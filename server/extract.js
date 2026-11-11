import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import mammoth from "mammoth";

export const PARSE_VERSION = 2;

const SKILL_TERMS = [
  "Isaac Gym", "Isaac Sim", "Sim2Real", "Diffusion Policy", "OpenVLA",
  "Loco-Manipulation", "PyTorch", "TensorFlow", "ROS2", "Pinocchio",
  "MuJoCo", "Locomotion", "Transformer", "YOLO", "ONNX", "SLAM",
  "LiDAR", "MPC", "WBC", "PPO", "SAC", "VLA", "QP", "C++", "RL",
  "强化学习", "域随机", "数据管线", "接触规划", "全身控制", "状态估计",
  "电机控制", "分布式训练", "局部规划",
];

const NAME_STOP = new Set([
  "男", "女", "本科", "硕士", "博士", "大专", "专科", "高中", "中专", "学士",
  "简历", "姓名", "个人信息", "基本信息", "教育背景", "教育经历", "学习经历",
  "工作经历", "工作经验", "实习经历", "项目经历", "项目经验", "专业技能",
  "技能特长", "一类本科", "二类本科", "自我评价", "求职意向", "校园经历",
  "荣誉奖项", "在职", "离职", "工程师", "机械", "算法", "设计", "制造",
  "个人简历", "中文简历", "应聘", "求职",
]);

const SECTION_MAP = {
  教育经历: "education",
  教育背景: "education",
  学习经历: "education",
  工作经历: "work",
  工作经验: "work",
  职业经历: "work",
  实习经历: "work",
  项目经历: "skip",
  项目经验: "skip",
  专业技能: "skip",
  技能特长: "skip",
  自我评价: "skip",
  求职意向: "skip",
  基本信息: "auto",
  个人信息: "auto",
  校园经历: "skip",
  荣誉奖项: "skip",
};

const DEGREE_RE = /(博士研究生|硕士研究生|博士|硕士|MBA|本科|学士|大专|专科|高中|中专)/i;
const DATE_RE = /(?<sy>20\d{2}|19\d{2})\s*[.\-/年]\s*(?<sm>0?[1-9]|1[0-2])\s*月?\s*[-~～—–到至]+\s*(?:(?<ey>20\d{2}|19\d{2})\s*[.\-/年]\s*(?<em>0?[1-9]|1[0-2])\s*月?|(?<ongoing>至今|现在|今(?!天)))/;

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

function cjkCount(text) {
  return (String(text || "").match(/[\u4e00-\u9fff]/g) || []).length;
}

function latinSupplementCount(text) {
  return (String(text || "").match(/[\u0080-\u00ff]/g) || []).length;
}

function isUsefulDecode(decoded, run) {
  if (!decoded || decoded.includes("\uFFFD")) return false;
  if (/[\uE000-\uF8FF\u3100-\u312F]/.test(decoded)) return false;
  if (cjkCount(decoded) > 0) return true;
  return [...decoded].every((ch) => /[\u3000-\u303F\uFF00-\uFFEF\u2010-\u2027·]/.test(ch))
    && decoded.length < run.length;
}

function decodeRun(run) {
  const bytes = Buffer.from(run, "latin1");
  const utf8 = bytes.toString("utf8");
  if (isUsefulDecode(utf8, run)) return utf8;
  try {
    const gbk = new TextDecoder("gbk", { fatal: true }).decode(bytes);
    if (isUsefulDecode(gbk, run) && cjkCount(gbk) >= 2 && !/[\uFF00-\uFFEF]/.test(gbk)) return gbk;
  } catch {
    /* not gbk */
  }
  return "";
}

export function repairMojibake(input) {
  const text = String(input ?? "");
  if (!text || !/[\u0080-\u00ff]/.test(text)) return text;
  return text.replace(/[\u0080-\u00ff]+/g, (run) => {
    if (run.length < 2) return run;
    return decodeRun(run) || run;
  });
}

export function looksGarbled(input) {
  const s = String(input || "");
  if (!s) return false;
  if (s.includes("\uFFFD") || /\(cid:\d+\)/i.test(s)) return true;
  if (/[\uE000-\uF8FF\u3100-\u312F]/.test(s)) return true;
  let latin = 0;
  let cjk = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x4e00 && c <= 0x9fff) cjk += 1;
    else if (c >= 0x80 && c <= 0xff) latin += 1;
  }
  if (latin >= 4 && latin > cjk) return true;
  return false;
}

export function presentFilename(name) {
  const fixed = repairMojibake(name).trim();
  if (fixed && !looksGarbled(fixed)) return fixed;
  const extSource = fixed || String(name || "");
  const ext = path.extname(extSource).toLowerCase();
  const safeExt = [".pdf", ".docx", ".doc"].includes(ext) ? ext : ".pdf";
  const id = extSource.match(/[A-Za-z]\d{5,}/);
  return `${id ? id[0] : "简历"}${safeExt}`;
}

function acceptableName(name) {
  const n = String(name || "").trim();
  if (!n || looksGarbled(n) || NAME_STOP.has(n)) return "";
  if (/^[\u4e00-\u9fff]{2,4}$/.test(n)) return n;
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(n)) return n;
  return "";
}

function nameFromFilename(filename) {
  const base = path.parse(String(filename || "")).name;
  if (!base || looksGarbled(base)) return "";
  const pieces = base.split(/[A-Za-z]*\d{5,}/);
  const focus = pieces.length > 1 ? pieces.slice(1).join(" ") : base;
  const runs = focus.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of runs) {
    const trimmed = run.replace(/(?:个人)?简历$|求职$|应聘$|中文$|英文$/g, "");
    const hit = acceptableName(trimmed);
    if (hit) return hit;
    if (trimmed.length > 4) {
      const head = acceptableName(trimmed.slice(0, 3)) || acceptableName(trimmed.slice(0, 2));
      if (head) return head;
    }
  }
  return "";
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
  const patterns = [
    /(?:工作经验|工作年限|从业年限|从业)\s*[:：]?\s*(\d{1,2})\s*年/,
    /(\d{1,2})\s*年(?:以上)?(?:工作经验|工作年限|经验)/,
    /(\d{1,2})\s*\+\s*years/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 0 && n <= 40) return n;
  }
  return null;
}

function normalizeYm(year, month) {
  return `${year}-${String(Number(month)).padStart(2, "0")}`;
}

function currentYm(now) {
  const date = now instanceof Date ? now : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function findDate(line) {
  const m = String(line || "").match(DATE_RE);
  if (!m || !m.groups) return null;
  const start = normalizeYm(m.groups.sy, m.groups.sm);
  const ongoing = Boolean(m.groups.ongoing);
  const end = ongoing ? "" : normalizeYm(m.groups.ey, m.groups.em);
  return { raw: m[0], start, end, ongoing, index: m.index };
}

function monthIndex(ym) {
  const [y, m] = String(ym || "").split("-").map(Number);
  if (!y || !m) return 0;
  return y * 12 + (m - 1);
}

export function formatDuration(start, end) {
  let months = monthIndex(end) - monthIndex(start);
  if (!Number.isFinite(months) || months < 1) months = 1;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years && rem) return `${years}年${rem}个月`;
  if (years) return `${years}年`;
  return `${rem}个月`;
}

function formatWhen(entry) {
  if (!entry.start) return "";
  const end = entry.end || "至今";
  const dur = entry.duration ? ` (${entry.duration})` : "";
  return `${entry.start}～${end}${dur}`;
}

function educationLine(entry) {
  const major = entry.major
    ? (/(专业|系|方向)$/.test(entry.major) ? entry.major : `${entry.major}专业`)
    : "";
  const left = [entry.school, major, entry.degree].filter(Boolean).join("·");
  const when = formatWhen(entry);
  return when && left ? `${left} | ${when}` : left || when;
}

function workLine(entry) {
  const left = [entry.company, entry.title].filter(Boolean).join("·");
  const when = formatWhen(entry);
  return when && left ? `${left} | ${when}` : left || when;
}

function matchSchool(text) {
  const m = String(text || "").match(/[\u4e00-\u9fffA-Za-z]{2,24}(?:大学|学院|学校)/);
  return m ? m[0] : "";
}

function matchCompany(text) {
  const src = String(text || "");
  const long = src.match(/[\u4e00-\u9fffA-Za-z0-9（）()]{2,40}(?:股份有限公司|有限责任公司|有限公司|集团公司)/);
  if (long) return long[0];
  const short = src.match(/[\u4e00-\u9fffA-Za-z0-9（）()]{2,30}(?:集团|公司|研究院|银行|医院)/);
  return short ? short[0] : "";
}

function normalizeDegree(raw) {
  const text = String(raw || "");
  if (/博士/.test(text)) return "博士";
  if (/硕士|MBA/i.test(text)) return "硕士";
  if (/本科|学士/.test(text)) return "本科";
  if (/大专|专科/.test(text)) return "大专";
  if (/高中/.test(text)) return "高中";
  if (/中专/.test(text)) return "中专";
  return "";
}

function highestDegree(degrees) {
  const rank = ["博士", "硕士", "本科", "大专", "高中", "中专"];
  for (const item of rank) {
    if (degrees.includes(item)) return item;
  }
  return degrees[0] || "";
}

function removeOnce(text, token) {
  if (!token) return text;
  const i = text.indexOf(token);
  if (i < 0) return text;
  return `${text.slice(0, i)} ${text.slice(i + token.length)}`;
}

function leftoverToken(text) {
  const cleaned = String(text || "")
    .replace(DEGREE_RE, " ")
    .replace(/[0-9０-９]/g, " ")
    .replace(/岁|至今|现在|年|月/g, " ")
    .replace(/[|｜·•,，、/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ").filter((p) => /^[\u4e00-\u9fffA-Za-z+.#]{2,20}$/.test(p) && !NAME_STOP.has(p));
  parts.sort((a, b) => b.length - a.length);
  return parts[0] || "";
}

function classifyLine(line, section, date, now) {
  let rest = line.replace(date.raw, " ");
  rest = rest.replace(/[（(]\s*\d+\s*年?\s*\d*\s*个?月\s*[)）]/g, " ");
  rest = rest.replace(/[|｜]/g, " ").replace(/[·•]/g, " ").replace(/\s+/g, " ").trim();
  if (/@|1[3-9]\d{9}/.test(rest) && !matchSchool(rest) && !matchCompany(rest)) return null;
  const school = matchSchool(rest);
  const company = matchCompany(rest);
  const degreeRaw = rest.match(DEGREE_RE);
  const degree = normalizeDegree(degreeRaw ? degreeRaw[1] : "");
  const endForDuration = date.end || currentYm(now);
  const duration = formatDuration(date.start, endForDuration);
  const base = { start: date.start, end: date.end, duration };

  const asEducation = section === "education" || (section !== "work" && school);
  if (asEducation && (school || degree)) {
    let remain = removeOnce(rest, school);
    if (degreeRaw) remain = removeOnce(remain, degreeRaw[1]);
    const major = leftoverToken(remain);
    const entry = { ...base, school, major, degree: degree || (section === "education" ? "" : "") };
    entry.line = educationLine(entry);
    if (!entry.line) return null;
    return { kind: "education", entry };
  }
  if (company || section === "work") {
    let remain = removeOnce(rest, company);
    const title = leftoverToken(remain);
    if (!company && !title) return null;
    const entry = { ...base, company, title };
    entry.line = workLine(entry);
    if (!entry.line) return null;
    return { kind: "work", entry };
  }
  return null;
}

function extractTags(text) {
  const tags = [];
  if (/一类本科|(?:^|[^\u4e00-\u9fff])一本(?:$|[^\u4e00-\u9fff])/.test(text)) tags.push("一类本科");
  if (/二类本科|(?:^|[^\u4e00-\u9fff])二本(?:$|[^\u4e00-\u9fff])/.test(text)) tags.push("二类本科");
  if (/双一流/.test(text)) tags.push("双一流");
  if (/(?<![0-9A-Za-z])985(?![0-9A-Za-z])/.test(text)) tags.push("985");
  if (/(?<![0-9A-Za-z])211(?![0-9A-Za-z])/.test(text)) tags.push("211");
  return uniq(tags);
}

function extractGender(text) {
  const labeled = text.match(/性别\s*[:：]?\s*([男女])/);
  if (labeled) return labeled[1];
  const head = text.slice(0, 240);
  const inline = head.match(/(?:^|[\s|｜·])([男女])(?=[\s|｜·]|$|\d|岁)/m);
  return inline ? inline[1] : "";
}

function extractAge(text) {
  const m = text.match(/(?:年龄\s*[:：]?\s*)?(\d{2})\s*岁/);
  if (!m) return null;
  const age = Number(m[1]);
  if (age < 15 || age > 70) return null;
  return age;
}

function extractPhone(text) {
  const m = text.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/);
  return m ? m[1] : "";
}

function extractEmail(text) {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : "";
}

function guessNameFromText(text) {
  const labeled = text.match(/姓\s*名\s*[:：]\s*([\u4e00-\u9fff]{2,4})/);
  if (labeled) return acceptableName(labeled[1]);
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  for (const line of lines) {
    const only = acceptableName(line);
    if (only) return only;
    const withGender = line.match(/^([\u4e00-\u9fff]{2,4})\s*[|｜·\s]\s*[男女](?=[\s|｜·]|$|\d|岁)/);
    if (withGender) {
      const hit = acceptableName(withGender[1]);
      if (hit) return hit;
    }
  }
  return "";
}

export function guessTitle(text) {
  if (!text) return "";
  const m = text.match(/(?:求职意向|应聘职位|目标职位|职位)[:：\s]*([^\n]{2,30})/);
  if (m) {
    const title = m[1].trim();
    if (title && !looksGarbled(title)) return title.slice(0, 30);
  }
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

function assessQuality(repaired, profile) {
  const trimmed = repaired.trim();
  if (trimmed.length < 8) return "empty";
  const bad = latinSupplementCount(repaired);
  const cjk = cjkCount(repaired);
  const structured = profile.education.length + profile.work.length > 0 && profile.name;
  if ((bad >= 6 && bad > cjk) || (profile.name === "" && looksGarbled(trimmed) && !profile.email && !profile.phone)) {
    return structured ? "partial" : "garbled";
  }
  if (structured || profile.name || profile.email || profile.phone || cjk >= 8) return "ok";
  return "partial";
}

export function parseResumeText(rawText, originalName = "", options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const filename = presentFilename(originalName);
  const repaired = repairMojibake(rawText).replace(/\u0000/g, "").replace(/[ \t\u00a0]+/g, " ").trim();
  const lines = repaired.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const education = [];
  const work = [];
  let section = "auto";
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].replace(/[:：\s]/g, "");
    if (SECTION_MAP[header]) {
      section = SECTION_MAP[header];
      continue;
    }
    if (section === "skip") continue;
    let line = lines[i];
    let date = findDate(line);
    if (!date && lines[i + 1] && findDate(lines[i + 1]) && (matchSchool(line) || matchCompany(line))) {
      line = `${line} ${lines[i + 1]}`;
      date = findDate(line);
      i += 1;
    }
    if (!date) continue;
    const found = classifyLine(line, section, date, now);
    if (!found) continue;
    const bucket = found.kind === "education" ? education : work;
    const key = found.entry.line;
    if (!bucket.some((item) => item.line === key)) bucket.push(found.entry);
  }
  const byStart = (a, b) => monthIndex(b.start) - monthIndex(a.start);
  education.sort((a, b) => monthIndex(b.end || b.start) - monthIndex(a.end || a.start));
  work.sort(byStart);

  const name = guessNameFromText(repaired) || nameFromFilename(filename);
  const gender = extractGender(repaired);
  const age = extractAge(repaired);
  const email = extractEmail(repaired);
  const phone = extractPhone(repaired);
  const degree = highestDegree(education.map((item) => item.degree).filter(Boolean).concat(
    normalizeDegree((repaired.slice(0, 300).match(DEGREE_RE) || [])[1] || "")
  ).filter(Boolean));
  const years = extractYears(repaired);
  const title = work.find((item) => item.title)?.title || guessTitle(repaired);
  const tags = extractTags(repaired);
  const stacks = extractSkills(repaired);
  const profile = {
    name,
    gender,
    age,
    degree,
    email,
    phone,
    years,
    title,
    education,
    work,
    tags,
    stacks,
    textQuality: "empty",
    fileMissing: false,
  };
  profile.textQuality = assessQuality(repaired, profile);
  if (profile.textQuality === "garbled") profile.name = name && !looksGarbled(name) ? name : "";
  return {
    name: profile.name || "",
    title: profile.title || "",
    years: profile.years,
    stacks,
    text: repaired.slice(0, 20000),
    method: "text",
    filename,
    profile,
  };
}

export function guessName(text, originalName = "") {
  return parseResumeText(text, originalName).name;
}

function pdftotext(filePath, mode) {
  const args = mode === "raw" ? ["-raw"] : ["-layout"];
  const result = spawnSync("pdftotext", [...args, "-enc", "UTF-8", filePath, "-"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 20000,
  });
  if (result.error || result.status !== 0) {
    return { text: "", missing: Boolean(result.error) };
  }
  return { text: result.stdout || "", missing: false };
}

function textScore(text) {
  const repaired = repairMojibake(text || "");
  return cjkCount(repaired) * 5 + Math.min(repaired.trim().length, 4000) / 25 - latinSupplementCount(repaired) * 4;
}

export async function extractFile(filePath, originalName, mime) {
  const filename = presentFilename(originalName);
  const ext = path.extname(filename || filePath).toLowerCase();
  let text = "";
  let method = "";
  try {
    if (ext === ".pdf" || mime === "application/pdf") {
      const layout = pdftotext(filePath, "layout");
      const raw = pdftotext(filePath, "raw");
      if (layout.missing && raw.missing) {
        method = "pdftotext-missing";
      } else {
        text = textScore(raw.text) > textScore(layout.text) ? raw.text : layout.text;
        method = text.trim() ? "pdftotext" : "pdftotext-failed";
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
      method = "unsupported-doc";
    }
  } catch {
    text = "";
    method = "extract-error";
  }
  const parsed = parseResumeText(text, filename);
  parsed.method = method || parsed.method;
  parsed.text = repairMojibake(text).replace(/\u0000/g, "").trim().slice(0, 20000);
  if (!parsed.text) {
    parsed.profile.textQuality = "empty";
    if (!parsed.profile.name) parsed.name = "";
  }
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

function profileHay(candidate) {
  const profile = candidate?.profile;
  if (!profile || typeof profile !== "object") return "";
  return [
    profile.degree,
    ...(profile.tags || []),
    ...(profile.education || []).map((item) => item.line || `${item.school || ""} ${item.major || ""}`),
    ...(profile.work || []).map((item) => item.line || `${item.company || ""} ${item.title || ""}`),
  ].join(" ");
}

export function scoreCandidate(candidate, must, nice) {
  const hay = [
    candidate.name,
    candidate.title,
    ...(candidate.stacks || []),
    ...(candidate.highlights || []),
    candidate.notes || "",
    profileHay(candidate),
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
