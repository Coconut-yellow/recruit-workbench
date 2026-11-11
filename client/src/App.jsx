import React, { useEffect, useMemo, useState } from "react";
import { api, isInFeishu, requestFeishuJsapiCode } from "./api.js";
import Board from "./pages/Board.jsx";
import Jobs from "./pages/Jobs.jsx";
import Talent from "./pages/Talent.jsx";
import Archive from "./pages/Archive.jsx";
import Match from "./pages/Match.jsx";
import Collab from "./pages/Collab.jsx";
import FeishuPage from "./pages/FeishuPage.jsx";
import { ROLE_LABELS } from "./constants.js";
import { ToastProvider, useToast } from "./toast.jsx";

const NAV = [
  { id: "board", label: "看板" },
  { id: "jobs", label: "职位" },
  { id: "talent", label: "人才库" },
  { id: "archive", label: "存档" },
  { id: "match", label: "匹配" },
  { id: "collab", label: "协作" },
  { id: "feishu", label: "飞书" },
];

const TITLES = {
  board: "招聘看板",
  jobs: "职位管理",
  talent: "人才库",
  archive: "简历存档",
  match: "Agent 匹配",
  collab: "协作权限",
  feishu: "飞书接入",
};

function useHash() {
  const read = () => {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const id = raw.split("?")[0] || "board";
    return NAV.some((n) => n.id === id) ? id : "board";
  };
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener("hashchange", on);
    if (!location.hash) location.hash = "#/board";
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (id) => {
    location.hash = `#/${id}`;
  };
  return [page, go];
}

function loginErrorFromUrl() {
  const q = new URLSearchParams(location.search);
  return q.get("login_error") || "";
}

function Login({ config, onLoggedIn }) {
  const toast = useToast();
  const [devUsers, setDevUsers] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(loginErrorFromUrl());

  useEffect(() => {
    if (!config?.devLogin) return;
    api.devUsers().then((d) => setDevUsers(d.users || [])).catch(() => {});
  }, [config]);

  useEffect(() => {
    if (!isInFeishu() || !config?.appId) return;
    let cancelled = false;
    (async () => {
      try {
        setBusy("jsapi");
        const code = await requestFeishuJsapiCode(config.appId);
        if (cancelled) return;
        const data = await api.jsapiLogin(code);
        onLoggedIn(data.user);
      } catch (err) {
        if (!cancelled) setError(err.message || "飞书免登失败，请改用授权登录");
      } finally {
        if (!cancelled) setBusy("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, onLoggedIn]);

  async function devLogin(userId) {
    try {
      setBusy(userId);
      const data = await api.devLogin(userId);
      onLoggedIn(data.user);
    } catch (err) {
      toast(err.message, "danger");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mark">
          <span className="logo">招</span>
          轻量招聘台
        </div>
        <h1>用协作把招聘跑起来</h1>
        <p className="lead">
          看板、简历存档、规则匹配，以及飞书通讯录与阶段通知。可在浏览器使用，后续放入飞书工作台。
        </p>
        {error ? <div className="alert danger">{error}</div> : null}
        <a className="btn btn-primary btn-block" href="/auth/feishu">
          使用飞书登录
        </a>
        {isInFeishu() ? (
          <p className="muted" style={{ marginTop: 10 }}>
            已检测到飞书客户端，正在尝试免登{busy === "jsapi" ? "…" : ""}。
          </p>
        ) : null}
        {config?.devLogin ? (
          <div className="dev-box">
            <h3>本地开发登录</h3>
            <p>尚未绑定工作台时，可用种子账号切换角色体验权限。生产环境默认不会出现此入口。</p>
            <div className="dev-list">
              {devUsers.map((u) => (
                <button key={u.id} className="dev-item" type="button" onClick={() => devLogin(u.id)} disabled={!!busy}>
                  <div>
                    <b>{u.name}</b>
                    <div className="meta">
                      {ROLE_LABELS[u.role] || u.role} · {u.title || "—"}
                    </div>
                  </div>
                  <span className="faint">{busy === u.id ? "进入中…" : "进入"}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Shell({ user, onLogout, children, page, go, feishuOk }) {
  return (
    <div className="app-shell">
      <aside className="side">
        <div className="brand">
          <span className="logo">招</span>
          轻量招聘台
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-btn ${page === n.id ? "active" : ""}`}
            type="button"
            onClick={() => go(n.id)}
          >
            {n.label}
          </button>
        ))}
        <div className="side-foot">越疆招聘协作 · 桌面优先</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h2>{TITLES[page] || "轻量招聘台"}</h2>
          <div className="userchip">
            <span className={`dot ${feishuOk ? "ok" : "bad"}`} title={feishuOk ? "飞书租户凭证可用" : "飞书凭证未就绪"} />
            <div className="who">
              <b>{user.name}</b>
              <span>{ROLE_LABELS[user.role] || user.role}</span>
            </div>
            <button className="btn btn-sm btn-ghost" type="button" onClick={onLogout}>
              退出
            </button>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
      <nav className="bottom-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "active" : ""}
            type="button"
            onClick={() => go(n.id)}
          >
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const toast = useToast();
  const [page, go] = useHash();
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [feishuOk, setFeishuOk] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const [j, c] = await Promise.all([api.jobs(), api.candidates()]);
    setJobs(j.jobs || []);
    setCandidates(c.candidates || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.config();
        setConfig(cfg);
      } catch {
        setConfig({ devLogin: false });
      }
      await loadMe();
      setReady(true);
    })();
  }, [loadMe]);

  useEffect(() => {
    if (!user) return;
    refresh().catch((err) => toast(err.message, "danger"));
    api
      .feishuStatus()
      .then((s) => setFeishuOk(Boolean(s.tenantToken)))
      .catch(() => setFeishuOk(false));
  }, [user, refresh, toast]);

  const onLogout = async () => {
    await api.logout();
    setUser(null);
  };

  const ctx = useMemo(
    () => ({ user, jobs, candidates, refresh, setCandidates }),
    [user, jobs, candidates, refresh]
  );

  if (!ready) {
    return (
      <div className="login-page">
        <p className="muted">正在加载轻量招聘台…</p>
      </div>
    );
  }

  if (!user) {
    return <Login config={config} onLoggedIn={setUser} />;
  }

  const pages = {
    board: <Board ctx={ctx} />,
    jobs: <Jobs ctx={ctx} />,
    talent: <Talent ctx={ctx} />,
    archive: <Archive ctx={ctx} />,
    match: <Match ctx={ctx} />,
    collab: <Collab ctx={ctx} />,
    feishu: <FeishuPage ctx={ctx} onStatus={(ok) => setFeishuOk(ok)} />,
  };

  return (
    <Shell user={user} onLogout={onLogout} page={page} go={go} feishuOk={feishuOk}>
      {pages[page] || pages.board}
    </Shell>
  );
}
