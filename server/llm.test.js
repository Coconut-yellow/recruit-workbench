import test from "node:test";
import assert from "node:assert/strict";
import { extractJdKeywords } from "./extract.js";
import {
  formatRequirementField,
  generateJobRequirements,
  parseRequirementPayload,
  readLlmConfig,
} from "./llm.js";

const JD = "任职要求：熟悉 PPO 与 PyTorch。\n加分项：有 Sim2Real 经验。";

test("reads model defaults without putting a key in the config", () => {
  const config = readLlmConfig({});
  assert.equal(config.apiKey, "");
  assert.equal(config.baseUrl, "https://api.openai.com/v1");
  assert.equal(config.model, "gpt-4o-mini");
  const custom = readLlmConfig({
    LLM_API_KEY: "secret-key",
    LLM_BASE_URL: "https://api.deepseek.com/v1/",
    LLM_MODEL: "deepseek-chat",
  });
  assert.equal(custom.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(custom.model, "deepseek-chat");
});

test("joins requirement items with the existing middle-dot delimiter", () => {
  assert.equal(
    formatRequirementField([" PPO ", "PyTorch", "这是一段明显超过二十八字限制的宣传句子不应该进入必须字段里面吧", "PPO"]),
    "PPO · PyTorch"
  );
});

test("parses fenced model JSON", () => {
  const parsed = parseRequirementPayload('```json\n{"must":["PPO"],"nice":["域随机"]}\n```');
  assert.equal(parsed.must, "PPO");
  assert.equal(parsed.nice, "域随机");
});

test("does not call the model when the key or JD is missing", async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    throw new Error("network");
  };
  await assert.rejects(
    () => generateJobRequirements({ jd: "" }, { fetchImpl, env: { LLM_API_KEY: "secret-key" } }),
    /请先填写职位描述/
  );
  await assert.rejects(
    () => generateJobRequirements({ jd: JD }, { fetchImpl, env: {} }),
    /LLM_API_KEY/
  );
  assert.equal(called, 0);
});

test("returns the model lists and does not fall back to keyword splitting", async () => {
  const regex = extractJdKeywords(JD);
  let seenAuth = "";
  const fetchImpl = async (url, options) => {
    seenAuth = options.headers.Authorization;
    assert.equal(url, "https://api.deepseek.com/v1/chat/completions");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ must: ["PPO", "PyTorch"], nice: ["Sim2Real"] }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await generateJobRequirements(
    { jd: JD, title: "强化学习" },
    {
      fetchImpl,
      env: {
        LLM_API_KEY: "secret-key",
        LLM_BASE_URL: "https://api.deepseek.com/v1/",
        LLM_MODEL: "deepseek-chat",
      },
    }
  );
  assert.equal(result.must, "PPO · PyTorch");
  assert.equal(result.nice, "Sim2Real");
  assert.notDeepEqual(regex.must, result.must.split(" · "));
  assert.equal(seenAuth, "Bearer secret-key");
  assert.doesNotMatch(JSON.stringify(result), /secret-key/);
});

test("surfaces model HTTP failures instead of invented keywords", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "secret-key" } }), { status: 401 });
  await assert.rejects(
    () => generateJobRequirements({ jd: JD }, { fetchImpl, env: { LLM_API_KEY: "secret-key" } }),
    (err) => {
      assert.equal(err.status, 502);
      assert.match(err.message, /模型生成失败/);
      assert.doesNotMatch(err.message, /secret-key/);
      assert.doesNotMatch(err.message, /PPO/);
      return true;
    }
  );
});

test("times out without calling a real network", async () => {
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
  await assert.rejects(
    () => generateJobRequirements(
      { jd: JD },
      { fetchImpl, env: { LLM_API_KEY: "secret-key" }, timeoutMs: 20 }
    ),
    /超时/
  );
});
