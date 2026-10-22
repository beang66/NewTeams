import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth, useProject } from "../App";
import { Empty, StatusBadge, formatNumber, timeAgo, useAction, usePolling } from "../components/ui";
import { navigate } from "../router";
import type { AssetComment, Project, ProjectAsset, ProjectStatus, Run, User } from "../types";


const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "기획",
  active: "진행",
  review: "검수",
  completed: "완료",
  paused: "보류",
};

const EMPTY_PROJECT = {
  name: "",
  client: "",
  description: "",
  status: "planning" as ProjectStatus,
  start_date: "",
  end_date: "",
  budget: "",
  member_ids: [] as string[],
};

export default function ProjectsPage({ projectId }: { projectId?: string }) {
  return projectId ? <ProjectDetail projectId={projectId} /> : <ProjectGallery />;
}

function ProjectGallery() {
  const projects = usePolling(() => api.projects(), []);
  const { setProjectId, reloadProjects } = useProject();
  const { isAdmin } = useAuth();
  const users = usePolling(() => (isAdmin ? api.users() : Promise.resolve([])), [isAdmin]);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(EMPTY_PROJECT);
  const { busy, run } = useAction();

  const create = async () => {
    const created = await run(() => api.createProject(draft), "프로젝트를 만들었습니다.");
    if (created) {
      reloadProjects();
      setProjectId(created.id);
      navigate(`/projects/${created.id}`);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>프로젝트 · 캠페인</h1>
          <p className="muted">팀, 시안, 에이전트 실행과 결과물을 하나의 캠페인 보관소에서 관리합니다.</p>
        </div>
        <button className="btn primary" onClick={() => setShowCreate((value) => !value)}>+ 프로젝트 만들기</button>
      </header>

      {showCreate && (
        <section className="card project-form">
          <div className="section-head"><h2 className="section-title">새 프로젝트</h2></div>
          <ProjectFields value={draft} onChange={setDraft} users={users.data ?? []} showMembers={isAdmin} />
          <div className="row end">
            <button className="btn" onClick={() => setShowCreate(false)}>취소</button>
            <button className="btn primary" disabled={busy || !draft.name.trim()} onClick={create}>프로젝트 만들기</button>
          </div>
        </section>
      )}

      {projects.data?.length === 0 ? (
        <Empty icon="🗂️" title="첫 프로젝트를 만들어 보세요">캠페인 정보, 시안과 실행 결과를 한곳에 모을 수 있습니다.</Empty>
      ) : (
        <div className="project-grid">
          {projects.data?.map((project) => (
            <button key={project.id} className="card project-card" onClick={() => navigate(`/projects/${project.id}`)}>
              <div className="project-card-head">
                <span className={`project-status status-${project.status}`}>{STATUS_LABEL[project.status]}</span>
                <span className="muted small">수정 {timeAgo(project.updated_at)}</span>
              </div>
              <strong>{project.name}</strong>
              <span className="muted">{project.client || "클라이언트 미지정"}</span>
              <p className="muted small clamp-2">{project.description || "프로젝트 설명이 없습니다."}</p>
              <div className="project-metrics">
                <span>🖼️ 시안 {project.asset_count}</span>
                <span>🤖 실행 {project.run_count}</span>
                <span>👥 {project.member_names.length}</span>
              </div>
              <div className="tags">
                {project.member_names.map((name) => <span key={name} className="tag">{name}</span>)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const { setProjectId, reloadProjects } = useProject();
  // 프로젝트를 열면 모든 화면이 이 프로젝트 기준으로 바뀐다
  useEffect(() => {
    setProjectId(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const project = usePolling(() => api.project(projectId), [projectId]);
  const assets = usePolling(() => api.projectAssets(projectId), [projectId]);
  const runs = usePolling(() => api.projectRuns(projectId), [projectId], 4000);
  const { isAdmin } = useAuth();
  const users = usePolling(() => (isAdmin ? api.users() : Promise.resolve([])), [isAdmin]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(EMPTY_PROJECT);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!project.data) return;
    setDraft(projectDraft(project.data));
  }, [project.data]);

  useEffect(() => {
    if (!selectedAsset && assets.data?.length) setSelectedAsset(assets.data[0].id);
    if (selectedAsset && assets.data && !assets.data.some((asset) => asset.id === selectedAsset)) {
      setSelectedAsset(assets.data[0]?.id ?? null);
    }
  }, [assets.data, selectedAsset]);

  if (!project.data) return <div className="page muted">프로젝트를 불러오는 중…</div>;
  const current = project.data;
  const asset = assets.data?.find((item) => item.id === selectedAsset) ?? null;

  const save = async () => {
    const updated = await run(() => api.updateProject(projectId, draft), "프로젝트 정보를 저장했습니다.");
    if (updated) {
      project.setData(updated);
      setEditing(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const uploaded = await run(() => api.uploadProjectAsset(projectId, file), `'${file.name}' 시안을 보관했습니다.`);
      if (uploaded) setSelectedAsset(uploaded.id);
    }
    assets.reload();
    project.reload();
  };

  const removeProject = async () => {
    if (!confirm(`'${current.name}' 프로젝트를 삭제할까요?
이미지 시안 ${current.asset_count}개와 실행 기록·결과물 ${current.run_count}개도 함께 삭제되며 되돌릴 수 없습니다.`)) return;
    const deleted = await run(() => api.deleteProject(projectId));
    if (deleted) {
      reloadProjects();
      navigate("/projects");
    }
  };

  return (
    <div className="page project-detail">
      <header className="page-head">
        <div>
          <a className="back" href="#/projects">← 프로젝트</a>
          <div className="project-title-line">
            <span className={`project-status status-${current.status}`}>{STATUS_LABEL[current.status]}</span>
            <h1>{current.name}</h1>
          </div>
          <p className="muted">{current.client || "클라이언트 미지정"} · {current.member_names.join(", ") || "멤버 미지정"}</p>
        </div>
        <div className="row">
          <a className="btn" href="#/knowledge">🗂️ 공유 저장소 (문서 {current.kb_documents}개)</a>
          <a className="btn primary" href={`#/tasks/${current.id}`}>+ 이 프로젝트에서 작업</a>
          {current.can_edit && <button className="btn" onClick={() => setEditing((value) => !value)}>{editing ? "편집 닫기" : "프로젝트 편집"}</button>}
        </div>
      </header>

      {editing && (
        <section className="card project-form">
          <ProjectFields value={draft} onChange={setDraft} users={users.data ?? []} showMembers={isAdmin} />
          <div className="row between">
            <button className="btn danger-ghost" disabled={busy} onClick={removeProject}>프로젝트 삭제</button>
            <button className="btn primary" disabled={busy || !draft.name.trim()} onClick={save}>저장</button>
          </div>
        </section>
      )}

      <section className="project-overview">
        <div className="card project-brief">
          <span className="muted small">기간</span><b>{dateRange(current)}</b>
          <span className="muted small">예산</span><b>{current.budget || "미정"}</b>
          <span className="muted small">설명</span><p>{current.description || "등록된 설명이 없습니다."}</p>
        </div>
        <div className="card storage-map">
          <h3>프로젝트 보관소</h3>
          <div><span>🖼️ 시안 보관소</span><b>{current.asset_count}개</b></div>
          <div><span>🤖 에이전트 실행 기록</span><b>{current.run_count}건</b></div>
          <div><span>📄 실행별 결과물</span><b>각 실행의 파일 탭</b></div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2 className="section-title">이미지 시안과 피드백</h2><p className="muted small">이미지를 선택한 뒤 원하는 위치를 클릭해 댓글을 남길 수 있습니다.</p></div>
          {current.can_contribute && (
            <>
              <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => upload(event.target.files)} />
              <button className="btn primary" disabled={busy} onClick={() => fileInput.current?.click()}>🖼️ 시안 업로드</button>
            </>
          )}
        </div>
        {assets.data?.length ? (
          <div className="asset-workbench">
            <div className="asset-list">
              {assets.data.map((item) => (
                <button key={item.id} className={`asset-thumb ${item.id === selectedAsset ? "active" : ""}`} onClick={() => setSelectedAsset(item.id)}>
                  <img src={api.projectAssetUrl(projectId, item.id)} alt="" />
                  <span>{item.name}</span>
                  <small>{item.comment_count}개 댓글</small>
                </button>
              ))}
            </div>
            {asset && <AssetInspector project={current} asset={asset} onChanged={() => { assets.reload(); project.reload(); }} />}
          </div>
        ) : (
          <Empty icon="🖼️" title="등록된 이미지 시안이 없습니다">PNG·JPG·GIF·WEBP 파일을 올리면 팀원이 함께 검수할 수 있습니다.</Empty>
        )}
      </section>

      <section>
        <div className="section-head"><h2 className="section-title">에이전트 실행과 결과물</h2><a href={`#/tasks/${current.id}`}>새 작업 시작 →</a></div>
        {runs.data?.length ? <div className="run-list">{runs.data.map((item) => <ProjectRun key={item.id} run={item} />)}</div> : (
          <Empty icon="🤖" title="아직 실행 기록이 없습니다">프로젝트 지시를 보내면 에이전트 대화와 결과물이 여기에 연결됩니다.</Empty>
        )}
      </section>
    </div>
  );
}

function ProjectFields({ value, onChange, users, showMembers }: {
  value: typeof EMPTY_PROJECT;
  onChange: (value: typeof EMPTY_PROJECT) => void;
  users: User[];
  showMembers: boolean;
}) {
  const set = <K extends keyof typeof EMPTY_PROJECT>(key: K, next: (typeof EMPTY_PROJECT)[K]) => onChange({ ...value, [key]: next });
  return (
    <div className="project-fields">
      <label className="field"><span>프로젝트명</span><input value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="예: 강남역 겨울 브랜드 캠페인" /></label>
      <label className="field"><span>클라이언트·브랜드</span><input value={value.client} onChange={(e) => set("client", e.target.value)} /></label>
      <label className="field"><span>상태</span><select value={value.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>{Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field"><span>시작일</span><input type="date" value={value.start_date} onChange={(e) => set("start_date", e.target.value)} /></label>
      <label className="field"><span>종료일</span><input type="date" value={value.end_date} onChange={(e) => set("end_date", e.target.value)} /></label>
      <label className="field"><span>예산</span><input value={value.budget} onChange={(e) => set("budget", e.target.value)} placeholder="예: 3천만 원" /></label>
      <label className="field wide"><span>설명과 목표</span><textarea rows={3} value={value.description} onChange={(e) => set("description", e.target.value)} /></label>
      {showMembers && (
        <fieldset className="field wide"><span>프로젝트 멤버</span><div className="member-picker">{users.map((user) => (
          <label key={user.id}><input type="checkbox" checked={value.member_ids.includes(user.id)} onChange={(e) => set("member_ids", e.target.checked ? [...value.member_ids, user.id] : value.member_ids.filter((id) => id !== user.id))} /> {user.name} <small>{user.role}</small></label>
        ))}</div></fieldset>
      )}
    </div>
  );
}

function AssetInspector({ project, asset, onChanged }: { project: Project; asset: ProjectAsset; onChanged: () => void }) {
  const comments = usePolling(() => api.assetComments(project.id, asset.id), [project.id, asset.id]);
  const { user, isAdmin } = useAuth();
  const [body, setBody] = useState("");
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const { busy, run } = useAction();

  const add = async () => {
    const created = await run(() => api.createAssetComment(project.id, asset.id, { body, x: point?.x, y: point?.y }), "댓글을 남겼습니다.");
    if (created) {
      setBody("");
      setPoint(null);
      comments.reload();
      onChanged();
    }
  };

  const removeAsset = async () => {
    if (!confirm(`'${asset.name}' 시안과 댓글을 삭제할까요?`)) return;
    const deleted = await run(() => api.deleteProjectAsset(project.id, asset.id));
    if (deleted) onChanged();
  };

  return (
    <div className="asset-inspector card">
      <div className="section-head">
        <div><h3>{asset.name}</h3><span className="muted small">{asset.owner_name} · {formatNumber(asset.size)} bytes · {timeAgo(asset.created_at)}</span></div>
        {(isAdmin || project.can_edit || asset.owner_id === user.id) && <button className="btn small danger-ghost" onClick={removeAsset}>시안 삭제</button>}
      </div>
      <div className="asset-preview" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPoint({ x: Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10, y: Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10 });
      }}>
        <img src={api.projectAssetUrl(project.id, asset.id)} alt={asset.name} />
        {comments.data?.filter(hasPoint).map((comment, index) => <span key={comment.id} className="comment-pin" style={{ left: `${comment.x}%`, top: `${comment.y}%` }} title={comment.body} onClick={(event) => event.stopPropagation()}>{index + 1}</span>)}
        {point && <span className="comment-pin draft" style={{ left: `${point.x}%`, top: `${point.y}%` }}>+</span>}
      </div>
      <div className="comment-composer">
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={point ? `선택한 위치 (${point.x}%, ${point.y}%)에 남길 의견` : "전체 시안에 대한 의견"} />
        <div className="row between"><button className="btn small" disabled={!point} onClick={() => setPoint(null)}>위치 선택 해제</button><button className="btn primary" disabled={busy || !body.trim()} onClick={add}>댓글 남기기</button></div>
      </div>
      <div className="asset-comments">
        {comments.data?.map((comment) => (
          <div key={comment.id} className="asset-comment">
            <span className="comment-number">{hasPoint(comment) ? (comments.data?.filter(hasPoint).findIndex((item) => item.id === comment.id) ?? 0) + 1 : "·"}</span>
            <div><b>{comment.author_name}</b><span className="muted small"> · {timeAgo(comment.created_at)}{hasPoint(comment) && ` · ${comment.x}%, ${comment.y}%`}</span><p>{comment.body}</p></div>
            {(isAdmin || project.can_edit || comment.author_id === user.id) && <button className="icon-btn" title="댓글 삭제" onClick={() => run(() => api.deleteAssetComment(project.id, asset.id, comment.id)).then(() => { comments.reload(); onChanged(); })}>✕</button>}
          </div>
        ))}
        {comments.data?.length === 0 && <p className="muted small">첫 검수 의견을 남겨보세요.</p>}
      </div>
    </div>
  );
}

function ProjectRun({ run }: { run: Run }) {
  return (
    <a className="run-row project-run" href={`#/runs/${run.id}`}>
      <span className="run-icon">{run.app_icon}</span>
      <span className="run-main"><b className="run-goal">{run.goal}</b><span className="muted small">{run.app_name} · {run.owner_name} · {timeAgo(run.created_at)}</span><span className="muted small clamp-1">{run.result_preview}</span></span>
      <StatusBadge status={run.status} />
    </a>
  );
}

function projectDraft(project: Project): typeof EMPTY_PROJECT {
  return {
    name: project.name,
    client: project.client,
    description: project.description,
    status: project.status,
    start_date: project.start_date,
    end_date: project.end_date,
    budget: project.budget,
    member_ids: project.member_ids,
  };
}

function dateRange(project: Project) {
  if (project.start_date && project.end_date) return `${project.start_date} ~ ${project.end_date}`;
  return project.start_date || project.end_date || "미정";
}

function hasPoint(comment: AssetComment): comment is AssetComment & { x: number; y: number } {
  return comment.x != null && comment.y != null;
}
