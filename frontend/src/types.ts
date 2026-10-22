export type RunStatus = "queued" | "running" | "waiting" | "paused" | "completed" | "failed" | "cancelled";
export type StepRole = "researcher" | "browser" | "developer" | "writer";
export type RoleKey = "planner" | StepRole | "verifier";

export interface Step {
  id: string;
  title: string;
  role: StepRole;
  tool: "none" | "knowledge_search" | "web_fetch" | "browser" | "workspace";
  input: string;
  instructions: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  output: string;
}

export interface Verdict {
  passed: boolean;
  score: number;
  issues: string[];
  summary: string;
  iteration: number;
}

export interface PendingAction {
  kind: "workspace" | "browser" | "openhands" | string;
  notes?: string;
  files?: { path: string; content: string }[];
  commands?: string[];
  task?: string;
  url?: string | null;
  instruction?: string;
}

export type Pending =
  | { kind: "plan_review"; summary: string; plan: Step[] }
  | { kind: "tool_approval"; step: Step; action: PendingAction }
  | { kind: "final_review"; draft: string; verdict: Verdict | null };

export interface Usage {
  llm_calls?: number;
  tool_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  active: boolean;
  created_at: number;
  last_login_at?: number | null;
  runs?: number;
}

export interface AuthState {
  needs_setup: boolean;
  allow_signup: boolean;
  user: User | null;
}

/** 앱·지식 베이스처럼 소유자와 공유 여부가 있는 항목 */
export interface Owned {
  owner_id: string | null;
  owner_name: string;
  shared: boolean;
  can_edit: boolean;
  is_mine: boolean;
}

export interface Run {
  id: string;
  owner_id: string | null;
  owner_name: string;
  app_id: string;
  app_name: string;
  app_icon: string;
  model: string;
  goal: string;
  template_id: string | null;
  project_id?: string | null;
  project_name?: string;
  status: RunStatus;
  plan: Step[];
  plan_summary: string;
  iteration: number;
  pending: Pending | null;
  verdict: Verdict | null;
  final?: string;
  draft?: string;
  result_preview?: string;
  error: string;
  usage: Usage;
  /** 실행 당시의 담당 이름 */
  role_names?: Record<string, string>;
  created_at: number;
  updated_at: number;
  started_at?: number;
  finished_at?: number;
}

export interface RunEvent {
  id: number;
  run_id: string;
  ts: number;
  type: string;
  data: Record<string, any>;
}

export interface RoleConfig {
  enabled: boolean;
  instructions: string;
  model: string;
  /** 비워 두면 기본 역할 정의(meta.roles)를 쓴다 */
  name: string;
  goal: string;
  backstory: string;
}

export interface AgentApp extends Owned {
  project_id?: string | null;
  id: string;
  name: string;
  icon: string;
  description: string;
  seed_key?: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  instructions: string;
  knowledge_ids: string[];
  retrieval_top_k: number;
  tools: {
    knowledge: boolean;
    web: boolean;
    browser: boolean;
    workspace: boolean;
    workspace_engine: "builtin" | "openhands";
  };
  roles: Record<RoleKey, RoleConfig>;
  policy: {
    plan_approval: boolean;
    tool_approval: boolean;
    final_approval: boolean;
    verify: boolean;
    max_iterations: number;
    max_steps: number;
  };
  created_at: number;
  updated_at: number;
}

export interface RoleInfo {
  key: RoleKey;
  name: string;
  goal: string;
  backstory: string;
  tools: string[];
  icon: string;
}

export interface Template {
  id: string;
  icon: string;
  title: string;
  description: string;
  goal: string;
  fields: { key: string; label: string; placeholder: string }[];
  tools: string[];
  recommended_app?: string;
}

export interface Meta {
  version: string;
  roles: RoleInfo[];
  templates: Template[];
  integrations: {
    browser_use: boolean;
    openhands: boolean;
    sandbox: string;
    docker_runtime: string;
    server_mode: boolean;
    sandbox_blocked: boolean;
  };
}

export interface KnowledgeBase extends Owned {
  project_id?: string | null;
  id: string;
  name: string;
  description: string;
  documents: number;
  chunks: number;
  chars: number;
  created_at: number;
}

export interface KBDocument {
  id: string;
  kb_id: string;
  name: string;
  chars: number;
  chunk_count: number;
  preview: string;
  created_at: number;
}

export interface SearchHit {
  kb_id: string;
  document_id: string;
  document: string;
  chunk: number;
  score: number;
  text: string;
}

export interface Provider {
  id: string;
  name: string;
  description: string;
  fields: string[];
  discover: boolean;
  configured: boolean;
  models: string[];
  config: { base_url: string; models: string; api_key_preview: string; uses_env_key?: boolean };
}

export interface WorkspaceFile {
  path: string;
  size: number;
}

export type ProjectStatus = "planning" | "active" | "review" | "completed" | "paused";

export interface Project {
  id: string;
  name: string;
  client: string;
  description: string;
  status: ProjectStatus;
  start_date: string;
  end_date: string;
  budget: string;
  owner_id: string;
  owner_name: string;
  member_ids: string[];
  member_names: string[];
  asset_count: number;
  run_count: number;
  /** 프로젝트 공유 저장소(지식 베이스) */
  kb_id: string;
  kb_documents: number;
  can_edit: boolean;
  can_contribute: boolean;
  created_at: number;
  updated_at: number;
}

export interface ProjectAsset {
  id: string;
  project_id: string;
  name: string;
  mime_type: string;
  size: number;
  owner_id: string;
  owner_name: string;
  comment_count: number;
  created_at: number;
  updated_at: number;
}

export interface AssetComment {
  id: string;
  project_id: string;
  asset_id: string;
  body: string;
  x: number | null;
  y: number | null;
  author_id: string;
  author_name: string;
  created_at: number;
}

export interface Stats {
  scope: "mine" | "all";
  total: number;
  by_status: Partial<Record<RunStatus, number>>;
  success_rate: number | null;
  avg_duration: number | null;
  usage: Usage;
  per_day: { date: string; count: number }[];
  per_app: { app: string; count: number }[];
  per_user: { user: string; count: number }[];
  waiting: { id: string; goal: string; kind: string; owner_name: string }[];
  recent_failures: { id: string; goal: string; error: string }[];
}
