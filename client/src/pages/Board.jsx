import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { STAGES } from "../constants.js";
import { useToast, formatNotify } from "../toast.jsx";

export default function Board({ ctx }) {
  const { jobs, candidates, refresh } = ctx;
  const toast = useToast();
  const [jobId, setJobId] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [events, setEvents] = useState([]);

  const visible = useMemo(() => {
    return candidates.filter((c) => {
      if (jobId && c.job_id !== jobId) return false;
      if (q && !`${c.name}${c.title}${c.job_title || ""}`.includes(q)) return false;
      return true;
    });
  }, [candidates, jobId, q]);

  async function move(c, stage) {
    if (c.stage === stage) return;
    try {
      const data = await api.moveStage(c.id, stage);
      await refresh();
      const msg = formatNotify(data.notifyResult || []);
      const failed = (data.notifyResult || []).some((r) => !r.ok);
      toast(msg, failed ? "warn" : "ok");
      if (open?.id === c.id) setOpen(data.candidate);
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function openCard(c) {
    setOpen(c);
    try {
      const data = await api.candidateEvents(c.id);
      setEvents(data.events || []);
    } catch {
      setEvents([]);
    }
  }

  function onDrop(e, stage) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const c = candidates.find((x) => x.id === id);
    if (c) move(c, stage);
  }

  return (
    <>
      <div className="row">
        <div className="filters">
          <button className={`chip ${jobId === "" ? "active" : ""}`} type="button" onClick={() => setJobId("")}>
            全部职位
          </button>
          {jobs.map((j) => (
            <button
              key={j.id}
              className={`chip ${jobId === j.id ? "active" : ""}`}
              type="button"
              onClick={() => setJobId(j.id)}
            >
              {j.title}
            </button>
          ))}
        </div>
        <div className="space" />
        <input className="input" style={{ maxWidth: 220 }} placeholder="搜索候选人" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="kanban">
        {STAGES.map((stage) => {
          const list = visible.filter((c) => c.stage === stage);
          return (
            <div
              key={stage}
              className="col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, stage)}
            >
              <div className="col-h">
                <strong>{stage}</strong>
                <span className="tag">{list.length}</span>
              </div>
              {list.map((c) => (
                <article
                  key={c.id}
                  className="cand"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                  onClick={() => openCard(c)}
                >
                  <div className="name">{c.name}</div>
                  <div className="sub">{c.title || "—"} · {c.years || 0} 年</div>
                  <div className="row">
                    <span className="tag brand">{c.job_title || "未关联职位"}</span>
                    <div className="space" />
                    {STAGES.map((s, i) =>
                      s !== c.stage && Math.abs(STAGES.indexOf(c.stage) - i) === 1 ? (
                        <button
                          key={s}
                          className="btn btn-sm"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            move(c, s);
                          }}
                        >
                          {STAGES.indexOf(c.stage) < i ? "推进" : "回退"}
                        </button>
                      ) : null
                    )}
                  </div>
                </article>
              ))}
            </div>
          );
        })}
      </div>
      {open ? (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3 style={{ margin: 0 }}>{open.name}</h3>
              <div className="space" />
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => setOpen(null)}>
                关闭
              </button>
            </div>
            <p className="muted">
              {open.title} · {open.years || 0} 年经验 · {open.job_title || "未关联职位"}
            </p>
            <div className="kw">
              {(open.stacks || []).map((s) => (
                <span className="tag teal" key={s}>{s}</span>
              ))}
            </div>
            <p className="muted">{(open.highlights || []).join(" · ")}</p>
            <div className="label">
              调整阶段
              <select
                className="select"
                value={open.stage}
                onChange={(e) => move(open, e.target.value)}
              >
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <h3 style={{ marginTop: 18 }}>阶段记录</h3>
            {events.length === 0 ? (
              <p className="muted">暂无推进记录。</p>
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="muted" style={{ marginBottom: 8 }}>
                  {new Date(ev.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                  {" · "}
                  {ev.actor_name || "系统"}：{ev.from_stage} → {ev.to_stage}
                  <div className="faint">{formatNotify(ev.notify_result || [])}</div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
