import type {
  AgentApp,
  AuthState,
  KBDocument,
  KnowledgeBase,
  Meta,
  Provider,
  Project,
  ProjectAsset,
  AssetComment,
  Run,
  RunEvent,
  SearchHit,
  Stats,
  User,
  WorkspaceFile,
} from "./types";

/** 세션이 만료되면 앱 전체가 로그인 화면으로 돌아가도록 알린다. */
export const UNAUTHORIZED_EVENT = "newteam:unauthorized";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: any) => d.msg).join(", ");
    } catch {
      /* 본문이 JSON이 아닐 수 있다 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  authState: () => request<AuthState>("/auth/state"),
  setup: (body: { name: string; email: string; password: string }) => request<User>("/auth/setup", json(body)),
  signup: (body: { name: string; email: string; password: string }) => request<User>("/auth/signup", json(body)),
  login: (body: { email: string; password: string }) => request<User>("/auth/login", json(body)),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  updateMe: (body: { name?: string; current_password?: string; new_password?: string }) =>
    request<User>("/auth/me", { method: "PUT", body: JSON.stringify(body) }),

  users: () => request<User[]>("/users"),
  createUser: (body: { name: string; email: string; password: string; role: string }) => request<User>("/users", json(body)),
  updateUser: (id: string, body: { name?: string; role?: string; active?: boolean; password?: string }) =>
    request<User>(`/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  meta: () => request<Meta>("/meta"),

  projects: () => request<Project[]>("/projects"),
  project: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (body: Partial<Project>) => request<Project>("/projects", json(body)),
  updateProject: (id: string, body: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  projectRuns: (id: string) => request<Run[]>(`/projects/${id}/runs`),
  projectAssets: (id: string) => request<ProjectAsset[]>(`/projects/${id}/assets`),
  uploadProjectAsset: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ProjectAsset>(`/projects/${id}/assets`, { method: "POST", body: form });
  },
  projectAssetUrl: (projectId: string, assetId: string) => `/api/projects/${projectId}/assets/${assetId}/content`,
  deleteProjectAsset: (projectId: string, assetId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/assets/${assetId}`, { method: "DELETE" }),
  assetComments: (projectId: string, assetId: string) =>
    request<AssetComment[]>(`/projects/${projectId}/assets/${assetId}/comments`),
  createAssetComment: (projectId: string, assetId: string, body: { body: string; x?: number | null; y?: number | null }) =>
    request<AssetComment>(`/projects/${projectId}/assets/${assetId}/comments`, json(body)),
  deleteAssetComment: (projectId: string, assetId: string, commentId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/assets/${assetId}/comments/${commentId}`, { method: "DELETE" }),

  apps: () => request<AgentApp[]>("/apps"),
  app: (id: string) => request<AgentApp>(`/apps/${id}`),
  createApp: (body: Partial<AgentApp>) => request<AgentApp>("/apps", json(body)),
  updateApp: (id: string, body: Partial<AgentApp>) =>
    request<AgentApp>(`/apps/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  duplicateApp: (id: string) => request<AgentApp>(`/apps/${id}/duplicate`, { method: "POST" }),
  deleteApp: (id: string) => request<{ ok: boolean }>(`/apps/${id}`, { method: "DELETE" }),

  runs: (params: { app_id?: string; status?: string; scope?: "mine" | "all"; project_id?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<Run[]>(`/runs?${q}`);
  },
  run: (id: string) => request<Run>(`/runs/${id}`),
  startRun: (body: { app_id: string; goal: string; template_id?: string | null; project_id?: string | null }) => request<Run>("/runs", json(body)),
  respond: (id: string, body: Record<string, unknown>) => request<Run>(`/runs/${id}/respond`, json(body)),
  pause: (id: string) => request<Run>(`/runs/${id}/pause`, { method: "POST" }),
  resume: (id: string) => request<Run>(`/runs/${id}/resume`, { method: "POST" }),
  cancel: (id: string) => request<Run>(`/runs/${id}/cancel`, { method: "POST" }),
  rerun: (id: string) => request<Run>(`/runs/${id}/rerun`, { method: "POST" }),
  deleteRun: (id: string) => request<{ ok: boolean }>(`/runs/${id}`, { method: "DELETE" }),
  events: (id: string, after = 0) => request<RunEvent[]>(`/runs/${id}/events?after=${after}`),
  files: (id: string) => request<WorkspaceFile[]>(`/runs/${id}/files`),
  file: (id: string, path: string) =>
    request<{ path: string; content: string; binary: boolean }>(
      `/runs/${id}/files/content?path=${encodeURIComponent(path)}`,
    ),
  fileUrl: (id: string, path: string) => `/api/runs/${id}/files/download?path=${encodeURIComponent(path)}`,
  streamUrl: (id: string, after = 0) => `/api/runs/${id}/stream?after=${after}`,

  knowledgeBases: () => request<KnowledgeBase[]>("/knowledge"),
  createKnowledgeBase: (body: { name: string; description: string }) => request<KnowledgeBase>("/knowledge", json(body)),
  updateKnowledgeBase: (id: string, body: { name?: string; description?: string; shared?: boolean }) =>
    request<KnowledgeBase>(`/knowledge/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteKnowledgeBase: (id: string) => request<{ ok: boolean }>(`/knowledge/${id}`, { method: "DELETE" }),
  documents: (kbId: string) => request<KBDocument[]>(`/knowledge/${kbId}/documents`),
  uploadDocument: (kbId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<KBDocument>(`/knowledge/${kbId}/documents`, { method: "POST", body: form });
  },
  addText: (kbId: string, body: { name: string; text: string }) =>
    request<KBDocument>(`/knowledge/${kbId}/text`, json(body)),
  deleteDocument: (kbId: string, docId: string) =>
    request<{ ok: boolean }>(`/knowledge/${kbId}/documents/${docId}`, { method: "DELETE" }),
  search: (body: { kb_ids: string[]; query: string; top_k?: number }) =>
    request<SearchHit[]>("/knowledge/search", json(body)),

  providers: () => request<Provider[]>("/providers"),
  saveProvider: (id: string, body: Record<string, unknown>) =>
    request<Provider[]>(`/providers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  discoverModels: (id: string, body: { api_key?: string; base_url?: string }) =>
    request<{ models: string[] }>(`/providers/${id}/discover`, json(body)),
  testModel: (model: string) =>
    request<{ ok: boolean; model?: string; reply?: string; error?: string }>("/providers/test", json({ model })),

  stats: (scope: "mine" | "all" = "mine", projectId = "") =>
    request<Stats>(`/stats?scope=${scope}${projectId ? `&project_id=${projectId}` : ""}`),
};
