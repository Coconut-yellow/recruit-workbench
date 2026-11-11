async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const res = await fetch(path, { credentials: "include", ...options, headers });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const message =
      (data && data.error) || (typeof data === "string" && data) || `请求失败（${res.status}）`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  config: () => request("/api/auth/config"),
  devUsers: () => request("/api/auth/dev-users"),
  devLogin: (userId) => request("/api/auth/dev-login", { method: "POST", body: { userId } }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  jsapiLogin: (code) => request("/api/auth/feishu/jsapi", { method: "POST", body: { code } }),
  me: () => request("/api/me"),
  feishuStatus: () => request("/api/feishu/status"),
  driveStatus: () => request("/api/feishu/drive"),
  driveBackfill: () => request("/api/feishu/drive/backfill", { method: "POST" }),
  tokenCheck: () => request("/api/feishu/token-check", { method: "POST" }),
  jobs: () => request("/api/jobs"),
  createJob: (body) => request("/api/jobs", { method: "POST", body }),
  generateJobRequirements: (body) => request("/api/jobs/generate-requirements", { method: "POST", body }),
  updateJob: (id, body) => request(`/api/jobs/${id}`, { method: "PATCH", body }),
  deleteJob: (id) => request(`/api/jobs/${id}`, { method: "DELETE" }),
  assignMember: (jobId, body) => request(`/api/jobs/${jobId}/members`, { method: "PUT", body }),
  removeMember: (jobId, userId) =>
    request(`/api/jobs/${jobId}/members/${userId}`, { method: "DELETE" }),
  candidates: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/candidates${q ? `?${q}` : ""}`);
  },
  createCandidate: (body) => request("/api/candidates", { method: "POST", body }),
  updateCandidate: (id, body) => request(`/api/candidates/${id}`, { method: "PATCH", body }),
  moveStage: (id, stage) =>
    request(`/api/candidates/${id}/stage`, { method: "POST", body: { stage } }),
  candidateEvents: (id) => request(`/api/candidates/${id}/events`),
  resumes: () => request("/api/resumes"),
  uploadResume: (form) => request("/api/resumes", { method: "POST", body: form }),
  updateResume: (id, body) => request(`/api/resumes/${id}`, { method: "PATCH", body }),
  importResume: (id, body) => request(`/api/resumes/${id}/import`, { method: "POST", body }),
  resumeFileUrl: (id) => `/api/resumes/${id}/file`,
  match: (body) => request("/api/match", { method: "POST", body }),
  users: () => request("/api/users"),
  updateUserRole: (id, role) => request(`/api/users/${id}`, { method: "PATCH", body: { role } }),
  lookupUser: (body) => request("/api/users/lookup", { method: "POST", body }),
  retryLookup: (id) => request(`/api/users/${id}/retry-lookup`, { method: "POST" }),
};

export function isInFeishu() {
  return /Lark|Feishu|LarkIntl/i.test(navigator.userAgent || "");
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("脚本加载失败"));
    document.head.appendChild(el);
  });
}

export async function requestFeishuJsapiCode(appId) {
  await loadScript(
    "https://lf-cdn.feishu.cn/obj/open-platform/open/js/h5-js-sdk-1.5.31.js"
  );
  return new Promise((resolve, reject) => {
    const run = () => {
      const tt = window.tt;
      if (!tt) return reject(new Error("当前环境没有飞书 JSAPI"));
      if (tt.requestAccess) {
        tt.requestAccess({
          appID: appId,
          scopeList: [
            "auth:user.id:read",
            "drive:file",
            "space:folder:create",
            "space:document:retrieve",
            "space:document:delete",
            "drive:drive.metadata:readonly",
          ],
          success: (res) => resolve(res.code),
          fail: (err) => {
            if (tt.requestAuthCode) {
              tt.requestAuthCode({
                appId,
                success: (r) => resolve(r.code),
                fail: reject,
              });
            } else reject(err);
          },
        });
      } else if (tt.requestAuthCode) {
        tt.requestAuthCode({
          appId,
          success: (r) => resolve(r.code),
          fail: reject,
        });
      } else reject(new Error("当前客户端不支持免登"));
    };
    if (window.h5sdk?.ready) window.h5sdk.ready(run);
    else run();
  });
}
