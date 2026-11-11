"""Fill a running backend with demo folders and files through its real API (used for screenshots and the demo video).

    python scripts/seed_demo.py --url http://127.0.0.1:8765 --token <token>

The file contents are random bytes with realistic names and sizes; they are not real documents.
"""
from __future__ import annotations

import argparse
import os
import random

import httpx

TREE = {
    "Documents": {"Contracts": [("Lease agreement 2026.pdf", 2.4), ("NDA - Orbit Labs.pdf", 0.6)], "Invoices": [("INV-2026-0042.pdf", 0.3), ("INV-2026-0043.pdf", 0.3)],
                  "_files": [("Quarterly report Q3.pdf", 5.2), ("Budget 2027.xlsx", 1.1), ("Meeting notes.txt", 0.02)]},
    "Photos": {"Holiday 2026": [(f"IMG_{n:04d}.jpg", 3.1) for n in (2201, 2202, 2203, 2204)], "_files": [("Profile picture.png", 0.8)]},
    "Backups": {"_files": [("laptop-backup-2026-10.tar.gz", 46.0), ("notes-vault.zip", 12.5)]},
    "Videos": {"_files": [("Conference talk.mp4", 64.0), ("Screen recording.mkv", 31.0)]},
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    rng = random.Random(7)
    client = httpx.Client(base_url=args.url, headers={"X-TGCS-Token": args.token}, timeout=120)

    def folder(name: str, parent: int | None) -> int:
        return client.post("/api/folders", json={"name": name, "parent_id": parent}).raise_for_status().json()["id"]

    def upload(name: str, mb: float, parent: int | None) -> None:
        params = {"name": name, **({"folder_id": parent} if parent else {})}
        client.post("/api/upload", params=params, content=rng.randbytes(int(mb * 1024 * 1024))).raise_for_status()

    for top, body in TREE.items():
        top_id = folder(top, None)
        for name, mb in body.get("_files", []):
            upload(name, mb, top_id)
        for sub, files in body.items():
            if sub == "_files":
                continue
            sub_id = folder(sub, top_id)
            for name, mb in files:
                upload(name, mb, sub_id)
    for name, mb in [("README.txt", 0.004), ("Passport scan.pdf", 1.9)]:
        upload(name, mb, None)
    print("seeded:", client.get("/api/status").json()["stats"])


if __name__ == "__main__":
    main()
