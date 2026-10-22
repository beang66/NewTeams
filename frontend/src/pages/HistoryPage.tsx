import { useMemo, useState } from "react";
import { api } from "../api";
import { useAuth, useMeta, useProject } from "../App";
import { Empty, StatusBadge, timeAgo, useAction, usePolling } from "../components/ui";
import type { Run, RunStatus } from "../types";

const STATUS_OPTIONS: { value: "all" | RunStatus; label: string }[] = [
  { value: "all", label: "전체 상태" },
  { value: "completed", label: "완료" },
  { value: "running", label: "실행 중" },
  { value: "waiting", label: "승인 대기" },
  { value: "paused", label: "일시정지" },
  { value: "failed", label: "실패" },
  { value: "cancelled", label: "취소" },
];

export default function HistoryPage() {
  const { isAdmin } = useAuth();
  const meta = useMeta();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState<"all" | RunStatus>("all");
  const [query, setQuery] = useState("");
  const { projectId, project } = useProject();
  const runs = usePolling(() => api.runs({ scope, project_id: projectId || undefined }), [scope, projectId], 3000);

  const templates = useMemo(() => new Map(meta.templates.map((t) => [t.id, t])), [meta.templates]);
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (runs.data ?? []).filter((run) => {
      if (status !== "all" && run.status !== status) return false;
      if (!needle) return true;
      return [run.goal, run.app_name, run.owner_name, run.result_preview]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    });
  }, [query, runs.data, status]);

  const completed = (runs.data ?? []).filter((run) => run.status === "completed").length;
  const waiting = (runs.data ?? []).filter((run) => run.status === "waiting").length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{project ? `${project.name} 실행 기록` : "실행 기록"}</h1>
          <p className="muted">작업 요청과 에이전트 결과가 서버에 보관되며 이 브라우저 화면에서 다시 열어볼 수 있습니다.</p>
        </div>
        {isAdmin && !projectId && (
          <div className="tabs">
            <button className={`tab ${scope === "mine" ? "active" : ""}`} onClick={() => setScope("mine")}>내 기록</button>
            <button className={`tab ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>전체 기록</button>
          </div>
        )}
      </header>

      <div className="history-summary">
        <div className="card history-stat"><span>전체 실행</span><strong>{runs.data?.length ?? 0}</strong></div>
        <div className="card history-stat"><span>완료 결과</span><strong>{completed}</strong></div>
        <div className="card history-stat"><span>승인 대기</span><strong>{waiting}</strong></div>
      </div>

      <section className="card history-toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="목표, 팀, 결과 내용 검색" aria-label="실행 기록 검색" />
        <select value={status} onChange={(e) => setStatus(e.target.value as "all" | RunStatus)} aria-label="상태 필터">
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="muted small">{list.length}건 표시</span>
      </section>

      {list.length === 0 ? (
        <Empty icon="🗂️" title="조건에 맞는 실행 기록이 없습니다">작업 화면에서 템플릿을 선택해 첫 실행을 시작해 보세요.</Empty>
      ) : (
        <div className="history-grid">
          {list.map((run) => <HistoryCard key={run.id} run={run} template={run.template_id ? templates.get(run.template_id) : undefined} showOwner={scope === "all" || !!projectId} onDeleted={runs.reload} />)}
        </div>
      )}
    </div>
  );
}

function HistoryCard({ run, template, showOwner, onDeleted }: { run: Run; template?: { icon: string; title: string }; showOwner: boolean; onDeleted: () => void }) {
  const { busy, run: act } = useAction();
  const remove = async (e: React.MouseEvent) => {
    e.preventDefault(); // 카드 링크로 이동하지 않게 한다
    if (!confirm(`'${run.goal.slice(0, 40)}' 실행 기록과 결과물을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    if (await act(() => api.deleteRun(run.id), "삭제했습니다.")) onDeleted();
  };
  return (
    <a className="card history-card" href={`#/runs/${run.id}`}>
      <div className="history-card-head">
        <span className="history-team-icon">{run.app_icon}</span>
        <div>
          <strong>{run.app_name}</strong>
          <span className="muted small">{timeAgo(run.created_at)}{showOwner && ` · ${run.owner_name || "사용자 미상"}`}</span>
        </div>
        <StatusBadge status={run.status} />
      </div>
      {template && <span className="tag history-template">{template.icon} {template.title}</span>}
      <p className="history-goal">{run.goal}</p>
      <div className="history-result">
        <b>{run.status === "completed" ? "결과 미리보기" : "현재 상태"}</b>
        <p className="muted small">{run.result_preview || run.error || statusMessage(run)}</p>
      </div>
      <span className="history-foot">
        <span className="history-open">상세 기록과 결과 열기 →</span>
        {run.status !== "queued" && run.status !== "running" && (
          <button className="btn small danger-ghost" disabled={busy} onClick={remove}>
            삭제
          </button>
        )}
      </span>
    </a>
  );
}

function statusMessage(run: Run) {
  if (run.status === "waiting") return "사람의 승인 또는 수정 의견을 기다리고 있습니다.";
  if (run.status === "running" || run.status === "queued") return "에이전트 팀이 작업을 진행하고 있습니다.";
  if (run.status === "paused") return "일시정지된 작업입니다. 상세 화면에서 재개할 수 있습니다.";
  if (run.status === "cancelled") return "취소된 작업입니다.";
  return "상세 화면에서 단계별 실행 기록을 확인할 수 있습니다.";
}
