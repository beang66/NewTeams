import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, UNAUTHORIZED_EVENT } from "./api";
import { BrandMark, ToastProvider, usePolling } from "./components/ui";
import AccountPage from "./pages/AccountPage";
import KnowledgePage from "./pages/KnowledgePage";
import HistoryPage from "./pages/HistoryPage";
import LoginPage from "./pages/LoginPage";
import ModelsPage from "./pages/ModelsPage";
import OpsPage from "./pages/OpsPage";
import ProjectsPage from "./pages/ProjectsPage";
import RunPage from "./pages/RunPage";
import StudioPage from "./pages/StudioPage";
import TasksPage from "./pages/TasksPage";
import UsersPage from "./pages/UsersPage";
import { useHashRoute } from "./router";
import type { AuthState, Meta, Project, RoleKey, User } from "./types";

const MetaContext = createContext<Meta | null>(null);
const AuthContext = createContext<{ user: User; setUser: (u: User) => void; logout: () => void } | null>(null);

/** 현재 프로젝트: 홈·실행 기록·에이전트 팀·지식·운영이 모두 이 프로젝트 기준으로 동작한다. 빈 값이면 개인 작업. */
interface ProjectCtx {
  projectId: string;
  project: Project | undefined;
  projects: Project[];
  setProjectId: (id: string) => void;
  reloadProjects: () => void;
}
const ProjectContext = createContext<ProjectCtx | null>(null);
const PROJECT_KEY = "newteam.project";

export function useProject(): ProjectCtx {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("project context missing");
  return ctx;
}

export function useMeta(): Meta {
  const meta = useContext(MetaContext);
  if (!meta) throw new Error("meta not loaded");
  return meta;
}

export function useRole(key: RoleKey) {
  return useMeta().roles.find((r) => r.key === key)!;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("not logged in");
  return { ...ctx, isAdmin: ctx.user.role === "admin" };
}

const NAV = [
  { path: "tasks", icon: "⌂", label: "홈", hint: "목표를 주고 실행" },
  { path: "projects", icon: "▣", label: "프로젝트", hint: "캠페인·시안·결과물 관리" },
  { path: "history", icon: "↗", label: "실행 기록", hint: "결과 검색·다시 보기" },
  { path: "studio", icon: "◉", label: "에이전트 팀", hint: "앱 스튜디오에서 팀 설계" },
  { path: "knowledge", icon: "▤", label: "지식", hint: "문서 검색·활용" },
  { path: "models", icon: "◇", label: "모델", hint: "모델 공급자 관리" },
  { path: "ops", icon: "▦", label: "운영", hint: "현황과 로그" },
];

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAuth = useCallback(() => {
    api.authState().then(setAuth).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    loadAuth();
    // 로그아웃 직후 늦게 도착한 401이 새로 로그인한 세션을 지우지 않도록, 서버에 현재 상태를 다시 묻는다.
    const onUnauthorized = () => loadAuth();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [loadAuth]);

  if (error) {
    return (
      <div className="boot">
        <h2>백엔드에 연결하지 못했습니다</h2>
        <p className="muted">{error}</p>
        <code>cd backend && .venv\Scripts\python -m newteam</code>
      </div>
    );
  }
  if (!auth) return <div className="boot muted">불러오는 중…</div>;

  return (
    <ToastProvider>
      {auth.user ? (
        <AuthContext.Provider
          value={{
            user: auth.user,
            setUser: (user) => setAuth({ ...auth, user }),
            logout: () => api.logout().finally(() => setAuth({ ...auth, user: null })),
          }}
        >
          <Shell key={auth.user.id} />
        </AuthContext.Provider>
      ) : (
        <LoginPage state={auth} onLoggedIn={(user) => setAuth({ ...auth, needs_setup: false, user })} />
      )}
    </ToastProvider>
  );
}

function Shell() {
  const { user, isAdmin, logout } = useAuth();
  const [meta, setMeta] = useState<Meta | null>(null);
  const route = useHashRoute();
  const waiting = usePolling(() => api.runs({ status: "waiting" }), [], 5000);
  const projectList = usePolling(() => api.projects(), [], 15000);
  const [storedProject, setStoredProject] = useState(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const projects = projectList.data ?? [];
  // 지워졌거나 권한이 없어진 프로젝트는 자동으로 해제한다
  const projectId = projects.some((p) => p.id === storedProject) ? storedProject : "";
  const setProjectId = (id: string) => {
    if (id && !projects.some((p) => p.id === id)) projectList.reload(); // 방금 만든 프로젝트면 목록부터 갱신
    setStoredProject(id);
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {
      /* 저장소를 쓸 수 없는 브라우저에서는 이번 화면에서만 유지한다 */
    }
  };

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  if (!meta) return <div className="boot muted">불러오는 중…</div>;

  const [section, id] = route;
  const active = section === "runs" ? "history" : section;
  const waitingCount = waiting.data?.length ?? 0;
  const nav = isAdmin ? [...NAV, { path: "users", icon: "◎", label: "사용자", hint: "계정과 권한" }] : NAV;

  return (
    <MetaContext.Provider value={meta}>
      <ProjectContext.Provider
        value={{ projectId, project: projects.find((p) => p.id === projectId), projects, setProjectId, reloadProjects: projectList.reload }}
      >
      <div className="shell">
        <aside className="sidebar">
          <a className="brand" href="#/tasks">
            <BrandMark />
            <span>
              NEWTEAM
              <em>AGENT STUDIO</em>
            </span>
          </a>
          <label className="project-switch">
            <span>현재 프로젝트</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">개인 작업 (프로젝트 없음)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <nav className="side-nav" aria-label="주요 메뉴">
            {nav.map((n) => (
              <a key={n.path} href={`#/${n.path}`} title={n.hint} className={`side-item ${active === n.path ? "active" : ""}`}>
                <span className="side-icon" aria-hidden>
                  {n.icon}
                </span>
                {n.label}
                {n.path === "tasks" && waitingCount > 0 && (
                  <span className="nav-count" title="승인 대기 중인 내 작업">
                    {waitingCount}
                  </span>
                )}
              </a>
            ))}
          </nav>
          <div className="side-foot">
            <a href="#/account" className="side-user" title="내 계정">
              <span className="user-avatar">{user.name.slice(0, 1)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{isAdmin ? "ADMIN" : "MEMBER"}</small>
              </span>
            </a>
            <button className="side-logout" onClick={logout}>
              로그아웃
            </button>
            <div className="side-status">
              <div>
                <span className={`dot ${meta.integrations.browser_use ? "on" : ""}`} />
                BROWSER-USE
              </div>
              <div>
                <span className={`dot ${meta.integrations.openhands ? "on" : ""}`} />
                OPENHANDS SDK
              </div>
              <div className={meta.integrations.sandbox_blocked ? "warn" : ""}>
                <span className={`dot ${meta.integrations.sandbox_blocked ? "warn" : "on"}`} />
                SANDBOX / {meta.integrations.sandbox.toUpperCase()}
                {meta.integrations.docker_runtime && ` (${meta.integrations.docker_runtime})`}
                {meta.integrations.sandbox_blocked && " — 서버 모드에서 local 샌드박스는 명령 실행이 막혀 있습니다. NEWTEAM_SANDBOX=docker로 설정하세요."}
              </div>
            </div>
          </div>
        </aside>
        <main className="main">
          {section === "runs" && id ? (
            <RunPage runId={id} key={id} />
          ) : section === "projects" ? (
            <ProjectsPage projectId={id} />
          ) : section === "history" ? (
            <HistoryPage />
          ) : section === "studio" ? (
            <StudioPage appId={id} />
          ) : section === "knowledge" ? (
            <KnowledgePage />
          ) : section === "models" ? (
            <ModelsPage />
          ) : section === "ops" ? (
            <OpsPage />
          ) : section === "users" && isAdmin ? (
            <UsersPage />
          ) : section === "account" ? (
            <AccountPage />
          ) : section === "tasks" ? (
            <TasksPage projectId={id} />
          ) : (
            <TasksPage />
          )}
        </main>
      </div>
      </ProjectContext.Provider>
    </MetaContext.Provider>
  );
}
