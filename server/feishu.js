import {
  APP_ID,
  APP_SECRET,
  FEISHU_BASE,
  ACCOUNTS_BASE,
  FEISHU_REDIRECT_URI,
  FEISHU_NOTIFY_CHAT_ID,
} from "./config.js";

let cachedTenant = { token: "", expireAt: 0 };

function hasCredentials() {
  return Boolean(APP_ID && APP_SECRET);
}

async function feishuFetch(url, options = {}) {
  const res = await fetch(url, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { msg: `HTTP ${res.status}` };
  }
  return { ok: res.ok, status: res.status, body };
}

export async function getTenantAccessToken() {
  if (!hasCredentials()) {
    return { ok: false, error: "未配置 App ID / App Secret，无法获取租户凭证" };
  }
  const now = Date.now();
  if (cachedTenant.token && cachedTenant.expireAt - now > 120_000) {
    return { ok: true, token: cachedTenant.token, cached: true };
  }
  const { ok, status, body } = await feishuFetch(
    `${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    }
  );
  if (!ok || !body || body.code !== 0 || !body.tenant_access_token) {
    cachedTenant = { token: "", expireAt: 0 };
    return {
      ok: false,
      error: body?.msg || body?.error_description || `获取租户凭证失败（HTTP ${status}）`,
      code: body?.code,
    };
  }
  cachedTenant = {
    token: body.tenant_access_token,
    expireAt: now + Number(body.expire || 7200) * 1000,
  };
  return { ok: true, token: cachedTenant.token, expire: body.expire, cached: false };
}

export function buildAuthorizeUrl(state, redirectUri = FEISHU_REDIRECT_URI) {
  const url = new URL(`${ACCOUNTS_BASE}/open-apis/authen/v1/authorize`);
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "auth:user.id:read");
  return url.toString();
}

async function exchangeToken(payload) {
  const attempts = [
    `${ACCOUNTS_BASE}/oauth/v3/token`,
    `${FEISHU_BASE}/open-apis/authen/v2/oauth/token`,
  ];
  let last = { ok: false, error: "换取 user_access_token 失败" };
  for (const url of attempts) {
    const { status, body } = await feishuFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (body?.access_token) {
      return { ok: true, accessToken: body.access_token, raw: body };
    }
    last = {
      ok: false,
      error: body?.error_description || body?.msg || `换取令牌失败（HTTP ${status}）`,
      code: body?.code || body?.error,
    };
  }
  return last;
}

export async function exchangeCodeForUserToken(code, redirectUri) {
  if (!hasCredentials()) {
    return { ok: false, error: "未配置 App Secret，无法完成飞书登录" };
  }
  const payload = {
    grant_type: "authorization_code",
    client_id: APP_ID,
    client_secret: APP_SECRET,
    code,
  };
  if (redirectUri) payload.redirect_uri = redirectUri;
  return exchangeToken(payload);
}

export async function getUserInfo(userAccessToken) {
  const { status, body } = await feishuFetch(
    `${FEISHU_BASE}/open-apis/authen/v1/user_info`,
    { headers: { Authorization: `Bearer ${userAccessToken}` } }
  );
  const data = body?.data || body;
  if (!data?.open_id && !data?.union_id) {
    return {
      ok: false,
      error: body?.msg || `获取用户信息失败（HTTP ${status}）`,
      code: body?.code,
    };
  }
  return {
    ok: true,
    user: {
      open_id: data.open_id || "",
      union_id: data.union_id || "",
      user_id: data.user_id || "",
      name: data.name || data.en_name || "飞书用户",
      email: data.enterprise_email || data.email || "",
      avatar: data.avatar_url || data.avatar_middle || data.avatar_thumb || "",
    },
  };
}

export async function batchGetIdByEmails(emails) {
  const tokenRes = await getTenantAccessToken();
  if (!tokenRes.ok) return tokenRes;
  const { status, body } = await feishuFetch(
    `${FEISHU_BASE}/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenRes.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ emails, include_resigned: false }),
    }
  );
  if (body?.code !== 0) {
    return {
      ok: false,
      error: body?.msg || `按邮箱查询飞书用户失败（HTTP ${status}）`,
      code: body?.code,
    };
  }
  return { ok: true, userList: body.data?.user_list || [] };
}

export async function sendTextMessage({ receiveId, receiveIdType = "open_id", text }) {
  const tokenRes = await getTenantAccessToken();
  if (!tokenRes.ok) return { ok: false, error: tokenRes.error, code: tokenRes.code };
  const { status, body } = await feishuFetch(
    `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenRes.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    }
  );
  if (body?.code !== 0) {
    return {
      ok: false,
      error: explainSendError(body, status),
      code: body?.code,
    };
  }
  return { ok: true, messageId: body.data?.message_id };
}

function explainSendError(body, status) {
  const code = body?.code;
  const msg = body?.msg || `发送失败（HTTP ${status}）`;
  if (code === 230002 || /not in.*scope|可用性|available/i.test(String(msg))) {
    return `${msg}。请在飞书开发者后台把对方加入应用「可用范围」，并确保已开通机器人能力。`;
  }
  if (code === 99992360 || /bot/i.test(String(msg))) {
    return `${msg}。请在应用「添加应用能力」中开通机器人，并发布新版本。`;
  }
  return msg;
}

export async function notifyStageChange({
  recipients,
  candidateName,
  jobTitle,
  fromStage,
  toStage,
  actorName,
}) {
  const text = `【轻量招聘台】候选人「${candidateName}」在职位「${jobTitle}」的阶段已由「${fromStage || "未设置"}」变更为「${toStage}」。操作人：${actorName || "系统"}`;
  const results = [];
  for (const person of recipients) {
    if (!person.open_id) {
      results.push({
        name: person.name,
        email: person.email || "",
        ok: false,
        error: "尚未绑定飞书 open_id，无法推送。请先让对方飞书登录，或用工作邮箱在协作页查询绑定。",
      });
      continue;
    }
    const sent = await sendTextMessage({
      receiveId: person.open_id,
      receiveIdType: "open_id",
      text,
    });
    results.push({
      name: person.name,
      email: person.email || "",
      open_id: person.open_id,
      ok: sent.ok,
      error: sent.error || "",
    });
  }
  if (FEISHU_NOTIFY_CHAT_ID) {
    const sent = await sendTextMessage({
      receiveId: FEISHU_NOTIFY_CHAT_ID,
      receiveIdType: "chat_id",
      text,
    });
    results.push({
      name: "通知群",
      email: "",
      chat_id: FEISHU_NOTIFY_CHAT_ID,
      ok: sent.ok,
      error: sent.error || "",
    });
  }
  return results;
}

export function feishuPublicStatus() {
  return {
    configured: hasCredentials(),
    appId: APP_ID,
    redirectUri: FEISHU_REDIRECT_URI,
    notifyChatConfigured: Boolean(FEISHU_NOTIFY_CHAT_ID),
  };
}
