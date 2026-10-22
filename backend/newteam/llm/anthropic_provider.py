"""Anthropic Claude 공급자. 공식 SDK(anthropic)를 사용한다."""

from __future__ import annotations

from typing import Any

from .base import LLMError, LLMRequest, LLMResult

MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
# 안전 분류기가 요청을 거절하면 서버가 권장 모델로 다시 실행한다.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"}


def _client(config: dict[str, Any]):
    import anthropic

    kwargs: dict[str, Any] = {"max_retries": 2}
    if config.get("api_key"):
        kwargs["api_key"] = config["api_key"]
    if config.get("base_url"):
        kwargs["base_url"] = config["base_url"]
    # 키가 없으면 SDK가 ANTHROPIC_API_KEY 또는 `ant auth login` 프로필을 찾는다.
    return anthropic.Anthropic(**kwargs)


def complete(model: str, req: LLMRequest, config: dict[str, Any]) -> LLMResult:
    import anthropic

    params: dict[str, Any] = {
        "model": model,
        "max_tokens": 16000,
        "system": req.system,
        "messages": [{"role": "user", "content": req.prompt}],
    }
    output_config: dict[str, Any] = {}
    if req.effort:
        output_config["effort"] = req.effort
    if req.json_schema:
        output_config["format"] = {"type": "json_schema", "schema": req.json_schema}
    if output_config:
        params["output_config"] = output_config

    client = _client(config)
    try:
        if model in FALLBACK_MODELS:
            resp = client.beta.messages.create(
                **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
            )
        else:
            resp = client.messages.create(**params)
    except anthropic.AuthenticationError as e:
        raise LLMError("Anthropic API 키가 올바르지 않습니다. 모델 설정에서 키를 확인하세요.") from e
    except anthropic.NotFoundError as e:
        raise LLMError(f"모델 '{model}'을 찾을 수 없습니다.") from e
    except anthropic.RateLimitError as e:
        raise LLMError("Anthropic 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"Anthropic API 오류({e.status_code}): {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError("Anthropic API에 연결하지 못했습니다. 네트워크를 확인하세요.") from e

    if resp.stop_reason == "refusal":
        category = getattr(resp.stop_details, "category", None) if resp.stop_details else None
        raise LLMError(f"모델이 요청을 거절했습니다(분류: {category or '알 수 없음'}).")
    if resp.stop_reason == "max_tokens":
        raise LLMError("모델 응답이 최대 길이에서 잘렸습니다. 단계를 더 작게 나눠 보세요.")

    text = "".join(block.text for block in resp.content if block.type == "text")
    return LLMResult(
        text=text,
        model=resp.model,
        input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
    )
