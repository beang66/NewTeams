import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useMeta, useProject } from "../App";
import { Empty, Toggle, timeAgo, useAction, usePolling } from "../components/ui";
import { navigate } from "../router";
import type { AgentApp, Provider, RoleConfig, RoleKey } from "../types";

export default function StudioPage({ appId }: { appId?: string }) {
  return appId ? <AppEditor appId={appId} key={appId} /> : <AppGallery />;
}

// ------------------------------------------------------------------ 앱 목록

function AppGallery() {
  const { projectId, project } = useProject();
  const allApps = usePolling(() => api.apps(), [projectId]);
  // 현재 프로젝트의 팀을 맨 앞에 보여 준다
  const apps = {
    ...allApps,
    data: allApps.data && [...allApps.data].sort((a, b) => Number(!!projectId && b.project_id === projectId) - Number(!!projectId && a.project_id === projectId)),
  };
  const { busy, run } = useAction();

  const create = async () => {
    // 프로젝트를 고른 상태에서 만든 팀은 그 프로젝트 멤버 모두가 함께 쓰고 고친다
    const app = await run(() => api.createApp({ name: project ? `${project.name} 팀` : "새 에이전트 앱", icon: "🤖", project_id: projectId || null }));
    if (app) navigate(`/studio/${app.id}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>앱 스튜디오</h1>
          <p className="muted">역할별 에이전트, 도구, 사람의 개입 지점을 조합해 업무용 에이전트 팀을 만듭니다.</p>
        </div>
        <button className="btn primary" disabled={busy} onClick={create}>
          + 새 앱 만들기
        </button>
      </header>
      {apps.data?.length === 0 && <Empty icon="🧩" title="아직 앱이 없습니다" />}
      <div className="app-grid">
        {apps.data?.map((a) => (
          <div key={a.id} className="app-card" onClick={() => navigate(`/studio/${a.id}`)}>
            <div className="app-card-head">
              <span className="app-icon">{a.icon}</span>
              <div>
                <strong>{a.name}</strong>
                <span className="muted small">수정 {timeAgo(a.updated_at)}</span>
              </div>
            </div>
            <p className="muted small clamp-2">{a.description || "설명이 없습니다."}</p>
            <div className="tags">
              {a.seed_key && <span className="tag accent">기본 제공 팀</span>}
              {a.project_id ? (
                <span className="tag accent">{a.project_id === projectId ? "현재 프로젝트 팀" : "프로젝트 팀"}</span>
              ) : a.shared ? (
                <span className="tag accent">팀 공유</span>
              ) : (
                <span className="tag">비공개</span>
              )}
              {!a.is_mine && <span className="tag">👤 {a.owner_name || "기본 제공"}</span>}
              <span className="tag">{a.model}</span>
              {a.policy.plan_approval && <span className="tag">계획 승인</span>}
              {a.policy.tool_approval && <span className="tag">도구 승인</span>}
              {a.policy.verify && <span className="tag">자동 검증</span>}
              {a.knowledge_ids.length > 0 && <span className="tag">지식 {a.knowledge_ids.length}</span>}
            </div>
            <div className="app-card-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn small ghost" onClick={() => run(() => api.duplicateApp(a.id), "복제했습니다.").then(() => apps.reload())}>
                복제
              </button>
              {a.can_edit && (
                <button
                  className="btn small danger-ghost"
                  onClick={() => confirm(`'${a.name}' 앱을 삭제할까요?`) && run(() => api.deleteApp(a.id), "삭제했습니다.").then(() => apps.reload())}
                >
                  삭제
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 편집기

type NodeKey =
  | "start"
  | "knowledge"
  | "planner"
  | "plan_gate"
  | "researcher"
  | "browser"
  | "developer"
  | "writer"
  | "verifier"
  | "final_gate"
  | "end";

interface NodeInfo {
  icon: string;
  title: string;
  subtitle: string;
  kind: "io" | "agent" | "human" | "tool";
  enabled: boolean;
  badges: string[];
}

type FlowNodeData = NodeInfo & { selected: boolean } & Record<string, unknown>;

function FlowNode({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div className={`flow-node kind-${data.kind} ${data.enabled ? "" : "off"} ${data.selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flow-node-head">
        <span className="flow-node-icon">{data.icon}</span>
        <div>
          <strong>{data.title}</strong>
          <small>{data.subtitle}</small>
        </div>
      </div>
      {data.badges.length > 0 && (
        <div className="flow-node-badges">
          {data.badges.map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} id="loop" />
      <Handle type="target" position={Position.Right} id="loop-in" />
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

function AppEditor({ appId }: { appId: string }) {
  const meta = useMeta();
  const loaded = usePolling(() => api.app(appId), [appId]);
  const providers = usePolling(() => api.providers(), []);
  const kbs = usePolling(() => api.knowledgeBases(), []);
  const [draft, setDraft] = useState<AgentApp | null>(null);
  const [selected, setSelected] = useState<NodeKey>("start");
  const [testGoal, setTestGoal] = useState("");
  const { busy, run } = useAction();

  useEffect(() => {
    if (loaded.data) setDraft(loaded.data);
  }, [loaded.data]);

  const dirty = useMemo(() => draft && loaded.data && JSON.stringify(draft) !== JSON.stringify(loaded.data), [draft, loaded.data]);

  const role = (key: RoleKey) => meta.roles.find((r) => r.key === key)!;
  const nameOf = (key: RoleKey) => draft?.roles[key]?.name || role(key).name;

  const { nodes, edges } = useMemo(() => {
    if (!draft) return { nodes: [], edges: [] };
    const p = draft.policy;
    const t = draft.tools;
    const roleOn = (k: RoleKey) => draft.roles[k]?.enabled !== false;
    const modelOf = (k: RoleKey) => draft.roles[k]?.model || "앱 기본 모델";
    const kbCount = draft.knowledge_ids.length;
    const spec: { key: NodeKey; x: number; y: number; data: NodeInfo }[] = [
      { key: "start", x: 0, y: 0, data: { icon: "🎯", title: "목표 입력", subtitle: "사용자의 자연어 목표", kind: "io", enabled: true, badges: [] } },
      {
        key: "knowledge", x: 0, y: 120,
        data: { icon: "📚", title: "지식 검색", subtitle: kbCount ? `지식 베이스 ${kbCount}개` : "연결된 지식 없음", kind: "tool", enabled: t.knowledge && kbCount > 0, badges: [] },
      },
      { key: "planner", x: 0, y: 240, data: { icon: role("planner").icon, title: nameOf("planner"), subtitle: modelOf("planner"), kind: "agent", enabled: true, badges: [`최대 ${p.max_steps}단계`] } },
      { key: "plan_gate", x: 0, y: 360, data: { icon: "✋", title: "계획 승인", subtitle: "사람이 계획을 확인·수정", kind: "human", enabled: p.plan_approval, badges: [] } },
      {
        key: "researcher", x: -345, y: 500,
        data: { icon: role("researcher").icon, title: nameOf("researcher"), subtitle: modelOf("researcher"), kind: "agent", enabled: roleOn("researcher"), badges: [t.knowledge ? "지식 검색" : "", t.web ? "웹 읽기" : ""].filter(Boolean) },
      },
      {
        key: "browser", x: -115, y: 500,
        data: { icon: role("browser").icon, title: nameOf("browser"), subtitle: meta.integrations.browser_use ? "browser-use" : "읽기 전용 모드", kind: "agent", enabled: roleOn("browser") && t.browser, badges: p.tool_approval ? ["🔒 실행 전 승인"] : [] },
      },
      {
        key: "developer", x: 115, y: 500,
        data: { icon: role("developer").icon, title: nameOf("developer"), subtitle: t.workspace_engine === "openhands" ? "OpenHands SDK" : `내장 실행기 · ${meta.integrations.sandbox}`, kind: "agent", enabled: roleOn("developer") && t.workspace, badges: p.tool_approval ? ["🔒 실행 전 승인"] : [] },
      },
      { key: "writer", x: 345, y: 500, data: { icon: role("writer").icon, title: nameOf("writer"), subtitle: modelOf("writer"), kind: "agent", enabled: true, badges: ["최종 결과물"] } },
      { key: "verifier", x: 0, y: 650, data: { icon: role("verifier").icon, title: nameOf("verifier"), subtitle: modelOf("verifier"), kind: "agent", enabled: p.verify && roleOn("verifier"), badges: [`최대 ${p.max_iterations}회 반복`] } },
      { key: "final_gate", x: 0, y: 770, data: { icon: "✋", title: "최종 승인", subtitle: "사람이 결과를 확인", kind: "human", enabled: p.final_approval, badges: [] } },
      { key: "end", x: 0, y: 890, data: { icon: "📦", title: "결과", subtitle: "result.md + 작업 공간", kind: "io", enabled: true, badges: [] } },
    ];
    const nodes: Node<FlowNodeData>[] = spec.map((s) => ({
      id: s.key, type: "flow", position: { x: s.x, y: s.y }, data: { ...s.data, selected: selected === s.key }, draggable: false,
    }));
    const on = (k: NodeKey) => spec.find((s) => s.key === k)!.data.enabled;
    const edge = (source: NodeKey, target: NodeKey, extra: Partial<Edge> = {}): Edge => ({
      id: `${source}-${target}${extra.sourceHandle ?? ""}`,
      source, target,
      animated: on(source) && on(target),
      markerEnd: { type: MarkerType.ArrowClosed },
      className: on(source) && on(target) ? "" : "edge-off",
      ...extra,
    });
    const executors: NodeKey[] = ["researcher", "browser", "developer", "writer"];
    const edges: Edge[] = [
      edge("start", "knowledge"),
      edge("knowledge", "planner"),
      edge("planner", "plan_gate"),
      ...executors.map((k) => edge("plan_gate", k)),
      ...executors.map((k) => edge(k, "verifier")),
      edge("verifier", "final_gate"),
      edge("final_gate", "end"),
      edge("verifier", "planner", {
        sourceHandle: "loop", targetHandle: "loop-in", type: "smoothstep", label: "보완 필요 → 재계획",
        style: { strokeDasharray: "6 4" }, animated: false,
      }),
    ];
    return { nodes, edges };
  }, [draft, selected, meta]);

  if (!draft) return <div className="page muted">불러오는 중…</div>;

  const patch = (fn: (a: AgentApp) => AgentApp) => setDraft((d) => (d ? fn(structuredClone(d)) : d));
  const save = async () => {
    const saved = await run(() => api.updateApp(draft.id, draft), "저장했습니다.");
    if (saved) loaded.setData(saved);
  };
  const tryRun = async () => {
    if (dirty) await save();
    const created = await run(() => api.startRun({ app_id: draft.id, goal: testGoal }));
    if (created) navigate(`/runs/${created.id}`);
  };

  const models = (providers.data ?? []).filter((p) => p.configured).flatMap((p) => p.models);
  const readOnly = !draft.can_edit;
  const duplicate = async () => {
    const copy = await run(() => api.duplicateApp(draft.id), "내 앱으로 복제했습니다.");
    if (copy) navigate(`/studio/${copy.id}`);
  };

  return (
    <div className="studio">
      <header className="studio-head">
        <a className="back" href="#/studio">
          ← 앱 목록
        </a>
        <fieldset className="head-fields" disabled={readOnly}>
          <input className="icon-input" value={draft.icon} maxLength={2} onChange={(e) => patch((a) => ({ ...a, icon: e.target.value }))} />
          <input className="title-input" value={draft.name} onChange={(e) => patch((a) => ({ ...a, name: e.target.value }))} />
          <label className="field inline">
            <span>기본 모델</span>
            <ModelSelect value={draft.model} models={models} onChange={(m) => patch((a) => ({ ...a, model: m }))} />
          </label>
        </fieldset>
        <span className="grow" />
        {readOnly ? (
          <>
            <span className="muted small">👤 {draft.owner_name || "기본 제공"}의 공유 앱 · 읽기 전용</span>
            <button className="btn primary" disabled={busy} onClick={duplicate}>
              복제해서 수정
            </button>
          </>
        ) : (
          <>
            {dirty && <span className="muted small">저장하지 않은 변경 사항</span>}
            <button className="btn primary" disabled={busy || !dirty} onClick={save}>
              저장
            </button>
          </>
        )}
      </header>

      <div className="studio-body">
        <div className="canvas">
          <div className="canvas-run">
            <input placeholder="테스트 목표를 입력하고 바로 실행해 보세요" value={testGoal} onChange={(e) => setTestGoal(e.target.value)} />
            <button className="btn primary" disabled={busy || !testGoal.trim()} onClick={tryRun}>
              ▶ 실행해 보기
            </button>
          </div>
          <div className="canvas-flow">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => setSelected(n.id as NodeKey)}
              fitView
              fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              minZoom={0.3}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </div>
        <aside className="inspector">
          <fieldset className="inspector-fields" disabled={readOnly}>
            <NodeInspector nodeKey={selected} app={draft} patch={patch} models={models} kbs={kbs.data ?? []} providers={providers.data ?? []} />
          </fieldset>
        </aside>
      </div>
    </div>
  );
}

function ModelSelect({ value, models, onChange, allowInherit }: { value: string; models: string[]; onChange: (v: string) => void; allowInherit?: boolean }) {
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowInherit && <option value="">앱 기본 모델 사용</option>}
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
          {!models.includes(m) ? " (설정 필요)" : ""}
        </option>
      ))}
    </select>
  );
}

const NODE_HELP: Record<NodeKey, string> = {
  start: "사용자가 자연어로 목표를 입력하는 시작점입니다. 앱 전체에 적용할 공통 지침을 정할 수 있습니다.",
  knowledge: "목표와 관련된 문서를 지식 베이스에서 찾아 계획과 작성에 근거로 제공합니다.",
  planner: "목표를 실행 가능한 단계로 나누고 각 단계를 알맞은 담당에게 위임합니다.",
  plan_gate: "계획이 만들어지면 실행 전에 사람이 확인하고, 단계를 고치거나 다시 계획하게 할 수 있습니다.",
  researcher: "지식 베이스와 웹 페이지에서 근거를 찾아 정리합니다.",
  browser: "API가 없는 웹사이트를 열어 정보를 수집합니다. browser-use가 설치되어 있고 실제 모델을 쓰면 브라우저를 직접 조작합니다.",
  developer: "실행마다 격리된 작업 공간에서 파일을 만들고 명령을 실행해 개발·데이터 처리 작업을 합니다.",
  writer: "앞 단계의 결과를 종합해 최종 결과물을 작성합니다.",
  verifier: "작성자와 독립적으로 결과물을 검토하고, 부족하면 계획 담당에게 보완을 요청합니다.",
  final_gate: "최종 결과를 사람이 승인해야 작업이 완료됩니다. 수정을 요청하면 다시 계획합니다.",
  end: "최종 결과물은 작업 공간의 result.md로 저장되고 실행 화면에서 내려받을 수 있습니다.",
};

function NodeInspector({
  nodeKey,
  app,
  patch,
  models,
  kbs,
  providers,
}: {
  nodeKey: NodeKey;
  app: AgentApp;
  patch: (fn: (a: AgentApp) => AgentApp) => void;
  models: string[];
  kbs: { id: string; name: string; documents: number; shared: boolean }[];
  providers: Provider[];
}) {
  const meta = useMeta();
  const roleKey = (["planner", "researcher", "browser", "developer", "writer", "verifier"] as const).find((k) => k === nodeKey);
  const role = roleKey ? meta.roles.find((r) => r.key === roleKey) : undefined;
  const setPolicy = (k: keyof AgentApp["policy"], v: boolean | number) => patch((a) => ({ ...a, policy: { ...a.policy, [k]: v } }));
  const setTool = (k: keyof AgentApp["tools"], v: boolean | string) => patch((a) => ({ ...a, tools: { ...a.tools, [k]: v } }));
  const setRole = (k: RoleKey, field: keyof RoleConfig, v: boolean | string) =>
    patch((a) => ({ ...a, roles: { ...a.roles, [k]: { ...a.roles[k], [field]: v } } }));
  const anthropic = app.model.startsWith("anthropic:");

  return (
    <div className="inspector-inner">
      <h3>{role ? `${role.icon} ${app.roles[role.key]?.name || role.name}` : TITLES[nodeKey]}</h3>
      <p className="muted small">{NODE_HELP[nodeKey]}</p>

      {nodeKey === "start" && (
        <>
          <Toggle
            label="팀에 공유"
            hint="켜면 다른 사용자도 이 앱을 보고 실행할 수 있습니다. 수정은 나와 관리자만 가능합니다."
            checked={app.shared}
            onChange={(v) => patch((a) => ({ ...a, shared: v }))}
          />
          <label className="field">
            <span>설명</span>
            <input value={app.description} onChange={(e) => patch((a) => ({ ...a, description: e.target.value }))} />
          </label>
          <label className="field">
            <span>공통 지침 (모든 역할에 적용)</span>
            <textarea rows={5} value={app.instructions} placeholder="예: 결과물은 항상 표와 3줄 요약으로 시작하세요." onChange={(e) => patch((a) => ({ ...a, instructions: e.target.value }))} />
          </label>
          <label className="field">
            <span>추론 강도 {anthropic ? "" : "(Anthropic 모델에서만 적용)"}</span>
            <select value={app.effort} disabled={!anthropic} onChange={(e) => patch((a) => ({ ...a, effort: e.target.value as AgentApp["effort"] }))}>
              {["low", "medium", "high", "xhigh", "max"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </>
      )}

      {nodeKey === "knowledge" && (
        <>
          <Toggle label="지식 검색 사용" checked={app.tools.knowledge} onChange={(v) => setTool("knowledge", v)} />
          <div className="field">
            <span>연결할 지식 베이스</span>
            {kbs.length === 0 && (
              <p className="muted small">
                지식 베이스가 없습니다. <a href="#/knowledge">지식 화면</a>에서 먼저 만드세요.
              </p>
            )}
            {kbs.map((kb) => (
              <label key={kb.id} className="check">
                <input
                  type="checkbox"
                  checked={app.knowledge_ids.includes(kb.id)}
                  onChange={(e) =>
                    patch((a) => ({
                      ...a,
                      knowledge_ids: e.target.checked ? [...a.knowledge_ids, kb.id] : a.knowledge_ids.filter((x) => x !== kb.id),
                    }))
                  }
                />
                {kb.name}{" "}
                <span className="muted small">
                  문서 {kb.documents}개{kb.shared ? " · 공유" : " · 비공개"}
                </span>
              </label>
            ))}
            {app.shared && (
              <p className="muted small">
                공유 앱에 비공개 지식 베이스를 연결하면, 다른 사용자가 실행할 때는 그 지식 베이스가 검색에서 빠집니다.
              </p>
            )}
          </div>
          <label className="field">
            <span>검색 결과 개수: {app.retrieval_top_k}</span>
            <input type="range" min={1} max={10} value={app.retrieval_top_k} onChange={(e) => patch((a) => ({ ...a, retrieval_top_k: Number(e.target.value) }))} />
          </label>
        </>
      )}

      {nodeKey === "plan_gate" && (
        <Toggle label="계획 승인 받기" hint="끄면 계획이 만들어지는 즉시 실행합니다." checked={app.policy.plan_approval} onChange={(v) => setPolicy("plan_approval", v)} />
      )}
      {nodeKey === "final_gate" && (
        <Toggle label="최종 결과 승인 받기" hint="켜면 사람이 승인해야 완료됩니다." checked={app.policy.final_approval} onChange={(v) => setPolicy("final_approval", v)} />
      )}

      {nodeKey === "researcher" && (
        <Toggle label="웹 페이지 읽기 허용" hint="목표나 단계에 있는 URL의 본문을 가져옵니다." checked={app.tools.web} onChange={(v) => setTool("web", v)} />
      )}
      {nodeKey === "browser" && (
        <>
          <Toggle label="브라우저 도구 사용" checked={app.tools.browser} onChange={(v) => setTool("browser", v)} />
          <Toggle label="실행 전 사람 승인" hint="개발 담당과 같은 설정을 공유합니다." checked={app.policy.tool_approval} onChange={(v) => setPolicy("tool_approval", v)} />
          <p className={`integration ${meta.integrations.browser_use ? "on" : ""}`}>
            browser-use {meta.integrations.browser_use ? "설치됨" : "미설치 — 읽기 전용(HTTP) 모드로 동작"}
            {!meta.integrations.browser_use && <code>pip install browser-use && playwright install chromium</code>}
          </p>
        </>
      )}
      {nodeKey === "developer" && (
        <>
          <Toggle label="작업 공간 도구 사용" checked={app.tools.workspace} onChange={(v) => setTool("workspace", v)} />
          <Toggle label="명령 실행 전 사람 승인" hint="실행할 파일과 명령을 미리 보여주고 수정할 수 있습니다." checked={app.policy.tool_approval} onChange={(v) => setPolicy("tool_approval", v)} />
          <label className="field">
            <span>실행 엔진</span>
            <select value={app.tools.workspace_engine} onChange={(e) => setTool("workspace_engine", e.target.value)}>
              <option value="builtin">내장 실행기 (모델이 파일·명령을 제안 → 작업 공간에서 실행)</option>
              <option value="openhands">OpenHands SDK (에이전트가 작업 공간에서 직접 개발)</option>
            </select>
          </label>
          <p className={`integration ${meta.integrations.openhands ? "on" : ""}`}>
            OpenHands SDK {meta.integrations.openhands ? "설치됨" : "미설치"} · 샌드박스 모드: <b>{meta.integrations.sandbox}</b>
            {meta.integrations.docker_runtime && ` (${meta.integrations.docker_runtime})`}
            {meta.integrations.sandbox_blocked && <span className="error-text">서버 모드에서 local 샌드박스는 명령 실행이 거부됩니다.</span>}
            {!meta.integrations.openhands && <code>pip install openhands-sdk openhands-tools</code>}
          </p>
        </>
      )}
      {nodeKey === "verifier" && (
        <>
          <Toggle label="자동 검증" checked={app.policy.verify} onChange={(v) => setPolicy("verify", v)} />
          <label className="field">
            <span>최대 반복 횟수: {app.policy.max_iterations}회</span>
            <input type="range" min={1} max={5} value={app.policy.max_iterations} onChange={(e) => setPolicy("max_iterations", Number(e.target.value))} />
          </label>
        </>
      )}
      {nodeKey === "planner" && (
        <label className="field">
          <span>최대 단계 수: {app.policy.max_steps}</span>
          <input type="range" min={2} max={15} value={app.policy.max_steps} onChange={(e) => setPolicy("max_steps", Number(e.target.value))} />
        </label>
      )}

      {role && (
        <div className="role-config">
          <label className="field">
            <span>담당 이름</span>
            <input value={app.roles[role.key]?.name ?? ""} maxLength={30} placeholder={role.name} onChange={(e) => setRole(role.key, "name", e.target.value)} />
          </label>
          <label className="field">
            <span>역할 (이 담당이 맡는 일)</span>
            <textarea rows={3} maxLength={500} value={app.roles[role.key]?.goal ?? ""} placeholder={role.goal} onChange={(e) => setRole(role.key, "goal", e.target.value)} />
          </label>
          <label className="field">
            <span>배경 (일하는 방식·관점)</span>
            <textarea rows={3} maxLength={500} value={app.roles[role.key]?.backstory ?? ""} placeholder={role.backstory} onChange={(e) => setRole(role.key, "backstory", e.target.value)} />
          </label>
          <p className="muted small">비워 두면 흐린 글씨의 기본값을 씁니다. 바꾼 이름과 역할은 계획 담당이 일을 나눌 때와 이 담당의 지시문에 그대로 들어갑니다.</p>
          {!["planner", "writer"].includes(role.key) && (
            <Toggle label="이 역할 사용" checked={app.roles[role.key]?.enabled !== false} onChange={(v) => setRole(role.key, "enabled", v)} />
          )}
          <label className="field">
            <span>이 역할의 모델</span>
            <ModelSelect value={app.roles[role.key]?.model ?? ""} models={models} allowInherit onChange={(v) => setRole(role.key, "model", v)} />
          </label>
          <label className="field">
            <span>추가 지침</span>
            <textarea rows={5} value={app.roles[role.key]?.instructions ?? ""} placeholder="이 역할에만 적용할 지침" onChange={(e) => setRole(role.key, "instructions", e.target.value)} />
          </label>
        </div>
      )}

      {nodeKey === "end" && (
        <p className="small">
          설정된 공급자: {providers.filter((p) => p.configured).map((p) => p.name).join(", ")}. 모델은 <a href="#/models">모델 화면</a>에서 추가할 수 있습니다.
        </p>
      )}
    </div>
  );
}

const TITLES: Record<NodeKey, string> = {
  start: "🎯 목표 입력",
  knowledge: "📚 지식 검색",
  planner: "계획 담당",
  plan_gate: "✋ 계획 승인",
  researcher: "조사 담당",
  browser: "웹 탐색 담당",
  developer: "개발 담당",
  writer: "작성 담당",
  verifier: "검증 담당",
  final_gate: "✋ 최종 승인",
  end: "📦 결과",
};
