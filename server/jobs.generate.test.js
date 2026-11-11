import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("generate-requirements checks permission and does not save the job", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-llm-"));
  const harness = fileURLToPath(new URL("./jobs.generate.harness.js", import.meta.url));
  const result = spawnSync(process.execPath, [harness], {
    cwd: path.resolve(path.dirname(harness), ".."),
    env: {
      ...process.env,
      RECRUIT_DATA_DIR: dir,
      DEV_LOGIN: "1",
      APP_SECRET: "invalid",
      NODE_ENV: "test",
      LLM_API_KEY: "test-key-not-secret",
      LLM_BASE_URL: "https://llm.example.test/v1",
      LLM_MODEL: "test-model",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(result.stdout, /job generate checks passed/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /test-key-not-secret/);
});
