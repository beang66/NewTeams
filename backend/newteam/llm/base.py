from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any


class LLMError(RuntimeError):
    """모델 호출 실패. message는 화면에 그대로 보여줄 수 있는 문장이어야 한다."""


@dataclass
class LLMRequest:
    system: str
    prompt: str
    # 데모 공급자가 어떤 응답을 만들지 고르는 힌트. 실제 모델은 system/prompt만 본다.
    purpose: str = "step"
    context: dict[str, Any] = field(default_factory=dict)
    json_schema: dict[str, Any] | None = None
    effort: str | None = None


@dataclass
class LLMResult:
    text: str
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0

    def json(self) -> Any:
        return parse_json(self.text)


def parse_json(text: str) -> Any:
    """모델 출력에서 JSON 본문을 꺼낸다. 코드 블록이나 앞뒤 설명문이 붙어 있어도 처리한다."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass
    start = min((i for i in (text.find("{"), text.find("[")) if i >= 0), default=-1)
    if start >= 0:
        closer = "}" if text[start] == "{" else "]"
        end = text.rfind(closer)
        if end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    raise LLMError("모델 응답을 JSON으로 해석하지 못했습니다.")


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 3)
