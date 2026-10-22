"""OpenAI 형식 Chat Completions: 호스팅 API(OpenAI, Gemini 호환 엔드포인트)와 직접 지정한 서버(Ollama, vLLM 등).

호스팅 API는 config["hosted"]에 고정 주소·키 환경 변수·표시 이름이 들어온다(registry.PROVIDERS 참고).
"""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

from .base import LLMError, LLMRequest, LLMResult

OPENAI_BASE_URL = "https://api.openai.com/v1"

# /v1/models 결과 중 채팅에 쓸 수 없는 모델(임베딩·음성·이미지 등)은 목록에서 뺀다.
NON_CHAT = re.compile(r"embedding|whisper|tts|dall-e|image|imagen|veo|aqa|audio|realtime|transcribe|moderation|search|babbage|davinci|sora|computer-use", re.I)


def _hosted(config: dict[str, Any]) -> dict[str, str] | None:
    return config.get("hosted")


def api_key(config: dict[str, Any]) -> str:
    if config.get("api_key"):
        return config["api_key"]
    hosted = _hosted(config)
    return os.getenv(hosted["env_key"], "") if hosted else ""


def base_url(config: dict[str, Any]) -> str:
    if hosted := _hosted(config):
        return hosted["base_url"]
    return (config.get("base_url") or OPENAI_BASE_URL).rstrip("/")


def _headers(config: dict[str, Any]) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if key := api_key(config):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _error(resp: httpx.Response, config: dict[str, Any], model: str = "") -> LLMError:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if isinstance(body, list):  # Gemini는 오류를 [{"error": …}] 배열로 감싸서 줄 때가 있다
        body = body[0] if body else {}
    error = body.get("error") if isinstance(body, dict) else None
    detail = (error.get("message", "") if isinstance(error, dict) else "") or resp.text[:300]
    name = hosted["label"] if (hosted := _hosted(config)) else "모델 서버"
    # Gemini는 잘못된 키에 401 대신 400을 준다
    if resp.status_code == 401 or (resp.status_code == 400 and "api key" in detail.lower()):
        return LLMError(f"{name} API 키가 올바르지 않습니다. 모델 설정에서 키를 확인하세요.")
    if resp.status_code == 404 and model:
        return LLMError(f"모델 '{model}'을 찾을 수 없거나 이 키로 사용할 수 없습니다.")
    if resp.status_code == 429:
        return LLMError(f"{name} 요청 한도 또는 사용 가능 금액을 초과했습니다. 잠시 후 다시 시도하거나 결제 설정을 확인하세요. ({detail})")
    return LLMError(f"{name} API 오류({resp.status_code}): {detail}")


def complete(model: str, req: LLMRequest, config: dict[str, Any]) -> LLMResult:
    system = req.system
    body: dict[str, Any] = {"model": model}
    if req.json_schema:
        if _hosted(config):
            # OpenAI와 Gemini 호환 엔드포인트는 스키마를 강제하는 structured outputs를 지원한다.
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": f"{req.purpose}_output", "schema": req.json_schema, "strict": True},
            }
        else:
            system += "\n\n반드시 JSON 객체 하나만 출력하세요."
            body["response_format"] = {"type": "json_object"}
    body["messages"] = [{"role": "system", "content": system}, {"role": "user", "content": req.prompt}]
    url = base_url(config)
    try:
        resp = httpx.post(f"{url}/chat/completions", json=body, headers=_headers(config), timeout=300)
    except httpx.HTTPError as e:
        raise LLMError(f"{url}에 연결하지 못했습니다: {e}") from e
    if resp.status_code >= 400:
        raise _error(resp, config, model)
    data = resp.json()
    choice = data["choices"][0]
    message = choice.get("message") or {}
    if message.get("refusal"):
        raise LLMError(f"모델이 요청을 거절했습니다: {message['refusal']}")
    if choice.get("finish_reason") == "length":
        raise LLMError("모델 응답이 최대 길이에서 잘렸습니다. 단계를 더 작게 나눠 보세요.")
    usage = data.get("usage") or {}
    return LLMResult(
        text=message.get("content") or "",
        model=data.get("model", model),
        input_tokens=usage.get("prompt_tokens", 0),
        output_tokens=usage.get("completion_tokens", 0),
    )


def discover_models(config: dict[str, Any]) -> list[str]:
    """키로 실제 사용할 수 있는 모델 목록을 가져온다."""
    url = base_url(config)
    try:
        resp = httpx.get(f"{url}/models", headers=_headers(config), timeout=30)
    except httpx.HTTPError as e:
        raise LLMError(f"{url}에 연결하지 못했습니다: {e}") from e
    if resp.status_code >= 400:
        raise _error(resp, config)
    # Gemini는 "models/gemini-…" 형태로 줄 수 있어 채팅 요청에 쓰는 짧은 이름으로 맞춘다.
    ids = sorted({m["id"].removeprefix("models/") for m in resp.json().get("data", []) if m.get("id")})
    if _hosted(config):
        ids = [i for i in ids if not NON_CHAT.search(i)]
    return ids
