import React from "react";

function clean(value) {
  const text = String(value || "").trim();
  if (!text || text.includes("\uFFFD")) return "";
  if (/[\u0080-\u00ff]{4,}/.test(text) || /[\uE000-\uF8FF\u3100-\u312F]/.test(text)) return "";
  return text;
}

function LockIcon() {
  return (
    <svg className="profile-ico lock" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.2" y="7" width="9.6" height="6.2" rx="1.4" fill="currentColor" />
      <path d="M5.2 7V5.1a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CapIcon() {
  return (
    <svg className="profile-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2 1.6 5.4 8 8.6l6.4-3.2L8 2.2Z" fill="currentColor" />
      <path d="M4.2 7.1v3c0 .2 1.6 2.2 3.8 2.2s3.8-2 3.8-2.2v-3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M14.1 6.2v3.3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CaseIcon() {
  return (
    <svg className="profile-ico" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.8" y="5" width="12.4" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 5V3.8A1.2 1.2 0 0 1 7.2 2.6h1.6A1.2 1.2 0 0 1 10 3.8V5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 8.6h12.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg className="profile-ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export default function ProfileCard({ profile, stacks, fallbackName, fallbackTitle, fallbackYears }) {
  const source = profile || {};
  const name = clean(source.name) || clean(fallbackName) || "未识别";
  const meta = [
    clean(source.gender),
    source.age ? `${source.age}岁` : "",
    clean(source.degree),
    !source.age && !source.degree && fallbackYears ? `${fallbackYears} 年` : "",
  ].filter(Boolean);
  const education = Array.isArray(source.education) ? source.education : [];
  const work = Array.isArray(source.work) ? source.work : [];
  const tags = (source.tags || []).map(clean).filter(Boolean);
  const skills = (stacks || source.stacks || []).map(clean).filter(Boolean);
  const contact = [clean(source.phone), clean(source.email)].filter(Boolean);

  return (
    <div className="profile-card">
      <div className="profile-head">
        <LockIcon />
        <span className="pname">{name}</span>
        {meta.length ? <span className="pmeta">{meta.join(" ")}</span> : null}
      </div>
      {contact.length ? <div className="profile-contact">{contact.join(" · ")}</div> : null}
      {education.map((item) => (
        <div className="profile-row" key={`edu-${item.line}`}>
          <CapIcon />
          <span>{item.line}</span>
        </div>
      ))}
      {work.map((item, index) => (
        <div className="profile-row" key={`work-${item.line}`}>
          {index === 0 ? <CaseIcon /> : <DotIcon />}
          <span>{item.line}</span>
        </div>
      ))}
      {!education.length && !work.length && clean(fallbackTitle) ? (
        <div className="profile-row">
          <span>{clean(fallbackTitle)}</span>
        </div>
      ) : null}
      {tags.length || skills.length ? (
        <div className="kw profile-tags">
          {tags.map((tag) => (
            <span className="tag plain" key={`tag-${tag}`}>{tag}</span>
          ))}
          {skills.map((tag) => (
            <span className="tag teal" key={`skill-${tag}`}>{tag}</span>
          ))}
        </div>
      ) : null}
      {source.textQuality === "garbled" && !education.length && !work.length ? (
        <p className="faint">未能从正文可靠识别中文，已隐藏乱码。</p>
      ) : null}
      {source.textQuality === "empty" && !education.length && !work.length ? (
        <p className="faint">{name === "未识别" ? "未能提取正文。" : "未能提取正文，姓名来自文件名。"}</p>
      ) : null}
      {source.fileMissing ? <p className="faint">原文件已不在服务器上。信息若不全，请重新上传。</p> : null}
    </div>
  );
}
