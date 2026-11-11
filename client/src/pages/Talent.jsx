import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { STAGES } from "../constants.js";
import { useToast, formatNotify } from "../toast.jsx";
import ProfileCard from "../ProfileCard.jsx";

const EMPTY = {
  name: "", title: "", years: "", stacks: "", highlights: "",
  stage: "待筛选", job_id: "", notes: "",
};

export default function Talent({ ctx }) {
  const { jobs, candidates, refresh, user } = ctx;
  const toast = useToast();
  const [q, setQ] = useState("");
  const [jobId, setJobId] = useState("");
  const [form, setForm] = useState(EMPTY);
  const canEdit = user.role !== "readonly";

  const list = useMemo(() => {
    return candidates.filter((c) => {
      if (jobId && c.job_id !== jobId) return false;
      if (q && !`${c.name}${c.title}${(c.stacks || []).join("")}`.includes(q)) return false;
      return true;
    });
  }, [candidates, jobId, q]);

  async function create(e) {
    e.preventDefault();
    try {
      await api.createCandidate({
        ...form,
        years: Number(form.years || 0),
        stacks: form.stacks.split(/[|/,，、]+/).map((s) => s.trim()).filter(Boolean),
        highlights: form.highlights.split(/[|/,，、]+/).map((s) => s.trim()).filter(Boolean),
      });
      setForm(EMPTY);
      toast("已写入人才库");
      await refresh();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function move(c, stage) {
    try {
      const data = await api.moveStage(c.id, stage);
      await refresh();
      toast(formatNotify(data.notifyResult || []), (data.notifyResult || []).some((r) => !r.ok) ? "warn" : "ok");
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function changeJob(c, nextJobId) {
    try {
      await api.updateCandidate(c.id, { job_id: nextJobId || null });
      await refresh();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  return (
    <>
      <div className="row">
        <select className="select" style={{ maxWidth: 240 }} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">全部职位</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.title}</option>
          ))}
        </select>
        <input className="input" style={{ maxWidth: 240 }} placeholder="搜索姓名 / 技能" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">共 {list.length} 人</span>
      </div>
      {canEdit ? (
        <form className="card" onSubmit={create}>
          <h3>新增候选人</h3>
          <div className="form-grid">
            <label className="label">姓名
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="label">当前头衔
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="label">年限
              <input className="input" type="number" min="0" value={form.years} onChange={(e) => setForm({ ...form, years: e.target.value })} />
            </label>
            <label className="label">关联职位
              <select className="select" value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })}>
                <option value="">暂不关联</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </label>
            <label className="label">技能（用顿号或逗号分隔）
              <input className="input" value={form.stacks} onChange={(e) => setForm({ ...form, stacks: e.target.value })} />
            </label>
            <label className="label">亮点
              <input className="input" value={form.highlights} onChange={(e) => setForm({ ...form, highlights: e.target.value })} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="submit">保存</button>
          </div>
        </form>
      ) : null}
      {list.map((c) => (
        <article className="card" key={c.id}>
          <ProfileCard
            profile={c.profile}
            stacks={c.stacks}
            fallbackName={c.name}
            fallbackTitle={c.title}
            fallbackYears={c.years}
          />
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label className="label">关联职位
              <select
                className="select"
                value={c.job_id || ""}
                disabled={!canEdit}
                onChange={(e) => changeJob(c, e.target.value)}
              >
                <option value="">未关联</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </label>
            <label className="label">阶段
              <select
                className="select"
                value={c.stage}
                disabled={!canEdit || !c.job_id}
                onChange={(e) => move(c, e.target.value)}
              >
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        </article>
      ))}
      {!list.length ? <div className="card muted">没有符合条件的候选人。</div> : null}
    </>
  );
}
