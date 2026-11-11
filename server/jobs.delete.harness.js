import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { initDb, closeDb, run, get, all } from "./db.js";
import api from "./routes.js";

const now = new Date().toISOString();

await initDb();

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use("/api", api);
const server = await new Promise((resolve) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function login(userId) {
  const res = await fetch(`${base}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  assert.equal(res.status, 200, await res.text());
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, "dev login did not set a cookie");
  return cookie.split(";")[0];
}

async function removeJob(cookie, id) {
  const res = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { cookie },
  });
  const data = await res.json();
  return { status: res.status, data };
}

function insertJob(id, title) {
  run(
    `INSERT INTO jobs (id, title, must, nice, level, location, status, jd, created_at, updated_at)
     VALUES (?, ?, '', '', 'P6', '深圳', '招聘中', '', ?, ?)`,
    [id, title, now, now]
  );
}

try {
  insertJob("j-del", "待删除职位");
  insertJob("j-int-owner", "面试官挂名负责人");
  insertJob("j-admin-del", "管理员删除职位");
  run(
    "INSERT INTO job_members (job_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ["j-del", "u-owner1", now]
  );
  run(
    "INSERT INTO job_members (job_id, user_id, role, created_at) VALUES (?, ?, 'interviewer', ?)",
    ["j-del", "u-int1", now]
  );
  run(
    "INSERT INTO job_members (job_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ["j-int-owner", "u-int1", now]
  );
  run(
    `INSERT INTO candidates (id, name, title, years, stacks, highlights, stage, score_base, job_id, created_at, updated_at)
     VALUES ('c-del', '周测', '算法工程师', 3, '[]', '[]', '初筛', 70, 'j-del', ?, ?)`,
    [now, now]
  );
  run(
    `INSERT INTO resumes (id, stored_name, original_name, mime, size, extracted_text, parsed_name, parsed_stacks, job_id, candidate_id, uploaded_by, feishu_file_token, created_at)
     VALUES ('res-del', 'kept.pdf', '周测.pdf', 'application/pdf', 1200, '原文', '周测', '[]', 'j-del', 'c-del', 'u-admin', 'box-token-keep', ?)`,
    [now]
  );
  run(
    `INSERT INTO stage_events (id, candidate_id, job_id, from_stage, to_stage, actor_user_id, notify_result, created_at)
     VALUES ('ev-del', 'c-del', 'j-del', '待筛选', '初筛', 'u-owner1', '[]', ?)`,
    [now]
  );

  const admin = await login("u-admin");
  const owner = await login("u-owner1");
  const otherManager = await login("u-owner2");
  const interviewer = await login("u-int1");
  const readonly = await login("u-read");

  const missing = await removeJob(admin, "missing-job");
  assert.equal(missing.status, 404);
  assert.match(missing.data.error, /不存在/);

  for (const cookie of [otherManager, interviewer, readonly]) {
    const denied = await removeJob(cookie, "j-del");
    assert.equal(denied.status, 403, JSON.stringify(denied.data));
    assert.ok(get("SELECT id FROM jobs WHERE id = 'j-del'"));
  }

  const interviewerOwner = await removeJob(interviewer, "j-int-owner");
  assert.equal(interviewerOwner.status, 403);
  assert.ok(get("SELECT id FROM jobs WHERE id = 'j-int-owner'"));

  const removed = await removeJob(owner, "j-del");
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal(removed.data.ok, true);
  assert.equal(removed.data.unlinkedCandidates, 1);
  assert.equal(removed.data.unlinkedResumes, 1);
  assert.equal(get("SELECT id FROM jobs WHERE id = 'j-del'"), null);
  assert.equal(all("SELECT * FROM job_members WHERE job_id = 'j-del'").length, 0);

  const candidate = get("SELECT * FROM candidates WHERE id = 'c-del'");
  assert.ok(candidate);
  assert.equal(candidate.job_id, null);
  assert.equal(candidate.stage, "初筛");
  assert.equal(candidate.name, "周测");

  const resume = get("SELECT * FROM resumes WHERE id = 'res-del'");
  assert.ok(resume);
  assert.equal(resume.job_id, null);
  assert.equal(resume.candidate_id, "c-del");
  assert.equal(resume.feishu_file_token, "box-token-keep");
  assert.equal(resume.stored_name, "kept.pdf");
  assert.equal(resume.original_name, "周测.pdf");

  const event = get("SELECT * FROM stage_events WHERE id = 'ev-del'");
  assert.ok(event);
  assert.equal(event.job_id, "j-del");
  assert.equal(event.to_stage, "初筛");

  const listed = await fetch(`${base}/api/candidates`, { headers: { cookie: admin } });
  assert.equal(listed.status, 200);
  const pool = await listed.json();
  const found = pool.candidates.find((item) => item.id === "c-del");
  assert.ok(found, "unlinked candidate should remain in the talent pool");
  assert.equal(found.job_id, null);
  assert.equal(found.job_title || "", "");

  const adminRemoved = await removeJob(admin, "j-admin-del");
  assert.equal(adminRemoved.status, 200, JSON.stringify(adminRemoved.data));
  assert.equal(get("SELECT id FROM jobs WHERE id = 'j-admin-del'"), null);
  assert.ok(get("SELECT id FROM jobs WHERE id = 'j1'"), "unrelated jobs stay");

  console.log("job delete checks passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
}
