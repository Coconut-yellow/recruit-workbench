import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { ASSIGN_LABELS, ROLE_LABELS } from "../constants.js";
import { useToast } from "../toast.jsx";

export default function Collab({ ctx }) {
  const { jobs, user, refresh } = ctx;
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ email: "", name: "", jobId: "", assignRole: "collaborator" });
  const canAdmin = user.role === "admin";
  const canAdd = canAdmin || user.role === "hiring_manager";

  async function load() {
    const data = await api.users();
    setUsers(data.users || []);
  }

  useEffect(() => {
    load().catch((err) => toast(err.message, "danger"));
  }, []);

  async function changeRole(id, role) {
    try {
      await api.updateUserRole(id, role);
      toast("系统角色已更新");
      await load();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function lookup(e) {
    e.preventDefault();
    try {
      const data = await api.lookupUser(form);
      if (data.lookupOk) toast(`已找到飞书用户并保存：${data.user.name || form.email}`);
      else toast(data.lookupError || "已保存邮箱，可稍后重试通讯录查询", "warn");
      setForm({ ...form, email: "", name: "" });
      await Promise.all([load(), refresh()]);
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function retry(id) {
    try {
      const data = await api.retryLookup(id);
      toast(data.lookupOk ? "已绑定飞书账号" : data.lookupError || "仍未找到", data.lookupOk ? "ok" : "warn");
      await load();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  return (
    <>
      <section className="card">
        <h3>权限说明</h3>
        <p className="muted">
          管理员可看全部职位。招聘负责人可创建职位，并给自己负责的职位分配同事。
          协作面试官可在被分配的职位上推进候选人。只读只能查看被分配的职位。
          职位协作身份分为负责人、面试官、协作；阶段变更会通知负责人和面试官。
        </p>
      </section>

      {canAdd ? (
        <form className="card" onSubmit={lookup}>
          <h3>用工作邮箱添加同事</h3>
          <p className="muted">会调用飞书通讯录按邮箱换取 open_id。若失败，仍会保存邮箱，可稍后重试。</p>
          <div className="form-grid">
            <label className="label">工作邮箱
              <input className="input" type="email" value={form.email} required onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="label">显示名（可选）
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="label">同时挂到职位
              <select className="select" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })}>
                <option value="">暂不分配</option>
                {jobs.filter((j) => j.canManage || canAdmin).map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </label>
            <label className="label">职位角色
              <select className="select" value={form.assignRole} onChange={(e) => setForm({ ...form, assignRole: e.target.value })}>
                <option value="owner">负责人</option>
                <option value="interviewer">面试官</option>
                <option value="collaborator">协作</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="submit">查询并添加</button>
          </div>
        </form>
      ) : null}

      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>同事</th>
              <th>系统角色</th>
              <th>飞书</th>
              <th>职位分配</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.name}</b>
                  <div className="faint">{u.email || "无邮箱"} · {u.title || ""}</div>
                </td>
                <td>
                  {canAdmin ? (
                    <select className="select" value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                      {Object.entries(ROLE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABELS[u.role] || u.role
                  )}
                </td>
                <td>
                  {u.feishuBound ? <span className="tag ok">已绑定</span> : <span className="tag warn">未绑定</span>}
                  {u.lastError ? <div className="faint">{u.lastError}</div> : null}
                  {canAdd && u.email && !u.feishuBound ? (
                    <button className="btn btn-sm" type="button" style={{ marginTop: 6 }} onClick={() => retry(u.id)}>
                      重试查询
                    </button>
                  ) : null}
                </td>
                <td>
                  <div className="kw">
                    {(u.assignments || []).map((a) => (
                      <span className="tag" key={a.job_id}>
                        {a.title} · {ASSIGN_LABELS[a.role] || a.role}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
