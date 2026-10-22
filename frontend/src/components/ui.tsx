import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RunStatus } from "../types";

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "대기",
  running: "실행 중",
  waiting: "승인 대기",
  paused: "일시정지",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {status === "running" && <span className="pulse" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Markdown({ children }: { children: string }) {
  // react-markdown은 원시 HTML을 렌더링하지 않으므로 모델 출력이 그대로 들어와도 안전하다.
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? "disabled" : ""}`}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
    </label>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function timeAgo(ts?: number): string {
  if (!ts) return "-";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return new Date(ts * 1000).toLocaleDateString("ko-KR");
}

export function duration(start?: number, end?: number): string {
  if (!start) return "-";
  const sec = Math.max(0, (end ?? Date.now() / 1000) - start);
  if (sec < 60) return `${sec.toFixed(1)}초`;
  return `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초`;
}

export function formatNumber(n?: number | null): string {
  return (n ?? 0).toLocaleString("ko-KR");
}

// ---- 알림 토스트 ----
type Toast = { id: number; kind: "info" | "error"; text: string };
const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** 비동기 작업을 실행하고 실패하면 토스트로 알린다. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const out = await fn();
        if (success) toast(success);
        return out;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

/** 주기적으로 다시 불러오는 데이터 훅 */
export function usePolling<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const go = () =>
      load()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    go();
    const timer = intervalMs ? setInterval(go, intervalMs) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}
