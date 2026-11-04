"""Command-line interface: `ingest` a folder, then `ask` questions."""

import argparse
import sys
from pathlib import Path

from . import config
from .generate import stream_answer
from .ingest import build_index
from .rag import retrieve
from .store import VectorStore


def cmd_ingest(args: argparse.Namespace) -> int:
    folder = Path(args.folder)
    print(f"Reading documents from '{folder}' ...")
    store = build_index(folder, on_warning=lambda message: print(f"Warning: {message}", file=sys.stderr))
    store.save(config.INDEX_DIR)
    sources = {c.source for c in store.chunks}
    print(f"Indexed {len(store)} chunks from {len(sources)} file(s) into '{config.INDEX_DIR}'.")
    return 0


def cmd_ask(args: argparse.Namespace) -> int:
    store = VectorStore.load(config.INDEX_DIR)
    hits = retrieve(store, args.question, k=args.top_k)

    if not args.no_llm:
        print("Answer:")
        for token in stream_answer(args.question, hits):
            print(token, end="", flush=True)
        print("\n")

    print("Sources:")
    for n, hit in enumerate(hits, start=1):
        preview = " ".join(hit.chunk.text.split())[:140]
        page = f", page {hit.chunk.page}" if hit.chunk.page else ""
        print(f"  [{n}] {hit.chunk.source} (chunk {hit.chunk.index}{page}, score {hit.score:.2f})")
        print(f"      {preview}...")
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    from . import evaluate  # local import keeps `ask` start-up light

    store = VectorStore.load(config.INDEX_DIR)
    cases = evaluate.load_cases(Path(args.cases))
    answer_fn = None if args.retrieval_only else stream_answer
    mode = "retrieval only" if args.retrieval_only else "retrieval + answers (slow on CPU)"
    print(f"Evaluating {len(cases)} cases against '{config.INDEX_DIR}': {mode}\n")
    results = evaluate.run_evaluation(store, cases, k=args.top_k, answer_fn=answer_fn)
    print(evaluate.format_report(results, k=args.top_k))
    return 0 if evaluate.all_passed(results, args.top_k) else 1


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn  # imported here so `ingest` and `ask` work without web extras

    from .web import create_app

    print(f"Serving Ask My Docs at http://{args.host}:{args.port}  (Ctrl+C to stop)")
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="warning")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ask_my_docs", description="Ask questions about your own documents."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="Index a folder of .md, .txt and .pdf files")
    ingest.add_argument("folder", help="Folder containing your documents")
    ingest.set_defaults(func=cmd_ingest)

    ask = sub.add_parser("ask", help="Ask a question about the indexed documents")
    ask.add_argument("question", help="Your question, in quotes")
    ask.add_argument("-k", "--top-k", type=int, default=config.TOP_K,
                     help="How many passages to retrieve (default: %(default)s)")
    ask.add_argument("--no-llm", action="store_true",
                     help="Only show retrieved passages; skip answer generation")
    ask.set_defaults(func=cmd_ask)

    evaluate = sub.add_parser("evaluate", help="Score retrieval and answers on a question file")
    evaluate.add_argument("cases", help="JSON file of test questions (see evals/)")
    evaluate.add_argument("-k", "--top-k", type=int, default=config.TOP_K,
                          help="Passages retrieved per question (default: %(default)s)")
    evaluate.add_argument("--retrieval-only", action="store_true",
                          help="Skip answer generation: fast, needs no chat model")
    evaluate.set_defaults(func=cmd_evaluate)

    serve = sub.add_parser("serve", help="Start the web interface")
    serve.add_argument("--host", default="127.0.0.1",
                       help="Address to bind (default: %(default)s; local only)")
    serve.add_argument("--port", type=int, default=8000,
                       help="Port to listen on (default: %(default)s)")
    serve.set_defaults(func=cmd_serve)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (FileNotFoundError, NotADirectoryError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
