import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { initDb, closeDb, get } from "./db.js";
import api from "./routes.js";

const originalFetch = globalThis.fetch;
let modelCalls = 0;
globalThis.fetch = async (url, options) => {
  const href = String(url);
  if (href.includes("/chat/completions")) {
    modelCalls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ must: ["模型必须项"], nice: ["模型加分项"] }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return originalFetch(url, options);
};

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
  const res = await originalFetch(`${base}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  assert.equal(res.status, 200, await res.text());
  return res.headers.get("set-cookie").split(";")[0];
}

async function generate(cookie, body) {
  const res = await originalFetch(`${base}/api/jobs/generate-requirements`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

try {
  const before = get("SELECT must, nice FROM jobs WHERE id = 'j1'");
  const admin = await login("u-admin");
  const owner = await login("u-owner1");
  const other = await login("u-owner2");
  const interviewer = await login("u-int1");
  const readonly = await login("u-read");

  const denied = await generate(interviewer, { jd: "任职要求：熟悉 PPO。" });
  assert.equal(denied.status, 403);
  const deniedRead = await generate(readonly, { jd: "任职要求：熟悉 PPO。", jobId: "j1" });
  assert.equal(deniedRead.status, 403);
  const notOwner = await generate(other, { jd: "任职要求：熟悉 PPO。", jobId: "j1" });
  assert.equal(notOwner.status, 403);
  assert.equal(modelCalls, 0);

  const empty = await generate(admin, { jd: "   " });
  assert.equal(empty.status, 400);
  assert.match(empty.data.error, /职位描述/);
  assert.equal(modelCalls, 0);

  const missing = await generate(admin, { jd: "任职要求：熟悉 PPO。", jobId: "missing-job" });
  assert.equal(missing.status, 404);
  assert.equal(modelCalls, 0);

  const created = await generate(admin, { jd: "任职要求：熟悉全身控制。加分：有实机经验。", title: "运控" });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.must, "模型必须项");
  assert.equal(created.data.nice, "模型加分项");
  assert.equal(modelCalls, 1);

  const edited = await generate(owner, { jd: "任职要求：熟悉 PPO。", jobId: "j1" });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(modelCalls, 2);

  const after = get("SELECT must, nice FROM jobs WHERE id = 'j1'");
  assert.deepEqual(after, before);
  console.log("job generate checks passed");
} finally {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
  closeDb();
}
