"""브라우저 작업 모듈 — browser-use 연결 지점.

browser-use가 설치되어 있고 실제 모델(Anthropic/OpenAI 호환)이 선택되면
browser-use 에이전트가 브라우저를 직접 조작한다. 그렇지 않으면 HTTP로 페이지
본문만 가져오는 '읽기 전용' 모드로 동작한다.

    pip install browser-use && playwright install chromium
"""

from __future__ import annotations

import asyncio
import importlib.util
from typing import Any

from . import web


def browser_use_available() -> bool:
    return importlib.util.find_spec("browser_use") is not None


def _browser_use_llm(provider_id: str, model: str, config: dict[str, Any]):
    if provider_id == "anthropic":
        from browser_use import ChatAnthropic

        kwargs: dict[str, Any] = {"model": model}
        if config.get("api_key"):
            kwargs["api_key"] = config["api_key"]
        return ChatAnthropic(**kwargs)
    if provider_id in ("openai", "gemini", "compat"):
        from browser_use import ChatOpenAI

        from ..llm.openai_compat import api_key, base_url

        kwargs = {"model": model}
        if key := api_key(config):
            kwargs["api_key"] = key
        if provider_id != "openai":  # Gemini·호환 서버는 OpenAI 형식 엔드포인트 주소를 지정한다
            kwargs["base_url"] = base_url(config)
        return ChatOpenAI(**kwargs)
    return None


def run_task(task: str, start_url: str | None, provider_id: str, model: str, config: dict[str, Any]) -> dict[str, Any]:
    url = start_url or next(iter(web.find_urls(task)), None)
    if not browser_use_available():
        fallback_note = "browser-use 미설치: 읽기 전용(HTTP) 모드로 동작합니다."
    elif (llm := _browser_use_llm(provider_id, model, config)) is None:
        fallback_note = "데모 모델에서는 browser-use를 쓰지 않고 읽기 전용 모드로 동작합니다."
    else:
        try:
            return _run_browser_use(task, url, llm)
        except Exception as e:  # browser-use 실패 시 읽기 전용 모드로 대체
            fallback_note = f"browser-use 실행 실패로 읽기 전용 모드로 전환: {e}"

    if not url:
        return {"mode": "fetch", "error": "열어 볼 URL이 없습니다. 목표나 단계 입력에 URL을 포함하세요.", "note": fallback_note}
    page = web.fetch(url)
    page.update({"mode": "fetch", "note": fallback_note, "actions": [f"GET {url}"]})
    return page


def _run_browser_use(task: str, url: str | None, llm: Any) -> dict[str, Any]:
    from browser_use import Agent

    instruction = task if not url or url in task else f"{task}\n시작 페이지: {url}"

    async def go():
        agent = Agent(task=instruction, llm=llm)
        return await agent.run()

    history = asyncio.run(go())
    final = history.final_result() or ""
    urls = [u for u in (history.urls() if hasattr(history, "urls") else []) if u]
    return {
        "mode": "browser-use",
        "url": urls[-1] if urls else (url or ""),
        "title": "",
        "text": final,
        "actions": urls,
    }
