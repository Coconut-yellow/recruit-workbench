import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { missingResumeMessage, pickLatest, shouldUploadDatabase } from "./drive.js";

test("keeps an empty local database from replacing a cloud backup", () => {
  assert.equal(shouldUploadDatabase({
    localWasUsable: false,
    restoreSucceeded: false,
    cloudDbToken: "boxcn-existing",
  }), false);
  assert.equal(shouldUploadDatabase({
    localWasUsable: true,
    restoreSucceeded: false,
    cloudDbToken: "boxcn-existing",
  }), true);
  assert.equal(shouldUploadDatabase({
    localWasUsable: false,
    restoreSucceeded: true,
    cloudDbToken: "boxcn-existing",
  }), true);
  assert.equal(shouldUploadDatabase({
    localWasUsable: false,
    restoreSucceeded: false,
    cloudDbToken: "",
  }), true);
});

test("picks the newest database backup by created time", () => {
  const files = [
    { name: "recruit-db-old.db", type: "file", created_time: "10", token: "old" },
    { name: "resume.pdf", type: "file", created_time: "99", token: "pdf" },
    { name: "recruit-db-new.db", type: "file", created_time: "20", token: "new" },
  ];
  const picked = pickLatest(files, (file) => file.type === "file" && file.name.startsWith("recruit-db-"));
  assert.equal(picked.token, "new");
});

test("missing resume message is explicit", () => {
  assert.match(missingResumeMessage(), /重新上传/);
});

test("login scopes include drive file access and not drive:drive", () => {
  const server = fs.readFileSync(new URL("./feishu.js", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../client/src/api.js", import.meta.url), "utf8");
  for (const scope of [
    "auth:user.id:read",
    "drive:file",
    "space:folder:create",
    "space:document:retrieve",
    "space:document:delete",
    "drive:drive.metadata:readonly",
  ]) {
    assert.match(server, new RegExp(scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(client, new RegExp(scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(server, /scope", "drive:drive"/);
  assert.doesNotMatch(client, /"drive:drive"/);
});
