import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("DELETE /api/jobs/:id unlinks people and rejects unauthorized users", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-jobs-"));
  const harness = fileURLToPath(new URL("./jobs.delete.harness.js", import.meta.url));
  const result = spawnSync(process.execPath, [harness], {
    cwd: path.resolve(path.dirname(harness), ".."),
    env: {
      ...process.env,
      RECRUIT_DATA_DIR: dir,
      DEV_LOGIN: "1",
      APP_SECRET: "invalid",
      NODE_ENV: "test",
    },
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${result.stdout || ""}\n${result.stderr || ""}`
  );
  assert.match(result.stdout, /job delete checks passed/);
});
