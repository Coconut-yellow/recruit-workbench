import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../toast.jsx";
import ProfileCard from "../ProfileCard.jsx";

export default function Archive({ ctx }) {
  const { jobs, candidates, refresh, user } = ctx;
  const toast = useToast();
  const [resumes, setResumes] = useState([]);
  const [drag, setDrag] = useState(false);
  const [jobId, setJobId] = useState("");
  const canEdit = user.role !== "readonly";

  async function load() {
    const data = await api.resumes();
    setResumes(data.resumes || []);
  }

  useEffect(() => {
    load().catch((err) => toast(err.message, "danger"));
  }, []);

  async function upload(file) {
    const form = new FormData();
    form.append("file", file);
    if (jobId) form.append("jobId", jobId);
    try {
      const data = await api.uploadResume(form);
      if (data.parseWarning) toast(data.parseWarning, "warn");
      else toast("简历已归档");
      await load();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  function onFiles(files) {
    [...files].forEach(upload);
  }

  async function link(resume, patch) {
    try {
      await api.updateResume(resume.id, patch);
      await load();
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  async function intoTalent(resume) {
    try {
      const data = await api.importResume(resume.id, { jobId: resume.job_id || jobId || undefined });
      toast(data.already ? "该简历已在人才库中" : `已写入人才库：${data.candidate.name}`);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      toast(err.message, "danger");
    }
  }

  return (
    <>
      <div className="row">
        <select className="select" style={{ maxWidth: 260 }} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">上传时暂不关联职位</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.title}</option>
          ))}
        </select>
        <span className="muted">支持 PDF / DOCX，单文件不超过 15 MB。</span>
      </div>
      {canEdit ? (
        <label
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFiles(e.dataTransfer.files);
          }}
        >
          把简历拖到这里，或点击选择文件
          <input
            type="file"
            accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
            multiple
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
      ) : (
        <div className="alert info">只读角色可以查看已归档的简历，但不能上传。</div>
      )}
      {resumes.map((r) => (
        <article className="card" key={r.id}>
          <div className="row">
            <h3 style={{ margin: 0 }}>{r.original_name}</h3>
            <span className="faint">{Math.round((r.size || 0) / 1024)} KB</span>
            <a className="btn btn-sm" href={api.resumeFileUrl(r.id)} target="_blank" rel="noreferrer">下载</a>
            <div className="space" />
            {canEdit && !r.candidate_id ? (
              <button className="btn btn-sm btn-primary" type="button" onClick={() => intoTalent(r)}>
                写入人才库
              </button>
            ) : null}
          </div>
          <ProfileCard profile={r.parsed_profile} stacks={r.parsed_stacks} fallbackName={r.parsed_name} />
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="label">关联职位
              <select
                className="select"
                disabled={!canEdit}
                value={r.job_id || ""}
                onChange={(e) => link(r, { jobId: e.target.value, candidateId: r.candidate_id })}
              >
                <option value="">未关联</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </label>
            <label className="label">关联候选人
              <select
                className="select"
                disabled={!canEdit}
                value={r.candidate_id || ""}
                onChange={(e) => link(r, { candidateId: e.target.value, jobId: r.job_id })}
              >
                <option value="">未关联</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {c.job_title || "未分职位"}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="faint">
            上传人：{r.uploader_name || "—"} · {new Date(r.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
          </p>
        </article>
      ))}
      {!resumes.length ? <div className="card muted">还没有归档简历。</div> : null}
    </>
  );
}
