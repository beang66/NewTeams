"""모델 공급자 관리(Dify의 '모델 공급자' 화면에 대응).

모델은 "공급자:모델" 문자열로 참조한다. 예) anthropic:claude-opus-5-5, mock:demo
"""

from __future__ import annotations

import os
from typing import Any, Callable

from ..db import Store
from . import anthropic_provider, mock, openai_compat
from .base import LLMError, LLMRequest, LLMResult

ProviderFn = Callable[[str, LLMRequest, dict[str, Any]], LLMResult]

PROVIDERS: dict[str, dict[str, Any]] = {
    "mock": {
        "name": "데모 (오프라인)",
        "description": "API 키 없이 전체 흐름을 시연하는 결정적 응답 모델",
        "fields": [],
        "models": mock.MODELS,
        "fn": mock.complete,
    },
    "anthropic": {
        "name": "Anthropic Claude",
        "description": "Claude Opus / Sonnet / Haiku. 키를 비워 두면 ANTHROPIC_API_KEY 환경 변수를 사용합니다.",
        "fields": ["api_key", "base_url"],
        "models": anthropic_provider.MODELS,
        "fn": anthropic_provider.complete,
    },
    "openai": {
        "name": "OpenAI",
        "description": "OpenAI 공식 API. 키를 비워 두면 OPENAI_API_KEY 환경 변수를 사용합니다. 키를 넣고 ‘모델 불러오기’로 쓸 모델을 고르세요.",
        "fields": ["api_key", "models"],
        "models": [],
        "fn": openai_compat.complete,
        "hosted": {"base_url": "https://api.openai.com/v1", "env_key": "OPENAI_API_KEY", "label": "OpenAI"},
        "discover": True,
    },
    "gemini": {
        "name": "Google Gemini",
        "description": "Gemini API(OpenAI 호환 엔드포인트). 키를 비워 두면 GEMINI_API_KEY 환경 변수를 사용합니다. 키를 넣고 ‘모델 불러오기’로 쓸 모델을 고르세요.",
        "fields": ["api_key", "models"],
        "models": [],
        "fn": openai_compat.complete,
        "hosted": {
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
            "env_key": "GEMINI_API_KEY",
            "label": "Gemini",
        },
        "discover": True,
    },
    "compat": {
        "name": "OpenAI 호환 (로컬·기타)",
        "description": "Ollama, vLLM, LM Studio 등 Chat Completions 호환 서버",
        "fields": ["api_key", "base_url", "models"],
        "models": [],
        "fn": openai_compat.complete,
        "discover": True,
    },
}

MODEL_LIST_PROVIDERS = ("openai", "gemini", "compat")


def _config(store: Store, provider_id: str) -> dict[str, Any]:
    cfg = store.get("providers", provider_id) or {"id": provider_id}
    return {**cfg, "hosted": PROVIDERS[provider_id].get("hosted")}


def provider_models(provider_id: str, config: dict[str, Any]) -> list[str]:
    if provider_id in MODEL_LIST_PROVIDERS:
        return [m.strip() for m in (config.get("models") or "").split(",") if m.strip()]
    return list(PROVIDERS[provider_id]["models"])


def is_configured(provider_id: str, config: dict[str, Any]) -> bool:
    if provider_id == "mock":
        return True
    if provider_id == "anthropic":
        return bool(config.get("api_key") or os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    if PROVIDERS[provider_id].get("hosted"):
        return bool(openai_compat.api_key(config) and provider_models(provider_id, config))
    return bool(config.get("base_url") and provider_models(provider_id, config))


def _env_key(provider_id: str) -> bool:
    name = "ANTHROPIC_API_KEY" if provider_id == "anthropic" else (PROVIDERS[provider_id].get("hosted") or {}).get("env_key")
    return bool(name and os.getenv(name))


def list_providers(store: Store) -> list[dict[str, Any]]:
    out = []
    for pid, spec in PROVIDERS.items():
        cfg = _config(store, pid)
        key = cfg.get("api_key") or ""
        out.append({
            "id": pid,
            "name": spec["name"],
            "description": spec["description"],
            "fields": spec["fields"],
            "discover": bool(spec.get("discover")),
            "configured": is_configured(pid, cfg),
            "models": [f"{pid}:{m}" for m in provider_models(pid, cfg)],
            "config": {
                "base_url": cfg.get("base_url", ""),
                "models": cfg.get("models", ""),
                "api_key_preview": f"{key[:6]}…{key[-4:]}" if len(key) > 12 else ("설정됨" if key else ""),
                "uses_env_key": not key and _env_key(pid),
            },
        })
    return out


def save_provider(store: Store, provider_id: str, values: dict[str, Any]) -> None:
    if provider_id not in PROVIDERS:
        raise LLMError(f"알 수 없는 공급자: {provider_id}")
    cfg = store.get("providers", provider_id) or {"id": provider_id}
    for field in PROVIDERS[provider_id]["fields"]:
        value = values.get(field)
        # 빈 api_key는 '변경 안 함'으로 취급한다.
        if value is None or (field == "api_key" and value == ""):
            continue
        cfg[field] = value
    if values.get("clear_api_key"):
        cfg.pop("api_key", None)
    store.put("providers", cfg)


def split_ref(model_ref: str) -> tuple[str, str]:
    provider_id, _, model = model_ref.partition(":")
    if provider_id not in PROVIDERS or not model:
        raise LLMError(f"모델 참조 형식이 올바르지 않습니다: '{model_ref}' (예: anthropic:claude-opus-5-5)")
    return provider_id, model


def provider_config(store: Store, model_ref: str) -> tuple[str, str, dict[str, Any]]:
    provider_id, model = split_ref(model_ref)
    return provider_id, model, _config(store, provider_id)


def complete(store: Store, model_ref: str, req: LLMRequest) -> LLMResult:
    provider_id, model, cfg = provider_config(store, model_ref)
    fn: ProviderFn = PROVIDERS[provider_id]["fn"]
    return fn(model, req, cfg)


def test_provider(store: Store, model_ref: str) -> dict[str, Any]:
    try:
        res = complete(store, model_ref, LLMRequest(system="연결 테스트입니다.", prompt="'OK'라고만 답하세요."))
        return {"ok": True, "model": res.model, "reply": res.text[:200]}
    except LLMError as e:
        return {"ok": False, "error": str(e)}


def discover_models(store: Store, provider_id: str, overrides: dict[str, Any] | None = None) -> list[str]:
    """저장 전 입력값(overrides)으로도 모델 목록을 확인할 수 있게 한다."""
    if not PROVIDERS.get(provider_id, {}).get("discover"):
        raise LLMError("이 공급자는 모델 목록 불러오기를 지원하지 않습니다.")
    cfg = _config(store, provider_id)
    for key, value in (overrides or {}).items():
        if value:
            cfg[key] = value
    return openai_compat.discover_models(cfg)
