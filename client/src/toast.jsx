import React, { createContext, useCallback, useContext, useState } from "react";

const ToastCtx = createContext(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, type }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function formatNotify(result = []) {
  if (!result.length) return "未向飞书发送通知（阶段未变化或没有接收人）。";
  const ok = result.filter((r) => r.ok).map((r) => r.name);
  const fail = result.filter((r) => !r.ok);
  const parts = [];
  if (ok.length) parts.push(`已通知：${ok.join("、")}`);
  if (fail.length) {
    parts.push("未能送达： " + fail.map((r) => `${r.name}（${r.error || "失败"}）`).join("；"));
  }
  return parts.join("。");
}
