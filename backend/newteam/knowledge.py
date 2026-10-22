"""지식 베이스: 문서 분할과 BM25 검색(Dify의 '지식' 기능에 대응).

외부 임베딩 서비스 없이 동작하도록 BM25를 쓴다. 한국어는 형태소 분석 대신
2글자 단위(bigram)를 함께 색인해 조사가 붙은 단어도 찾을 수 있게 한다.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from html.parser import HTMLParser
from typing import Any

from .db import Store, new_id

WORD = re.compile(r"[0-9A-Za-z]+|[가-힣]+")


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for word in WORD.findall(text.lower()):
        if re.fullmatch(r"[가-힣]+", word) and len(word) > 2:
            tokens.extend(word[i : i + 2] for i in range(len(word) - 1))
        tokens.append(word)
    return tokens


def chunk_text(text: str, size: int = 600, overlap: int = 100) -> list[str]:
    """문단 경계를 우선으로 size 글자 안팎의 조각으로 나눈다."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        while len(para) > size:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(para[:size])
            para = para[size - overlap :]
        if len(current) + len(para) + 2 > size and current:
            chunks.append(current)
            tail = current[-overlap:] if overlap else ""
            current = f"{tail}\n\n{para}" if tail else para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.title = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in self.SKIP:
            self._skip += 1
        if tag == "title":
            self._in_title = True
        if tag in ("p", "div", "br", "li", "h1", "h2", "h3", "h4", "tr", "section", "article"):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data.strip()
        elif not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> tuple[str, str]:
    parser = _TextExtractor()
    parser.feed(html)
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return parser.title, text.strip()


def extract_text(filename: str, raw: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        try:
            from pypdf import PdfReader  # 선택 의존성
        except ImportError as e:
            raise ValueError("PDF를 읽으려면 `pip install pypdf`가 필요합니다.") from e
        import io

        return "\n\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(raw)).pages)
    text = raw.decode("utf-8", errors="replace")
    if name.endswith((".html", ".htm")):
        return html_to_text(text)[1]
    return text


# ---- 저장소 연동 ----

def add_document(store: Store, kb_id: str, name: str, text: str) -> dict[str, Any]:
    chunks = chunk_text(text)
    doc = {
        "id": new_id("doc"),
        "kb_id": kb_id,
        "name": name,
        "chars": len(text),
        "chunks": chunks,
    }
    return store.put("documents", doc)


def search(store: Store, kb_ids: list[str], query: str, top_k: int = 5) -> list[dict[str, Any]]:
    entries: list[tuple[dict[str, Any], int, str]] = []
    for kb_id in kb_ids:
        for doc in store.list("documents", kb_id=kb_id):
            entries.extend((doc, i, chunk) for i, chunk in enumerate(doc["chunks"]))
    if not entries:
        return []
    tokenized = [tokenize(chunk) for _, _, chunk in entries]
    n = len(tokenized)
    avgdl = sum(len(t) for t in tokenized) / n or 1
    df: Counter[str] = Counter()
    for toks in tokenized:
        df.update(set(toks))
    k1, b = 1.5, 0.75
    q_terms = set(tokenize(query))
    scored = []
    for (doc, idx, chunk), toks in zip(entries, tokenized):
        tf = Counter(toks)
        score = 0.0
        for term in q_terms:
            if term not in tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf[term] * (k1 + 1) / (tf[term] + k1 * (1 - b + b * len(toks) / avgdl))
        if score > 0:
            scored.append({
                "kb_id": doc["kb_id"],
                "document_id": doc["id"],
                "document": doc["name"],
                "chunk": idx,
                "score": round(score, 3),
                "text": chunk,
            })
    scored.sort(key=lambda h: h["score"], reverse=True)
    return scored[:top_k]
