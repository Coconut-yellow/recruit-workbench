import React, { useState } from "react";
import { api } from "../api.js";
import { ASSIGN_LABELS, ROLE_LABELS } from "../constants.js";
import { useToast } from "../toast.jsx";

const EMPTY = { title: "", must: "", nice: "", level: "", location: "深圳", status: "招聘中", jd: "" };

export default function Jobs({ ctx }) {
  const { jobs, user, refresh } = ctx;
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [users, setUsers] = useState([]);
  const [assign, setAssign] = useState({ jobId: "", userId: "", role: "interviewer" });

  async function loadUsers() {
    const data = await api.users();
    setUsers(data.users || []);
  }

  React.useEffect(() => {
    loadUsers().catch(() => {});
  }, []);

  const canCreate = user.role === "admin" || user.role === "hiring_manager";

  async function save(e) {
    e.preventDefault();
    try {
      if (editing) {
        await api.updateJob(editing, form);
        toast("职位已更新");
      } else {
        await api.createJob(form);
        toast("职位已创建");
      }
      setForm(EMPTY);
      setEditing(null);
      await refresh();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  function startEdit(job) {
    setEditing(job.id);
    setForm({
      title: job.title,
      must: job.must || "",
      nice: job.nice || "",
      level: job.level || "",
      location: job.location || "",
      status: job.status || "招聘中",
      jd: job.jd || "",
    });
  }

  async function assignMember(e) {
    e.preventDefault();
    try {
      await api.assignMember(assign.jobId, { userId: assign.userId, role: assign.role });
      toast("已分配协作同事");
      await refresh();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function removeMember(jobId, userId) {
    try {
      await api.removeMember(jobId, userId);
      await refresh();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  return (
    <>
      {canCreate ? (
        <form className="card" onSubmit={save}>
          <h3>{editing ? "编辑职位" : "新建职位"}</h3>
          <div className="form-grid">
            <label className="label">名称
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </label>
            <label className="label">职级
              <input className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
            </label>
            <label className="label">地点
              <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
            <label className="label">状态
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option>招聘中</option>
                <option>暂停</option>
                <option>已关闭</option>
              </select>
            </label>
            <label className="label">必须能力
              <input className="input" value={form.must} onChange={(e) => setForm({ ...form, must: e.target.value })} />
            </label>
            <label className="label">加分项
              <input className="input" value={form.nice} onChange={(e) => setForm({ ...form, nice: e.target.value })} />
            </label>
          </div>
          <label className="label" style={{ marginTop: 12 }}>职位描述
            <textarea className="textarea" value={form.jd} onChange={(e) => setForm({ ...form, jd: e.target.value })} />
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="submit">{editing ? "保存" : "创建"}</button>
            {editing ? (
              <button className="btn" type="button" onClick={() => { setEditing(null); setForm(EMPTY); }}>取消</button>
            ) : null}
          </div>
        </form>
      ) : null}

      {jobs.map((job) => (
        <section className="card" key={job.id}>
          <div className="row">
            <h3 style={{ margin: 0 }}>{job.title}</h3>
            <span className={`tag ${job.status === "招聘中" ? "ok" : "warn"}`}>{job.status}</span>
            <span className="tag">{job.location} · {job.level}</span>
            <span className="faint">{job.candidate_count} 位候选人</span>
            <div className="space" />
            {job.canManage ? (
              <button className="btn btn-sm" type="button" onClick={() => startEdit(job)}>编辑</button>
            ) : null}
          </div>
          <p className="muted">必须：{job.must || "—"}</p>
          <p className="muted">加分：{job.nice || "—"}</p>
          <div className="kw">
            {(job.members || []).map((m) => (
              <span className="tag" key={m.userId}>
                {m.name} · {ASSIGN_LABELS[m.assignRole] || m.assignRole}
                {job.canManage ? (
                  <button type="button" className="kw" onClick={() => removeMember(job.id, m.userId)} aria-label="移除">
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          {job.canManage ? (
            <form className="row" style={{ marginTop: 12 }} onSubmit={assignMember}>
              <select
                className="select"
                style={{ maxWidth: 180 }}
                value={assign.jobId === job.id ? assign.userId : ""}
                onChange={(e) => setAssign({ ...assign, jobId: job.id, userId: e.target.value })}
                required
              >
                <option value="">选择同事</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{ROLE_LABELS[u.role]}）
                  </option>
                ))}
              </select>
              <select
                className="select"
                style={{ maxWidth: 140 }}
                value={assign.jobId === job.id ? assign.role : "interviewer"}
                onChange={(e) => setAssign({ ...assign, jobId: job.id, role: e.target.value })}
              >
                <option value="owner">负责人</option>
                <option value="interviewer">面试官</option>
                <option value="collaborator">协作</option>
              </select>
              <button className="btn btn-sm btn-primary" type="submit" onClick={() => setAssign((a) => ({ ...a, jobId: job.id }))}>
                分配
              </button>
            </form>
          ) : null}
        </section>
      ))}
      {!jobs.length ? <div className="card muted">当前视角下没有可见职位。</div> : null}
    </>
  );
}
