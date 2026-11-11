import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../toast.jsx";

export default function FeishuPage({ ctx, onStatus }) {
  const { user } = ctx;
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);

  async function load() {
    const data = await api.feishuStatus();
    setStatus(data);
    onStatus?.(Boolean(data.tenantToken));
  }

  useEffect(() => {
    load().catch((err) => toast(err.message, "danger"));
  }, []);

  async function check() {
    setChecking(true);
    try {
      const data = await api.tokenCheck();
      if (data.ok) toast("租户凭证有效，未向任何同事发消息");
      else toast(data.error || "凭证检查失败", "danger");
      await load();
    } catch (err) {
      toast(err.message, "danger");
    } finally {
      setChecking(false);
    }
  }

  if (!status) return <div className="card muted">正在检查飞书接入状态…</div>;

  return (
    <>
      <section className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>连接状态</h3>
          <span className={`tag ${status.tenantToken ? "ok" : "danger"}`}>
            {status.tenantToken ? "租户凭证可用" : "租户凭证未就绪"}
          </span>
          <div className="space" />
          <button className="btn" type="button" onClick={check} disabled={checking}>
            {checking ? "检查中…" : "检查租户凭证"}
          </button>
        </div>
        {status.tenantError ? <div className="alert danger" style={{ marginTop: 12 }}>{status.tenantError}</div> : (
          <p className="muted">只会向飞书换取 tenant_access_token，不会给同事或群发送消息。</p>
        )}
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="label">App ID
            <div>{status.appId || "未配置"}</div>
          </div>
          <div className="label">当前账号绑定
            <div>{user.feishuBound ? "已绑定 open_id，可接收阶段通知" : "尚未绑定飞书身份（本地开发登录不会自动绑定）"}</div>
          </div>
          <div className="label">OAuth 回调
            <div style={{ wordBreak: "break-all" }}>{status.redirectUri}</div>
          </div>
          <div className="label">群通知
            <div>{status.notifyChatConfigured ? "已配置 FEISHU_NOTIFY_CHAT_ID" : "未配置群 chat_id"}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>阶段通知如何工作</h3>
        <p className="muted">
          在看板或人才库里变更候选人阶段后，系统会向该职位的负责人和面试官发送飞书文本消息。
          如果设置了 <code>FEISHU_NOTIFY_CHAT_ID</code>，也会同步发到群。
          若对方不在应用可用范围、未开通机器人，或尚未绑定 open_id，界面会明确展示失败原因，不会中断操作。
        </p>
      </section>

      <section className="card">
        <h3>发布到飞书工作台（你只需两步）</h3>
        <ol className="muted">
          <li>把本服务放到公网 HTTPS 地址，记为 <code>{"{PUBLIC_URL}"}</code>，并设置环境变量 <code>PUBLIC_URL</code> 与 <code>FEISHU_REDIRECT_URI={"{PUBLIC_URL}"}/auth/feishu/callback</code>。</li>
          <li>打开飞书开发者后台的企业自建应用，填写并发布新版本：
            <ul>
              <li>应用功能 · 网页 · 桌面端主页：<code>{"{PUBLIC_URL}"}</code></li>
              <li>应用功能 · 网页 · 移动端主页：<code>{"{PUBLIC_URL}"}</code></li>
              <li>安全设置 · 重定向 URL：<code>{"{PUBLIC_URL}"}/auth/feishu/callback</code> 和 <code>{"{PUBLIC_URL}"}/callback</code>（可保留已有的 <code>http://localhost:3000/callback</code> 供本地调试）</li>
            </ul>
          </li>
        </ol>
        <p className="muted">发布后把该应用加到工作台，并确保需要协作和接收通知的同事都在「可用范围」内。</p>
      </section>
    </>
  );
}
