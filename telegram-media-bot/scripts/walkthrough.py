"""Run the bot's real code against a fake Telegram client and print the conversation, so you can see what a user would see.

    python scripts/walkthrough.py

SIMULATED: there is no network and no Telegram. Messages and files are real Telethon objects built offline, the database is a real
SQLite file in a temporary folder, and every handler is the real one; only the Telegram client is a stand-in.
"""
from __future__ import annotations

import asyncio
import html
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]

from telethon import errors, utils  # noqa: E402

from bot import LibraryBot  # noqa: E402
from config import Config  # noqa: E402
from database import Database  # noqa: E402
from fakes import CHANNEL, FakeClient, make_message  # noqa: E402

CAPTIONS = [
    (101, '---\ntitle: "Dune"\ntype: Movie\nyear: 2021\nresolution: 1080p\ngenres: [Sci-Fi, Adventure]\n---'),
    (102, '---\ntitle: "Dune"\ntype: Movie\nyear: 2021\nresolution: 4K\n---'),
    (103, '---\ntitle: "Attack on Titan"\ntype: Anime\nyear: 2013\nseason: 1\nepisode: 1\nresolution: 1080p\ngenres: [Action, Fantasy]\n---'),
    (104, '---\ntitle: "Attack on Titan"\ntype: Anime\nyear: 2013\nseason: 1\nepisode: 2\nresolution: 1080p\n---'),
    (105, "Title: Attack on Titan\nType: Anime\nYear: 2013\nSeason: 2\nEpisode: 1\nResolution: 720p\n#Action #Fantasy"),
    (106, "just a nice video, no tags"),
]
OUT: list[str] = []


def say(text: str = "") -> None:
    OUT.append(text)
    print(text)


def plain(text: str) -> str:
    return html.unescape(re.sub(r"</?(b|i|code)>", "", text))


def show_menu(reply) -> None:
    say(f"  BOT: {plain(reply.text)}".replace("\n", "\n       "))
    for row in reply.keyboard:
        say("       " + " ".join(f"[{label}]" for label, _ in row))


async def main() -> None:
    folder = Path(tempfile.mkdtemp())
    config = Config(api_id=1, api_hash="x", bot_token="1:x", storage_channel_id=CHANNEL, admin_ids=frozenset({99}), send_cooldown=0)
    db = await Database(folder / "library.db").open()
    client = FakeClient()

    async def no_sleep(_):
        return None

    bot = LibraryBot(client, db, config, sleep=no_sleep)
    say("SIMULATED walkthrough: real bot code, fake Telegram client. No network.\n")
    say("== Posts arrive in the storage channel ==")
    for mid, caption in CAPTIONS:
        message = make_message(mid, caption)
        client.messages[(CHANNEL, mid)] = message
        out = await bot.ingest_message(message)
        first = caption.replace("\n", " | ")[:70]
        say(f"  post {mid}: {first}...  ->  {out.status}{(' (' + out.reason + ')') if out.reason else ''}")
    for admin, note in client.dms:
        say(f"  (admin {admin} is told: {note})")
    say(f"  library now: {await db.stats()}\n")

    async def tap(reply, label_part: str):
        for row in reply.keyboard:
            for label, data in row:
                if label_part in label:
                    say(f"\nUSER taps [{label}]")
                    return await bot.route_callback(1, data)
        raise SystemExit(f"no button containing {label_part!r}")

    say("== A user searches ==")
    say("USER: titan attack")
    results = await bot.command_reply(1, "titan attack")
    show_menu(results)
    seasons = (await tap(results, "Attack on Titan")).edit
    show_menu(seasons)
    episodes = (await tap(seasons, "Season 1")).edit
    show_menu(episodes)
    sent = (await tap(episodes, "E2")).send
    problem = await bot.deliver(1, 1, sent)
    sid = client.sent[-1][1]
    say(f"  BOT sends a video (file_id {sid[:14]}...) with caption: {plain(client.sent[-1][2])}" if not problem else f"  BOT: {problem}")

    say("\n== A movie in two qualities ==")
    say("USER: dune")
    results = await bot.command_reply(1, "dune")
    menu = (await tap(results, "Dune")).edit
    show_menu(menu)
    sent = (await tap(menu, "4K")).send
    await bot.deliver(1, 1, sent)
    say(f"  BOT sends a video with caption: {plain(client.sent[-1][2])}")

    say("\n== Telegram invalidates the stored file reference ==")
    client.send_script = [errors.FileReferenceExpiredError(request=None)]
    before = (await db.get_file(sent["id"]))["telegram_file_id"]
    await bot.deliver(1, 1, sent)
    after = (await db.get_file(sent["id"]))["telegram_file_id"]
    say("  send_file failed with FileReferenceExpiredError")
    say(f"  bot fetched message {sent['telegram_message_id']} from the storage channel (get_messages calls: {client.fetch_calls[-1:]})")
    retry = client.sent[-1][1]
    say(f"  stored file_id unchanged: {before == after} (Telegram's bot file ids do not carry the file reference, so the id looks the same)")
    say(f"  so the retry used the post's media object ({type(retry).__name__}), which carries a fresh reference")
    say(f"  the user still received the file: {client.sent[-1][2] is not None}")

    say("\n== The post is deleted from the channel ==")
    await bot.handle_deleted(CHANNEL, [102])
    say("USER: dune")
    show_menu(await bot.command_reply(1, "dune"))
    say(f"  the 4K file is gone; the title remains with its other file. library: {await db.stats()}")
    await db.close()
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "walkthrough.txt").write_text("\n".join(OUT) + "\n", encoding="utf-8")


asyncio.run(main())
