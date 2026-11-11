# Telegram Movie & Anime Library Bot

A self-hosted Telegram bot that turns a **private storage channel** into a searchable media library. Post videos to the channel with a
small metadata caption; the bot indexes them into SQLite; people message the bot, search by title, pick a season and episode from inline
buttons, and receive the video instantly. Built on **Telethon** (MTProto), so files up to 2 GB are fine.

```
 you post a video + caption  ->  bot parses the caption  ->  SQLite (titles + files)
 a user types "titan attack" ->  inline menus: title -> season -> episode -> quality  ->  video delivered
```

A simulated conversation using the real code is in [`docs/walkthrough.txt`](docs/walkthrough.txt) (see "What has and has not been verified").

> **Use it only for media you have the right to share, and keep it private.** Set `ALLOWED_USER_IDS` so that only people you choose can use the bot.

## How it works

- **Ingestion.** The bot is an administrator of your storage channel. Every new video (or video sent as a document) is parsed, and its title, season,
  episode and quality are stored together with the Telegram `file_id`, the `message_id` and the `channel_id`. Edited captions update the entry; deleted posts remove it.
- **Search.** Any plain message, or `/search attack titan`, finds titles containing every word, in any order and case (also for non-Latin scripts).
- **Menus.** Movie: sent straight away (a choice of quality if there are several files). Anime or show: seasons, then an episode grid (paged for long series), then a quality if needed.
- **Stale `file_id`s.** If Telegram rejects a stored `file_id` or file reference, the bot fetches the post from the storage channel by `message_id`, stores the fresh id and retries. If the post is gone, the entry is removed and the admins are told.
- **Flood limits.** `FLOOD_WAIT_X` is waited out (up to 5 minutes; longer is reported to the user), brief network errors are retried with backoff, and each person can request one file every 2 seconds.

## Setup

You need Python 3.10 or newer.

### 1. Get a Telegram `api_id` and `api_hash`

1. Open <https://my.telegram.org> and sign in with your phone number.
2. Choose **API development tools** and create an application (any name; platform "Other").
3. Copy the **App api_id** (a number) and **App api_hash** (32 characters). Keep them secret.

### 2. Create the bot

1. In Telegram open **@BotFather**, send `/newbot`, and follow the questions.
2. Copy the **token** (looks like `123456789:AA...`).

A bot token is required. A user account could index the channel, but only bots can show the inline buttons.

### 3. Create the storage channel and add the bot

1. Create a **private channel** and post one video to it.
2. Channel settings, **Administrators**, **Add administrator**, choose your bot (the default rights are enough).
3. Get the channel id. Open a post's link in a browser: a private channel post link looks like `https://t.me/c/1234567890/5`. The id is `-100` followed by that number: `-1001234567890`.

### 4. Configure

```bash
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                       # then edit .env
```

`.env`:

| Setting | Meaning |
| --- | --- |
| `API_ID`, `API_HASH` | from step 1 |
| `BOT_TOKEN` | from step 2 |
| `STORAGE_CHANNEL_ID` | from step 3, starts with `-100` |
| `ALLOWED_USER_IDS` | optional, comma-separated user ids that may use the bot (empty: anyone who finds it). Get an id from @userinfobot |
| `ADMIN_IDS` | optional, user ids that may use `/stats` and `/reindex` and are told about problems |
| `DB_PATH`, `SESSION_NAME` | optional, default `library.db` and `media_bot` |

### 5. Initialise the database and run

The database is created from `schema.sql` automatically the first time the bot starts (it is safe to run again: every statement is `IF NOT EXISTS`). To create it by hand instead:

```bash
sqlite3 library.db < schema.sql
```

Start the bot:

```bash
python bot.py
```

Open the bot in Telegram, press **Start**, and send a title. To index videos that were already in the channel, send `/reindex` as an administrator.

**If the bot says it cannot reach the channel:** make sure it is an administrator and the id starts with `-100`, then post anything in the channel once (a bot learns a channel when an update from it arrives).

## Captions

Post each video with a caption in one of these forms.

**YAML block (recommended):**

```
---
title: "Attack on Titan"
type: Anime            # Movie, Anime or Show (tv and series also work)
year: 2013
season: 1
episode: 1
resolution: 1080p      # 720p, 1080p, 4K... free text, so "1080p Dub" works for another audio track
genres: [Action, Fantasy]
---
```

**Plain lines:**

```
Title: Attack on Titan
Type: Anime
Year: 2013
Season: 1
Episode: 1
Resolution: 1080p
#Action #Fantasy
```

Rules the parser follows:

- **A title is required.** A post without one is skipped, and the administrators get a message saying which post to fix. Edit the post's caption and it is indexed.
- Values are checked: a year outside 1880 to next-five-years, a negative or non-numeric season or episode, or an unknown type is ignored rather than stored wrongly.
- A missing `type` is guessed (Show if there is a season or episode, otherwise Movie, never Anime) and logged. An episode without a season goes in season 1. A movie never has a season.
- The same title, type and year is one entry (case-insensitive), so many episodes and qualities attach to it. "Dune" 1984 and "Dune" 2021 stay separate.
- Two posts of the same file are detected and stored once.

## Commands

| Command | Who | What |
| --- | --- | --- |
| a plain message, or `/search words` | allowed users | search titles |
| `/start`, `/help` | allowed users | short help |
| `/stats` | admins | number of titles and files |
| `/reindex [first_id] [last_id]` | admins | read the channel's posts by id and index them; stops after 300 empty ids in a row |

## Files

```
bot.py        Telethon handlers and menus wiring (LibraryBot), start-up
parser.py     caption parsing and validation
database.py   SQLite pool and queries
delivery.py   sending a file, the file_id refresh fallback, flood-wait handling
menus.py      inline keyboards and callback codes (pure functions)
config.py     settings from .env
schema.sql    the database definition
tests/        226 tests, no network     scripts/walkthrough.py   a simulated conversation
```

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tests

```bash
pip install -r requirements-dev.txt
pytest -q          # 226 tests, no Telegram account or network needed
python scripts/walkthrough.py
```

| Area | Tests | Covers |
| --- | --- | --- |
| `parser.py` | 66 | the specification's example, fenced and legacy captions, normalisation of types/resolutions/years/seasons, broken or hostile YAML, 800 random inputs never raise |
| `database.py` | 39 | foreign keys on every connection, schema as specified, de-duplication rules, edits, deletes with cascade, Unicode and wildcard-safe search, ranking, paging, concurrency |
| `menus.py` | 39 | callback codes round-trip and reject forged input, 64-byte and 100-button limits, HTML escaping |
| `delivery.py` | 27 | stale file id refresh and its fallbacks, deleted posts, flood waits (including during the refresh), blocked users, channel errors, network backoff |
| `bot.py` | 44 | ingestion from real Telethon message objects, edits, deletions, reindex, commands, access control, the full menu walk, throttling, Telethon handler wiring |
| `config.py` | 11 | validation messages, secrets masked |

Each protection (foreign keys, WAL, de-duplication, safe YAML, escaping, access control, the cooldown, the file-id refresh, the flood-wait sleep...) was switched off in turn to check that a test fails. That found two tests that passed anyway; both were fixed.

## What has and has not been verified

- **The bot has never been connected to real Telegram.** There were no credentials in the build environment. Everything runs against a fake client; messages and files are real Telethon objects built offline (so `file_id` packing, `message.video` and `chat_id` are real).
- Behaviour that this design relies on, and that I could not confirm against the live service: that Telethon's `send_file` accepts the Bot-API-style `file_id` it generates (it is documented to); that a bot administrator receives channel post, edit and delete updates (documented); that a bot may read posts by id with `get_messages` (it may; it may not read history, which is why `/reindex` scans ids); and how quickly a bot learns a channel it has never seen (see the note above). Expect small fixes on first contact.
- `docs/walkthrough.txt` is **simulated**: the real handlers, a fake Telegram.

## Where this differs from the original specification

- `pyyaml` is added to `requirements.txt` (the specified `parser.py` imports `yaml`).
- `parse_caption` returns the database's field names with cleaned, range-checked values (the specified version returned raw YAML keys such as `year` and `genres`, which do not match the columns).
- `schema.sql` is the specified schema plus one unique index on title, type and year, so de-duplication is enforced by the database. `PRAGMA foreign_keys` is also set on **every** connection, because the pragma in `schema.sql` only affects the connection that runs it.
- `telegram_file_id` is Telethon's `pack_bot_file_id(media)`, the Bot-API-style string.
- Database access uses the standard library `sqlite3` in worker threads (as specified), with a small pool.
- Added: caption edits and deletions, `/reindex`, `/stats`, an allow-list, per-person send throttling, a quality step, paged results and episode lists.

## Limitations

- Titles are searched by words in the title only (not genre, year or description).
- No audio-language column in the schema: put it in the resolution text (`1080p Dub`).
- `telegram_message_id` is unique on its own in the specified schema, so the library supports one storage channel.
- Search memory (for the Next and Back buttons) is in RAM: after a restart an old button says the search expired.
- Whether sharing a given video is allowed is your responsibility.

## Licence

MIT. See [LICENSE](LICENSE).
