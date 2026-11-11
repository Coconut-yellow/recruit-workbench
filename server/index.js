import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { initDb, closeDb } from "./db.js";
import {
  PORT,
  IS_PROD,
  DEV_LOGIN,
  ROOT,
  PUBLIC_URL,
  APP_ID,
  APP_SECRET,
  FEISHU_REDIRECT_URI,
} from "./config.js";
import { getSessionSecret } from "./config.js";
import { startFeishuOAuth, handleFeishuCallback } from "./auth.js";
import { getTenantAccessToken } from "./feishu.js";
import api from "./routes.js";

await initDb();
getSessionSecret();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "轻量招聘台", publicUrl: PUBLIC_URL });
});

app.get("/auth/feishu", startFeishuOAuth);
app.get("/auth/feishu/callback", handleFeishuCallback);
app.get("/callback", handleFeishuCallback);

app.use("/api", api);

if (IS_PROD) {
  const dist = path.join(ROOT, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error("未找到前端构建产物，请先执行 npm run build");
    process.exit(1);
  }
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/auth")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: path.join(ROOT, "client"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`轻量招聘台已启动：http://localhost:${PORT}`);
  console.log(`对外地址 PUBLIC_URL=${PUBLIC_URL}`);
  console.log(`飞书回调 FEISHU_REDIRECT_URI=${FEISHU_REDIRECT_URI}`);
  console.log(`本地开发登录：${DEV_LOGIN ? "已开启" : "关闭"}`);
  console.log(`飞书 App ID：${APP_ID}`);
  if (!APP_SECRET) {
    console.log("飞书租户凭证：未配置 App Secret");
  } else {
    try {
      const token = await getTenantAccessToken();
      if (token.ok) {
        console.log("飞书租户凭证：已获取");
      } else {
        console.log(`飞书租户凭证：获取失败（${token.error || "未知错误"}）`);
      }
    } catch (err) {
      console.log(`飞书租户凭证：检查异常（${err.message}）`);
    }
  }
});

function shutdown() {
  closeDb();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
