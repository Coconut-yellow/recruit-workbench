import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const RESUME_DIR = path.join(DATA_DIR, "resumes");
export const DB_PATH = path.join(DATA_DIR, "recruit.db");
export const SESSION_SECRET_FILE = path.join(DATA_DIR, "session.secret");
const LARK_SECRET_FILE = "/home/box/.config/lark-mcp/app_secret";

fs.mkdirSync(RESUME_DIR, { recursive: true, mode: 0o700 });

function readSecretFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

export const PORT = Number(process.env.PORT || 3000);
export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PROD = NODE_ENV === "production";

export const APP_ID =
  process.env.APP_ID || process.env.FEISHU_APP_ID || "cli_aa61b8d7a3b89ce0";

export const APP_SECRET =
  process.env.APP_SECRET ||
  process.env.FEISHU_APP_SECRET ||
  readSecretFile(LARK_SECRET_FILE);

export const FEISHU_BASE = "https://open.feishu.cn";
export const ACCOUNTS_BASE = "https://accounts.feishu.cn";

export const PUBLIC_URL = String(
  process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");

export const FEISHU_REDIRECT_URI =
  process.env.FEISHU_REDIRECT_URI || `${PUBLIC_URL}/auth/feishu/callback`;

export const FEISHU_NOTIFY_CHAT_ID = process.env.FEISHU_NOTIFY_CHAT_ID || "";

// 飞书云空间文件夹 token。可先留空，管理员飞书登录后会自动创建并在日志里打印。
export const FEISHU_RESUME_FOLDER_TOKEN = String(process.env.FEISHU_RESUME_FOLDER_TOKEN || "").trim();
export const DRIVE_FOLDER_NAME = "招聘台简历存档";
export const DRIVE_POINTER_NAME = "recruit-workbench.json";
export const DRIVE_DB_PREFIX = "recruit-db-";

// 仅当显式 DEV_LOGIN=1 时开启。生产环境不会默认打开，必须主动设置。
export const DEV_LOGIN = process.env.DEV_LOGIN === "1";

export function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SESSION_SECRET_FILE)) {
    return fs.readFileSync(SESSION_SECRET_FILE, "utf8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SESSION_SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

export const COOKIE_NAME = "rw_sid";
export const COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const COOKIE_SECURE = PUBLIC_URL.startsWith("https://");

export const STAGES = ["待筛选", "初筛", "技术面", "终面", "offer"];

export const ROLE_LABELS = {
  admin: "管理员",
  hiring_manager: "招聘负责人",
  interviewer: "协作面试官",
  readonly: "只读",
};

export const JOB_MEMBER_LABELS = {
  owner: "负责人",
  interviewer: "面试官",
  collaborator: "协作",
};
