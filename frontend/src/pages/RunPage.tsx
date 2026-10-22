import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth, useMeta } from "../App";
import { Empty, Markdown, StatusBadge, duration, formatNumber, useAction, usePolling } from "../components/ui";
import { navigate } from "../router";
import type { Pending, RoleKey, Run, RunEvent, Step, StepRole } from "../types";
import { PENDING_LABEL } from "./TasksPage";

const TABS = [
  { key: "plan", label: "계획" },
  { key: "result", label: "결과" },
  { key: "files", label: "파일" },
  { key: "storage", label: "보관소" },
  { key: "terminal", label: "터미널" },
  { key: "browser", label: "브라우저" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function useRunStream(runId: string, generation: number) {
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const lastId = useRef(0);

  useEffect(() => {
    const source = new EventSource(api.streamUrl(runId, lastId.current));
    source.addEventListener("run", (e) => setRun(JSON.parse((e as MessageEvent).data)));
    source.addEventListener("event", (e) => {
      const ev: RunEvent = JSON.parse((e as MessageEvent).data);
      if (ev.id <= lastId.current) return;
      lastId.current = ev.id;
      setEvents((prev) => [...prev, ev]);
    });
    source.addEventListener("end", () => source.close());
    return () => source.close();
  }, [runId, generation]);

  return { run, events, setRun };
}

export default function RunPage({ runId }: { runId: string }) {
  const [generation, setGeneration] = useState(0);
  const { run, events, setRun } = useRunStream(runId, generation);
  const [tab, setTab] = useState<TabKey>("plan");
  const { busy, run: act } = useAction();
  const { user } = useAuth();

  useEffect(() => {
    if (run?.status === "completed") setTab("result");
  }, [run?.status]);

  if (!run) return <div className="page muted">불러오는 중…</div>;

  const control = async (fn: () => Promise<Run>, message?: string) => {
    const next = await act(fn, message);
    if (next) {
      setRun(next);
      setGeneration((g) => g + 1); // 종료된 스트림을 다시 연결한다
    }
  };

  const rerun = async () => {
    const next = await act(() => api.rerun(run.id), "같은 목표로 새 실행을 시작했습니다.");
    if (next) navigate(`/runs/${next.id}`);
  };

  const remove = async () => {
    if (!confirm("이 실행 기록과 결과물(작업 공간 파일 포함)을 삭제할까요? 되돌릴 수 없습니다.")) return;
    const ok = await act(() => api.deleteRun(run.id));
    if (ok) navigate("/tasks");
  };

  const active = run.status === "running" || run.status === "queued";

  return (
    <RoleNamesContext.Provider value={run.role_names ?? {}}>
    <div className="run-page">
      <header className="run-head">
        <a className="back" href={run.project_id ? `#/projects/${run.project_id}` : "#/tasks"}>
          ← {run.project_id ? "프로젝트" : "작업"}
        </a>
        <div className="run-title">
          <h1 title={run.goal}>{run.goal}</h1>
          <span className="muted small">
            {run.owner_id !== user.id && <span className="tag">👤 {run.owner_name || "다른 사용자"}의 실행</span>} {run.app_icon} {run.app_name} · <code>{run.model}</code> · 소요 {duration(run.started_at, run.finished_at)} · LLM{" "}
            {formatNumber(run.usage?.llm_calls)}회 · 토큰 {formatNumber((run.usage?.input_tokens ?? 0) + (run.usage?.output_tokens ?? 0))} · 도구{" "}
            {formatNumber(run.usage?.tool_calls)}회
            {run.project_id && <a className="tag run-project-link" href={`#/projects/${run.project_id}`}>▣ {run.project_name}</a>}
          </span>
        </div>
        <StatusBadge status={run.status} />
        <div className="actions">
          {active && (
            <button className="btn" disabled={busy} onClick={() => control(() => api.pause(run.id))}>
              ⏸ 일시정지
            </button>
          )}
          {(run.status === "paused" || run.status === "failed") && (
            <button className="btn primary" disabled={busy} onClick={() => control(() => api.resume(run.id), "이어서 실행합니다.")}>
              ▶ {run.status === "failed" ? "실패한 단계부터 다시 시도" : "재개"}
            </button>
          )}
          {!["completed", "cancelled", "failed"].includes(run.status) && (
            <button className="btn danger-ghost" disabled={busy} onClick={() => control(() => api.cancel(run.id))}>
              취소
            </button>
          )}
          {["completed", "cancelled", "failed"].includes(run.status) && (
            <button className="btn" disabled={busy} onClick={rerun}>
              ↻ 다시 실행
            </button>
          )}
          {!active && (
            <button className="btn danger-ghost" disabled={busy} onClick={remove}>
              삭제
            </button>
          )}
        </div>
      </header>

      <div className="run-body">
        <section className="timeline-pane">
          <Timeline events={events} />
          <ControlPanel run={run} busy={busy} onRespond={(body) => control(() => api.respond(run.id, body), "결정을 전달했습니다.")} />
        </section>

        <section className="workspace-pane">
          <div className="tabs underline">
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}
                {t.key === "terminal" && <span className="count">{events.filter((e) => e.type === "command").length}</span>}
                {t.key === "browser" && <span className="count">{events.filter((e) => e.type === "browser").length}</span>}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === "plan" && <PlanView run={run} />}
            {tab === "result" && <ResultView run={run} />}
            {tab === "files" && <FilesView runId={run.id} version={events.filter((e) => e.type === "file_written").length} />}
            {tab === "storage" && <StorageView run={run} version={events.filter((e) => e.type === "file_written").length} />}
            {tab === "terminal" && <TerminalView events={events} />}
            {tab === "browser" && <BrowserView events={events} />}
          </div>
        </section>
      </div>
    </div>
    </RoleNamesContext.Provider>
  );
}

// ------------------------------------------------------------------ 타임라인

function RoleAvatar({ role }: { role: RoleKey | "human" | "system" }) {
  const meta = useMeta();
  const roleName = useRoleName();
  const info = meta.roles.find((r) => r.key === role);
  const icon = role === "human" ? "👤" : role === "system" ? "⚙️" : info?.icon ?? "🤖";
  return (
    <span className={`avatar avatar-${role}`} title={info ? roleName(role) : role === "human" ? "사람" : "시스템"}>
      {icon}
    </span>
  );
}

// 앱 스튜디오에서 바꾼 이름은 실행 당시 값(run.role_names)으로 보여준다.
const RoleNamesContext = createContext<Record<string, string>>({});

function useRoleName() {
  const meta = useMeta();
  const names = useContext(RoleNamesContext);
  return (role: string) => names[role] ?? meta.roles.find((r) => r.key === role)?.name ?? role;
}

const HUMAN_ACTION: Record<string, string> = {
  approve: "승인했습니다",
  revise: "다시 계획을 요청했습니다",
  edit: "내용을 수정해 승인했습니다",
  skip: "이 단계를 건너뛰었습니다",
};

const STATUS_TEXT: Record<string, string> = {
  queued: "작업을 대기열에 넣었습니다.",
  running: "실행을 시작합니다.",
  resumed: "이어서 실행합니다.",
  paused: "일시정지했습니다.",
  pausing: "현재 단계가 끝나면 일시정지합니다.",
  cancelling: "현재 단계가 끝나면 취소합니다.",
  completed: "작업을 완료했습니다.",
  failed: "실행 중 오류가 발생했습니다.",
  cancelled: "작업을 취소했습니다.",
};

function Timeline({ events }: { events: RunEvent[] }) {
  const roleName = useRoleName();
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 최신 브라우저의 scrollIntoView는 Promise를 반환하므로 effect에서 값을 돌려주지 않는다.
    void bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  return (
    <div className="timeline">
      {events.map((ev) => {
        const d = ev.data;
        switch (ev.type) {
          case "user_instruction":
            return (
              <div key={ev.id} className="msg human instruction-message">
                <div className="bubble">
                  <div className="bubble-head"><b>{d.sender || "사용자"}</b><span className="muted">최초 지시</span></div>
                  <p>{d.message}</p>
                  {d.project_name && <span className="tag">▣ {d.project_name}</span>}
                </div>
                <RoleAvatar role="human" />
              </div>
            );
          case "agent_message":
            return <AgentHandoff key={ev.id} data={d} />;
          case "status":
            if (d.status === "running" && events.some((x) => x.id < ev.id && x.type === "status" && x.data.status === "running")) return null;
            return (
              <div key={ev.id} className={`sys-line ${d.status === "failed" ? "error" : ""}`}>
                {STATUS_TEXT[d.status] ?? d.status}
                {d.message && ` ${d.message}`}
                {d.error && <div className="error-text">{d.error}</div>}
              </div>
            );
          case "knowledge":
            return (
              <Msg key={ev.id} role="researcher" title="지식 베이스 검색">
                관련 문서 {d.hits.length}건을 찾았습니다.
                <ul className="hit-list">
                  {d.hits.slice(0, 5).map((h: any, i: number) => (
                    <li key={i}>
                      <b>{h.document}</b> <span className="muted">({h.score})</span> — {h.text}
                    </li>
                  ))}
                </ul>
              </Msg>
            );
          case "plan":
            return (
              <Msg key={ev.id} role="planner" title={d.iteration > 0 ? `계획 수정 (${d.iteration + 1}번째 반복)` : "실행 계획"}>
                <p>{d.summary}</p>
                <ol className="mini-steps">
                  {d.steps.map((s: Step) => (
                    <li key={s.id}>
                      <span className="role-chip">{roleName(s.role)}</span> {s.title}
                    </li>
                  ))}
                </ol>
              </Msg>
            );
          case "human":
            return (
              <div key={ev.id} className="msg human">
                <div className="bubble">
                  {PENDING_LABEL[d.kind] ? `${PENDING_LABEL[d.kind].replace(" 필요", "")}: ` : ""}
                  {HUMAN_ACTION[d.action] ?? d.action}
                  {d.feedback && <div className="quote">“{d.feedback}”</div>}
                  {d.commands && <pre className="code small">{d.commands.join("\n")}</pre>}
                </div>
                <RoleAvatar role="human" />
              </div>
            );
          case "step_started":
            return (
              <div key={ev.id} className="sys-line">
                <RoleAvatar role={d.step.role} /> {roleName(d.step.role)}가 <b>{d.step.title}</b> 단계를 시작합니다 ({d.index + 1}/{d.total})
              </div>
            );
          case "tool":
            return (
              <div key={ev.id} className="tool-line">
                🔎 지식 검색 “{d.query}” → {d.hits.length}건
              </div>
            );
          case "browser":
            return (
              <div key={ev.id} className={`tool-line ${d.error ? "error" : ""}`}>
                🌐 {d.mode === "browser-use" ? "브라우저 조작" : "페이지 읽기"}: {d.url || "(주소 없음)"} {d.error && `— ${d.error}`}
              </div>
            );
          case "file_written":
            return (
              <div key={ev.id} className="tool-line">
                📄 파일 작성 <code>{d.path}</code>
              </div>
            );
          case "artifact_stored":
            return (
              <div key={ev.id} className="storage-event">
                <span>📦</span>
                <div>
                  <b>결과물을 보관했습니다</b>
                  <ul>
                    {(d.destinations ?? []).map((destination: any, index: number) => (
                      <li key={index}><span>{destination.label}</span> <code>{destination.path}</code></li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          case "command":
            return (
              <div key={ev.id} className={`tool-line ${d.exit_code !== 0 ? "error" : ""}`}>
                ⌨️ <code>$ {d.command}</code> → 종료 코드 {d.exit_code} ({d.duration}초)
              </div>
            );
          case "tool_error":
            return (
              <div key={ev.id} className="tool-line error">
                ⚠️ 도구 실행 실패: {d.error}
              </div>
            );
          case "step_completed":
            return (
              <Msg key={ev.id} role={d.role} title={d.title} collapsible={d.role !== "writer"} status={d.status}>
                <Markdown>{d.output}</Markdown>
              </Msg>
            );
          case "verdict":
            return (
              <Msg key={ev.id} role="verifier" title={`검증 ${d.passed ? "통과" : "보완 필요"} · 점수 ${Math.round(d.score * 100)}`}>
                <p>{d.summary}</p>
                {d.issues.length > 0 && (
                  <ul>
                    {d.issues.map((i: string, k: number) => (
                      <li key={k}>{i}</li>
                    ))}
                  </ul>
                )}
              </Msg>
            );
          case "replan":
            return (
              <div key={ev.id} className="sys-line accent">
                🔁 검증 의견을 반영해 {d.iteration + 1}번째 반복을 시작합니다.
              </div>
            );
          case "approval_requested":
            return (
              <div key={ev.id} className="sys-line warn">
                ✋ {PENDING_LABEL[d.kind] ?? "사람의 확인이 필요합니다"}
              </div>
            );
          default:
            return null;
        }
      })}
      <div ref={bottom} />
    </div>
  );
}

function AgentHandoff({ data }: { data: any }) {
  const roleName = useRoleName();
  const sender = data.sender as RoleKey | "human" | "system";
  const recipient = data.recipient as RoleKey | "human" | "system";
  return (
    <div className="agent-handoff">
      <RoleAvatar role={sender} />
      <div className="handoff-body">
        <div className="bubble-head">
          <b>{roleName(data.sender)}</b>
          <span className="handoff-arrow">→</span>
          <b>{data.recipient === "human" ? "사용자" : roleName(data.recipient)}</b>
          <span className="tag">{data.kind === "review" ? "검토" : data.kind === "handoff" ? "인계" : "지시"}</span>
        </div>
        {data.title && <strong className="handoff-title">{data.title}</strong>}
        <p>{data.message}</p>
        {data.artifacts?.length > 0 && (
          <div className="file-chips">
            {data.artifacts.map((path: string) => <span className="chip" key={path}>📄 {path}</span>)}
          </div>
        )}
      </div>
      <RoleAvatar role={recipient} />
    </div>
  );
}

function Msg({
  role,
  title,
  children,
  collapsible,
  status,
}: {
  role: RoleKey;
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  status?: string;
}) {
  const roleName = useRoleName();
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className={`msg agent ${status === "failed" ? "failed" : ""}`}>
      <RoleAvatar role={role} />
      <div className="bubble">
        <div className="bubble-head">
          <b>{roleName(role)}</b>
          <span className="muted">{title}</span>
          {collapsible && (
            <button className="link" onClick={() => setOpen(!open)}>
              {open ? "접기" : "펼치기"}
            </button>
          )}
        </div>
        <div className={open ? "" : "clamp"}>{children}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 사람의 개입

function ControlPanel({ run, busy, onRespond }: { run: Run; busy: boolean; onRespond: (body: Record<string, unknown>) => void }) {
  if (run.status === "waiting" && run.pending) {
    const p = run.pending;
    return (
      <div className="control-panel">
        <div className="control-title">✋ {PENDING_LABEL[p.kind]}</div>
        {p.kind === "plan_review" && <PlanReview pending={p} busy={busy} onRespond={onRespond} />}
        {p.kind === "tool_approval" && <ToolApproval pending={p} busy={busy} onRespond={onRespond} />}
        {p.kind === "final_review" && <FinalReview pending={p} busy={busy} onRespond={onRespond} />}
      </div>
    );
  }
  if (run.status === "paused") {
    return <div className="control-panel quiet">⏸ 일시정지됨 — 상단의 ‘재개’를 누르면 다음 단계부터 이어서 실행합니다.</div>;
  }
  if (run.status === "failed") {
    return (
      <div className="control-panel quiet error">
        ⚠️ {run.error || "오류가 발생했습니다."}
        <br />
        <span className="muted small">상단의 ‘다시 시도’를 누르면 저장된 체크포인트에서 실패한 단계부터 다시 실행합니다.</span>
      </div>
    );
  }
  return null;
}

const ROLE_OPTIONS: StepRole[] = ["researcher", "browser", "developer", "writer"];
const TOOL_FOR_ROLE: Record<StepRole, Step["tool"][]> = {
  researcher: ["none", "knowledge_search", "web_fetch"],
  browser: ["browser"],
  developer: ["workspace"],
  writer: ["none"],
};
const TOOL_NAME: Record<string, string> = {
  none: "도구 없음",
  knowledge_search: "지식 검색",
  web_fetch: "웹 페이지 읽기",
  browser: "브라우저",
  workspace: "작업 공간",
};

function PlanReview({ pending, busy, onRespond }: { pending: Extract<Pending, { kind: "plan_review" }>; busy: boolean; onRespond: (b: Record<string, unknown>) => void }) {
  const roleName = useRoleName();
  const [steps, setSteps] = useState<Step[]>(pending.plan);
  const [feedback, setFeedback] = useState("");
  const edited = JSON.stringify(steps) !== JSON.stringify(pending.plan);

  useEffect(() => {
    setSteps(pending.plan);
  }, [pending.plan]);

  const update = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <>
      <p className="muted small">{pending.summary} 단계를 직접 고치거나, 요청 사항을 적어 다시 계획하게 할 수 있습니다.</p>
      <div className="plan-editor">
        {steps.map((s, i) => (
          <div key={s.id + i} className="plan-edit-row">
            <span className="step-no">{i + 1}</span>
            <div className="plan-edit-fields">
              <input value={s.title} onChange={(e) => update(i, { title: e.target.value })} />
              <div className="row">
                <select value={s.role} onChange={(e) => update(i, { role: e.target.value as StepRole, tool: TOOL_FOR_ROLE[e.target.value as StepRole][0] })}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {roleName(r)}
                    </option>
                  ))}
                </select>
                <select value={s.tool} onChange={(e) => update(i, { tool: e.target.value as Step["tool"] })}>
                  {TOOL_FOR_ROLE[s.role].map((t) => (
                    <option key={t} value={t}>
                      {TOOL_NAME[t]}
                    </option>
                  ))}
                </select>
                <input className="grow" placeholder="입력 (검색어, URL 등)" value={s.input} onChange={(e) => update(i, { input: e.target.value })} />
              </div>
              <textarea rows={2} value={s.instructions} onChange={(e) => update(i, { instructions: e.target.value })} />
            </div>
            <div className="plan-edit-actions">
              <button className="icon-btn" title="위로" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn" title="아래로" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="icon-btn" title="삭제" onClick={() => setSteps((x) => x.filter((_, k) => k !== i))}>
                ✕
              </button>
            </div>
          </div>
        ))}
        <button
          className="btn ghost small"
          onClick={() =>
            setSteps((s) => [
              ...s.slice(0, -1),
              { id: `new${Date.now()}`, title: "새 단계", role: "researcher", tool: "none", input: "", instructions: "", status: "pending", output: "" },
              ...s.slice(-1),
            ])
          }
        >
          + 단계 추가
        </button>
      </div>
      <div className="control-actions">
        <button className="btn primary" disabled={busy} onClick={() => onRespond(edited ? { action: "edit", plan: steps } : { action: "approve" })}>
          {edited ? "수정한 계획으로 실행" : "승인하고 실행"}
        </button>
        <input className="grow" placeholder="다시 계획할 때 반영할 요청 (예: 경쟁사를 3곳으로 줄여줘)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        <button className="btn" disabled={busy || !feedback.trim()} onClick={() => onRespond({ action: "revise", feedback })}>
          다시 계획
        </button>
      </div>
    </>
  );
}

function ToolApproval({ pending, busy, onRespond }: { pending: Extract<Pending, { kind: "tool_approval" }>; busy: boolean; onRespond: (b: Record<string, unknown>) => void }) {
  const a = pending.action;
  const [commands, setCommands] = useState((a.commands ?? []).join("\n"));
  const [openFile, setOpenFile] = useState<string | null>(null);
  const edited = commands !== (a.commands ?? []).join("\n");
  return (
    <>
      <p className="muted small">
        <b>{pending.step.title}</b> 단계에서 다음 작업을 실행하려고 합니다. 확인 후 승인하세요.
      </p>
      {a.kind === "workspace" && (
        <>
          {a.notes && <p>{a.notes}</p>}
          <div className="file-chips">
            {a.files?.map((f) => (
              <button key={f.path} className={`chip ${openFile === f.path ? "active" : ""}`} onClick={() => setOpenFile(openFile === f.path ? null : f.path)}>
                📄 {f.path}
              </button>
            ))}
          </div>
          {openFile && <pre className="code">{a.files?.find((f) => f.path === openFile)?.content}</pre>}
          <label className="field">
            <span>실행할 명령 (한 줄에 하나, 작업 공간 폴더에서 실행)</span>
            <textarea className="mono" rows={Math.max(2, (a.commands?.length ?? 0) + 1)} value={commands} onChange={(e) => setCommands(e.target.value)} />
          </label>
        </>
      )}
      {a.kind === "browser" && (
        <div className="kv">
          <span>시작 주소</span>
          <code>{a.url ?? "(지정 안 됨)"}</code>
          <span>할 일</span>
          <span>{a.task}</span>
        </div>
      )}
      {a.kind === "openhands" && <pre className="code">{a.instruction}</pre>}
      <div className="control-actions">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => onRespond(edited ? { action: "edit", commands: commands.split("\n").filter((c) => c.trim()) } : { action: "approve" })}
        >
          {edited ? "수정한 명령으로 실행" : "실행 승인"}
        </button>
        <button className="btn" disabled={busy} onClick={() => onRespond({ action: "skip" })}>
          이 단계 건너뛰기
        </button>
      </div>
    </>
  );
}

function FinalReview({ pending, busy, onRespond }: { pending: Extract<Pending, { kind: "final_review" }>; busy: boolean; onRespond: (b: Record<string, unknown>) => void }) {
  const [feedback, setFeedback] = useState("");
  return (
    <>
      {pending.verdict && (
        <p className="muted small">
          검증 결과: {pending.verdict.passed ? "통과" : "보완 필요"} (점수 {Math.round(pending.verdict.score * 100)}) — {pending.verdict.summary}
        </p>
      )}
      <p className="muted small">오른쪽 ‘결과’ 탭에서 초안을 확인하세요.</p>
      <div className="control-actions">
        <button className="btn primary" disabled={busy} onClick={() => onRespond({ action: "approve" })}>
          승인하고 완료
        </button>
        <input className="grow" placeholder="수정 요청 사항" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        <button className="btn" disabled={busy || !feedback.trim()} onClick={() => onRespond({ action: "revise", feedback })}>
          수정 요청
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 작업 공간 탭

function PlanView({ run }: { run: Run }) {
  const meta = useMeta();
  const roleName = useRoleName();
  if (!run.plan.length) return <Empty icon="🧭" title="계획을 세우는 중입니다" />;
  return (
    <div className="plan-view">
      <div className="plan-summary">
        <span className="muted small">{run.iteration + 1}번째 반복</span>
        <p>{run.plan_summary}</p>
      </div>
      <ol className="step-list">
        {run.plan.map((s) => {
          const role = meta.roles.find((r) => r.key === s.role);
          return (
            <li key={s.id} className={`step step-${s.status}`}>
              <span className="step-dot" />
              <div>
                <div className="step-head">
                  <span className="role-chip">
                    {role?.icon} {roleName(s.role)}
                  </span>
                  <b>{s.title}</b>
                  <span className="muted small">{TOOL_NAME[s.tool]}</span>
                </div>
                {s.instructions && <p className="muted small">{s.instructions}</p>}
                {s.input && s.tool !== "none" && (
                  <p className="small">
                    입력: <code>{s.input}</code>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {run.verdict && (
        <div className={`verdict ${run.verdict.passed ? "pass" : "fail"}`}>
          <b>
            {run.verdict.passed ? "✅ 검증 통과" : "⚠️ 보완 필요"} · 점수 {Math.round(run.verdict.score * 100)}
          </b>
          <p>{run.verdict.summary}</p>
          {run.verdict.issues.length > 0 && (
            <ul>
              {run.verdict.issues.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ResultView({ run }: { run: Run }) {
  const text = run.final || run.draft;
  if (!text) return <Empty icon="📝" title="아직 결과물이 없습니다">작성 담당이 결과물을 만들면 여기에 표시됩니다.</Empty>;
  return (
    <div className="result-view">
      <div className="result-bar">
        <span className="muted small">{run.final ? "최종 결과" : "초안 (검토 전)"}</span>
        <button className="btn small" onClick={() => navigator.clipboard.writeText(text)}>
          복사
        </button>
        {run.final && (
          <a className="btn small" href={api.fileUrl(run.id, "result.md")}>
            result.md 내려받기
          </a>
        )}
      </div>
      <Markdown>{text}</Markdown>
    </div>
  );
}

function FilesView({ runId, version }: { runId: string; version: number }) {
  const files = usePolling(() => api.files(runId), [runId, version]);
  const [selected, setSelected] = useState<string | null>(null);
  const content = usePolling(() => (selected ? api.file(runId, selected) : Promise.resolve(null)), [runId, selected, version]);
  if (!files.data?.length) return <Empty icon="📁" title="작업 공간이 비어 있습니다">개발 담당이 만든 파일과 결과물이 여기에 저장됩니다.</Empty>;
  return (
    <div className="files-view">
      <ul className="file-tree">
        {files.data.map((f) => (
          <li key={f.path}>
            <button className={selected === f.path ? "active" : ""} onClick={() => setSelected(f.path)}>
              📄 {f.path}
              <span className="muted small">{f.size.toLocaleString()} B</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="file-viewer">
        {selected && content.data ? (
          <>
            <div className="result-bar">
              <code>{selected}</code>
              <a className="btn small" href={api.fileUrl(runId, selected)}>
                내려받기
              </a>
            </div>
            {content.data.binary ? <p className="muted">바이너리 파일은 미리 볼 수 없습니다.</p> : selected.endsWith(".md") ? <Markdown>{content.data.content}</Markdown> : <pre className="code">{content.data.content}</pre>}
          </>
        ) : (
          <p className="muted">왼쪽에서 파일을 고르세요.</p>
        )}
      </div>
    </div>
  );
}

function StorageView({ run, version }: { run: Run; version: number }) {
  const files = usePolling(() => api.files(run.id), [run.id, version]);
  return (
    <div className="storage-view">
      <div className="storage-destinations">
        {run.project_id && (
          <a className="storage-card primary" href={`#/projects/${run.project_id}`}>
            <span className="storage-icon">▣</span>
            <div><b>프로젝트 보관소</b><strong>{run.project_name}</strong><small>캠페인 정보, 시안, 댓글과 함께 관리</small></div>
            <span>→</span>
          </a>
        )}
        <a className="storage-card" href="#/history">
          <span className="storage-icon">↗</span>
          <div><b>실행 기록</b><strong>실행 #{run.id.slice(-8)}</strong><small>지시, 에이전트 대화, 승인 이력 보관</small></div>
          <span>→</span>
        </a>
        <div className="storage-card">
          <span className="storage-icon">📁</span>
          <div><b>작업 공간</b><strong>{files.data?.length ?? 0}개 파일</strong><small>에이전트가 만든 디자인, 프로그램, 보고서 파일</small></div>
        </div>
      </div>
      <div className="stored-files">
        <div className="panel-head"><b>저장된 결과물</b><span className="muted small">실행별 격리 작업 공간</span></div>
        {!files.data?.length ? <Empty icon="📦" title="아직 저장된 파일이 없습니다" /> : (
          <ul>
            {files.data.map((file) => (
              <li key={file.path}>
                <span>📄 <code>{file.path}</code></span>
                <span className="muted small">{file.size.toLocaleString()} B</span>
                <a className="btn small" href={api.fileUrl(run.id, file.path)}>내려받기</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TerminalView({ events }: { events: RunEvent[] }) {
  const commands = events.filter((e) => e.type === "command");
  if (!commands.length) return <Empty icon="⌨️" title="실행한 명령이 없습니다">개발 담당이 작업 공간에서 실행한 명령과 출력이 표시됩니다.</Empty>;
  return (
    <div className="terminal">
      {commands.map((e) => (
        <div key={e.id}>
          <div className="term-cmd">
            <span className="prompt">workspace $</span> {e.data.command}
          </div>
          {e.data.stdout && <pre>{e.data.stdout}</pre>}
          {e.data.stderr && <pre className="stderr">{e.data.stderr}</pre>}
          <div className={`term-exit ${e.data.exit_code === 0 ? "ok" : "bad"}`}>
            exit {e.data.exit_code} · {e.data.duration}s
          </div>
        </div>
      ))}
    </div>
  );
}

function BrowserView({ events }: { events: RunEvent[] }) {
  const visits = events.filter((e) => e.type === "browser");
  const [index, setIndex] = useState(visits.length - 1);
  const current = visits[Math.min(Math.max(index, 0), visits.length - 1)];
  const ordered = useMemo(() => visits.map((v, i) => ({ v, i })), [visits]);
  if (!current) return <Empty icon="🌐" title="방문한 페이지가 없습니다">웹 탐색 담당이 연 페이지가 여기에 표시됩니다.</Empty>;
  const d = current.data;
  return (
    <div className="browser-view">
      <div className="browser-chrome">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <div className="url-bar">{d.url || "(주소 없음)"}</div>
        <span className="tag">{d.mode === "browser-use" ? "browser-use" : "읽기 전용"}</span>
      </div>
      {d.note && <p className="muted small">{d.note}</p>}
      {d.error ? <p className="error-text">{d.error}</p> : (
        <div className="page-preview">
          <h3>{d.title || "(제목 없음)"}</h3>
          <p>{d.preview}</p>
        </div>
      )}
      {d.actions?.length > 0 && (
        <details>
          <summary>수행한 동작 {d.actions.length}개</summary>
          <ul>
            {d.actions.map((a: string, i: number) => (
              <li key={i}>
                <code>{a}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {visits.length > 1 && (
        <div className="history">
          {ordered.map(({ v, i }) => (
            <button key={v.id} className={`chip ${v === current ? "active" : ""}`} onClick={() => setIndex(i)}>
              {i + 1}. {v.data.title || v.data.url}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
