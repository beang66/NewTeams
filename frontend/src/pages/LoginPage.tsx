import { useState, type FormEvent } from "react";
import { api } from "../api";
import { BrandMark } from "../components/ui";
import type { AuthState, User } from "../types";

type Mode = "login" | "signup" | "setup";

export default function LoginPage({ state, onLoggedIn }: { state: AuthState; onLoggedIn: (u: User) => void }) {
  const [mode, setMode] = useState<Mode>(state.needs_setup ? "setup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode !== "login" && password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      const user =
        mode === "login"
          ? await api.login({ email, password })
          : mode === "setup"
            ? await api.setup({ name, email, password })
            : await api.signup({ name, email, password });
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const title = { login: "로그인", signup: "회원가입", setup: "관리자 계정 만들기" }[mode];

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand">
          <BrandMark />
          <span>
            NEWTEAM
            <em>AGENT STUDIO</em>
          </span>
        </div>
        <h1>{title}</h1>
        {mode === "setup" && (
          <p className="muted small">
            처음 사용하는 서버입니다. 이 계정이 관리자가 되며, 이후 다른 사용자의 계정을 만들고 모델 키를 관리합니다. 기존 실행 기록과 앱은 이 계정으로 넘어갑니다.
          </p>
        )}
        {mode !== "login" && (
          <label className="field">
            <span>이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </label>
        )}
        <label className="field">
          <span>이메일</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>비밀번호{mode !== "login" && " (8자 이상)"}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "login" ? undefined : 8}
            required
          />
        </label>
        {mode !== "login" && (
          <label className="field">
            <span>비밀번호 확인</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {error && <p className="error-text small">{error}</p>}
        <button className="btn primary lg" type="submit" disabled={busy}>
          {title}
        </button>
        {!state.needs_setup && (
          <p className="muted small center">
            {mode === "login" ? (
              state.allow_signup ? (
                <>
                  계정이 없나요?{" "}
                  <button type="button" className="link" onClick={() => setMode("signup")}>
                    회원가입
                  </button>
                </>
              ) : (
                "계정이 없으면 관리자에게 요청하세요."
              )
            ) : (
              <>
                이미 계정이 있나요?{" "}
                <button type="button" className="link" onClick={() => setMode("login")}>
                  로그인
                </button>
              </>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
