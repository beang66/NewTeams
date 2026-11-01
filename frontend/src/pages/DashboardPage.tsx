import { useMemo, useState, type ReactNode } from "react";
import {
  approvals,
  brain,
  channels,
  events,
  failures,
  goals,
  outputs,
  routines,
  skills,
  sync,
  todayTasks,
  usage,
  week,
  type BrainCluster,
  type ChannelSummary,
} from "../dashboard/mockData";
import "../dashboard/dashboard.css";

const nf = new Intl.NumberFormat("ko-KR");
const fmt = (n: number | null) => (n === null ? "—" : nf.format(n));

function Panel({ title, meta, href, area, children }: { title: string; meta?: ReactNode; href?: string; area?: string; children: ReactNode }) {
  return (
    <section className={`dash-panel${area ? ` dash-a-${area}` : ""}`}>
      <header className="dash-panel-head">
        <h2>{title}</h2>
        {meta && <span className="dash-meta">{meta}</span>}
        {href && (
          <a className="dash-more" href={href} aria-label={`${title} 자세히`}>
            ›
          </a>
        )}
      </header>
      {children}
    </section>
  );
}

function StateTag({ tone, children }: { tone: "ok" | "warn" | "danger" | "muted"; children: ReactNode }) {
  const icon = { ok: "●", warn: "▲", danger: "✕", muted: "○" }[tone];
  return (
    <span className={`dash-tag dash-tag-${tone}`}>
      <span aria-hidden>{icon}</span> {children}
    </span>
  );
}

/* ---------- 왼쪽 ---------- */

function Goals() {
  return (
    <Panel area="goals" title="목표" meta={`${goals.length}개`}>
      <ul className="dash-list">
        {goals.map((g) => {
          const pct = g.current === null ? null : Math.min(100, Math.round((g.current / g.target) * 100));
          return (
            <li key={g.id} className="dash-goal">
              <div className="dash-row">
                <span>{g.title}</span>
                <span className="dash-num">{pct === null ? "데이터 없음" : `${pct}%`}</span>
              </div>
              <div className="dash-bar" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={g.title}>
                <i style={{ width: `${pct ?? 0}%` }} />
              </div>
              <small>
                {g.metric} {fmt(g.current)} / {nf.format(g.target)}
                {g.unit} · ~{g.due}
              </small>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Today() {
  const [done, setDone] = useState(() => new Set(todayTasks.filter((t) => t.done).map((t) => t.id)));
  return (
    <Panel area="today" title="오늘의 작업" meta={`${done.size}/${todayTasks.length} 완료`} href="#/tasks">
      <ul className="dash-list">
        {todayTasks.map((t) => (
          <li key={t.id}>
            <label className="dash-check">
              <input
                type="checkbox"
                checked={done.has(t.id)}
                onChange={() =>
                  setDone((s) => {
                    const n = new Set(s);
                    n.has(t.id) ? n.delete(t.id) : n.add(t.id);
                    return n;
                  })
                }
              />
              <span className={done.has(t.id) ? "dash-done" : ""}>{t.title}</span>
              <small>
                {t.project} · {t.due}
              </small>
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Week() {
  const maxTokens = Math.max(...week.map((d) => d.tokens), 1);
  const total = week.reduce((a, d) => a + d.tokens, 0);
  return (
    <Panel title="주간 활동" meta={`토큰 ${nf.format(total)}`}>
      <div className="dash-week">
        {week.map((d) => (
          <div key={d.label} className="dash-day" title={`예정 ${d.planned} · 완료 ${d.done} · 실패 ${d.failed} · 토큰 ${nf.format(d.tokens)}`}>
            <div className="dash-day-bar">
              <i style={{ height: `${(d.tokens / maxTokens) * 100}%` }} />
            </div>
            <span>{d.label}</span>
            <small>
              {d.done}/{d.planned}
              {d.failed > 0 && <b className="dash-fail"> ✕{d.failed}</b>}
            </small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function channelTag(c: ChannelSummary) {
  if (c.status === "connected") return <StateTag tone="ok">{c.updatedAt} 갱신</StateTag>;
  if (c.status === "error") return <StateTag tone="danger">연결 오류</StateTag>;
  return <StateTag tone="muted">미연결</StateTag>;
}

function Channels() {
  return (
    <Panel area="channels" title="채널 요약" meta="WordPress · YouTube · Instagram · Threads">
      <div className="dash-channels">
        {channels.map((c) => (
          <div key={c.key} className="dash-channel">
            <span className="dash-channel-name">{c.label}</span>
            <strong className="dash-num">{fmt(c.value)}</strong>
            <small>
              {c.metricLabel}
              {c.delta !== null && <span className="dash-up"> ↑{nf.format(c.delta)}</span>}
            </small>
            {channelTag(c)}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Outputs() {
  return (
    <Panel title="최근 결과물" href="#/history">
      <ul className="dash-list">
        {outputs.map((o) => (
          <li key={o.id} className="dash-row">
            <span>
              {o.title}
              <small>{o.kind}</small>
            </span>
            <span className="dash-meta">{o.at}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------- 중앙: 세컨드 브레인 ---------- */

// 결정적 의사난수: 새로고침해도 같은 배치를 유지한다
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// 가장 큰 분류를 가운데, 나머지를 둘레에 겹치지 않게 배치한다
const CENTERS = [
  [330, 235],
  [140, 125],
  [140, 335],
  [520, 125],
  [520, 335],
  [330, 430],
];

function BrainGraph({ data, selected, onSelect }: { data: BrainCluster[]; selected: string | null; onSelect: (k: string) => void }) {
  const max = Math.max(...data.map((d) => d.count));
  const nodes = useMemo(
    () =>
      data.map((c, i) => {
        const [cx, cy] = CENTERS[i % CENTERS.length];
        const r = 22 + 52 * Math.sqrt(c.count / max);
        const rand = rng(i + 7);
        const dots = Array.from({ length: Math.min(c.count, 160) }, () => {
          const a = rand() * Math.PI * 2;
          const d = Math.sqrt(rand()) * r;
          return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.8 + rand() * 1.6] as const;
        });
        return { ...c, cx, cy, r, dots };
      }),
    [data, max],
  );
  return (
    <svg className="dash-brain-svg" viewBox="0 0 660 510" role="img" aria-label="세컨드 브레인 분류별 노트 분포">
      {nodes.map((n) => (
        <g
          key={n.key}
          className={`dash-cluster ${selected === n.key ? "on" : ""} ${selected && selected !== n.key ? "dim" : ""}`}
          onClick={() => onSelect(n.key)}
          tabIndex={0}
          role="button"
          aria-label={`${n.label} ${n.count}개`}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(n.key)}
        >
          <circle cx={n.cx} cy={n.cy} r={n.r + 6} className="dash-cluster-halo" />
          {n.dots.map(([x, y, s], j) => (
            <circle key={j} cx={x} cy={y} r={s} className="dash-dot" />
          ))}
          <text x={n.cx} y={n.cy + n.r + 18} textAnchor="middle" className="dash-cluster-label">
            {n.label} {n.count}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SecondBrain() {
  const [view, setView] = useState<"graph" | "list">("graph");
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const total = brain.reduce((a, c) => a + c.count, 0);
  const toggle = (k: string) => setSelected((s) => (s === k ? null : k));
  return (
    <section className="dash-panel dash-brain">
      <header className="dash-panel-head">
        <h2>세컨드 브레인</h2>
        <span className="dash-meta">
          Obsidian · 01 Projects/ + wiki/ · 노트 {nf.format(total)} · 동기화 {sync.obsidianLastSync}
        </span>
        <div className="dash-seg" role="tablist" aria-label="보기 방식">
          <button role="tab" aria-selected={view === "graph"} onClick={() => setView("graph")}>
            그래프
          </button>
          <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")}>
            목록
          </button>
        </div>
      </header>
      <div className="dash-brain-body">
        {view === "graph" ? (
          <BrainGraph data={brain} selected={selected} onSelect={toggle} />
        ) : (
          <ul className="dash-list dash-brain-list">
            {brain.map((c) => (
              <li key={c.key}>
                <button className={`dash-row dash-brain-item ${selected === c.key ? "on" : ""}`} onClick={() => toggle(c.key)}>
                  <span>{c.label}</span>
                  <span className="dash-num">{nf.format(c.count)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="dash-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) window.location.hash = `/knowledge`;
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={selected ? `${brain.find((b) => b.key === selected)?.label}에서 검색하거나 질문하기` : "노트를 검색하거나 질문하기"}
          aria-label="세컨드 브레인 검색"
        />
        <button type="submit">검색</button>
      </form>
    </section>
  );
}

/* ---------- 오른쪽 ---------- */

function Approvals() {
  return (
    <Panel area="approvals" title="승인 대기" meta={<b className="dash-count">{approvals.length}</b>} href="#/history">
      <ul className="dash-list">
        {approvals.map((a) => (
          <li key={a.id} className="dash-approval">
            <span>
              {a.title}
              <small>
                {a.channel} · {a.requestedAt} 요청
              </small>
            </span>
            <a className="dash-btn" href="#/history">
              검토
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Failures() {
  if (failures.length === 0) return null;
  return (
    <Panel area="failures" title="실패 · 재연결 요청" meta={<b className="dash-count dash-count-danger">{failures.length}</b>}>
      <ul className="dash-list">
        {failures.map((f) => (
          <li key={f.id} className="dash-approval">
            <span>
              <StateTag tone="danger">{f.title}</StateTag>
              <small>{f.reason}</small>
            </span>
            <button className="dash-btn dash-btn-ghost">{f.action}</button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Routines() {
  return (
    <Panel title="루틴 다음 실행" meta={`${routines.length}개`}>
      <ul className="dash-list">
        {routines.map((r) => (
          <li key={r.id} className="dash-row">
            <span>
              {r.name}
              <small>{r.schedule}</small>
            </span>
            <span className="dash-right">
              <span className="dash-meta">{r.nextRun}</span>
              {r.lastResult === "failed" ? (
                <StateTag tone="danger">최근 실패</StateTag>
              ) : r.lastResult === "ok" ? (
                <StateTag tone="ok">최근 완료</StateTag>
              ) : (
                <StateTag tone="muted">기록 없음</StateTag>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Skills() {
  return (
    <Panel title="활성 스킬" meta={`${skills.length}개`} href="#/studio">
      <div className="dash-skills">
        {skills.map((s) => (
          <a key={s.id} className="dash-skill" href="#/tasks">
            <strong>{s.name}</strong>
            <small>{s.description}</small>
          </a>
        ))}
      </div>
    </Panel>
  );
}

function Events() {
  return (
    <Panel title="최근 이벤트" href="#/ops">
      <ul className="dash-list dash-events">
        {events.map((e) => (
          <li key={e.id} className="dash-row">
            <span>{e.text}</span>
            <span className="dash-meta">{e.at}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function DashboardPage() {
  const costPct = Math.round((usage.monthCostKrw / usage.monthCapKrw) * 100);
  return (
    <div className="dash">
      <div className="dash-top">
        <h1>대시보드</h1>
        <span className="dash-sample" title="2단계(DB·API) 연결 전 예시 값입니다">
          목업 데이터
        </span>
        <span className="dash-top-spacer" />
        <StateTag tone="ok">{sync.saved}</StateTag>
        <span className="dash-meta">
          이번 달 ₩{nf.format(usage.monthCostKrw)} / ₩{nf.format(usage.monthCapKrw)} ({costPct}%)
        </span>
      </div>
      <div className="dash-grid">
        <div className="dash-col dash-col-left">
          <Goals />
          <Today />
          <Week />
          <Channels />
          <Outputs />
        </div>
        <div className="dash-col dash-col-center">
          <SecondBrain />
        </div>
        <div className="dash-col dash-col-right">
          <Approvals />
          <Failures />
          <Routines />
          <Skills />
          <Events />
        </div>
      </div>
    </div>
  );
}
