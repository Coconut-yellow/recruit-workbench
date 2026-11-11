# 轻量招聘台

可在浏览器独立使用、后续放入飞书工作台的轻量招聘协作应用。包含职位与看板、简历归档、规则匹配、协作权限，以及飞书登录与阶段通知。

## 启动

需要 Node.js 20 或以上（本机已验证 Node 24）。在项目目录执行：

```bash
cd /workspace/recruit-workbench
npm install
```

本地开发（开启「本地开发登录」，前后端同一端口）：

```bash
npm run dev
```

默认地址：[http://localhost:3000](http://localhost:3000)

生产启动（先构建前端，再由 Express 同时提供 API 与静态页面；默认**不会**开启本地开发登录）：

```bash
npm start
```

若前端已经构建过，只需：

```bash
npm run start:prod
```

生产环境若仍需临时使用本地开发登录，必须显式加上 `DEV_LOGIN=1`：

```bash
DEV_LOGIN=1 NODE_ENV=production npm run start:prod
```

数据与上传文件位于 `data/`（已加入 `.gitignore`）：

- `data/recruit.db`：SQLite 数据库
- `data/resumes/`：简历原件
- `data/session.secret`：若未设置 `SESSION_SECRET`，首次启动会自动生成

首次启动会写入演示数据（职位：强化学习算法 Locomotion、全身运控负责人、具身操作算法；以及若干虚构候选人与协作账号）。

## 环境变量

可复制 `.env.example` 后自行导出到 shell，或在启动命令前加上。服务读取如下变量：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口，默认 `3000` |
| `PUBLIC_URL` | 对外访问根地址，用于拼接 OAuth 回调和工作台主页。本地默认 `http://localhost:3000`，上线改为公网 HTTPS |
| `APP_ID` 或 `FEISHU_APP_ID` | 飞书企业自建应用 App ID，默认 `cli_aa61b8d7a3b89ce0` |
| `APP_SECRET` 或 `FEISHU_APP_SECRET` | 应用密钥。不要写入仓库或前端。若环境变量未设置，会尝试读取 `/home/box/.config/lark-mcp/app_secret` |
| `FEISHU_REDIRECT_URI` | OAuth 回调地址，须与飞书后台重定向 URL 完全一致。默认 `{PUBLIC_URL}/auth/feishu/callback` |
| `SESSION_SECRET` | 会话签名。省略时写入 `data/session.secret` |
| `DEV_LOGIN` | 设为 `1` 时开启本地开发登录。`NODE_ENV=production` 时不会默认打开，必须显式设置 |
| `FEISHU_NOTIFY_CHAT_ID` | 可选，阶段变更时额外通知该飞书群（`chat_id`） |
| `FEISHU_RESUME_FOLDER_TOKEN` | 可选。飞书云空间「招聘台简历存档」的文件夹 token。留空时，管理员用飞书重新登录后会创建文件夹，并在服务日志和「飞书」页打印 token |
| `NODE_ENV` | `production` 时提供构建后的前端；其他情况使用 Vite 开发中间件 |
| `LLM_API_KEY` | 根据 JD 生成必须/加分时必填。不要写入仓库 |
| `LLM_BASE_URL` | 可选。OpenAI 兼容接口根路径，不含 `/chat/completions`。默认 `https://api.openai.com/v1`。DeepSeek 用 `https://api.deepseek.com/v1` |
| `LLM_MODEL` | 可选。默认 `gpt-4o-mini`。DeepSeek 可设为 `deepseek-chat` |

开放平台为中国区：`https://open.feishu.cn`。

简历原件和 `recruit.db` 会备份到飞书云空间，避免 Render 免费实例重新部署后本地 `data/` 被清空。应用需要开通并发布这些权限（不要开通 `drive:drive`）：

- `auth:user.id:read`（原有登录权限）
- `drive:file`（上传、下载文件到云空间，并添加协作者）
- `space:folder:create`（创建云空间文件夹）
- `space:document:retrieve`（获取文件夹中的文件清单）
- `space:document:delete`（删掉被替换的旧数据库备份）
- `drive:drive.metadata:readonly`（查看云空间根目录，便于重新部署后找回文件夹）

权限发布后，管理员要重新用飞书登录一次。如果应用仍然不能访问个人云空间里的文件夹，给应用加上机器人，建一个群把机器人拉进去，再把文件夹分享给该群并设为「可管理」。云备份失败时，存档页和飞书页会直接提示，不会显示成已经持久化。

## 飞书开发者后台需要填写的字段

应用已经建好。把本服务放到公网 HTTPS 之后，你只需要在[飞书开发者后台](https://open.feishu.cn/app)打开该企业自建应用，填写以下地址并**创建版本、提交发布**：

把公网根地址记为 `{PUBLIC_URL}`，例如 `https://recruit.example.com`（不要末尾斜杠）。

1. **应用功能 → 网页 → 桌面端主页**：`{PUBLIC_URL}`
2. **应用功能 → 网页 → 移动端主页**：`{PUBLIC_URL}`
3. **安全设置 → 重定向 URL**（可同时保留本地调试地址）：
   - `{PUBLIC_URL}/auth/feishu/callback`
   - `{PUBLIC_URL}/callback`
   - `http://localhost:3000/callback`（可选，本地开发）
   - `http://localhost:3000/auth/feishu/callback`（可选，本地开发）

同时在运行环境中设置：

```bash
PUBLIC_URL={PUBLIC_URL}
FEISHU_REDIRECT_URI={PUBLIC_URL}/auth/feishu/callback
```

还请确认：

- 已开通「机器人」能力（阶段通知需要）
- 需要协作或接收通知的同事都在应用「可用范围」内
- 权限中已包含通讯录查询、发送消息等已申请的默认 OpenAPI 范围

发布后，将应用添加到飞书工作台即可打开本招聘台。在飞书客户端内打开时会尝试 JSAPI 免登；也可使用标准 OAuth（`/auth/feishu`）。

## 功能说明

- **登录**：飞书 OAuth（`/auth/feishu`、`/auth/feishu/callback` 与 `/callback`）；飞书客户端内免登；可选本地开发登录。
- **权限**：管理员、招聘负责人、协作面试官、只读。管理员看见全部职位；其他人只看见被分配的职位。负责人/管理员可把同事挂到职位上，身份为负责人、面试官或协作。
- **看板**：待筛选 → 初筛 → 技术面 → 终面 → offer，拖拽或按钮推进，结果会落库。
- **简历存档**：上传 PDF / DOCX，提取文本与简易画像，可关联候选人和职位，并一键写入人才库。
- **匹配**：粘贴 JD，抽取 Must / Nice 关键词，对权限范围内的候选人打分并给出短名单。
- **飞书通知**：阶段变更后，使用 `tenant_access_token` 向该职位负责人和面试官发送文本消息；失败原因会在界面展示，不会中断操作。开发过程默认不向真实同事发测试消息。
- **通讯录**：可用工作邮箱添加同事（`contact/v3/users/batch_get_id`），失败时仍保存邮箱并支持重试。

## 开发备注

不要把 App Secret 写进代码、README、前端或 Git。日志只会说明租户凭证是否获取成功，不会打印密钥或 token。
