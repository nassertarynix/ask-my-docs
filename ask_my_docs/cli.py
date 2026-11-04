"""Command-line interface: `ingest` a folder, then `ask` questions."""

import argparse
import sys
from pathlib import Path

from . import config
from .embeddings import embed
from .generate import stream_answer
from .ingest import build_index
from .store import VectorStore


def cmd_ingest(args: argparse.Namespace) -> int:
    folder = Path(args.folder)
    print(f"Reading documents from '{folder}' ...")
    store = build_index(folder)
    store.save(config.INDEX_DIR)
    sources = {c.source for c in store.chunks}
    print(f"Indexed {len(store)} chunks from {len(sources)} file(s) into '{config.INDEX_DIR}'.")
    return 0


def cmd_ask(args: argparse.Namespace) -> int:
    store = VectorStore.load(config.INDEX_DIR)
    query_vector = embed([args.question], prefix=config.QUERY_PREFIX)[0]
    hits = store.search(query_vector, k=args.top_k)

    if not args.no_llm:
        print("Answer:")
        for token in stream_answer(args.question, hits):
            print(token, end="", flush=True)
        print("\n")

    print("Sources:")
    for n, hit in enumerate(hits, start=1):
        preview = " ".join(hit.chunk.text.split())[:140]
        print(f"  [{n}] {hit.chunk.source} (chunk {hit.chunk.index}, score {hit.score:.2f})")
        print(f"      {preview}...")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ask_my_docs", description="Ask questions about your own documents."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="Index a folder of .md/.txt files")
    ingest.add_argument("folder", help="Folder containing your documents")
    ingest.set_defaults(func=cmd_ingest)

    ask = sub.add_parser("ask", help="Ask a question about the indexed documents")
    ask.add_argument("question", help="Your question, in quotes")
    ask.add_argument("-k", "--top-k", type=int, default=config.TOP_K,
                     help="How many passages to retrieve (default: %(default)s)")
    ask.add_argument("--no-llm", action="store_true",
                     help="Only show retrieved passages; skip answer generation")
    ask.set_defaults(func=cmd_ask)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (FileNotFoundError, NotADirectoryError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
