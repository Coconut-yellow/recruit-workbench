import fs from "node:fs";
import path from "node:path";
import { getTenantAccessToken } from "./feishu.js";
import {
  DATA_DIR,
  DB_PATH,
  DRIVE_DB_PREFIX,
  DRIVE_FOLDER_NAME,
  DRIVE_POINTER_NAME,
  FEISHU_BASE,
  FEISHU_RESUME_FOLDER_TOKEN,
  RESUME_DIR,
} from "./config.js";

const STATE_PATH = path.join(DATA_DIR, "feishu-drive.json");
const UPLOAD_ALL_LIMIT = 20 * 1024 * 1024;
const GROUP_SHARE_HINT = "应用还不能用租户凭证访问该文件夹。请在飞书里建一个群，把招聘台机器人拉进群，再把文件夹分享给该群并设为「可管理」。";

const state = {
  folderToken: "",
  folderUrl: "",
  dbFileToken: "",
  pointerFileToken: "",
  tenantReady: false,
  needsGroupShare: false,
  lastError: "",
  lastBackupAt: "",
  lastBackupError: "",
};

let localWasUsable = false;
let restoreSucceeded = false;
let uploadChain = Promise.resolve();
let backupTimer = null;
let backupRunning = null;

export function shouldUploadDatabase({ localWasUsable: usable, restoreSucceeded: restored, cloudDbToken }) {
  if (usable || restored) return true;
  return !cloudDbToken;
}

export function pickLatest(files, predicate) {
  return (files || [])
    .filter(predicate)
    .sort((a, b) => Number(b.created_time || 0) - Number(a.created_time || 0))[0] || null;
}

export function missingResumeMessage() {
  return "原简历不在服务器上，飞书云空间里也没有可下载的备份。请重新上传这份简历。";
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (parsed && typeof parsed === "object") Object.assign(state, parsed);
  } catch {
    /* first boot */
  }
  if (FEISHU_RESUME_FOLDER_TOKEN) state.folderToken = FEISHU_RESUME_FOLDER_TOKEN;
  return state;
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const body = {
    folderToken: state.folderToken,
    folderUrl: state.folderUrl,
    dbFileToken: state.dbFileToken,
    pointerFileToken: state.pointerFileToken,
    tenantReady: state.tenantReady,
    needsGroupShare: state.needsGroupShare,
    lastError: state.lastError,
    lastBackupAt: state.lastBackupAt,
    lastBackupError: state.lastBackupError,
  };
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STATE_PATH);
}

function folderUrl(token) {
  return token ? `https://feishu.cn/drive/folder/${token}` : "";
}

function markDriveFailure(result) {
  const denied = result?.code === 1061004 || result?.status === 403;
  state.lastError = result?.error || "飞书云空间操作失败";
  if (denied) {
    state.tenantReady = false;
    state.needsGroupShare = true;
    state.lastError = `${GROUP_SHARE_HINT}（${state.lastError}）`;
  }
  saveState();
}

function logFolder(token, url) {
  console.log(`飞书简历文件夹 token=${token}`);
  console.log(`飞书简历文件夹地址 ${url || folderUrl(token)}`);
  console.log("请把上面的 token 写入 Render 环境变量 FEISHU_RESUME_FOLDER_TOKEN，重新部署后才能稳定找回。");
}

export function driveStatus({ includeToken = false } = {}) {
  readState();
  const status = {
    ready: Boolean(state.tenantReady && state.folderToken),
    folderConfigured: Boolean(state.folderToken),
    needsGroupShare: Boolean(state.needsGroupShare),
    lastError: state.lastBackupError || state.lastError || "",
    lastBackupAt: state.lastBackupAt || "",
    folderUrl: state.folderUrl || folderUrl(state.folderToken),
    groupShareHint: state.needsGroupShare ? GROUP_SHARE_HINT : "",
  };
  if (includeToken) status.folderToken = state.folderToken || "";
  return status;
}

function enqueue(task) {
  const run = uploadChain.then(task, task);
  uploadChain = run.then(() => undefined, () => undefined);
  return run;
}

async function feishuJson(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { msg: `HTTP ${res.status}` };
  }
  if (!res.ok || (body && body.code !== undefined && body.code !== 0)) {
    return {
      ok: false,
      status: res.status,
      error: body?.msg || `飞书接口失败（HTTP ${res.status}）`,
      code: body?.code,
    };
  }
  return { ok: true, body };
}

async function withRetry(fn) {
  let last = { ok: false, error: "飞书接口失败" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await fn();
    if (last.ok || last.code !== 1061045) return last;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return last;
}

async function listChildren(token, folderToken) {
  const files = [];
  let pageToken = "";
  do {
    const url = new URL(`${FEISHU_BASE}/open-apis/drive/v1/files`);
    url.searchParams.set("page_size", "200");
    url.searchParams.set("order_by", "CreatedTime");
    url.searchParams.set("direction", "DESC");
    if (folderToken) url.searchParams.set("folder_token", folderToken);
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const result = await feishuJson(url, token);
    if (!result.ok) return result;
    files.push(...(result.body?.data?.files || []));
    pageToken = result.body?.data?.has_more ? result.body.data.next_page_token || "" : "";
  } while (pageToken);
  return { ok: true, files };
}

async function createFolder(token, name, parentToken) {
  return withRetry(async () => {
    const result = await feishuJson(`${FEISHU_BASE}/open-apis/drive/v1/files/create_folder`, token, {
      method: "POST",
      body: JSON.stringify({ name, folder_token: parentToken || "" }),
    });
    if (!result.ok) return result;
    return {
      ok: true,
      token: result.body?.data?.token || "",
      url: result.body?.data?.url || folderUrl(result.body?.data?.token || ""),
    };
  });
}

async function getRootToken(token) {
  const result = await feishuJson(`${FEISHU_BASE}/open-apis/drive/explorer/v2/root_folder/meta`, token);
  if (!result.ok) return result;
  const root = result.body?.data?.token || result.body?.data?.id || "";
  if (!root) return { ok: false, error: "飞书没有返回云空间根目录 token" };
  return { ok: true, token: root };
}

async function getBotOpenId(token) {
  const result = await feishuJson(`${FEISHU_BASE}/open-apis/bot/v3/info`, token);
  if (!result.ok) return result;
  const openId = result.body?.bot?.open_id || result.body?.data?.bot?.open_id || "";
  if (!openId) return { ok: false, error: "未拿到应用 open_id。请先给应用添加机器人能力并发布。" };
  return { ok: true, openId };
}

async function addCollaborator(token, folderToken, memberId) {
  const url = `${FEISHU_BASE}/open-apis/drive/v1/permissions/${folderToken}/members?type=folder&need_notification=false`;
  return feishuJson(url, token, {
    method: "POST",
    body: JSON.stringify({
      member_type: "openid",
      member_id: memberId,
      perm: "full_access",
      perm_type: "container",
      type: "user",
    }),
  });
}

function safeFileName(name, fallback) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim();
  return (cleaned || fallback).slice(0, 240);
}

async function uploadAll(token, folderToken, fileName, bytes) {
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "explorer");
  form.append("parent_node", folderToken);
  form.append("size", String(bytes.length));
  form.append("file", new Blob([bytes]), fileName);
  const res = await fetch(`${FEISHU_BASE}/open-apis/drive/v1/files/upload_all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { msg: `HTTP ${res.status}` };
  }
  if (!res.ok || body?.code !== 0 || !body?.data?.file_token) {
    return {
      ok: false,
      error: body?.msg || `上传失败（HTTP ${res.status}）`,
      code: body?.code,
    };
  }
  return { ok: true, fileToken: body.data.file_token };
}

async function uploadMultipart(token, folderToken, fileName, bytes) {
  const prepared = await feishuJson(`${FEISHU_BASE}/open-apis/drive/v1/files/upload_prepare`, token, {
    method: "POST",
    body: JSON.stringify({
      file_name: fileName,
      parent_type: "explorer",
      parent_node: folderToken,
      size: bytes.length,
    }),
  });
  if (!prepared.ok) return prepared;
  const uploadId = prepared.body?.data?.upload_id;
  const blockSize = Number(prepared.body?.data?.block_size || 4 * 1024 * 1024);
  const blockNum = Number(prepared.body?.data?.block_num || Math.ceil(bytes.length / blockSize));
  if (!uploadId) return { ok: false, error: "分片上传没有返回 upload_id" };
  for (let seq = 0; seq < blockNum; seq += 1) {
    const start = seq * blockSize;
    const chunk = bytes.subarray(start, Math.min(bytes.length, start + blockSize));
    const form = new FormData();
    form.append("upload_id", uploadId);
    form.append("seq", String(seq));
    form.append("size", String(chunk.length));
    form.append("file", new Blob([chunk]), fileName);
    const res = await fetch(`${FEISHU_BASE}/open-apis/drive/v1/files/upload_part`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = { msg: `HTTP ${res.status}` };
    }
    if (!res.ok || body?.code !== 0) {
      return { ok: false, error: body?.msg || `分片 ${seq} 上传失败`, code: body?.code };
    }
  }
  const finished = await feishuJson(`${FEISHU_BASE}/open-apis/drive/v1/files/upload_finish`, token, {
    method: "POST",
    body: JSON.stringify({ upload_id: uploadId, block_num: blockNum }),
  });
  if (!finished.ok) return finished;
  const fileToken = finished.body?.data?.file_token;
  if (!fileToken) return { ok: false, error: "分片上传没有返回 file_token" };
  return { ok: true, fileToken };
}

async function uploadBytes(token, folderToken, fileName, bytes) {
  const name = safeFileName(fileName, "resume.bin");
  const send = () => (bytes.length > UPLOAD_ALL_LIMIT
    ? uploadMultipart(token, folderToken, name, bytes)
    : uploadAll(token, folderToken, name, bytes));
  return withRetry(send);
}

function putFile(folderToken, fileName, bytes, previousToken = "") {
  return enqueue(async () => {
    const tenant = await tenantToken();
    if (!tenant.ok) return tenant;
    const uploaded = await uploadBytes(tenant.token, folderToken, fileName, bytes);
    if (uploaded.ok && previousToken && previousToken !== uploaded.fileToken) {
      const removed = await deleteFile(tenant.token, previousToken);
      if (!removed.ok) uploaded.deleteError = removed.error;
    }
    return uploaded;
  });
}

async function deleteFile(token, fileToken) {
  if (!fileToken) return { ok: true };
  return feishuJson(
    `${FEISHU_BASE}/open-apis/drive/v1/files/${fileToken}?type=file`,
    token,
    { method: "DELETE" }
  );
}

async function downloadByToken(token, fileToken) {
  const res = await fetch(`${FEISHU_BASE}/open-apis/drive/v1/files/${fileToken}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `下载失败（HTTP ${res.status}）`;
    try {
      const body = await res.json();
      message = body?.msg || message;
    } catch {
      /* binary error page */
    }
    return { ok: false, error: message };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) return { ok: false, error: "飞书返回了空文件" };
  return { ok: true, bytes };
}

async function tenantToken() {
  const result = await getTenantAccessToken();
  if (!result.ok) return result;
  return { ok: true, token: result.token };
}

async function rememberFolder(token, url, tenantReady) {
  state.folderToken = token;
  state.folderUrl = url || folderUrl(token);
  state.tenantReady = Boolean(tenantReady);
  state.needsGroupShare = !tenantReady;
  state.lastError = tenantReady ? "" : GROUP_SHARE_HINT;
  saveState();
  logFolder(state.folderToken, state.folderUrl);
}

async function publishPointer(token) {
  if (!state.folderToken) return { ok: false, error: "没有文件夹 token" };
  const root = await getRootToken(token);
  if (!root.ok) return root;
  const payload = Buffer.from(JSON.stringify({
    folderToken: state.folderToken,
    folderUrl: state.folderUrl,
    dbFileToken: state.dbFileToken || "",
    updatedAt: new Date().toISOString(),
  }));
  const previous = state.pointerFileToken;
  const uploaded = await putFile(root.token, DRIVE_POINTER_NAME, payload, previous);
  if (!uploaded.ok) return uploaded;
  state.pointerFileToken = uploaded.fileToken;
  saveState();
  if (uploaded.deleteError) console.log(`旧的云空间指针未删除：${uploaded.deleteError}`);
  return { ok: true };
}

async function accessFolder(token, folderToken) {
  return listChildren(token, folderToken);
}

export async function ensureDriveFolder() {
  readState();
  const tenant = await tenantToken();
  if (!tenant.ok) {
    state.lastError = tenant.error || "无法获取租户凭证";
    state.tenantReady = false;
    saveState();
    return { ok: false, error: state.lastError };
  }
  if (state.folderToken) {
    const access = await accessFolder(tenant.token, state.folderToken);
    if (access.ok) {
      state.tenantReady = true;
      state.needsGroupShare = false;
      state.lastError = "";
      if (!state.folderUrl) state.folderUrl = folderUrl(state.folderToken);
      saveState();
      return { ok: true, folderToken: state.folderToken };
    }
    state.tenantReady = false;
    state.needsGroupShare = true;
    state.lastError = `${GROUP_SHARE_HINT}（${access.error}）`;
    saveState();
    return { ok: false, error: state.lastError, needsGroupShare: true };
  }
  const root = await listChildren(tenant.token, "");
  if (root.ok) {
    const pointer = pickLatest(root.files, (file) => file.type === "file" && file.name === DRIVE_POINTER_NAME);
    if (pointer) {
      const downloaded = await downloadByToken(tenant.token, pointer.token);
      if (downloaded.ok) {
        try {
          const parsed = JSON.parse(downloaded.bytes.toString("utf8"));
          if (parsed.folderToken) {
            state.folderToken = parsed.folderToken;
            state.folderUrl = parsed.folderUrl || folderUrl(parsed.folderToken);
            state.dbFileToken = parsed.dbFileToken || state.dbFileToken;
            state.pointerFileToken = pointer.token;
            saveState();
            const access = await accessFolder(tenant.token, state.folderToken);
            if (access.ok) {
              state.tenantReady = true;
              state.needsGroupShare = false;
              state.lastError = "";
              saveState();
              return { ok: true, folderToken: state.folderToken };
            }
            state.needsGroupShare = true;
            state.lastError = GROUP_SHARE_HINT;
            saveState();
            return { ok: false, error: state.lastError, needsGroupShare: true };
          }
        } catch {
          /* ignore a broken pointer and keep looking */
        }
      }
    }
    const existing = (root.files || []).find((file) => file.type === "folder" && file.name === DRIVE_FOLDER_NAME);
    if (existing) {
      await rememberFolder(existing.token, existing.url, true);
      return { ok: true, folderToken: existing.token };
    }
  }
  const created = await createFolder(tenant.token, DRIVE_FOLDER_NAME, "");
  if (!created.ok) {
    state.lastError = created.error || "创建飞书文件夹失败";
    state.tenantReady = false;
    saveState();
    console.log(`飞书文件夹未就绪：${state.lastError}`);
    return created;
  }
  await rememberFolder(created.token, created.url, true);
  await publishPointer(tenant.token);
  return { ok: true, folderToken: created.token };
}

export async function provisionDriveFolder(userAccessToken, adminOpenId = "") {
  if (!userAccessToken) return { ok: false, error: "没有用户凭证" };
  readState();
  const listed = await listChildren(userAccessToken, "");
  let folder = listed.ok
    ? (listed.files || []).find((file) => file.type === "folder" && file.name === DRIVE_FOLDER_NAME)
    : null;
  if (!folder) {
    const created = await createFolder(userAccessToken, DRIVE_FOLDER_NAME, "");
    if (!created.ok) {
      state.lastError = created.error || "用管理员身份创建文件夹失败";
      saveState();
      console.log(`飞书文件夹创建失败：${state.lastError}`);
      return created;
    }
    folder = { token: created.token, url: created.url };
  }
  const tenant = await tenantToken();
  if (tenant.ok) {
    const bot = await getBotOpenId(tenant.token);
    if (bot.ok) {
      const added = await addCollaborator(userAccessToken, folder.token, bot.openId);
      if (!added.ok) console.log(`把应用加为文件夹协作者失败：${added.error}`);
    } else {
      console.log(`读取应用 open_id 失败：${bot.error}`);
    }
    if (adminOpenId) {
      const addedAdmin = await addCollaborator(tenant.token, folder.token, adminOpenId);
      if (!addedAdmin.ok) {
        await addCollaborator(userAccessToken, folder.token, adminOpenId);
      }
    }
    const access = await accessFolder(tenant.token, folder.token);
    if (!access.ok && state.tenantReady && state.folderToken && state.folderToken !== folder.token) {
      state.needsGroupShare = true;
      state.lastError = `${GROUP_SHARE_HINT}（${access.error}）`;
      saveState();
      console.log(state.lastError);
      console.log(`管理员文件夹 token=${folder.token} 尚未授权给应用，继续使用已可用的文件夹 ${state.folderToken}`);
      return { ok: false, error: state.lastError, needsGroupShare: true, folderToken: folder.token };
    }
    await rememberFolder(folder.token, folder.url, access.ok);
    if (!access.ok) {
      state.lastError = `${GROUP_SHARE_HINT}（${access.error}）`;
      saveState();
      console.log(state.lastError);
      return { ok: false, error: state.lastError, needsGroupShare: true, folderToken: folder.token };
    }
    await publishPointer(tenant.token);
    scheduleDbBackup();
    backfillLocalResumes().catch((err) => console.log(`补传简历失败：${err.message}`));
    return { ok: true, folderToken: folder.token };
  }
  await rememberFolder(folder.token, folder.url, false);
  state.lastError = tenant.error || GROUP_SHARE_HINT;
  saveState();
  return { ok: false, error: state.lastError };
}

export async function uploadResumeBytes(fileName, bytes) {
  const ready = await ensureDriveFolder();
  if (!ready.ok) {
    return { ok: false, error: ready.error || "飞书云空间文件夹不可用" };
  }
  const uploaded = await putFile(state.folderToken, fileName, bytes);
  if (!uploaded.ok) markDriveFailure(uploaded);
  return uploaded;
}

export async function materializeResumeFile(row) {
  const stored = path.basename(String(row?.stored_name || ""));
  const local = stored ? path.join(RESUME_DIR, stored) : "";
  if (local && fs.existsSync(local) && fs.statSync(local).size > 0) {
    return { ok: true, path: local, source: "local" };
  }
  if (!row?.feishu_file_token) {
    return { ok: false, error: missingResumeMessage() };
  }
  const tenant = await tenantToken();
  if (!tenant.ok) return { ok: false, error: `飞书云空间下载失败：${tenant.error}` };
  const downloaded = await downloadByToken(tenant.token, row.feishu_file_token);
  if (!downloaded.ok) return { ok: false, error: `飞书云空间下载失败：${downloaded.error}` };
  fs.mkdirSync(RESUME_DIR, { recursive: true, mode: 0o700 });
  const dest = path.join(RESUME_DIR, stored || `${Date.now()}-restored.bin`);
  const tmp = `${dest}.incoming`;
  fs.writeFileSync(tmp, downloaded.bytes);
  fs.renameSync(tmp, dest);
  return { ok: true, path: dest, source: "feishu" };
}

async function downloadLatestDatabase(token) {
  readState();
  if (state.dbFileToken) {
    const direct = await downloadByToken(token, state.dbFileToken);
    if (direct.ok && direct.bytes.subarray(0, 15).toString() === "SQLite format 3") return direct;
  }
  if (!state.folderToken) return { ok: false, error: "没有可恢复的数据库备份" };
  const listed = await listChildren(token, state.folderToken);
  if (!listed.ok) return listed;
  const latest = pickLatest(listed.files, (file) => file.type === "file" && String(file.name || "").startsWith(DRIVE_DB_PREFIX));
  if (!latest) return { ok: false, error: "飞书文件夹里没有数据库备份" };
  const downloaded = await downloadByToken(token, latest.token);
  if (!downloaded.ok) return downloaded;
  if (downloaded.bytes.subarray(0, 15).toString() !== "SQLite format 3") {
    return { ok: false, error: "飞书上的数据库备份不是有效的 SQLite 文件" };
  }
  state.dbFileToken = latest.token;
  saveState();
  return downloaded;
}

export async function localDatabaseUsable() {
  if (!fs.existsSync(DB_PATH)) return false;
  const bytes = fs.readFileSync(DB_PATH);
  if (bytes.length < 100 || bytes.subarray(0, 15).toString() !== "SQLite format 3") return false;
  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(bytes);
    const count = (table) => {
      try {
        const result = db.exec(`SELECT COUNT(*) FROM ${table}`);
        return Number(result[0]?.values?.[0]?.[0] || 0);
      } catch {
        return 0;
      }
    };
    const total = count("users") + count("candidates") + count("resumes");
    db.close();
    return total > 0;
  } catch {
    return false;
  }
}

export async function restoreDatabaseIfNeeded() {
  readState();
  localWasUsable = await localDatabaseUsable();
  if (localWasUsable) return { ok: true, skipped: true };
  const tenant = await tenantToken();
  if (!tenant.ok) {
    console.log(`数据库云恢复跳过：${tenant.error}`);
    return { ok: false, error: tenant.error };
  }
  await ensureDriveFolder();
  const downloaded = await downloadLatestDatabase(tenant.token);
  if (!downloaded.ok) {
    console.log(`数据库云恢复未执行：${downloaded.error}`);
    return downloaded;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${DB_PATH}.restore`;
  fs.writeFileSync(tmp, downloaded.bytes);
  const check = fs.readFileSync(tmp);
  if (check.subarray(0, 15).toString() !== "SQLite format 3") {
    fs.rmSync(tmp, { force: true });
    return { ok: false, error: "下载到的数据库备份无效" };
  }
  fs.renameSync(tmp, DB_PATH);
  restoreSucceeded = true;
  console.log("已从飞书云空间恢复招聘数据库");
  return { ok: true };
}

async function backupDatabase() {
  readState();
  if (!shouldUploadDatabase({
    localWasUsable,
    restoreSucceeded,
    cloudDbToken: state.dbFileToken,
  })) {
    const message = "本机数据库是空的，已拒绝用它覆盖飞书上的备份";
    state.lastBackupError = message;
    saveState();
    console.log(message);
    return { ok: false, error: message };
  }
  const { flushDb } = await import("./db.js");
  if (!fs.existsSync(DB_PATH)) return { ok: false, error: "本地数据库不存在" };
  flushDb();
  const ready = await ensureDriveFolder();
  if (!ready.ok) {
    state.lastBackupError = ready.error || "飞书文件夹不可用，数据库未备份";
    saveState();
    console.log(`数据库云备份失败：${state.lastBackupError}`);
    return { ok: false, error: state.lastBackupError };
  }
  const bytes = fs.readFileSync(DB_PATH);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const tenant = await tenantToken();
  if (!tenant.ok) {
    state.lastBackupError = tenant.error;
    saveState();
    return tenant;
  }
  const previous = state.dbFileToken;
  const uploaded = await putFile(state.folderToken, `${DRIVE_DB_PREFIX}${stamp}.db`, bytes, previous);
  if (!uploaded.ok) {
    state.lastBackupError = uploaded.error;
    markDriveFailure(uploaded);
    console.log(`数据库云备份失败：${uploaded.error}`);
    return uploaded;
  }
  state.dbFileToken = uploaded.fileToken;
  state.lastBackupAt = new Date().toISOString();
  state.lastBackupError = "";
  state.tenantReady = true;
  saveState();
  if (uploaded.deleteError) console.log(`旧的数据库备份未删除：${uploaded.deleteError}`);
  const pointed = await publishPointer(tenant.token);
  if (!pointed.ok) console.log(`云空间指针未更新：${pointed.error}`);
  console.log(`数据库已备份到飞书云空间 ${state.lastBackupAt}`);
  return { ok: true, fileToken: uploaded.fileToken };
}

export function scheduleDbBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupRunning = backupDatabase()
      .catch((err) => {
        state.lastBackupError = err.message;
        saveState();
        console.log(`数据库云备份异常：${err.message}`);
      })
      .finally(() => {
        backupRunning = null;
      });
  }, 8000);
  backupTimer.unref?.();
}

export async function flushDriveBackup() {
  clearTimeout(backupTimer);
  if (backupRunning) await backupRunning;
  return backupDatabase();
}

export async function backfillLocalResumes() {
  const ready = await ensureDriveFolder();
  if (!ready.ok) return { ok: false, error: ready.error };
  const { all, run } = await import("./db.js");
  const rows = all(
    "SELECT * FROM resumes WHERE feishu_file_token IS NULL OR feishu_file_token = ''"
  );
  let uploaded = 0;
  for (const row of rows) {
    const local = path.join(RESUME_DIR, path.basename(String(row.stored_name || "")));
    if (!row.stored_name || !fs.existsSync(local)) continue;
    const bytes = fs.readFileSync(local);
    const result = await uploadResumeBytes(row.original_name || row.stored_name, bytes);
    const now = new Date().toISOString();
    if (result.ok) {
      run(
        "UPDATE resumes SET feishu_file_token = ?, feishu_uploaded_at = ?, feishu_error = NULL WHERE id = ?",
        [result.fileToken, now, row.id]
      );
      uploaded += 1;
    } else {
      run("UPDATE resumes SET feishu_error = ? WHERE id = ?", [result.error, row.id]);
      console.log(`简历补传失败 ${row.original_name || row.id}：${result.error}`);
    }
  }
  if (uploaded) console.log(`已补传 ${uploaded} 份本地简历到飞书云空间`);
  return { ok: true, uploaded };
}

export async function startDriveMaintenance() {
  const { setPersistHook } = await import("./db.js");
  setPersistHook(() => scheduleDbBackup());
  try {
    const result = await ensureDriveFolder();
    if (!result.ok) {
      console.log(`飞书云空间尚未就绪：${result.error || "未知原因"}`);
      return;
    }
    scheduleDbBackup();
    await backfillLocalResumes();
  } catch (err) {
    console.log(`飞书云空间初始化失败：${err.message}`);
  }
}
