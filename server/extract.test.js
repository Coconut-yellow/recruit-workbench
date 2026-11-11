import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDuration,
  looksGarbled,
  parseResumeText,
  presentFilename,
  repairMojibake,
} from "./extract.js";

const SAMPLE = `
李栋
男 24岁 本科
1478710536@qq.com
L15723091126

教育背景
广东工业大学·机械设计制造及其自动化·本科 | 2020-09～2024-07 (3年10个月)

工作经历
东莞市百润装饰工程有限公司·项目负责人 | 2026-01～2026-08 (7个月)
珠海市普生医疗科技股份有限公司·研发工艺工程师 | 2024-07～2025-08 (1年1个月)

一类本科
技能 Sim2Real PyTorch MuJoCo PPO SAC 强化学习
2022年参加校赛
`;

test("repairs UTF-8 filenames that were decoded as Latin-1", () => {
  const original = "C00079616-李栋-机械设计.pdf";
  const mojibake = Buffer.from(original, "utf8").toString("latin1");
  assert.equal(looksGarbled(mojibake), true);
  assert.equal(repairMojibake(mojibake), original);
  assert.equal(presentFilename(mojibake), original);
  assert.equal(presentFilename(original), original);
});

test("does not present mojibake when the bytes are not recoverable", () => {
  const garbage = "C00079616-æ±£å®ç¨å¸æ.pdf";
  const shown = presentFilename(garbage);
  assert.equal(shown.includes("æ"), false);
  assert.match(shown, /^C00079616\.pdf$/);
});

test("parses a Moka-style profile and ignores calendar years", () => {
  const parsed = parseResumeText(SAMPLE, "C00079616-李栋.pdf", { now: new Date("2026-11-11T00:00:00Z") });
  assert.equal(parsed.profile.name, "李栋");
  assert.equal(parsed.profile.gender, "男");
  assert.equal(parsed.profile.age, 24);
  assert.equal(parsed.profile.degree, "本科");
  assert.equal(parsed.profile.email, "1478710536@qq.com");
  assert.equal(parsed.profile.phone, "15723091126");
  assert.equal(parsed.profile.years, null);
  assert.equal(parsed.profile.education.length, 1);
  assert.equal(
    parsed.profile.education[0].line,
    "广东工业大学·机械设计制造及其自动化专业·本科 | 2020-09～2024-07 (3年10个月)"
  );
  assert.equal(
    parsed.profile.work[0].line,
    "东莞市百润装饰工程有限公司·项目负责人 | 2026-01～2026-08 (7个月)"
  );
  assert.equal(
    parsed.profile.work[1].line,
    "珠海市普生医疗科技股份有限公司·研发工艺工程师 | 2024-07～2025-08 (1年1个月)"
  );
  assert.deepEqual(parsed.profile.tags, ["一类本科"]);
  assert.ok(parsed.stacks.includes("强化学习"));
  assert.ok(parsed.stacks.includes("PyTorch"));
});

test("repairs mojibake inside extracted text and still finds the name", () => {
  const body = Buffer.from("李栋\n男 24岁\n广东工业大学 机械设计制造及其自动化 本科\n2020-09～2024-07\n", "utf8").toString("latin1");
  const parsed = parseResumeText(body, Buffer.from("C00079616-李栋.pdf", "utf8").toString("latin1"));
  assert.equal(parsed.profile.name, "李栋");
  assert.equal(parsed.profile.education[0].school, "广东工业大学");
  assert.equal(parsed.filename, "C00079616-李栋.pdf");
});

test("does not use a garbled filename as the candidate name", () => {
  const garbage = "C00079616-æ±£å®ç¨.pdf";
  const parsed = parseResumeText("24岁\n1478710536@qq.com\n15723091126\nSim2Real PyTorch", garbage);
  assert.equal(parsed.name, "");
  assert.equal(parsed.profile.age, 24);
  assert.equal(parsed.profile.email, "1478710536@qq.com");
  assert.equal(parsed.profile.phone, "15723091126");
  assert.ok(parsed.stacks.includes("Sim2Real"));
});

test("duration matches the Moka card", () => {
  assert.equal(formatDuration("2020-09", "2024-07"), "3年10个月");
  assert.equal(formatDuration("2026-01", "2026-08"), "7个月");
  assert.equal(formatDuration("2024-07", "2025-08"), "1年1个月");
});
