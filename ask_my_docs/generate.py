"""Build the grounded prompt and stream the model's answer."""

from collections.abc import Iterator

from openai import OpenAI

from . import config
from .store import Hit

# Small local models follow short, explicit rules best. Two lessons from testing
# a 3B model: without "never reply with only a citation" it sometimes answered
# just "[1]", and labelling passages like the citation format ("[1] (...)")
# made it copy the label instead of answering.
SYSTEM_PROMPT = (
    "You answer questions using ONLY the numbered passages provided.\n"
    "Rules:\n"
    "- Write a direct answer in complete sentences, then cite the passages you "
    "used in square brackets right after the facts, like [1] or [1][3].\n"
    "- Never reply with only a citation, and never repeat the passage labels.\n"
    "- Do not use outside knowledge and do not guess.\n"
    "- If the passages do not contain the answer, reply exactly: "
    "I don't know based on the provided documents."
)


def build_messages(question: str, hits: list[Hit]) -> list[dict[str, str]]:
    def label(hit: Hit) -> str:
        chunk = hit.chunk
        return f"{chunk.title} - {chunk.source}" if chunk.title else chunk.source

    passages = "\n\n".join(
        f"Passage {n} ({label(hit)}):\n{hit.chunk.text}"
        for n, hit in enumerate(hits, start=1)
    )
    user = (
        f"{passages}\n\nQuestion: {question}\n\n"
        "Answer in complete sentences and cite passages like [1]."
    )
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
        temperature=config.TEMPERATURE,
        stream=True,
    )
    for event in stream:
        if event.choices and event.choices[0].delta.content:
            yield event.choices[0].delta.content
