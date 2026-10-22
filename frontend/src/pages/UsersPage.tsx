import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import { timeAgo, useAction, usePolling } from "../components/ui";
import type { User } from "../types";

export default function UsersPage() {
  const users = usePolling(() => api.users(), []);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" });
  const { busy, run } = useAction();

  const create = async () => {
    const ok = await run(() => api.createUser(form), `${form.name} 계정을 만들었습니다.`);
    if (ok) {
      setForm({ name: "", email: "", password: "", role: "member" });
      users.reload();
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>사용자</h1>
          <p className="muted">팀원 계정을 만들고 권한을 관리합니다. 멤버는 자기 실행 기록만 보고, 관리자는 전체 기록과 모델 키를 관리합니다.</p>
        </div>
      </header>

      <div className="card">
        <h3>새 계정</h3>
        <div className="user-form">
          <input placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="이메일" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input placeholder="임시 비밀번호 (8자 이상)" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="member">멤버</option>
            <option value="admin">관리자</option>
          </select>
          <button className="btn primary" disabled={busy || !form.name || !form.email || form.password.length < 8} onClick={create}>
            계정 만들기
          </button>
        </div>
        <p className="muted small">만든 계정의 이메일과 임시 비밀번호를 팀원에게 전달하세요. 팀원은 ‘내 계정’에서 비밀번호를 바꿀 수 있습니다.</p>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>역할</th>
              <th>상태</th>
              <th>실행</th>
              <th>최근 로그인</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <UserRow key={u.id} user={u} onChanged={users.reload} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({ user, onChanged }: { user: User; onChanged: () => void }) {
  const { user: me } = useAuth();
  const { busy, run } = useAction();
  const update = (body: Parameters<typeof api.updateUser>[1], message: string) =>
    run(() => api.updateUser(user.id, body), message).then((ok) => ok && onChanged());

  const resetPassword = () => {
    const password = prompt(`${user.name}의 새 비밀번호 (8자 이상)`);
    if (password) update({ password }, "비밀번호를 바꿨습니다. 기존 로그인은 모두 끊깁니다.");
  };

  return (
    <tr className={user.active ? "" : "inactive"}>
      <td>
        <strong>{user.name}</strong>
        {user.id === me.id && <span className="tag">나</span>}
      </td>
      <td className="muted">{user.email}</td>
      <td>
        <select value={user.role} disabled={busy} onChange={(e) => update({ role: e.target.value }, "역할을 바꿨습니다.")}>
          <option value="member">멤버</option>
          <option value="admin">관리자</option>
        </select>
      </td>
      <td>{user.active ? <span className="badge badge-completed">활성</span> : <span className="badge">비활성</span>}</td>
      <td>{user.runs ?? 0}</td>
      <td className="muted small">{timeAgo(user.last_login_at ?? undefined)}</td>
      <td className="row">
        <button className="btn small ghost" disabled={busy} onClick={resetPassword}>
          비밀번호 재설정
        </button>
        <button
          className={`btn small ${user.active ? "danger-ghost" : "ghost"}`}
          disabled={busy}
          onClick={() => update({ active: !user.active }, user.active ? "비활성화했습니다." : "다시 활성화했습니다.")}
        >
          {user.active ? "비활성화" : "활성화"}
        </button>
      </td>
    </tr>
  );
}
