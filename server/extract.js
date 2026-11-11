import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import mammoth from "mammoth";

const SKILL_TERMS = [
  "Isaac Gym", "Isaac Sim", "Sim2Real", "Diffusion Policy", "OpenVLA",
  "Loco-Manipulation", "PyTorch", "TensorFlow", "ROS2", "Pinocchio",
  "MuJoCo", "Locomotion", "Transformer", "YOLO", "ONNX", "SLAM",
  "LiDAR", "MPC", "WBC", "PPO", "SAC", "VLA", "QP", "C++", "RL",
  "强化学习", "域随机", "数据管线", "接触规划", "全身控制", "状态估计",
  "电机控制", "分布式训练", "局部规划",
];

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item).trim();
    if (!key) continue;
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(key);
  }
  return out;
}

export function extractSkills(text) {
  if (!text) return [];
  const hits = [];
  for (const term of SKILL_TERMS) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(text)) hits.push(term);
  }
  return uniq(hits);
}

export function extractYears(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s*年(?:以上|经验|工作)?/);
  if (m) return Number(m[1]);
  const m2 = text.match(/(\d{1,2})\s*\+\s*years/i);
  if (m2) return Number(m2[1]);
  return null;
}

export function guessName(text, originalName = "") {
  if (text) {
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines.slice(0, 8)) {
      if (/^[\u4e00-\u9fff]{2,4}$/.test(line)) return line;
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(line)) return line;
    }
  }
  const base = path.parse(originalName || "").name.replace(/[_\-]+/g, " ").trim();
  if (base) {
    const cn = base.match(/[\u4e00-\u9fff]{2,4}/);
    if (cn) return cn[0];
    return base.slice(0, 40);
  }
  return "";
}

export function guessTitle(text) {
  if (!text) return "";
  const m = text.match(
    /(?:求职意向|应聘职位|目标职位|职位)[:：\s]*([^\n]{2,30})/
  );
  if (m) return m[1].trim();
  const titles = [
    "强化学习算法工程师",
    "运控算法工程师",
    "具身算法工程师",
    "算法工程师",
    "研究员",
    "控制工程师",
  ];
  for (const t of titles) {
    if (text.includes(t)) return t;
  }
  return "";
}

export async function extractFile(filePath, originalName, mime) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  let text = "";
  let method = "";
  try {
    if (ext === ".pdf" || mime === "application/pdf") {
      const result = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.status === 0) {
        text = result.stdout || "";
        method = "pdftotext";
      } else {
        text = "";
        method = "pdftotext-failed";
      }
    } else if (
      ext === ".docx" ||
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const buffer = fs.readFileSync(filePath);
      const out = await mammoth.extractRawText({ buffer });
      text = out.value || "";
      method = "mammoth";
    } else if (ext === ".doc") {
      text = "";
      method = "unsupported-doc";
    }
  } catch {
    text = "";
    method = "extract-error";
  }
  text = String(text).replace(/\u0000/g, "").trim();
  const parsed = {
    name: guessName(text, originalName),
    title: guessTitle(text),
    years: extractYears(text),
    stacks: extractSkills(text),
    text: text.slice(0, 20000),
    method,
  };
  return parsed;
}

const MUST_HINTS = /必须|必需|任职要求|岗位要求|任职资格|Must\s*have|Requirements/i;
const NICE_HINTS = /加分|优先|Nice\s*to\s*have|Plus|更好/i;

export function extractJdKeywords(jd, jobMust = "", jobNice = "") {
  const must = [];
  const nice = [];
  const text = String(jd || "").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let mode = "must";
  if (!lines.some((l) => MUST_HINTS.test(l) || NICE_HINTS.test(l))) {
    mode = "auto";
  }
  for (const line of lines) {
    if (NICE_HINTS.test(line)) mode = "nice";
    else if (MUST_HINTS.test(line)) mode = "must";
    const parts = splitKeywords(line);
    if (mode === "nice") nice.push(...parts);
    else must.push(...parts);
  }

  const fromJobMust = splitKeywords(jobMust);
  const fromJobNice = splitKeywords(jobNice);
  const skills = extractSkills(text);

  const mustFinal = uniq([...fromJobMust, ...(mode === "auto" ? skills : must)]);
  const niceFinal = uniq([
    ...fromJobNice,
    ...(mode === "auto" ? [] : nice),
  ]).filter((k) => !mustFinal.some((m) => m.toLowerCase() === k.toLowerCase()));

  return { must: mustFinal, nice: niceFinal };
}

function splitKeywords(input) {
  if (!input) return [];
  const cleaned = String(input)
    .replace(MUST_HINTS, " ")
    .replace(NICE_HINTS, " ");
  const parts = cleaned
    .split(/[·,，、|/；;。]+|\s+/)
    .map((s) => s.replace(/^[\s\-：:]+|[\s。：:]+$/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 28)
    .filter((s) => !/[：:。]/.test(s))
    .filter((s) => !/^(招聘|职位|岗位|工程师|负责人|以及|或者|和|与|例如|具备)$/.test(s));
  const skills = extractSkills(input);
  const filtered = parts.filter((p) => {
    const lower = p.toLowerCase();
    if (/^(the|and|or|to|of|gym|sim|plus)$/i.test(p)) return false;
    if (skills.some((s) => s.toLowerCase() !== lower && s.toLowerCase().includes(lower))) return false;
    return true;
  });
  return uniq([...skills, ...filtered]).slice(0, 24);
}

function includesTerm(hay, term) {
  if (!term) return false;
  const h = hay.toLowerCase();
  const t = term.toLowerCase();
  if (t.length <= 2) {
    return new RegExp(`(?:^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`, "i").test(hay);
  }
  return h.includes(t);
}

export function scoreCandidate(candidate, must, nice) {
  const hay = [
    candidate.name,
    candidate.title,
    ...(candidate.stacks || []),
    ...(candidate.highlights || []),
    candidate.notes || "",
  ].join(" ");
  const mustHits = (must || []).filter((k) => includesTerm(hay, k));
  const niceHits = (nice || []).filter((k) => includesTerm(hay, k));
  const mustScore = must.length ? (mustHits.length / must.length) * 70 : 40;
  const niceScore = nice.length ? (niceHits.length / nice.length) * 18 : 8;
  const years = Number(candidate.years || 0);
  const yearsScore = Math.min(8, years * 0.7);
  const base = Number(candidate.score_base || 70) * 0.06;
  const total = Math.round(Math.min(99, Math.max(1, mustScore + niceScore + yearsScore + base)));
  return {
    score: total,
    mustHits,
    niceHits,
    missingMust: (must || []).filter((k) => !mustHits.includes(k)),
  };
}
