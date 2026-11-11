# Architecture

```
storage channel (private, bot is admin)                      people (private chats)
        | new post / edit / delete                                  | text, /search, button presses
        v                                                           v
   LibraryBot.ingest_message / handle_deleted         LibraryBot.command_reply / route_callback
        |   parser.parse_caption -> complete_metadata            |  menus.* (pure: text + keyboard data)
        v                                                           v
   database.Database  (SQLite: media, media_files)  <---- queries ----+
                                                                    |
                                          LibraryBot.deliver -> delivery.send_media_file -> client.send_file
```

## Modules

| Module | Role | Touches Telegram? |
| --- | --- | --- |
| `parser.py` | caption text to clean metadata; never raises | no |
| `database.py` | pool, schema, queries | no |
| `menus.py` | keyboards and callback codes as plain data | no |
| `delivery.py` | send a file, refresh a stale `file_id`, flood waits | via an injected client |
| `bot.py` | `LibraryBot` (all behaviour) and the Telethon handler wiring | via an injected client |
| `config.py` | settings, validation | no |

`LibraryBot` takes any object with Telethon's client methods, which is how the tests run it without a network.

## Data model

```
media        id, title, type (Movie|Anime|Show), release_year, genre, created_at
media_files  id, media_id -> media (cascade), season_number, episode_number, quality_resolution,
             telegram_file_id (unique), telegram_message_id (unique), channel_id
```

One `media` row per title + type + year (case-insensitive, a unique index). A title without files is deleted. Season and episode are `NULL` for movies and single files.

## Identity and de-duplication

- Same post again (an edit): the file row is updated in place; if it moved to another title, the old title is removed when empty.
- Same `file_id` in a different post: nothing is written.
- Year matching: with a year, the same year (or a year-less row, which adopts it); without a year, the only match, or the oldest if remakes exist.

## Sending a file

```
send_file(chat, stored file_id)
   ok -> done
   invalid id / expired file reference -> get_messages(channel, message_id)
        post gone            -> delete the row, tell the user and the admins
        id changed           -> store it, retry with it
        id unchanged / fails -> retry with the post's media object
   FLOOD_WAIT_X             -> sleep X+1 (up to 300 s), else report the wait
   user blocked the bot     -> stop quietly
   network error            -> 2, 4, 8 s backoff, then give up
```

## Search

The query is split into words (at most six). Every word must match at least one of: the title (substring, case-folded so it works beyond ASCII), the genre, the release year (if the word is four digits), or the type (`movie`, `movies`, `film`, `anime`, `show`, `shows`, `series`, `tv`). LIKE wildcards typed by the user are escaped. Results are ordered: exact title, title starting with the query, every word in the title, then matches found only through genre, year or type.

## Menus

Callback data is a short ASCII code (Telegram allows 64 bytes): `s:<token>:<page>`, `m:<media>`, `t:<media>:<season>:<page>`, `e:<media>:<season>:<episode>`, `q:<file>`. `menus.decode` accepts only exactly these shapes (digits are ASCII only), so forged data is rejected. Search text is kept in a small in-memory store so that paging and Back can find it again.

## Security and abuse

- All user and caption text is HTML-escaped before it is sent (the bot sends with HTML formatting).
- `yaml.safe_load` only. A hostile caption is data, never code.
- Access: `ALLOWED_USER_IDS` (admins always allowed); `/stats` and `/reindex` are admin-only.
- One file per person per 2 seconds, and a second tap on a file still being sent is ignored.
- The session file is created owner-only; `Config` masks the API hash and token when printed.
