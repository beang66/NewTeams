import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import { useAction } from "../components/ui";

export default function AccountPage() {
  const { user, setUser, isAdmin, logout } = useAuth();
  const [name, setName] = useState(user.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, run } = useAction();

  const saveName = async () => {
    const updated = await run(() => api.updateMe({ name }), "이름을 바꿨습니다.");
    if (updated) setUser(updated);
  };

  const changePassword = async () => {
    if (next !== confirm) {
      await run(() => Promise.reject(new Error("새 비밀번호 확인이 일치하지 않습니다.")));
      return;
    }
    const updated = await run(
      () => api.updateMe({ current_password: current, new_password: next }),
      "비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다.",
    );
    if (updated) {
      setUser(updated);
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>내 계정</h1>
          <p className="muted">
            {user.email} · {isAdmin ? "관리자" : "멤버"}
          </p>
        </div>
        <button className="btn" onClick={logout}>
          로그아웃
        </button>
      </header>
      <div className="card stack">
        <h3>프로필</h3>
        <label className="field">
          <span>이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div>
          <button className="btn primary" disabled={busy || !name.trim() || name === user.name} onClick={saveName}>
            저장
          </button>
        </div>
      </div>
      <div className="card stack">
        <h3>비밀번호 변경</h3>
        <label className="field">
          <span>현재 비밀번호</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span>새 비밀번호 (8자 이상)</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>새 비밀번호 확인</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <div>
          <button className="btn primary" disabled={busy || !current || next.length < 8} onClick={changePassword}>
            비밀번호 변경
          </button>
        </div>
      </div>
    </div>
  );
}
