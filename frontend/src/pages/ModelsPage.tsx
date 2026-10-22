import { useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import { useAction, usePolling } from "../components/ui";
import type { Provider } from "../types";

export default function ModelsPage() {
  const { isAdmin } = useAuth();
  const providers = usePolling(() => api.providers(), []);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>모델</h1>
          <p className="muted">
            에이전트가 사용할 모델 공급자를 연결합니다. 여기서 켠 모델은 앱 스튜디오에서 앱 기본 모델이나 역할별 모델로 고를 수 있습니다.
            {isAdmin ? " API 키는 이 서버의 로컬 데이터베이스(backend/data)에 저장됩니다." : " 키와 접속 정보는 관리자가 관리합니다."}
          </p>
        </div>
      </header>
      <div className="provider-grid">
        {providers.data?.map((p) =>
          isAdmin ? <ProviderCard key={p.id} provider={p} onSaved={(list) => providers.setData(list)} /> : <ReadOnlyCard key={p.id} provider={p} />,
        )}
      </div>
    </div>
  );
}

function ReadOnlyCard({ provider }: { provider: Provider }) {
  return (
    <div className="card provider-card">
      <div className="provider-head">
        <strong>
          {ICON[provider.id]} {provider.name}
        </strong>
        <StatusPill ok={provider.configured} />
      </div>
      <div className="model-list">
        {provider.models.map((m) => (
          <code key={m}>{m}</code>
        ))}
        {provider.models.length === 0 && <span className="muted small">사용할 수 있는 모델이 없습니다.</span>}
      </div>
    </div>
  );
}

const ICON: Record<string, string> = { mock: "🧪", anthropic: "🟠", openai: "🟢", gemini: "🔷", compat: "🖥️" };
const KEY_URL: Record<string, string> = { openai: "platform.openai.com/api-keys", gemini: "aistudio.google.com/apikey" };
const PLACEHOLDER: Record<string, Record<string, string>> = {
  anthropic: { api_key: "sk-ant-… (비우면 ANTHROPIC_API_KEY 사용)", base_url: "기본값 사용" },
  openai: { api_key: "sk-… (비우면 OPENAI_API_KEY 사용)" },
  gemini: { api_key: "AIza… (비우면 GEMINI_API_KEY 사용)" },
  compat: { api_key: "로컬 서버는 비워도 됩니다", base_url: "예: http://localhost:11434/v1" },
};

function StatusPill({ ok }: { ok: boolean }) {
  return <span className={`badge ${ok ? "badge-completed" : "badge-queued"}`}>{ok ? "사용 가능" : "설정 필요"}</span>;
}

function splitModels(s: string) {
  return s
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function ProviderCard({ provider, onSaved }: { provider: Provider; onSaved: (list: Provider[]) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.config.base_url);
  const [selected, setSelected] = useState<string[]>(splitModels(provider.config.models));
  const [found, setFound] = useState<string[] | null>(null);
  const [manual, setManual] = useState("");
  const [testModel, setTestModel] = useState(provider.models[0] ?? "");
  const [result, setResult] = useState<{ ok: boolean; reply?: string; error?: string; model?: string } | null>(null);
  const { busy, run } = useAction();

  const hasModelList = provider.fields.includes("models");
  const keySource = provider.config.api_key_preview
    ? `저장된 키: ${provider.config.api_key_preview}`
    : provider.config.uses_env_key
      ? "환경 변수의 키를 사용 중"
      : "";
  const choices = useMemo(() => Array.from(new Set([...(found ?? []), ...selected])).sort(), [found, selected]);

  const toggle = (m: string) => setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));

  const discover = async () => {
    const res = await run(() => api.discoverModels(provider.id, { api_key: apiKey || undefined, base_url: baseUrl || undefined }));
    if (res) {
      setFound(res.models);
      if (!res.models.length) setResult({ ok: false, error: "불러온 모델이 없습니다. 모델 이름을 직접 입력하세요." });
    }
  };

  const save = async () => {
    const body: Record<string, unknown> = {};
    if (apiKey) body.api_key = apiKey;
    if (provider.fields.includes("base_url")) body.base_url = baseUrl;
    if (hasModelList) body.models = selected.join(",");
    const list = await run(() => api.saveProvider(provider.id, body), "저장했습니다.");
    if (list) {
      onSaved(list);
      setApiKey("");
      const updated = list.find((p) => p.id === provider.id);
      if (updated && !updated.models.includes(testModel)) setTestModel(updated.models[0] ?? "");
    }
  };

  const test = async () => {
    setResult(null);
    const r = await run(() => api.testModel(testModel));
    if (r) setResult(r);
  };

  return (
    <div className={`card provider-card ${provider.id === "openai" ? "featured" : ""}`}>
      <div className="provider-head">
        <strong>
          {ICON[provider.id]} {provider.name}
        </strong>
        <StatusPill ok={provider.configured} />
      </div>
      <p className="muted small">{provider.description}</p>

      {provider.fields.includes("api_key") && (
        <label className="field">
          <span>
            API 키 {keySource && <span className="muted small">· {keySource}</span>}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={keySource ? "바꿀 때만 새 키를 입력하세요" : PLACEHOLDER[provider.id]?.api_key}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {KEY_URL[provider.id] && !keySource && (
            <small className="muted">
              키는{" "}
              <a href={`https://${KEY_URL[provider.id]}`} target="_blank" rel="noreferrer">
                {KEY_URL[provider.id]}
              </a>
              에서 발급합니다.
            </small>
          )}
        </label>
      )}
      {provider.fields.includes("base_url") && (
        <label className="field">
          <span>Base URL</span>
          <input value={baseUrl} placeholder={PLACEHOLDER[provider.id]?.base_url} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
      )}

      {hasModelList && (
        <div className="field">
          <span>사용할 모델</span>
          <div className="row">
            {provider.discover && (
              <button className="btn" disabled={busy} onClick={discover}>
                ⟳ 모델 불러오기
              </button>
            )}
            <input
              className="grow"
              placeholder="직접 추가 (Enter)"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manual.trim()) {
                  setSelected((s) => Array.from(new Set([...s, ...splitModels(manual)])));
                  setManual("");
                }
              }}
            />
          </div>
          {choices.length > 0 ? (
            <div className="model-picker">
              {choices.map((m) => (
                <label key={m} className={`model-option ${selected.includes(m) ? "on" : ""}`}>
                  <input type="checkbox" checked={selected.includes(m)} onChange={() => toggle(m)} />
                  {m}
                </label>
              ))}
            </div>
          ) : (
            <span className="muted small">
              {provider.discover ? "키를 입력하고 ‘모델 불러오기’를 누르면 사용 가능한 모델이 표시됩니다." : "모델 이름을 입력하세요."}
            </span>
          )}
          {found && <span className="muted small">{found.length}개 모델을 불러왔습니다. 쓸 모델을 체크하고 저장하세요.</span>}
        </div>
      )}

      {provider.fields.length > 0 && (
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={save}>
            저장
          </button>
          {provider.config.api_key_preview && (
            <button
              className="btn ghost small"
              disabled={busy}
              onClick={() =>
                confirm("저장된 키를 삭제할까요?") &&
                run(() => api.saveProvider(provider.id, { clear_api_key: true }), "키를 삭제했습니다.").then((l) => l && onSaved(l))
              }
            >
              저장된 키 삭제
            </button>
          )}
        </div>
      )}

      {!hasModelList && (
        <div className="model-list">
          {provider.models.map((m) => (
            <code key={m}>{m}</code>
          ))}
        </div>
      )}

      {provider.models.length > 0 && (
        <div className="row test-row">
          <select value={testModel} onChange={(e) => setTestModel(e.target.value)}>
            {provider.models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button className="btn" disabled={busy || !testModel} onClick={test}>
            연결 테스트
          </button>
        </div>
      )}
      {result && <p className={result.ok ? "ok-text small" : "error-text small"}>{result.ok ? `✅ ${result.model}: ${result.reply}` : `⚠️ ${result.error}`}</p>}
    </div>
  );
}
