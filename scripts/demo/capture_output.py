"""Run the real commands shown in the terminal demo and save their output as JSON.

Usage: python scripts/demo/capture_output.py captured.json
Needs Ollama running with the models pulled and the project's dependencies installed.
Commands run in a temporary folder so the output shows the default relative index path.
"""
import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "captured.json")
PY = sys.executable
WORK = Path(tempfile.mkdtemp(prefix="demo_cwd_"))
shutil.copytree(REPO / "portfolio_docs", WORK / "portfolio_docs")
shutil.copytree(REPO / "evals", WORK / "evals")
env = dict(os.environ, PYTHONPATH=str(REPO))
steps = [
 ("python -m ask_my_docs ingest portfolio_docs", ["-m","ask_my_docs","ingest","portfolio_docs"], str(WORK), "ingest"),
 ('python -m ask_my_docs ask "Which state management does Jobly use?"', ["-m","ask_my_docs","ask","Which state management does Jobly use?"], str(WORK), "ask"),
 ('python -m ask_my_docs ask "What was his role in Tayar Shop?" --no-llm', ["-m","ask_my_docs","ask","What was his role in Tayar Shop?","--no-llm"], str(WORK), "plain"),
 ('python -m ask_my_docs ask "Does Al-Nasser know Rust?"', ["-m","ask_my_docs","ask","Does Al-Nasser know Rust?"], str(WORK), "ask"),
 ("python -m ask_my_docs evaluate evals/portfolio.json --retrieval-only", ["-m","ask_my_docs","evaluate","evals/portfolio.json","--retrieval-only"], str(WORK), "plain"),
 ("python -m pytest -q", ["-m","pytest","-q"], str(REPO), "plain"),
]
out = []
for shown, args, cwd, kind in steps:
    t = time.time()
    r = subprocess.run([PY] + args, cwd=cwd, env=env, capture_output=True, text=True)
    text = (r.stdout + r.stderr).rstrip("\n")
    print(f"{shown}\n   exit={r.returncode} {time.time()-t:.1f}s {len(text.splitlines())} lines", flush=True)
    out.append({"cmd": shown, "kind": kind, "output": text, "exit": r.returncode})
json.dump(out, open(OUT, "w"), indent=1)
