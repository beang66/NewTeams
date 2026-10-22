import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth, useMeta, useProject } from "../App";
import { Empty, StatusBadge, timeAgo, useAction, usePolling } from "../components/ui";
import { navigate } from "../router";
import type { Run, RunStatus, Template } from "../types";

const FILTERS: { key: string; label: string; statuses?: RunStatus[] }[] = [
  { key: "all", label: "전체" },
  { key: "active", label: "진행 중", statuses: ["queued", "running", "paused"] },
  { key: "waiting", label: "승인 대기", statuses: ["waiting"] },
  { key: "completed", label: "완료", statuses: ["completed"] },
  { key: "failed", label: "실패·취소", statuses: ["failed", "cancelled"] },
];

function fill(template: Template, values: Record<string, string>) {
  return template.goal.replace(/\{(\w+)\}/g, (_, key) => values[key]?.trim() || `[${template.fields.find((f) => f.key === key)?.label ?? key}]`);
}

export default function TasksPage({ projectId }: { projectId?: string }) {
  const meta = useMeta();
  const { user, isAdmin } = useAuth();
  const [composerOpen, setComposerOpen] = useState(false);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const { projectId: selectedProjectId, setProjectId: setSelectedProjectId, project: selectedProject, projects } = useProject();
  const allApps = usePolling(() => api.apps(), []);
  // 현재 프로젝트의 팀을 먼저 보여 주고 기본 선택한다
  const apps = {
    ...allApps,
    data: allApps.data && [...allApps.data].sort((a, b) => Number(b.project_id === selectedProjectId && !!selectedProjectId) - Number(a.project_id === selectedProjectId && !!selectedProjectId)),
  };
  const runs = usePolling(() => api.runs({ scope, project_id: selectedProjectId || undefined }), [scope, selectedProjectId], 2500);
  const [goal, setGoal] = useState("");
  const [appId, setAppId] = useState("");
  const [template, setTemplate] = useState<Template | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const { busy, run } = useAction();

  useEffect(() => {
    if (!appId && apps.data?.length) setAppId(apps.data[0].id);
  }, [apps.data, appId]);

  useEffect(() => {
    // #/tasks/<프로젝트> 로 들어오면 그 프로젝트를 현재 프로젝트로 삼는다
    if (projectId) {
      setSelectedProjectId(projectId);
      setComposerOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const team = allApps.data?.find((a) => selectedProjectId && a.project_id === selectedProjectId);
    if (team) setAppId(team.id);
  }, [selectedProjectId, allApps.data]);

  // 입력창을 열고 그 위치로 스크롤한다(배너·템플릿·팀 카드 공통)
  const openComposer = () => {
    setComposerOpen(true);
    requestAnimationFrame(() => {
      goalRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      goalRef.current?.focus({ preventScroll: true });
    });
  };

  const pickTemplate = (t: Template) => {
    if (template?.id === t.id) {
      setTemplate(null);
      return;
    }
    openComposer();
    setTemplate(t);
    setValues({});
    setGoal(fill(t, {}));
    if (t.recommended_app) {
      const recommended = apps.data?.find((app) => app.seed_key === t.recommended_app);
      if (recommended) setAppId(recommended.id);
    }
  };

  const setField = (key: string, value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (template) setGoal(fill(template, next));
  };

  const start = async () => {
    const created = await run(() => api.startRun({
      app_id: appId,
      goal,
      template_id: template?.id ?? null,
      project_id: selectedProjectId || null,
    }));
    if (created) navigate(`/runs/${created.id}`);
  };

  const list = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    return (runs.data ?? []).filter((r) => !f?.statuses || f.statuses.includes(r.status));
  }, [runs.data, filter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of FILTERS) out[f.key] = (runs.data ?? []).filter((r) => !f.statuses || f.statuses.includes(r.status)).length;
    return out;
  }, [runs.data]);

  const selectedApp = apps.data?.find((a) => a.id === appId);

  return (
    <div className="page home">
      <header className="home-head">
        <div>
          <span className="eyebrow">Workspace / {user.name}</span>
          <h1>{new Date().getHours() < 12 ? "좋은 아침이에요" : new Date().getHours() < 18 ? "좋은 오후예요" : "좋은 저녁이에요"}</h1>
        </div>
        <a href="#/account" className="avatar-btn" title="내 계정">
          {user.name.slice(0, 2)}
        </a>
      </header>

      {selectedProject && (
        <div className="project-context">
          <span>
            <b>프로젝트 작업</b> · {selectedProject.name} · 공유 저장소 문서 {selectedProject.kb_documents}개 · 멤버 {selectedProject.member_names.length}명이 결과를 함께 봅니다
          </span>
          <a href={`#/projects/${selectedProject.id}`}>프로젝트 보관소 보기 →</a>
        </div>
      )}

      <section className="hero-banner">
        <div>
          <span className="chip">AI work crew</span>
          <h2>
            오늘 맡길 업무는
            <br />
            <span>무엇인가요?</span>
          </h2>
          <p>
            자연어로 목표를 적으면 에이전트 팀이 계획하고, 실행하고, 검토합니다.
            {counts.waiting > 0 && ` 지금 확인을 기다리는 작업이 ${counts.waiting}건 있어요.`}
          </p>
        </div>
        <button className="hero-cta" onClick={openComposer}>
          <span className="plus" aria-hidden>
            +
          </span>
          <span>
            <strong>새 작업 시작</strong>
            <small>업무를 설명하고 팀을 배정하세요</small>
          </span>
        </button>
      </section>

      {composerOpen && (
        <section className="card composer">
          <div className="panel-head">
            <span>
              <span className="live-dot" />
              New task / 자연어 목표
            </span>
            <span className="flow-strip" aria-label="진행 흐름">
              {["목표", "계획", "실행", "결과"].map((s, i) => (
                <span key={s} className="flow-chip">
                  <b>{String(i + 1).padStart(2, "0")}</b> {s}
                </span>
              ))}
            </span>
            <button className="link" onClick={() => setComposerOpen(false)}>
              닫기
            </button>
          </div>
          <textarea
            ref={goalRef}
            className="goal-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="예: 국내 AI 에이전트 SaaS 경쟁사 5곳의 요금제를 조사해서 비교표로 정리해줘"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && goal.trim() && appId) start();
            }}
          />
          {template && (
            <div className="template-fields">
              <span className="muted small">
                {template.icon} {template.title} 템플릿
              </span>
              {template.fields.map((f) => (
                <label key={f.key} className="field inline">
                  <span>{f.label}</span>
                  <input value={values[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setField(f.key, e.target.value)} />
                </label>
              ))}
            </div>
          )}
          <div className="composer-foot panel-foot">
            <label className="field inline">
              <span>에이전트 앱</span>
              <select value={appId} onChange={(e) => setAppId(e.target.value)}>
                {apps.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name}
                    {a.is_mine ? "" : ` · 공유 (${a.owner_name || "기본"})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>프로젝트 보관소</span>
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                <option value="">연결 안 함</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedApp && (
              <span className="muted small app-summary">
                모델 <code>{selectedApp.model}</code> · 계획 승인 {selectedApp.policy.plan_approval ? "켜짐" : "꺼짐"} · 최대{" "}
                {selectedApp.policy.max_iterations}회 반복
                <a href={`#/studio/${selectedApp.id}`}> 설정 열기 →</a>
              </span>
            )}
            <button className="btn primary lg" disabled={busy || !goal.trim() || !appId} onClick={start}>
              {busy ? "시작 중…" : "실행하기"}
            </button>
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <div>
            <span className="eyebrow">Quick start</span>
            <h2 className="section-h">자주 쓰는 작업</h2>
          </div>
          <button className="link-more" onClick={() => setShowAllTemplates(!showAllTemplates)}>
            {showAllTemplates ? "접기 ←" : `전체 보기 (${meta.templates.length}) →`}
          </button>
        </div>
        <div className="quick-grid">
          {(showAllTemplates ? meta.templates : meta.templates.slice(0, 4)).map((t, i) => (
            <button key={t.id} className={`quick-card ${template?.id === t.id ? "selected" : ""}`} onClick={() => pickTemplate(t)}>
              <span className={`quick-icon tone-${i % 4}`}>{t.icon}</span>
              <strong>{t.title}</strong>
              <span className="muted small">{t.description}</span>
              <span className="quick-foot">
                <span>{t.tools.map((tool) => TOOL_LABEL[tool] ?? tool).join(" · ")}</span>
                <span>{t.recommended_app ? "추천 팀 →" : "→"}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <span className="eyebrow">Specialist crews</span>
            <h2 className="section-h">에이전트 팀</h2>
          </div>
          <a className="link-more" href="#/studio">
            팀 살펴보기 →
          </a>
        </div>
        <div className="crew-grid">
          {apps.data?.slice(0, 3).map((a, i) => (
            <button
              key={a.id}
              className={`crew-card tone-${i}`}
              onClick={() => {
                setAppId(a.id);
                openComposer();
              }}
            >
              <span className="crew-kicker">
                Crew {String(i + 1).padStart(2, "0")} · {a.is_mine ? "My team" : a.shared ? "Shared" : "Private"}
              </span>
              <strong>
                {a.icon} {a.name}
              </strong>
              <p>{a.description || "설명이 없습니다."}</p>
              <span className="crew-foot">{a.model} · 이 팀으로 시작 →</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <span className="eyebrow">My runs</span>
            <h2 className="section-h">{selectedProject ? `${selectedProject.name} 실행 현황` : scope === "all" ? "전체 사용자의 실행" : "내 실행 현황"}</h2>
          </div>
          {isAdmin && !selectedProjectId && (
            <div className="tabs">
              <button className={`tab ${scope === "mine" ? "active" : ""}`} onClick={() => setScope("mine")}>
                내 실행
              </button>
              <button className={`tab ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>
                전체 (관리자)
              </button>
            </div>
          )}
          <div className="tabs">
            {FILTERS.map((f) => (
              <button key={f.key} className={`tab ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label} <span className="count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <Empty icon="🗂️" title="아직 실행한 작업이 없습니다">
            ‘새 작업 시작’을 누르거나 자주 쓰는 작업을 골라 첫 작업을 시작해 보세요.
          </Empty>
        ) : (
          <div className="run-list">
            {list.map((r) => (
              <RunRow key={r.id} run={r} showOwner={scope === "all" || !!selectedProjectId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export const TOOL_LABEL: Record<string, string> = {
  knowledge: "지식 검색",
  web: "웹 읽기",
  browser: "브라우저",
  workspace: "작업 공간",
};

function RunRow({ run, showOwner }: { run: Run; showOwner?: boolean }) {
  const total = run.plan.length;
  const done = run.plan.filter((s) => s.status === "done" || s.status === "skipped" || s.status === "failed").length;
  const current = run.plan.find((s) => s.status === "running");
  const pct = run.status === "completed" ? 100 : total ? Math.round((done / total) * 100) : 0;
  return (
    <a className={`run-row status-${run.status}`} href={`#/runs/${run.id}`}>
      <span className="run-icon">{run.app_icon}</span>
      <span className="run-main">
        <span className="run-goal">{run.goal}</span>
        <span className="muted small">
          {showOwner && `👤 ${run.owner_name || "(알 수 없음)"} · `}
          {run.app_name} · {timeAgo(run.created_at)}
          {run.iteration > 0 && ` · ${run.iteration + 1}번째 반복`}
          {current && ` · 진행: ${current.title}`}
          {run.status === "waiting" && run.pending && ` · ${PENDING_LABEL[run.pending.kind]}`}
          {run.status === "failed" && run.error && ` · ${run.error}`}
        </span>
      </span>
      <span className="run-progress">
        <span className="progress">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="muted small">{total ? `${done}/${total} 단계` : "계획 중"}</span>
      </span>
      <StatusBadge status={run.status} />
    </a>
  );
}

export const PENDING_LABEL: Record<string, string> = {
  plan_review: "계획 확인 필요",
  tool_approval: "도구 실행 승인 필요",
  final_review: "최종 결과 승인 필요",
};
