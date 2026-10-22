import httpx
import pytest
from fastapi.testclient import TestClient

from newteam.api import create_app
from newteam.engine.graph import PLAN_SCHEMA
from newteam.llm import LLMError, LLMRequest, registry
from newteam.llm import openai_compat

OPENAI = registry.PROVIDERS["openai"]["hosted"]
GEMINI = registry.PROVIDERS["gemini"]["hosted"]


class FakeHTTP:
    """httpx.post/get을 가로채 OpenAI 응답을 흉내 낸다."""

    def __init__(self, monkeypatch):
        self.calls = []
        self.status = 200
        self.reply = '{"summary": "요약", "steps": []}'
        monkeypatch.setattr(openai_compat.httpx, "post", self.post)
        monkeypatch.setattr(openai_compat.httpx, "get", self.get)

    def _response(self, method, url, payload):
        return httpx.Response(self.status, json=payload, request=httpx.Request(method, url))

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.status != 200:
            return self._response("POST", url, {"error": {"message": "bad"}})
        return self._response("POST", url, {
            "model": json["model"],
            "choices": [{"message": {"content": self.reply}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        })

    def get(self, url, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers})
        if self.status != 200:
            return self._response("GET", url, {"error": {"message": "bad"}})
        ids = ["gpt-test-mini", "gpt-test", "text-embedding-test", "whisper-1", "tts-test", "o-test"]
        return self._response("GET", url, {"data": [{"id": i} for i in ids]})


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    return FakeHTTP(monkeypatch)


def test_official_openai_uses_strict_json_schema(fake):
    cfg = {"hosted": OPENAI, "api_key": "sk-abc"}
    res = openai_compat.complete("gpt-test", LLMRequest(system="s", prompt="p", purpose="plan", json_schema=PLAN_SCHEMA), cfg)
    call = fake.calls[0]
    assert call["url"] == "https://api.openai.com/v1/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer sk-abc"
    fmt = call["json"]["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["strict"] is True
    assert fmt["json_schema"]["schema"] == PLAN_SCHEMA
    assert res.json()["summary"] == "요약" and res.input_tokens == 11


def test_official_ignores_custom_base_url_and_reads_env_key(fake, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")
    openai_compat.complete("gpt-test", LLMRequest(system="s", prompt="p"), {"hosted": OPENAI, "base_url": "http://evil/v1"})
    assert fake.calls[0]["url"].startswith("https://api.openai.com/v1")
    assert fake.calls[0]["headers"]["Authorization"] == "Bearer sk-from-env"


def test_compat_server_uses_json_object(fake):
    openai_compat.complete("llama3", LLMRequest(system="s", prompt="p", json_schema=PLAN_SCHEMA), {"base_url": "http://localhost:11434/v1/"})
    call = fake.calls[0]
    assert call["url"] == "http://localhost:11434/v1/chat/completions"
    assert call["json"]["response_format"] == {"type": "json_object"}
    assert "Authorization" not in call["headers"]


@pytest.mark.parametrize("status,phrase", [(401, "API 키가 올바르지 않습니다"), (429, "요청 한도"), (404, "찾을 수 없거나")])
def test_error_messages(fake, status, phrase):
    fake.status = status
    with pytest.raises(LLMError, match=phrase):
        openai_compat.complete("gpt-x", LLMRequest(system="s", prompt="p"), {"hosted": OPENAI, "api_key": "k"})


def test_discover_filters_non_chat_models(fake):
    models = openai_compat.discover_models({"hosted": OPENAI, "api_key": "k"})
    assert models == ["gpt-test", "gpt-test-mini", "o-test"]


def test_openai_provider_end_to_end(fake, monkeypatch):
    with TestClient(create_app()) as client:
        client.post("/api/auth/setup", json={"name": "관리자", "email": "a@example.com", "password": "admin-pass-1"})
        providers = {p["id"]: p for p in client.get("/api/providers").json()}
        assert providers["openai"]["configured"] is False and providers["openai"]["discover"] is True

        # 저장 전에 입력한 키로 모델 목록을 확인할 수 있다
        found = client.post("/api/providers/openai/discover", json={"api_key": "sk-typed-123456789"}).json()
        assert found["models"] == ["gpt-test", "gpt-test-mini", "o-test"]
        assert fake.calls[-1]["headers"]["Authorization"] == "Bearer sk-typed-123456789"

        client.put("/api/providers/openai", json={"api_key": "sk-typed-123456789", "models": "gpt-test,gpt-test-mini"})
        p = {x["id"]: x for x in client.get("/api/providers").json()}["openai"]
        assert p["configured"] is True and p["models"] == ["openai:gpt-test", "openai:gpt-test-mini"]
        assert "123456789" not in p["config"]["api_key_preview"]

        assert client.post("/api/providers/test", json={"model": "openai:gpt-test"}).json()["ok"] is True

        fake.status = 401
        bad = client.post("/api/providers/openai/discover", json={})
        assert bad.status_code == 400 and "API 키" in bad.json()["detail"]


def test_env_key_counts_as_configured(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    assert registry.is_configured("openai", {"hosted": OPENAI, "models": "gpt-test"})
    assert not registry.is_configured("openai", {"hosted": OPENAI})


def test_gemini_uses_its_endpoint_env_key_and_strict_schema(fake, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gm-env-key")
    openai_compat.complete("gemini-test-flash", LLMRequest(system="s", prompt="p", purpose="plan", json_schema=PLAN_SCHEMA),
                           {"hosted": GEMINI, "base_url": "http://ignored/v1"})
    call = fake.calls[0]
    assert call["url"] == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer gm-env-key"
    assert call["json"]["response_format"]["type"] == "json_schema"


def test_gemini_errors_are_labelled(fake):
    fake.status = 401
    with pytest.raises(LLMError, match="Gemini API 키"):
        openai_compat.complete("gemini-x", LLMRequest(system="s", prompt="p"), {"hosted": GEMINI, "api_key": "k"})


def test_gemini_discover_strips_prefix_and_filters(fake, monkeypatch):
    def get(url, headers=None, timeout=None):
        fake.calls.append({"url": url})
        ids = ["models/gemini-test-flash", "models/gemini-embedding-001", "models/imagen-test", "models/veo-test", "gemini-test-pro"]
        return httpx.Response(200, json={"data": [{"id": i} for i in ids]}, request=httpx.Request("GET", url))

    monkeypatch.setattr(openai_compat.httpx, "get", get)
    assert openai_compat.discover_models({"hosted": GEMINI, "api_key": "k"}) == ["gemini-test-flash", "gemini-test-pro"]
    assert fake.calls[-1]["url"] == "https://generativelanguage.googleapis.com/v1beta/openai/models"


def test_gemini_provider_listed_and_configurable(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with TestClient(create_app()) as client:
        client.post("/api/auth/setup", json={"name": "관리자", "email": "a@example.com", "password": "admin-pass-1"})
        gemini = {p["id"]: p for p in client.get("/api/providers").json()}["gemini"]
        assert gemini["configured"] is False and gemini["discover"] is True and gemini["fields"] == ["api_key", "models"]
        client.put("/api/providers/gemini", json={"api_key": "gm-typed-123456789", "models": "gemini-test-flash"})
        gemini = {p["id"]: p for p in client.get("/api/providers").json()}["gemini"]
        assert gemini["configured"] is True and gemini["models"] == ["gemini:gemini-test-flash"]


def test_gemini_list_shaped_error_body(monkeypatch):
    # 실제 Gemini 채팅 엔드포인트는 잘못된 키에 400과 배열 형태 본문을 돌려준다
    def post(url, json=None, headers=None, timeout=None):
        return httpx.Response(400, json=[{"error": {"code": 400, "message": "Please pass a valid API key"}}], request=httpx.Request("POST", url))

    monkeypatch.setattr(openai_compat.httpx, "post", post)
    with pytest.raises(LLMError, match="Gemini API 키가 올바르지 않습니다"):
        openai_compat.complete("gemini-x", LLMRequest(system="s", prompt="p"), {"hosted": GEMINI, "api_key": "bad"})
