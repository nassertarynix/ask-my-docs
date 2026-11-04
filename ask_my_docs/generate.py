"""Build the grounded prompt and stream the model's answer."""

from collections.abc import Iterator

from openai import OpenAI

from . import config
from .store import Hit

SYSTEM_PROMPT = (
    "You answer questions using ONLY the numbered context passages provided. "
    "Cite the passages you used like [1] or [2]. "
    "If the passages do not contain the answer, reply exactly: "
    "\"I don't know based on the provided documents.\" "
    "Do not use outside knowledge and do not guess."
)


def build_messages(question: str, hits: list[Hit]) -> list[dict[str, str]]:
    def label(hit: Hit) -> str:
        chunk = hit.chunk
        return f"{chunk.title}; source: {chunk.source}" if chunk.title else f"source: {chunk.source}"

    context = "\n\n".join(
        f"[{n}] ({label(hit)})\n{hit.chunk.text}" for n, hit in enumerate(hits, start=1)
    )
    user = f"Context passages:\n\n{context}\n\nQuestion: {question}"
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def stream_answer(question: str, hits: list[Hit]) -> Iterator[str]:
    """Yield the answer token by token so the CLI can print as it arrives."""
    client = OpenAI(base_url=config.BASE_URL, api_key=config.API_KEY)
    stream = client.chat.completions.create(
        model=config.CHAT_MODEL,
        messages=build_messages(question, hits),
        temperature=0.1,
        stream=True,
    )
    for event in stream:
        if event.choices and event.choices[0].delta.content:
            yield event.choices[0].delta.content
