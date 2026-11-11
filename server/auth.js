import crypto from "node:crypto";
import {
  COOKIE_NAME,
  COOKIE_MAX_AGE_MS,
  COOKIE_SECURE,
  DEV_LOGIN,
  FEISHU_REDIRECT_URI,
  PUBLIC_URL,
} from "./config.js";
import { get, run } from "./db.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForUserToken,
  getUserInfo,
} from "./feishu.js";
import { provisionDriveFolder } from "./drive.js";

const oauthStates = new Map();

function expireOldSessions() {
  run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);
}

export function getSessionUser(req) {
  const sid = req.cookies?.[COOKIE_NAME];
  if (!sid) return null;
  expireOldSessions();
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    [sid, new Date().toISOString()]
  );
  return row || null;
}

export function setSessionCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/", sameSite: "lax", secure: COOKIE_SECURE });
}

export function createSession(userId) {
  const id = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + COOKIE_MAX_AGE_MS);
  run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [id, userId, now.toISOString(), expires.toISOString()]
  );
  return id;
}

export function destroySession(req) {
  const sid = req.cookies?.[COOKIE_NAME];
  if (sid) run("DELETE FROM sessions WHERE id = ?", [sid]);
}

export function requireUser(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "请先登录" });
  }
  req.user = user;
  next();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email || "",
    role: user.role,
    title: user.title || "",
    avatar: user.avatar || "",
    feishuBound: Boolean(user.feishu_open_id),
    lookupStatus: user.lookup_status || "",
    lastError: user.last_error || "",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function newUserId() {
  return `u-${crypto.randomBytes(6).toString("hex")}`;
}

export function upsertFeishuUser(profile) {
  const now = nowIso();
  let existing = null;
  if (profile.open_id) {
    existing = get("SELECT * FROM users WHERE feishu_open_id = ?", [profile.open_id]);
  }
  if (!existing && profile.email) {
    existing = get(
      "SELECT * FROM users WHERE lower(email) = lower(?)",
      [profile.email]
    );
  }

  if (existing) {
    run(
      `UPDATE users SET
        name = COALESCE(?, name),
        email = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE email END,
        feishu_open_id = COALESCE(?, feishu_open_id),
        feishu_union_id = COALESCE(?, feishu_union_id),
        feishu_user_id = COALESCE(?, feishu_user_id),
        avatar = COALESCE(?, avatar),
        lookup_status = 'bound',
        last_error = NULL,
        updated_at = ?
       WHERE id = ?`,
      [
        profile.name || null,
        profile.email, profile.email, profile.email,
        profile.open_id || null,
        profile.union_id || null,
        profile.user_id || null,
        profile.avatar || null,
        now,
        existing.id,
      ]
    );
    return get("SELECT * FROM users WHERE id = ?", [existing.id]);
  }

  const linkedAdmin = get(
    "SELECT id FROM users WHERE role = 'admin' AND feishu_open_id IS NOT NULL AND feishu_open_id != ''"
  );
  const role = linkedAdmin ? "readonly" : "admin";
  const id = newUserId();
  run(
    `INSERT INTO users (id, name, email, role, title, feishu_open_id, feishu_union_id, feishu_user_id, avatar, lookup_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'bound', ?, ?)`,
    [
      id,
      profile.name || "飞书用户",
      profile.email || "",
      role,
      "",
      profile.open_id || "",
      profile.union_id || "",
      profile.user_id || "",
      profile.avatar || "",
      now,
      now,
    ]
  );
  return get("SELECT * FROM users WHERE id = ?", [id]);
}

function rememberState(extra = {}) {
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.set(state, { ...extra, at: Date.now() });
  for (const [key, val] of oauthStates) {
    if (Date.now() - val.at > 10 * 60 * 1000) oauthStates.delete(key);
  }
  return state;
}

export function startFeishuOAuth(req, res) {
  const redirectUri =
    req.query.redirect_uri || FEISHU_REDIRECT_URI || `${PUBLIC_URL}/auth/feishu/callback`;
  const state = rememberState({ redirectUri });
  res.redirect(buildAuthorizeUrl(state, redirectUri));
}

export async function handleFeishuCallback(req, res) {
  try {
    if (req.query.error) {
      return res.redirect(`/?login_error=${encodeURIComponent(req.query.error)}`);
    }
    const code = req.query.code;
    const state = req.query.state;
    if (!code) {
      return res.redirect(`/?login_error=${encodeURIComponent("缺少授权码")}`);
    }
    const saved = state ? oauthStates.get(String(state)) : null;
    if (state && !saved) {
      return res.redirect(`/?login_error=${encodeURIComponent("登录状态已过期，请重试")}`);
    }
    if (state) oauthStates.delete(String(state));
    const redirectUri = saved?.redirectUri || FEISHU_REDIRECT_URI;
    const token = await exchangeCodeForUserToken(String(code), redirectUri);
    if (!token.ok) {
      return res.redirect(`/?login_error=${encodeURIComponent(token.error)}`);
    }
    const info = await getUserInfo(token.accessToken);
    if (!info.ok) {
      return res.redirect(`/?login_error=${encodeURIComponent(info.error)}`);
    }
    const user = upsertFeishuUser(info.user);
    if (user.role === "admin") {
      try {
        await provisionDriveFolder(token.accessToken, user.feishu_open_id || "");
      } catch (err) {
        console.log(`飞书云空间准备失败：${err.message}`);
      }
    }
    const sid = createSession(user.id);
    setSessionCookie(res, sid);
    res.redirect("/");
  } catch (err) {
    res.redirect(`/?login_error=${encodeURIComponent(err.message || "飞书登录失败")}`);
  }
}

export async function handleJsapiCode(req, res) {
  try {
    const code = req.body?.code;
    if (!code) return res.status(400).json({ error: "缺少授权码" });
    const token = await exchangeCodeForUserToken(String(code));
    if (!token.ok) return res.status(400).json({ error: token.error });
    const info = await getUserInfo(token.accessToken);
    if (!info.ok) return res.status(400).json({ error: info.error });
    const user = upsertFeishuUser(info.user);
    if (user.role === "admin") {
      try {
        await provisionDriveFolder(token.accessToken, user.feishu_open_id || "");
      } catch (err) {
        console.log(`飞书云空间准备失败：${err.message}`);
      }
    }
    const sid = createSession(user.id);
    setSessionCookie(res, sid);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message || "飞书免登失败" });
  }
}

export function handleDevLogin(req, res) {
  if (!DEV_LOGIN) {
    return res.status(403).json({ error: "本地开发登录未开启（需要 DEV_LOGIN=1）" });
  }
  const userId = req.body?.userId;
  const user = get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "未找到该账号" });
  const sid = createSession(user.id);
  setSessionCookie(res, sid);
  res.json({ user: publicUser(user) });
}

export function handleLogout(req, res) {
  destroySession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
}
