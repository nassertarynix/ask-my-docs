# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this folder. Read the monorepo root `CLAUDE.md` too.

**Telegram Movie & Anime Library Bot**: a Telethon bot that indexes videos posted to a private storage channel (from caption metadata) into SQLite
and lets people search and receive them through inline menus. Portfolio project by Al-Nasser Haddad (pronouns not stated: avoid them).
Keep claims honest: it has never run against real Telegram (see README).

## Commands
```bash
pytest -q                          # 236 tests, offline (pip install -r requirements-dev.txt)
python scripts/walkthrough.py      # simulated conversation; rewrites docs/walkthrough.txt
python bot.py                      # needs a real .env (never commit it)
```

## Architecture (see docs/ARCHITECTURE.md)
`parser.py` / `database.py` / `menus.py` are pure or local. `delivery.py` and `bot.py` take an injected client, so tests use `tests/fakes.py`
(real Telethon `Message` and `Document` objects built offline, plus a scripted fake client).

## Rules (each has a test; keep them)
- `PRAGMA foreign_keys = ON` on **every** connection (the pragma in schema.sql only covers the connection that runs it), WAL mode, readers are read-only.
- Indexing is atomic: title and file row in one transaction. A message is matched by (message id, channel); a clash must fail and roll back, never re-point a row.
- De-duplication: title + type + year, case-insensitive, enforced by the unique index `uq_media_identity` as well as in code.
- `yaml.safe_load` only. A broken or hostile YAML block must never become a title; `parse_caption` never raises.
- All user and caption text is `html.escape`d (`menus.esc`) before it is sent with HTML parse mode. Button labels are plain text.
- Callback data: ASCII only (`re.ASCII`), strict shapes, `decode` never raises. Telegram limits: 64 bytes per callback, 100 buttons per message.
- Sending goes through `delivery.send_media_file`: refresh a stale file_id from the channel, store it, fall back to the media object, sleep out flood waits, never retry blocked users.
  A flood wait during the refresh must retry the refresh, not resend the stale id (regression test).
- Search: every word must match the title, genre, a 4-digit year (`\d`, so Arabic-Indic digits work on purpose) or a type word; title matches rank before genre-only matches.
- Access control (`ALLOWED_USER_IDS`, admin-only commands), the per-person cooldown and the double-tap guard are tested; do not weaken them.
- Secrets: `.env`, `*.session` and `*.db` are git-ignored. `Config` masks the hash and token in repr.

## Lessons learned
- **Check your own tests for vacuous assertions** (`or True`, searching for something a query already hides). Two protections passed mutation checks only
  after the tests were made to look at the real rows. Run a mutation pass after adding a guard: switch it off and confirm a test fails.
- **`\d` in Python regexes matches other scripts' digits** (`int("١") == 1`). Use `re.ASCII` wherever a pattern guards forged input.
- **A parser fallback must not read text it already rejected.** The `Key: value` fallback first picked up the line inside a broken YAML block.
- Telethon 1.45 `Button.inline(...)` returns `KeyboardInlineButton` with the data at `.type.data` (older versions: `.data`); tests use a helper for both.
- Bots cannot read history (`GetHistory`) but can read posts by id, which is why `/reindex` scans ids and stops after a gap.
- Only bots can send inline keyboards, so `BOT_TOKEN` is required even though the spec mentions a user session.
- Bot file ids do not carry the file reference, so after a refresh the id usually looks unchanged; the retry then uses the post's media object.
