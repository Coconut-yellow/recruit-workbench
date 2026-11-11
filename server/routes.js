import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { RESUME_DIR, STAGES, ROLE_LABELS, DEV_LOGIN, APP_ID, PUBLIC_URL, FEISHU_REDIRECT_URI } from "./config.js";
import { all, get, run, parseJsonCol } from "./db.js";
import {
  requireUser,
  publicUser,
  handleDevLogin,
  handleLogout,
  handleJsapiCode,
} from "./auth.js";
import * as perms from "./perms.js";
import {
  extractFile,
  extractJdKeywords,
  scoreCandidate,
  PARSE_VERSION,
  presentFilename,
  parseResumeText,
  repairMojibake,
  looksGarbled,
} from "./extract.js";
import { generateJobRequirements } from "./llm.js";
import {
  getTenantAccessToken,
  batchGetIdByEmails,
  notifyStageChange,
  feishuPublicStatus,
} from "./feishu.js";
import {
  backfillLocalResumes,
  driveStatus,
  materializeResumeFile,
  missingResumeMessage,
  uploadResumeBytes,
} from "./drive.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

function shapeCandidate(row) {
  if (!row) return null;
  return {
    ...row,
    stacks: parseJsonCol(row.stacks, []),
    highlights: parseJsonCol(row.highlights, []),
    profile: parseJsonCol(row.profile, null),
  };
}

function shapeResume(row) {
  if (!row) return null;
  const profile = parseJsonCol(row.parsed_profile, null);
  const quality = profile?.textQuality;
  const text = row.extracted_text ? String(row.extracted_text) : "";
  const showText = quality === "ok" && text && !looksGarbled(text);
  return {
    ...row,
    original_name: presentFilename(row.original_name),
    parsed_stacks: parseJsonCol(row.parsed_stacks, []),
    parsed_profile: profile,
    extracted_text: showText ? text.slice(0, 4000) : "",
  };
}

function profileHighlights(profile) {
  return [
    ...(profile?.education || []).map((item) => item.line).filter(Boolean),
    ...(profile?.work || []).map((item) => item.line).filter(Boolean),
  ];
}

async function parsedFromStoredResume(row) {
  const filename = presentFilename(row.original_name);
  const file = await materializeResumeFile(row);
  if (file.ok) {
    const parsed = await extractFile(file.path, filename, row.mime);
    parsed.profile.fileMissing = false;
    parsed.filename = filename;
    return parsed;
  }
  const parsed = parseResumeText(repairMojibake(row.extracted_text || ""), filename);
  parsed.method = "stored-text";
  parsed.profile.fileMissing = true;
  if (parsed.profile.textQuality === "ok") parsed.profile.textQuality = "partial";
  return parsed;
}

function syncLinkedCandidate(row, profile, stacks) {
  if (!row.candidate_id) return;
  const candidate = get("SELECT * FROM candidates WHERE id = ?", [row.candidate_id]);
  if (!candidate) return;
  const badName = !candidate.name
    || candidate.name === "未识别"
    || looksGarbled(candidate.name)
    || candidate.name === row.parsed_name;
  if (!badName && candidate.profile) return;
  const highlights = profileHighlights(profile);
  const previousStacks = parseJsonCol(candidate.stacks, []);
  const previousHighlights = parseJsonCol(candidate.highlights, []);
  run(
    `UPDATE candidates SET name=?, title=?, years=?, stacks=?, highlights=?, email=?, profile=?, updated_at=? WHERE id=?`,
    [
      badName ? (profile.name || "未识别") : candidate.name,
      badName ? (profile.title || candidate.title || "") : (candidate.title || profile.title || ""),
      badName ? Number(profile.years || 0) : Number(candidate.years || profile.years || 0),
      JSON.stringify(stacks.length ? stacks : previousStacks),
      JSON.stringify(highlights.length ? highlights : previousHighlights),
      candidate.email || profile.email || "",
      JSON.stringify(profile),
      nowIso(),
      candidate.id,
    ]
  );
}

function persistResumeParse(row, parsed) {
  const profile = parsed.profile || {};
  const filename = parsed.filename || presentFilename(row.original_name);
  run(
    `UPDATE resumes SET original_name=?, extracted_text=?, parsed_name=?, parsed_title=?, parsed_years=?, parsed_stacks=?, parsed_profile=?, parse_version=? WHERE id=?`,
    [
      filename,
      parsed.text || "",
      profile.name || "",
      profile.title || "",
      profile.years ?? null,
      JSON.stringify(parsed.stacks || []),
      JSON.stringify(profile),
      PARSE_VERSION,
      row.id,
    ]
  );
  syncLinkedCandidate(row, profile, parsed.stacks || []);
  row.original_name = filename;
  row.extracted_text = parsed.text || "";
  row.parsed_name = profile.name || "";
  row.parsed_title = profile.title || "";
  row.parsed_years = profile.years ?? null;
  row.parsed_stacks = JSON.stringify(parsed.stacks || []);
  row.parsed_profile = JSON.stringify(profile);
  row.parse_version = PARSE_VERSION;
  return row;
}

async function refreshResume(row) {
  if (Number(row.parse_version || 0) >= PARSE_VERSION) return row;
  try {
    return persistResumeParse(row, await parsedFromStoredResume(row));
  } catch {
    return row;
  }
}

function jobScopeSql(user, alias = "job_id") {
  const ids = perms.visibleJobIds(user);
  if (ids === null) return { sql: "1=1", params: [] };
  if (!ids.length) return { sql: "1=0", params: [] };
  const placeholders = ids.map(() => "?").join(",");
  return { sql: `${alias} IN (${placeholders})`, params: ids };
}

function handleError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "服务器错误" });
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, name: "轻量招聘台" });
});

router.get("/auth/config", (req, res) => {
  res.json({
    devLogin: DEV_LOGIN,
    appId: APP_ID,
    publicUrl: PUBLIC_URL,
    redirectUri: FEISHU_REDIRECT_URI,
    feishu: feishuPublicStatus(),
  });
});

router.get("/auth/dev-users", (req, res) => {
  if (!DEV_LOGIN) return res.status(403).json({ error: "本地开发登录未开启" });
  const users = all("SELECT * FROM users ORDER BY role, name").map(publicUser);
  res.json({ users, roles: ROLE_LABELS });
});

router.post("/auth/dev-login", handleDevLogin);
router.post("/auth/logout", handleLogout);
router.post("/auth/feishu/jsapi", handleJsapiCode);

router.get("/me", requireUser, (req, res) => {
  res.json({ user: publicUser(req.user), devLogin: DEV_LOGIN });
});

router.get("/feishu/status", requireUser, async (_req, res) => {
  const pub = feishuPublicStatus();
  const token = pub.configured ? await getTenantAccessToken() : { ok: false, error: "未配置密钥" };
  res.json({
    ...pub,
    tenantToken: token.ok,
    tenantError: token.ok ? "" : token.error || "",
    tenantCached: Boolean(token.cached),
    drive: driveStatus({ includeToken: false }),
  });
});

router.get("/feishu/drive", requireUser, (req, res) => {
  if (!perms.isAdmin(req.user)) return res.status(403).json({ error: "只有管理员可以查看云空间配置" });
  res.json(driveStatus({ includeToken: true }));
});

router.post("/feishu/drive/backfill", requireUser, async (req, res) => {
  try {
    if (!perms.isAdmin(req.user)) return res.status(403).json({ error: "只有管理员可以补传简历" });
    const result = await backfillLocalResumes();
    res.json({ ...result, drive: driveStatus({ includeToken: true }) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/feishu/token-check", requireUser, async (_req, res) => {
  const token = await getTenantAccessToken();
  res.json({
    ok: token.ok,
    error: token.ok ? "" : token.error || "",
    expire: token.expire || null,
  });
});

router.get("/jobs", requireUser, (req, res) => {
  const scope = jobScopeSql(req.user, "j.id");
  const jobs = all(
    `SELECT j.*,
      (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id) AS candidate_count
     FROM jobs j
     WHERE ${scope.sql}
     ORDER BY j.status ASC, j.created_at DESC`,
    scope.params
  );
  const members = all(
    `SELECT jm.*, u.name, u.email, u.role AS user_role, u.feishu_open_id
     FROM job_members jm JOIN users u ON u.id = jm.user_id`
  );
  const byJob = {};
  for (const m of members) {
    (byJob[m.job_id] ||= []).push({
      userId: m.user_id,
      name: m.name,
      email: m.email,
      assignRole: m.role,
      userRole: m.user_role,
      feishuBound: Boolean(m.feishu_open_id),
    });
  }
  res.json({
    jobs: jobs.map((j) => ({
      ...j,
      members: byJob[j.id] || [],
      canManage: perms.canManageJob(req.user, j.id),
      canDelete: perms.canDeleteJob(req.user, j.id),
      canMove: perms.canMoveCandidate(req.user, j.id),
    })),
  });
});

router.post("/jobs/generate-requirements", requireUser, async (req, res) => {
  try {
    const jobId = req.body?.jobId || "";
    if (jobId) {
      const job = get("SELECT id FROM jobs WHERE id = ?", [jobId]);
      if (!job) return res.status(404).json({ error: "职位不存在" });
    }
    perms.assert(
      perms.canGenerateJobRequirements(req.user, jobId),
      "当前角色不能根据 JD 生成要求"
    );
    const generated = await generateJobRequirements({
      jd: req.body?.jd,
      title: req.body?.title,
    });
    res.json(generated);
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/jobs", requireUser, (req, res) => {
  try {
    perms.assert(perms.canCreateJob(req.user), "当前角色不能创建职位");
    const { title, must, nice, level, location, status, jd } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "请填写职位名称" });
    }
    const id = newId("job");
    const now = nowIso();
    run(
      `INSERT INTO jobs (id, title, must, nice, level, location, status, jd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(title).trim(),
        must || "",
        nice || "",
        level || "",
        location || "深圳",
        status || "招聘中",
        jd || "",
        now,
        now,
      ]
    );
    if (req.user.role !== "admin") {
      run(
        "INSERT INTO job_members (job_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        [id, req.user.id, now]
      );
    }
    res.json({ job: get("SELECT * FROM jobs WHERE id = ?", [id]) });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/jobs/:id", requireUser, (req, res) => {
  try {
    const job = get("SELECT * FROM jobs WHERE id = ?", [req.params.id]);
    if (!job) return res.status(404).json({ error: "职位不存在" });
    perms.assert(perms.canDeleteJob(req.user, job.id), "只有管理员或该职位负责人可以删除职位");
    const now = nowIso();
    const unlinkedCandidates = run(
      "UPDATE candidates SET job_id = NULL, updated_at = ? WHERE job_id = ?",
      [now, job.id]
    ).changes;
    const unlinkedResumes = run(
      "UPDATE resumes SET job_id = NULL WHERE job_id = ?",
      [job.id]
    ).changes;
    run("DELETE FROM job_members WHERE job_id = ?", [job.id]);
    run("DELETE FROM jobs WHERE id = ?", [job.id]);
    res.json({ ok: true, unlinkedCandidates, unlinkedResumes });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/jobs/:id", requireUser, (req, res) => {
  try {
    const job = get("SELECT * FROM jobs WHERE id = ?", [req.params.id]);
    if (!job) return res.status(404).json({ error: "职位不存在" });
    perms.assert(perms.canEditJobContent(req.user, job.id), "无权编辑该职位");
    const fields = ["title", "must", "nice", "level", "location", "status", "jd"];
    const next = { ...job };
    for (const f of fields) {
      if (req.body[f] !== undefined) next[f] = req.body[f];
    }
    run(
      `UPDATE jobs SET title=?, must=?, nice=?, level=?, location=?, status=?, jd=?, updated_at=? WHERE id=?`,
      [next.title, next.must, next.nice, next.level, next.location, next.status, next.jd, nowIso(), job.id]
    );
    res.json({ job: get("SELECT * FROM jobs WHERE id = ?", [job.id]) });
  } catch (err) {
    handleError(res, err);
  }
});

router.put("/jobs/:id/members", requireUser, (req, res) => {
  try {
    const job = get("SELECT * FROM jobs WHERE id = ?", [req.params.id]);
    if (!job) return res.status(404).json({ error: "职位不存在" });
    perms.assert(perms.canAssign(req.user, job.id), "只有管理员或该职位负责人可以分配协作同事");
    const userId = req.body?.userId;
    const role = req.body?.role;
    if (!["owner", "interviewer", "collaborator"].includes(role)) {
      return res.status(400).json({ error: "协作角色无效，请选择负责人 / 面试官 / 协作" });
    }
    const user = get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return res.status(404).json({ error: "同事不存在" });
    const existing = get(
      "SELECT * FROM job_members WHERE job_id = ? AND user_id = ?",
      [job.id, userId]
    );
    const now = nowIso();
    if (existing) {
      run("UPDATE job_members SET role = ? WHERE job_id = ? AND user_id = ?", [
        role,
        job.id,
        userId,
      ]);
    } else {
      run(
        "INSERT INTO job_members (job_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
        [job.id, userId, role, now]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/jobs/:id/members/:userId", requireUser, (req, res) => {
  try {
    perms.assert(
      perms.canAssign(req.user, req.params.id),
      "只有管理员或该职位负责人可以移除协作同事"
    );
    run("DELETE FROM job_members WHERE job_id = ? AND user_id = ?", [
      req.params.id,
      req.params.userId,
    ]);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/candidates", requireUser, (req, res) => {
  const scope = jobScopeSql(req.user, "c.job_id");
  const params = [...scope.params];
  let where = scope.sql;
  if (req.query.jobId) {
    if (!perms.canSeeJob(req.user, req.query.jobId)) {
      return res.status(403).json({ error: "无权查看该职位" });
    }
    where += " AND c.job_id = ?";
    params.push(req.query.jobId);
  }
  if (req.query.stage) {
    where += " AND c.stage = ?";
    params.push(req.query.stage);
  }
  if (req.query.q) {
    where += " AND (c.name LIKE ? OR c.title LIKE ? OR c.stacks LIKE ?)";
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  const rows = all(
    `SELECT c.*, j.title AS job_title
     FROM candidates c
     LEFT JOIN jobs j ON j.id = c.job_id
     WHERE ${where}
     ORDER BY c.updated_at DESC`,
    params
  );
  res.json({ candidates: rows.map(shapeCandidate), stages: STAGES });
});

router.post("/candidates", requireUser, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: "请填写候选人姓名" });
    }
    if (body.job_id) {
      perms.assert(perms.canMutateCandidate(req.user, body.job_id), "无权在该职位下新增候选人");
    } else {
      perms.assert(req.user.role !== "readonly", "只读角色不能新增候选人");
    }
    const id = newId("can");
    const now = nowIso();
    const stage = STAGES.includes(body.stage) ? body.stage : "待筛选";
    run(
      `INSERT INTO candidates (id, name, title, years, stacks, highlights, stage, score_base, job_id, resume_id, email, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(body.name).trim(),
        body.title || "",
        Number(body.years || 0),
        JSON.stringify(body.stacks || []),
        JSON.stringify(body.highlights || []),
        stage,
        Number(body.score_base || 70),
        body.job_id || null,
        body.resume_id || null,
        body.email || "",
        body.notes || "",
        now,
        now,
      ]
    );
    if (body.resume_id) {
      run("UPDATE resumes SET candidate_id = ?, job_id = COALESCE(?, job_id) WHERE id = ?", [
        id,
        body.job_id || null,
        body.resume_id,
      ]);
    }
    res.json({ candidate: shapeCandidate(get("SELECT * FROM candidates WHERE id = ?", [id])) });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/candidates/:id", requireUser, (req, res) => {
  try {
    const row = get("SELECT * FROM candidates WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "候选人不存在" });
    if (row.job_id) {
      perms.assert(perms.canMutateCandidate(req.user, row.job_id), "无权编辑该候选人");
    } else {
      perms.assert(req.user.role !== "readonly", "只读角色不能编辑");
    }
    const next = shapeCandidate(row);
    const fields = ["name", "title", "years", "stage", "score_base", "job_id", "resume_id", "email", "notes"];
    for (const f of fields) {
      if (req.body[f] !== undefined) next[f] = req.body[f];
    }
    if (req.body.stacks !== undefined) next.stacks = req.body.stacks;
    if (req.body.highlights !== undefined) next.highlights = req.body.highlights;
    if (next.job_id) {
      perms.assert(perms.canSeeJob(req.user, next.job_id), "无权关联到该职位");
    }
    if (next.stage && !STAGES.includes(next.stage)) {
      return res.status(400).json({ error: "阶段无效" });
    }
    run(
      `UPDATE candidates SET name=?, title=?, years=?, stacks=?, highlights=?, stage=?, score_base=?, job_id=?, resume_id=?, email=?, notes=?, updated_at=? WHERE id=?`,
      [
        next.name,
        next.title,
        Number(next.years || 0),
        JSON.stringify(next.stacks || []),
        JSON.stringify(next.highlights || []),
        next.stage,
        Number(next.score_base || 0),
        next.job_id || null,
        next.resume_id || null,
        next.email || "",
        next.notes || "",
        nowIso(),
        row.id,
      ]
    );
    res.json({ candidate: shapeCandidate(get("SELECT * FROM candidates WHERE id = ?", [row.id])) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/candidates/:id/stage", requireUser, async (req, res) => {
  try {
    const row = get("SELECT * FROM candidates WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "候选人不存在" });
    const toStage = req.body?.stage;
    if (!STAGES.includes(toStage)) return res.status(400).json({ error: "阶段无效" });
    perms.assert(row.job_id, "请先把候选人关联到职位，再推进阶段", 400);
    perms.assert(perms.canMoveCandidate(req.user, row.job_id), "无权推进该候选人阶段");
    const fromStage = row.stage;
    run("UPDATE candidates SET stage = ?, updated_at = ? WHERE id = ?", [
      toStage,
      nowIso(),
      row.id,
    ]);
    const job = get("SELECT * FROM jobs WHERE id = ?", [row.job_id]);
    const targets = all(
      `SELECT u.id, u.name, u.email, u.feishu_open_id AS open_id, jm.role
       FROM job_members jm JOIN users u ON u.id = jm.user_id
       WHERE jm.job_id = ? AND jm.role IN ('owner', 'interviewer')`,
      [row.job_id]
    );
    let notifyResult = [];
    if (fromStage !== toStage) {
      try {
        notifyResult = await notifyStageChange({
          recipients: targets,
          candidateName: row.name,
          jobTitle: job?.title || "",
          fromStage,
          toStage,
          actorName: req.user.name,
        });
      } catch (err) {
        notifyResult = [{ name: "系统", ok: false, error: err.message || "通知发送异常" }];
      }
    }
    const eventId = newId("evt");
    run(
      `INSERT INTO stage_events (id, candidate_id, job_id, from_stage, to_stage, actor_user_id, notify_result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, row.id, row.job_id, fromStage, toStage, req.user.id, JSON.stringify(notifyResult), nowIso()]
    );
    res.json({
      candidate: shapeCandidate(get("SELECT * FROM candidates WHERE id = ?", [row.id])),
      notifyResult,
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/candidates/:id/events", requireUser, (req, res) => {
  const row = get("SELECT * FROM candidates WHERE id = ?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "候选人不存在" });
  if (row.job_id && !perms.canSeeJob(req.user, row.job_id)) {
    return res.status(403).json({ error: "无权查看" });
  }
  const events = all(
    `SELECT e.*, u.name AS actor_name
     FROM stage_events e LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.candidate_id = ?
     ORDER BY e.created_at DESC`,
    [row.id]
  ).map((e) => ({ ...e, notify_result: parseJsonCol(e.notify_result, []) }));
  res.json({ events });
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RESUME_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".pdf", ".docx", ".doc"].includes(ext) ? ext : "";
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safeExt}`);
  },
});

const upload = multer({
  storage,
  defParamCharset: "utf8",
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const ok =
      [".pdf", ".docx", ".doc"].includes(ext) ||
      [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
      ].includes(file.mimetype);
    if (!ok) cb(new Error("仅支持 PDF / DOCX 简历"));
    else cb(null, true);
  },
});

router.get("/resumes", requireUser, async (req, res) => {
  try {
    let where;
    let params;
    if (perms.isAdmin(req.user)) {
      where = "1=1";
      params = [];
    } else {
      const ids = perms.visibleJobIds(req.user) || [];
      const ph = ids.length ? ids.map(() => "?").join(",") : "NULL";
      where = `(r.uploaded_by = ? OR r.job_id IN (${ph}))`;
      params = [req.user.id, ...ids];
    }
    const rows = all(
      `SELECT r.*, c.name AS candidate_name, j.title AS job_title, u.name AS uploader_name
       FROM resumes r
       LEFT JOIN candidates c ON c.id = r.candidate_id
       LEFT JOIN jobs j ON j.id = r.job_id
       LEFT JOIN users u ON u.id = r.uploaded_by
       WHERE ${where}
       ORDER BY r.created_at DESC`,
      params
    );
    const refreshed = [];
    for (const row of rows) refreshed.push(await refreshResume(row));
    res.json({ resumes: refreshed.map(shapeResume) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/resumes", requireUser, (req, res) => {
  if (req.user.role === "readonly") {
    return res.status(403).json({ error: "只读角色不能上传简历" });
  }
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });
    if (!req.file) return res.status(400).json({ error: "请选择文件" });
    try {
      const jobId = req.body?.jobId || null;
      if (jobId && !perms.canSeeJob(req.user, jobId)) {
        return res.status(403).json({ error: "无权关联到该职位" });
      }
      const filename = presentFilename(req.file.originalname);
      const parsed = await extractFile(req.file.path, filename, req.file.mimetype);
      parsed.filename = filename;
      const profile = parsed.profile || {};
      const id = newId("res");
      run(
        `INSERT INTO resumes (id, stored_name, original_name, mime, size, extracted_text, parsed_name, parsed_title, parsed_years, parsed_stacks, parsed_profile, parse_version, candidate_id, job_id, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          req.file.filename,
          filename,
          req.file.mimetype,
          req.file.size,
          parsed.text || "",
          profile.name || "",
          profile.title || "",
          profile.years ?? null,
          JSON.stringify(parsed.stacks || []),
          JSON.stringify(profile),
          PARSE_VERSION,
          req.body?.candidateId || null,
          jobId,
          req.user.id,
          nowIso(),
        ]
      );
      if (req.body?.candidateId) {
        run("UPDATE candidates SET resume_id = ?, updated_at = ? WHERE id = ?", [
          id,
          nowIso(),
          req.body.candidateId,
        ]);
      }
      const cloud = await uploadResumeBytes(
        filename,
        fs.readFileSync(req.file.path)
      );
      const cloudWarning = cloud.ok
        ? ""
        : `云备份失败：${cloud.error}。这份简历目前只在本机，重新部署后可能丢失。`;
      run(
        "UPDATE resumes SET feishu_file_token = ?, feishu_uploaded_at = ?, feishu_error = ? WHERE id = ?",
        [cloud.ok ? cloud.fileToken : null, cloud.ok ? nowIso() : null, cloud.ok ? null : cloud.error, id]
      );
      const row = get("SELECT * FROM resumes WHERE id = ?", [id]);
      res.json({
        resume: shapeResume(row),
        cloudWarning,
        parseWarning:
          parsed.method === "pdftotext-failed"
          || parsed.method === "pdftotext-missing"
          || parsed.method === "extract-error"
          || parsed.method === "unsupported-doc"
          || profile.textQuality === "garbled"
          || profile.textQuality === "empty"
            ? "未能可靠提取中文正文。已保留可识别字段，乱码不会当作姓名。"
            : "",
      });
    } catch (e) {
      handleError(res, e);
    }
  });
});

router.patch("/resumes/:id", requireUser, (req, res) => {
  try {
    const row = get("SELECT * FROM resumes WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "简历不存在" });
    if (req.user.role === "readonly") return res.status(403).json({ error: "只读角色不能修改" });
    const candidateId = req.body.candidateId !== undefined ? req.body.candidateId : row.candidate_id;
    const jobId = req.body.jobId !== undefined ? req.body.jobId : row.job_id;
    if (jobId && !perms.canSeeJob(req.user, jobId)) {
      return res.status(403).json({ error: "无权关联到该职位" });
    }
    run("UPDATE resumes SET candidate_id = ?, job_id = ? WHERE id = ?", [
      candidateId || null,
      jobId || null,
      row.id,
    ]);
    if (candidateId) {
      run("UPDATE candidates SET resume_id = ?, job_id = COALESCE(job_id, ?), updated_at = ? WHERE id = ?", [
        row.id,
        jobId || null,
        nowIso(),
        candidateId,
      ]);
    }
    res.json({ resume: shapeResume(get("SELECT * FROM resumes WHERE id = ?", [row.id])) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/resumes/:id/import", requireUser, async (req, res) => {
  try {
    if (req.user.role === "readonly") return res.status(403).json({ error: "只读角色不能写入人才库" });
    let row = get("SELECT * FROM resumes WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "简历不存在" });
    row = await refreshResume(row);
    const jobId = req.body?.jobId || row.job_id || null;
    if (jobId) {
      perms.assert(perms.canMutateCandidate(req.user, jobId), "无权写入该职位");
    }
    if (row.candidate_id) {
      return res.json({
        candidate: shapeCandidate(get("SELECT * FROM candidates WHERE id = ?", [row.candidate_id])),
        already: true,
      });
    }
    const id = newId("can");
    const now = nowIso();
    const profile = parseJsonCol(row.parsed_profile, null) || {};
    const stacks = parseJsonCol(row.parsed_stacks, []);
    const highlights = profileHighlights(profile);
    const name = profile.name || row.parsed_name || "未识别";
    run(
      `INSERT INTO candidates (id, name, title, years, stacks, highlights, stage, score_base, job_id, resume_id, email, profile, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '待筛选', 70, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        looksGarbled(name) ? "未识别" : name,
        profile.title || row.parsed_title || "",
        Number(profile.years || row.parsed_years || 0),
        JSON.stringify(stacks),
        JSON.stringify(highlights),
        jobId,
        row.id,
        profile.email || "",
        JSON.stringify(profile),
        now,
        now,
      ]
    );
    run("UPDATE resumes SET candidate_id = ?, job_id = COALESCE(?, job_id) WHERE id = ?", [
      id,
      jobId,
      row.id,
    ]);
    res.json({ candidate: shapeCandidate(get("SELECT * FROM candidates WHERE id = ?", [id])) });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/resumes/:id/file", requireUser, async (req, res) => {
  try {
  const row = get("SELECT * FROM resumes WHERE id = ?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "简历不存在" });
  if (!perms.isAdmin(req.user)) {
    const allowed =
      row.uploaded_by === req.user.id ||
      (row.job_id && perms.canSeeJob(req.user, row.job_id));
    if (!allowed) return res.status(403).json({ error: "无权下载该简历" });
  }
  const file = await materializeResumeFile(row);
  if (!file.ok) {
    const message = file.error || missingResumeMessage();
    res.status(404).type("html").send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>简历不可用</title></head>
<body style="font-family:sans-serif;padding:32px;line-height:1.6;color:#1a1714;background:#f3efe6">
<h1>打不开原简历</h1>
<p>${message.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]))}</p>
</body></html>`);
    return;
  }
  res.download(file.path, presentFilename(row.original_name));
  } catch (err) {
    if (!res.headersSent) handleError(res, err);
  }
});

router.post("/match", requireUser, (req, res) => {
  const { jd, jobId, must, nice } = req.body || {};
  const job = jobId ? get("SELECT * FROM jobs WHERE id = ?", [jobId]) : null;
  if (jobId && !perms.canSeeJob(req.user, jobId)) {
    return res.status(403).json({ error: "无权查看该职位" });
  }
  const extracted = extractJdKeywords(jd || job?.jd || "", job?.must || "", job?.nice || "");
  const mustKeys = Array.isArray(must) && must.length ? must : extracted.must;
  const niceKeys = Array.isArray(nice) && nice.length ? nice : extracted.nice;

  const scope = jobScopeSql(req.user, "c.job_id");
  const params = [...scope.params];
  let where = scope.sql;
  if (jobId) {
    where += " AND c.job_id = ?";
    params.push(jobId);
  }
  const candidates = all(
    `SELECT c.*, j.title AS job_title FROM candidates c
     LEFT JOIN jobs j ON j.id = c.job_id
     WHERE ${where}`,
    params
  ).map(shapeCandidate);

  const ranked = candidates
    .map((c) => {
      const s = scoreCandidate(c, mustKeys, niceKeys);
      return { ...c, match: s };
    })
    .sort((a, b) => b.match.score - a.match.score);

  res.json({
    must: mustKeys,
    nice: niceKeys,
    shortlist: ranked.slice(0, 12),
    total: ranked.length,
  });
});

router.get("/users", requireUser, (_req, res) => {
  const users = all("SELECT * FROM users ORDER BY role, name").map((u) => ({
    ...publicUser(u),
    assignments: all(
      `SELECT jm.job_id, jm.role, j.title
       FROM job_members jm JOIN jobs j ON j.id = jm.job_id
       WHERE jm.user_id = ?`,
      [u.id]
    ),
  }));
  res.json({ users, roleLabels: ROLE_LABELS });
});

router.patch("/users/:id", requireUser, (req, res) => {
  try {
    perms.assert(perms.canManageUsers(req.user), "只有管理员可以调整系统角色");
    const role = req.body?.role;
    if (!ROLE_LABELS[role]) return res.status(400).json({ error: "角色无效" });
    const user = get("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!user) return res.status(404).json({ error: "用户不存在" });
    run("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [role, nowIso(), user.id]);
    res.json({ user: publicUser(get("SELECT * FROM users WHERE id = ?", [user.id])) });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/users/lookup", requireUser, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "请填写有效的工作邮箱" });
    }
    const jobId = req.body?.jobId;
    const assignRole = req.body?.assignRole;
    if (jobId) {
      perms.assert(perms.canAssign(req.user, jobId), "无权给该职位分配同事");
    } else {
      perms.assert(
        perms.isAdmin(req.user) || req.user.role === "hiring_manager",
        "无权添加协作同事"
      );
    }

    let existing = get("SELECT * FROM users WHERE lower(email) = ?", [email]);
    const lookup = await batchGetIdByEmails([email]);
    const hit = lookup.ok
      ? (lookup.userList || []).find((u) => (u.email || "").toLowerCase() === email) ||
        lookup.userList?.[0]
      : null;
    const openId = hit?.user_id || hit?.open_id || "";
    const now = nowIso();

    if (!existing) {
      const id = newId("u");
      run(
        `INSERT INTO users (id, name, email, role, title, feishu_open_id, lookup_status, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'readonly', ?, ?, ?, ?, ?, ?)`,
        [
          id,
          req.body?.name || email.split("@")[0],
          email,
          "",
          openId,
          lookup.ok && openId ? "bound" : lookup.ok ? "not_found" : "retry",
          lookup.ok ? (openId ? "" : "通讯录未找到该邮箱，已先保存，可稍后重试") : lookup.error,
          now,
          now,
        ]
      );
      existing = get("SELECT * FROM users WHERE id = ?", [id]);
    } else {
      run(
        `UPDATE users SET
          feishu_open_id = CASE WHEN ? != '' THEN ? ELSE feishu_open_id END,
          lookup_status = ?,
          last_error = ?,
          updated_at = ?
         WHERE id = ?`,
        [
          openId,
          openId,
          lookup.ok && openId ? "bound" : lookup.ok ? "not_found" : "retry",
          lookup.ok ? (openId ? "" : "通讯录未找到该邮箱") : lookup.error,
          now,
          existing.id,
        ]
      );
      existing = get("SELECT * FROM users WHERE id = ?", [existing.id]);
    }

    if (jobId && assignRole) {
      const ex = get("SELECT * FROM job_members WHERE job_id = ? AND user_id = ?", [
        jobId,
        existing.id,
      ]);
      if (ex) {
        run("UPDATE job_members SET role = ? WHERE job_id = ? AND user_id = ?", [
          assignRole,
          jobId,
          existing.id,
        ]);
      } else {
        run(
          "INSERT INTO job_members (job_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
          [jobId, existing.id, assignRole, now]
        );
      }
    }

    res.json({
      user: publicUser(existing),
      lookupOk: Boolean(lookup.ok && openId),
      lookupError: existing.last_error || "",
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/users/:id/retry-lookup", requireUser, async (req, res) => {
  try {
    const user = get("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!user) return res.status(404).json({ error: "用户不存在" });
    if (!user.email) return res.status(400).json({ error: "该同事没有邮箱，无法重试" });
    perms.assert(
      perms.isAdmin(req.user) || req.user.role === "hiring_manager",
      "无权重试通讯录查询"
    );
    const lookup = await batchGetIdByEmails([user.email]);
    const hit = lookup.ok ? lookup.userList?.[0] : null;
    const openId = hit?.user_id || hit?.open_id || "";
    run(
      `UPDATE users SET feishu_open_id = CASE WHEN ? != '' THEN ? ELSE feishu_open_id END,
        lookup_status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      [
        openId,
        openId,
        lookup.ok && openId ? "bound" : lookup.ok ? "not_found" : "retry",
        lookup.ok ? (openId ? "" : "通讯录仍未找到该邮箱") : lookup.error,
        nowIso(),
        user.id,
      ]
    );
    const next = get("SELECT * FROM users WHERE id = ?", [user.id]);
    res.json({
      user: publicUser(next),
      lookupOk: Boolean(lookup.ok && openId),
      lookupError: next.last_error || "",
    });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
