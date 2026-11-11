const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 25_000;

const SYSTEM_PROMPT = [
  "你从职位描述中提取可编辑的招聘条件，只输出 JSON，不要 Markdown。",
  '格式：{"must":["..."],"nice":["..."]}',
  "must 是必须满足的技能或经验；nice 是加分项、优先项。",
  "按 JD 原文的中文或英文书写。每一项要具体、简短，不超过 24 个字符。",
  "不要写宣传语，不要编造 JD 里没有、也不能从 JD 直接推出的要求。",
  "任职要求、必须、Requirements 放进 must；加分、优先、Nice to have 放进 nice。",
  "如果 JD 没有分开写，明确的硬性条件放 must，可选或更好的放 nice。",
  "不要使用 · , ， 、 | / ； ; 这些分隔符。",
].join("\n");

export function readLlmConfig(env = process.env) {
  const apiKey = String(env.LLM_API_KEY || "").trim();
  const baseUrl = String(env.LLM_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  const model = String(env.LLM_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

function statusError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function normalizeRequirementItems(list) {
  const seen = new Set();
  const out = [];
  const source = Array.isArray(list) ? list : [];
  for (const item of source) {
    const parts = String(item || "").split(/[·,，、|/；;。]+/);
    for (const part of parts) {
      const text = part.replace(/\s+/g, " ").trim();
      if (text.length < 2 || text.length > 28) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= 16) return out;
    }
  }
  return out;
}

export function formatRequirementField(list) {
  return normalizeRequirementItems(list).join(" · ");
}

export function parseRequirementPayload(content) {
  const raw = String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw statusError("模型没有返回可解析的必须和加分列表", 502);
  }
  const must = formatRequirementField(parsed?.must);
  const nice = formatRequirementField(parsed?.nice);
  if (!must && !nice) {
    throw statusError("模型没有返回可用的必须或加分项", 502);
  }
  return { must, nice };
}

export async function generateJobRequirements(input, options = {}) {
  const jd = String(input?.jd || "").trim();
  if (!jd) throw statusError("请先填写职位描述", 400);
  if (jd.length > 20_000) throw statusError("职位描述过长，请控制在两万字以内", 400);

  const { apiKey, baseUrl, model } = readLlmConfig(options.env);
  if (!apiKey) {
    throw statusError("尚未配置模型密钥 LLM_API_KEY。请管理员在运行环境中设置后再生成。", 503);
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const title = String(input?.title || "").trim();
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: title ? `职位：${title}\n\n${jd}` : jd },
        ],
      }),
      signal: controller.signal,
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      throw statusError(`模型生成失败（HTTP ${response.status}）。请稍后再试。`, 502);
    }
    const content = body?.choices?.[0]?.message?.content || "";
    return parseRequirementPayload(content);
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      throw statusError("模型生成超时，请稍后再试", 504);
    }
    if (err?.status) throw err;
    throw statusError("无法连接模型服务，请检查 LLM_BASE_URL 后重试", 502);
  } finally {
    clearTimeout(timer);
  }
}
