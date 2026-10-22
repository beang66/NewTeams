import { useMemo, useState } from "react";
import { api } from "../api";
import { useAuth, useProject } from "../App";
import { STATUS_LABEL, StatusBadge, duration, formatNumber, timeAgo, usePolling } from "../components/ui";
import type { RunStatus } from "../types";
import { PENDING_LABEL } from "./TasksPage";

export default function OpsPage() {
  const { isAdmin } = useAuth();
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const { projectId, project } = useProject();
  const stats = usePolling(() => api.stats(scope, projectId), [scope, projectId], 5000);
  const runs = usePolling(() => api.runs({ scope, project_id: projectId || undefined }), [scope, projectId], 5000);
  const apps = usePolling(() => api.apps(), []);
  const [appFilter, setAppFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");

  const s = stats.data;
  const all = scope === "all" || !!projectId; // 프로젝트 기준이면 멤버 전원을 함께 본다
  const maxDay = Math.max(1, ...(s?.per_day.map((d) => d.count) ?? [1]));
  const tokens = (s?.usage.input_tokens ?? 0) + (s?.usage.output_tokens ?? 0);

  const logs = useMemo(
    () =>
      (runs.data ?? []).filter(
        (r) => (!appFilter || r.app_id === appFilter) && (!statusFilter || r.status === statusFilter) && (!query || r.goal.includes(query)),
      ),
    [runs.data, appFilter, statusFilter, query],
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{project ? `${project.name} 운영` : "운영"}</h1>
          <p className="muted">{all ? "모든 사용자의" : "내"} 최근 7일 실행 현황과 사람의 확인이 필요한 작업, 실행 로그를 한곳에서 봅니다.</p>
        </div>
        {isAdmin && !projectId && (
          <div className="tabs">
            <button className={`tab ${all ? "active" : ""}`} onClick={() => setScope("all")}>
              전체 사용자
            </button>
            <button className={`tab ${!all ? "active" : ""}`} onClick={() => setScope("mine")}>
              내 실행
            </button>
          </div>
        )}
      </header>

      <div className="stat-grid">
        <Stat label="총 실행" value={formatNumber(s?.total)} />
        <Stat label="성공률" value={s?.success_rate == null ? "-" : `${Math.round(s.success_rate * 100)}%`} />
        <Stat label="평균 소요 시간" value={s?.avg_duration == null ? "-" : `${s.avg_duration}초`} />
        <Stat label="토큰 사용량" value={formatNumber(tokens)} sub={`LLM 호출 ${formatNumber(s?.usage.llm_calls)}회`} />
        <Stat label="도구 실행" value={formatNumber(s?.usage.tool_calls)} />
      </div>

      <div className="ops-grid">
        <div className="card">
          <h3>일별 실행</h3>
          <div className="bars">
            {s?.per_day.map((d) => (
              <div key={d.date} className="bar-col" title={`${d.date}: ${d.count}건`}>
                <span className="bar-value">{d.count || ""}</span>
                <div className="bar" style={{ height: `${(d.count / maxDay) * 100}%` }} />
                <span className="bar-label">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>상태별</h3>
          <ul className="kv-list">
            {(Object.keys(STATUS_LABEL) as RunStatus[]).map((k) => (
              <li key={k}>
                <StatusBadge status={k} />
                <b>{s?.by_status[k] ?? 0}</b>
              </li>
            ))}
          </ul>
          {all && (
            <>
              <h3>사용자별</h3>
              <ul className="kv-list">
                {s?.per_user.map((u) => (
                  <li key={u.user}>
                    <span>👤 {u.user}</span>
                    <b>{u.count}</b>
                  </li>
                ))}
                {!s?.per_user.length && <li className="muted small">기록이 없습니다.</li>}
              </ul>
            </>
          )}
        </div>
        <div className="card">
          <h3>✋ 확인이 필요한 작업</h3>
          {s?.waiting.length ? (
            <ul className="link-list">
              {s.waiting.slice(0, 5).map((w) => (
                <li key={w.id}>
                  <a href={`#/runs/${w.id}`}>{w.goal}</a>
                  <span className="muted small">
                    {all && `${w.owner_name} · `}
                    {PENDING_LABEL[w.kind]}
                  </span>
                </li>
              ))}
              {s.waiting.length > 5 && <li className="muted small">외 {s.waiting.length - 5}건 — 아래 로그에서 ‘승인 대기’로 거르세요.</li>}
            </ul>
          ) : (
            <p className="muted small">대기 중인 승인 요청이 없습니다.</p>
          )}
          <h3>⚠️ 최근 실패</h3>
          {s?.recent_failures.length ? (
            <ul className="link-list">
              {s.recent_failures.map((f) => (
                <li key={f.id}>
                  <a href={`#/runs/${f.id}`}>{f.goal}</a>
                  <span className="error-text small">{f.error}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">실패한 작업이 없습니다.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h3>실행 로그</h3>
          <div className="row">
            <input placeholder="목표 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={appFilter} onChange={(e) => setAppFilter(e.target.value)}>
              <option value="">모든 앱</option>
              {apps.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">모든 상태</option>
              {(Object.keys(STATUS_LABEL) as RunStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>목표</th>
              {all && <th>사용자</th>}
              <th>앱</th>
              <th>상태</th>
              <th>반복</th>
              <th>LLM / 토큰</th>
              <th>소요</th>
              <th>시작</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => (window.location.hash = `/runs/${r.id}`)}>
                <td className="clamp-1">{r.goal}</td>
                {all && <td>{r.owner_name}</td>}
                <td>
                  {r.app_icon} {r.app_name}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.iteration + 1}</td>
                <td>
                  {formatNumber(r.usage?.llm_calls)} / {formatNumber((r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0))}
                </td>
                <td>{duration(r.started_at, r.finished_at)}</td>
                <td className="muted small">{timeAgo(r.created_at)}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  로그가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}
