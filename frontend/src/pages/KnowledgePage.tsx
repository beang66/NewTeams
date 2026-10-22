import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useProject } from "../App";
import { Empty, Toggle, formatNumber, timeAgo, useAction, usePolling } from "../components/ui";
import type { KnowledgeBase, SearchHit } from "../types";

export default function KnowledgePage() {
  const { projectId, project } = useProject();
  const kbs = usePolling(() => api.knowledgeBases(), [projectId]);
  const [selected, setSelected] = useState<string | null>(null);

  // 프로젝트를 고르면 그 프로젝트의 공유 저장소를 먼저 연다
  useEffect(() => {
    if (project) setSelected(project.kb_id);
  }, [project?.kb_id]);
  const [name, setName] = useState("");
  const { busy, run } = useAction();

  useEffect(() => {
    if (!selected && kbs.data?.length) setSelected(kbs.data[0].id);
  }, [kbs.data, selected]);

  const create = async () => {
    const kb = await run(() => api.createKnowledgeBase({ name, description: "" }), "지식 베이스를 만들었습니다.");
    if (kb) {
      setName("");
      setSelected(kb.id);
      kbs.reload();
    }
  };

  const current = kbs.data?.find((k) => k.id === selected);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>지식</h1>
          <p className="muted">사내 문서를 올려 두면 에이전트가 검색해 근거로 사용합니다. 앱 스튜디오의 ‘지식 검색’ 노드에서 연결하세요.</p>
        </div>
      </header>
      <div className="split">
        <aside className="card list-pane">
          <div className="row">
            <input className="grow" placeholder="새 지식 베이스 이름" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} />
            <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>
              만들기
            </button>
          </div>
          <ul className="select-list">
            {kbs.data?.map((kb) => (
              <li key={kb.id}>
                <button className={selected === kb.id ? "active" : ""} onClick={() => setSelected(kb.id)}>
                  <strong>
                    {kb.project_id ? "🗂️" : "📚"} {kb.name}
                    {kb.project_id && kb.project_id === projectId && <span className="tag accent">현재 프로젝트 저장소</span>}
                  </strong>
                  <span className="muted small">
                    문서 {kb.documents} · 조각 {kb.chunks} · {formatNumber(kb.chars)}자
                  </span>
                  <span className="muted small">
                    {kb.shared ? "팀 공유" : "비공개"}
                    {!kb.is_mine && ` · 👤 ${kb.owner_name}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="detail-pane">
          {current ? (
            <KnowledgeDetail
              key={current.id}
              kb={current}
              onChanged={kbs.reload}
              onDeleted={() => {
                setSelected(null);
                kbs.reload();
              }}
            />
          ) : (
            <Empty icon="📚" title="지식 베이스를 만들어 보세요">왼쪽에서 이름을 입력하고 ‘만들기’를 누르세요.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function KnowledgeDetail({ kb, onChanged, onDeleted }: { kb: KnowledgeBase; onChanged: () => void; onDeleted: () => void }) {
  const { id: kbId, name, can_edit: canEdit } = kb;
  const docs = usePolling(() => api.documents(kbId), [kbId]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [textName, setTextName] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const { busy, run } = useAction();

  const refresh = () => {
    docs.reload();
    onChanged();
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      await run(() => api.uploadDocument(kbId, file), `'${file.name}'을(를) 추가했습니다.`);
    }
    refresh();
  };

  const addText = async () => {
    const ok = await run(() => api.addText(kbId, { name: textName || "붙여넣은 문서", text }), "문서를 추가했습니다.");
    if (ok) {
      setText("");
      setTextName("");
      refresh();
    }
  };

  const search = async () => {
    const result = await run(() => api.search({ kb_ids: [kbId], query, top_k: 5 }));
    if (result) setHits(result);
  };

  return (
    <div className="stack">
      <div className="section-head">
        <h2 className="section-title">📚 {name}</h2>
        {canEdit ? (
          <div className="row">
            <Toggle
              label="팀에 공유"
              checked={kb.shared}
              onChange={(v) => run(() => api.updateKnowledgeBase(kbId, { shared: v }), v ? "팀에 공유했습니다." : "비공개로 바꿨습니다.").then(onChanged)}
            />
            <button className="btn danger-ghost small" onClick={() => confirm(`'${name}'과(와) 모든 문서를 삭제할까요?`) && run(() => api.deleteKnowledgeBase(kbId)).then(onDeleted)}>
              지식 베이스 삭제
            </button>
          </div>
        ) : (
          <span className="muted small">👤 {kb.owner_name}의 공유 지식 베이스 · 읽기 전용</span>
        )}
      </div>

      {canEdit && (
        <>
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }}
            onClick={() => fileInput.current?.click()}
          >
            <input ref={fileInput} type="file" multiple hidden accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf" onChange={(e) => upload(e.target.files)} />
            <strong>📎 파일을 끌어다 놓거나 클릭해서 올리세요</strong>
            <span className="muted small">txt · md · csv · json · html · pdf(pypdf 필요) · 최대 10MB</span>
          </div>

          <details className="card">
            <summary>텍스트 직접 붙여넣기</summary>
            <div className="stack">
              <input placeholder="문서 이름" value={textName} onChange={(e) => setTextName(e.target.value)} />
              <textarea rows={6} placeholder="내용을 붙여넣으세요" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn primary" disabled={busy || !text.trim()} onClick={addText}>
                추가
              </button>
            </div>
          </details>
        </>
      )}

      <div className="card">
        <h3>문서 {docs.data?.length ?? 0}개</h3>
        {docs.data?.length === 0 ? (
          <p className="muted small">아직 문서가 없습니다.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>이름</th>
                <th>글자 수</th>
                <th>조각</th>
                <th>추가</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.data?.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.name}</strong>
                    <div className="muted small clamp-1">{d.preview}</div>
                  </td>
                  <td>{formatNumber(d.chars)}</td>
                  <td>{d.chunk_count}</td>
                  <td className="muted small">{timeAgo(d.created_at)}</td>
                  <td>
                    {canEdit && (
                      <button className="icon-btn" title="삭제" onClick={() => run(() => api.deleteDocument(kbId, d.id)).then(refresh)}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>검색 테스트</h3>
        <p className="muted small">에이전트가 이 지식 베이스에서 무엇을 찾게 될지 미리 확인합니다.</p>
        <div className="row">
          <input className="grow" placeholder="질문이나 검색어" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query.trim() && search()} />
          <button className="btn" disabled={busy || !query.trim()} onClick={search}>
            검색
          </button>
        </div>
        {hits && (
          <ol className="hits">
            {hits.length === 0 && <li className="muted">일치하는 조각이 없습니다.</li>}
            {hits.map((h) => (
              <li key={`${h.document_id}-${h.chunk}`}>
                <div className="hit-head">
                  <b>{h.document}</b> <span className="muted small">#{h.chunk} · 점수 {h.score}</span>
                </div>
                <p className="small">{h.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
