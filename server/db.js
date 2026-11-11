import fs from "node:fs";
import initSqlJs from "sql.js";
import { DB_PATH, STAGES } from "./config.js";

let sqlDb;
let persistTimer;
let SQL;

function persistNow() {
  if (!sqlDb) return;
  const data = Buffer.from(sqlDb.export());
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, DB_PATH);
}

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 40);
}

export function all(sql, params = []) {
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

export function run(sql, params = []) {
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const changes = sqlDb.getRowsModified();
  persistSoon();
  return { changes };
}

export function exec(sql) {
  sqlDb.exec(sql);
  persistSoon();
}

function createSchema() {
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'readonly',
      title TEXT,
      feishu_open_id TEXT,
      feishu_union_id TEXT,
      feishu_user_id TEXT,
      avatar TEXT,
      lookup_status TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL AND email != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_open_id ON users(feishu_open_id) WHERE feishu_open_id IS NOT NULL AND feishu_open_id != '';

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      must TEXT,
      nice TEXT,
      level TEXT,
      location TEXT,
      status TEXT NOT NULL DEFAULT '招聘中',
      jd TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_members (
      job_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (job_id, user_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT,
      years INTEGER,
      stacks TEXT,
      highlights TEXT,
      stage TEXT NOT NULL,
      score_base INTEGER,
      job_id TEXT,
      resume_id TEXT,
      email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY,
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT,
      size INTEGER,
      extracted_text TEXT,
      parsed_name TEXT,
      parsed_title TEXT,
      parsed_years INTEGER,
      parsed_stacks TEXT,
      candidate_id TEXT,
      job_id TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stage_events (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      job_id TEXT,
      from_stage TEXT,
      to_stage TEXT NOT NULL,
      actor_user_id TEXT,
      notify_result TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
}

function nowIso() {
  return new Date().toISOString();
}

function seedIfEmpty() {
  const row = get("SELECT COUNT(*) AS c FROM users");
  if (row && Number(row.c) > 0) return;

  const now = nowIso();

  const users = [
    {
      id: "u-admin",
      name: "江澄",
      email: "jiangcheng@example.com",
      role: "admin",
      title: "招聘与组织发展",
    },
    {
      id: "u-owner1",
      name: "沈砺",
      email: "shenli@example.com",
      role: "hiring_manager",
      title: "算法招聘负责人",
    },
    {
      id: "u-owner2",
      name: "顾衡",
      email: "guheng@example.com",
      role: "hiring_manager",
      title: "运控招聘负责人",
    },
    {
      id: "u-int1",
      name: "唐川",
      email: "tangchuan@example.com",
      role: "interviewer",
      title: "运控算法专家",
    },
    {
      id: "u-int2",
      name: "裴岚",
      email: "peilan@example.com",
      role: "interviewer",
      title: "具身算法专家",
    },
    {
      id: "u-read",
      name: "阮青",
      email: "ruanqing@example.com",
      role: "readonly",
      title: "用人部门协作",
    },
  ];

  for (const u of users) {
    run(
      `INSERT INTO users (id, name, email, role, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [u.id, u.name, u.email, u.role, u.title, now, now]
    );
  }

  const jobs = [
    {
      id: "j1",
      title: "强化学习算法（Locomotion）",
      must: "RL · Isaac · Sim2Real · PyTorch",
      nice: "Locomotion · 域随机 · 四足/人形落地经验",
      level: "P7",
      location: "深圳",
      status: "招聘中",
      jd: "招聘强化学习算法工程师，负责人形/四足机器人 Locomotion 策略。\n必须：强化学习（PPO/SAC）、Isaac Gym 或 Isaac Sim、Sim2Real、PyTorch。\n加分：域随机、实机落地、分布式训练。",
    },
    {
      id: "j2",
      title: "全身运控负责人",
      must: "WBC · MPC · C++ · ROS2",
      nice: "接触规划 · 硬件联调 · 团队管理",
      level: "M",
      location: "深圳",
      status: "招聘中",
      jd: "招聘全身运控负责人，带领团队完成人形机器人全身控制。\n必须：WBC、MPC、C++、ROS2、QP。\n加分：接触规划、实机联调、带队经验。",
    },
    {
      id: "j3",
      title: "具身操作算法",
      must: "VLA / Diffusion · 数据管线",
      nice: "OpenVLA · 策略评估 · 大规模训练",
      level: "P6-7",
      location: "深圳",
      status: "暂停",
      jd: "招聘具身操作算法工程师。\n必须：VLA 或 Diffusion Policy、数据管线、PyTorch。\n加分：OpenVLA、操作数据飞轮、策略评估。",
    },
  ];

  for (const j of jobs) {
    run(
      `INSERT INTO jobs (id, title, must, nice, level, location, status, jd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [j.id, j.title, j.must, j.nice, j.level, j.location, j.status, j.jd, now, now]
    );
  }

  const members = [
    ["j1", "u-owner1", "owner"],
    ["j1", "u-int1", "interviewer"],
    ["j2", "u-owner2", "owner"],
    ["j2", "u-int1", "interviewer"],
    ["j3", "u-owner1", "owner"],
    ["j3", "u-int2", "interviewer"],
    ["j3", "u-read", "collaborator"],
  ];
  for (const [jobId, userId, role] of members) {
    run(
      `INSERT INTO job_members (job_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      [jobId, userId, role, now]
    );
  }

  const candidates = [
    ["c1", "陈可", "强化学习算法工程师", 5, ["RL", "PPO", "SAC", "Isaac Gym", "PyTorch", "Sim2Real", "Locomotion"], ["四足/人形 locomotion 落地", "sim2real 域随机"], "待筛选", 92, "j1"],
    ["c2", "林舟", "机器人运控算法", 7, ["MPC", "WBC", "Pinocchio", "C++", "ROS2", "QP", "Contact"], ["全身控制与接触规划", "与硬件联调"], "初筛", 88, "j2"],
    ["c3", "赵宁", "具身多模态算法", 4, ["VLA", "Transformer", "Diffusion Policy", "PyTorch", "OpenVLA", "数据管线"], ["操作策略与数据质量", "大规模训练"], "待筛选", 85, "j3"],
    ["c4", "周然", "感知规划工程师", 6, ["SLAM", "导航", "局部规划", "Occupancy", "C++", "ROS2", "LiDAR"], ["可通行性与场景导航", "野外鲁棒"], "技术面", 80, "j2"],
    ["c5", "韩悦", "仿真与训练平台", 5, ["Isaac Sim", "MuJoCo", "RL", "分布式训练", "Python", "CI"], ["可复现训练平台", "虚实迁移工具链"], "待筛选", 83, "j1"],
    ["c6", "丁一", "传统运控专家", 9, ["PID", "状态估计", "卡尔曼", "嵌入式", "C", "电机控制"], ["关节级控制", "量产调试"], "终面", 78, "j2"],
    ["c7", "许杉", "Loco-Manipulation", 4, ["RL", "Loco-Manipulation", "接触", "Isaac Gym", "PyTorch", "MPC"], ["边走边操作", "接触丰富任务"], "待筛选", 90, "j1"],
    ["c8", "马驰", "CV 算法工程师", 5, ["检测", "分割", "YOLO", "PyTorch", "ONNX", "部署"], ["视觉检测量产", "边缘部署"], "待筛选", 70, "j3"],
    ["c9", "叶晴", "RL 研究员", 3, ["RL", "PPO", "Isaac Gym", "PyTorch", "Sim2Real"], ["论文落地", "仿真加速"], "初筛", 86, "j1"],
    ["c10", "高远", "运控算法", 6, ["MPC", "WBC", "C++", "ROS2", "QP"], ["人形全身控制", "实机调参"], "技术面", 87, "j2"],
    ["c11", "苏晚", "具身算法", 5, ["VLA", "Diffusion Policy", "数据管线", "PyTorch"], ["操作数据飞轮", "策略评估"], "offer", 91, "j3"],
  ];

  for (const c of candidates) {
    const [id, name, title, years, stacks, highlights, stage, scoreBase, jobId] = c;
    if (!STAGES.includes(stage)) continue;
    run(
      `INSERT INTO candidates (id, name, title, years, stacks, highlights, stage, score_base, job_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, title, years, JSON.stringify(stacks), JSON.stringify(highlights), stage, scoreBase, jobId, now, now]
    );
  }
}

export async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    sqlDb = new SQL.Database();
  }
  exec("PRAGMA foreign_keys = ON;");
  createSchema();
  seedIfEmpty();
  persistNow();
}

export function closeDb() {
  clearTimeout(persistTimer);
  persistNow();
}

export function parseJsonCol(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
