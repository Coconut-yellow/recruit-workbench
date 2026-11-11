import React, { useState } from "react";
import { api } from "../api.js";
import { useToast } from "../toast.jsx";

export default function Match({ ctx }) {
  const { jobs } = ctx;
  const toast = useToast();
  const [jobId, setJobId] = useState(jobs[0]?.id || "");
  const [jd, setJd] = useState(jobs[0]?.jd || "");
  const [must, setMust] = useState([]);
  const [nice, setNice] = useState([]);
  const [draft, setDraft] = useState({ must: "", nice: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  function pickJob(id) {
    setJobId(id);
    const job = jobs.find((j) => j.id === id);
    if (job?.jd) setJd(job.jd);
  }

  function addTag(kind, value) {
    const text = (value || "").trim();
    if (!text) return;
    if (kind === "must") setMust((list) => Array.from(new Set([...list, text])));
    else setNice((list) => Array.from(new Set([...list, text])));
    setDraft((d) => ({ ...d, [kind]: "" }));
  }

  async function run(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const data = await api.match({
        jd,
        jobId: jobId || undefined,
        must,
        nice,
      });
      setMust(data.must || []);
      setNice(data.nice || []);
      setResult(data);
    } catch (err) {
      toast(err.message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="card" onSubmit={run}>
        <h3>粘贴职位要求，生成 Must / Nice 并打分</h3>
        <p className="muted">规则匹配：按必须项命中率为主、加分项和年限为辅。可以先选职位带出 JD，再手工增删关键词。</p>
        <div className="form-grid">
          <label className="label">限定职位（可选）
            <select className="select" value={jobId} onChange={(e) => pickJob(e.target.value)}>
              <option value="">当前权限内全部候选人</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="label" style={{ marginTop: 12 }}>职位描述 / 要求
          <textarea className="textarea" value={jd} onChange={(e) => setJd(e.target.value)} placeholder="例如：必须具备 PPO/SAC、Isaac、Sim2Real……加分项：域随机、实机落地" />
        </label>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div>
            <div className="muted">Must</div>
            <div className="kw" style={{ margin: "8px 0" }}>
              {must.map((k) => (
                <span className="tag brand" key={k}>
                  {k}
                  <button type="button" onClick={() => setMust(must.filter((x) => x !== k))}>×</button>
                </span>
              ))}
            </div>
            <div className="row">
              <input className="input" value={draft.must} placeholder="添加必须项，回车"
                onChange={(e) => setDraft({ ...draft, must: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag("must", draft.must); } }}
              />
            </div>
          </div>
          <div>
            <div className="muted">Nice</div>
            <div className="kw" style={{ margin: "8px 0" }}>
              {nice.map((k) => (
                <span className="tag teal" key={k}>
                  {k}
                  <button type="button" onClick={() => setNice(nice.filter((x) => x !== k))}>×</button>
                </span>
              ))}
            </div>
            <div className="row">
              <input className="input" value={draft.nice} placeholder="添加加分项，回车"
                onChange={(e) => setDraft({ ...draft, nice: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag("nice", draft.nice); } }}
              />
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "匹配中…" : "开始匹配"}</button>
        </div>
      </form>

      {result ? (
        <section className="card">
          <h3>短名单 · {result.shortlist.length} / {result.total}</h3>
          {result.shortlist.map((c) => (
            <div key={c.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <div className="row">
                <b>{c.name}</b>
                <span className="muted">{c.title} · {c.job_title || "未关联职位"}</span>
                <div className="space" />
                <strong>{c.match.score}</strong>
              </div>
              <div className="score" style={{ margin: "8px 0" }}>
                <span style={{ width: `${c.match.score}%` }} />
              </div>
              <div className="kw">
                {(c.match.mustHits || []).map((k) => (
                  <span className="tag ok" key={`m${k}`}>Must {k}</span>
                ))}
                {(c.match.niceHits || []).map((k) => (
                  <span className="tag teal" key={`n${k}`}>Nice {k}</span>
                ))}
                {(c.match.missingMust || []).map((k) => (
                  <span className="tag danger" key={`x${k}`}>缺 {k}</span>
                ))}
              </div>
            </div>
          ))}
          {!result.shortlist.length ? <p className="muted">当前范围内没有候选人。</p> : null}
        </section>
      ) : null}
    </>
  );
}
