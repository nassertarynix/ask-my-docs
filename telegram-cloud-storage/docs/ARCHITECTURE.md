# Architecture

```
+-----------------------------+      loopback HTTP + WebSocket       +-------------------------------+
|  Tauri window (Rust shell)  |  127.0.0.1:<random port>, secret     |  Python backend (FastAPI)     |
|  React + Tailwind UI        | -----------------------------------> |  service.py  database.py      |
|  src/                       |  X-TGCS-Token on every request       |  chunker.py  telegram_client  |
+-----------------------------+                                       +---------------+---------------+
        ^  starts, passes port + token, stops                                         |            |
        |                                                                  SQLite (WAL)     Telegram channel
   src-tauri/ (Rust)                                                   folders/files/chunks   (MTProto, Telethon)
```

## Who does what

| Part | Responsibility |
| --- | --- |
| `src-tauri/` | Starts the Python backend on a free loopback port with a fresh random token, hands both to the window through one command (`backend_config`), and stops the backend on exit. In a release build the backend is a bundled executable (PyInstaller); in development it is `python -m backend.main`. |
| `src/` | The file explorer: folder tree, file table, drag-and-drop, transfers panel, settings. Talks only to the local backend. Model and document names are rendered through React (escaped), never as HTML. |
| `backend/main.py` | The API and its guard (token, `Host`, `Origin`). No business rules. |
| `backend/service.py` | Upload, download, delete, index recovery. The only place that combines the database and the storage backend. |
| `backend/chunker.py` | Hashing, splitting, captions, verified reassembly. Standard library only. |
| `backend/database.py` | The SQLite index. |
| `backend/telegram_client.py` | `StorageBackend` interface; `TelethonBackend` (Telegram) and `LocalDirBackend` (a folder standing in for the channel, for tests and demos). Flood-wait and retry logic. |

## Data model

```
folders     id, name, parent_id -> folders(id) ON DELETE CASCADE, created_at
files       id, uid (unique), folder_id -> folders(id) ON DELETE CASCADE, file_name, file_size, mime_type,
            sha256_hash, total_chunks, uploaded_at
file_chunks id, file_id -> files(id) ON DELETE CASCADE, chunk_index, chunk_size, telegram_file_id, telegram_message_id
```

- The root folder is `NULL` (`parent_id` / `folder_id`), not a row.
- Names are unique per folder, case-insensitively (a unique index on `COALESCE(parent_id, 0), name COLLATE NOCASE`).
- `files.uid` is the one column added to the specified schema. It is a random identifier written into every Telegram caption,
  so the index can be rebuilt from the channel alone, and two uploads of identical content never get confused.
- Every foreign-key column is the leading column of an index (a test checks it).
- WAL mode and `foreign_keys=ON`. One writer connection (serialised, every write is one transaction) and three read-only readers.
- Schema changes are migrations tracked in `PRAGMA user_version`; a database from a newer version is refused, not damaged.

## Upload

1. The browser sends the raw file as the request body (`POST /api/upload?name=&folder_id=&job_id=`). The backend spools it to disk
   while counting bytes (aborting at `MAX_UPLOAD_GB`), because the whole-file SHA-256 must be known before the first chunk is sent.
2. SHA-256 of the whole file; then the file is read one chunk (default 20 MB) at a time.
3. Each chunk is sent as a document with a JSON caption:
   `{"app":"tgcs","v":1,"fid":<uid>,"i":<index>,"n":<total>,"sha":<file sha256>,"csha":<chunk sha256>,"name":...,"size":...,"mime":...}`.
4. Only when every chunk is stored are the `files` and `file_chunks` rows committed, in one transaction.
5. If anything fails or the upload is cancelled, the chunks already sent are deleted again and no row is written.

Progress is published on `/ws/progress` as `{job_id, kind, phase, done, total, chunk, chunks_total}`; the UI matches events to
transfers by `job_id`.

## Download

Chunks are fetched in order into a temporary `.part` file while hashing. Each chunk's size is checked, then the file's total size and
SHA-256. Only a verified file is renamed into place and served; a mismatch deletes the partial file and returns an error.
Because verification happens before the first byte reaches the browser, a corrupted file is never delivered.

## Flood waits

Every Telegram call goes through `with_retries`: on `FLOOD_WAIT_X` it sleeps `X + 1` seconds and retries (up to 6 attempts); on a
network error it backs off 1, 2, 4, ... up to 30 s. A wait longer than 15 minutes is not slept out: it fails with a clear message. The
Telethon client is created with `flood_sleep_threshold=0` so that Telethon never sleeps silently; the UI shows the wait.

## Disaster recovery

`POST /api/recover` lists the channel's messages, parses the captions, groups chunks by `uid`, and re-creates the rows for every
file that is complete and consistent (all chunk indexes present, same checksum, sizes adding up). Files with a missing chunk are
counted as `incomplete` and not imported. Recovered files go into a folder named "Recovered", because folders are not stored in captions.

## Security model

The API has no login and can write files, so it is locked down:

1. It binds to `127.0.0.1` only (not configurable).
2. Every `/api/*` request and the WebSocket need the per-launch secret token (`X-TGCS-Token`, or `?token=` where a browser cannot set headers).
3. The `Host` header must be a loopback name (stops DNS rebinding) and a browser `Origin` must be on a short allow-list (the Tauri window and the Vite dev server).
4. Upload size is capped while streaming; names are validated (no slashes, no control characters, no `.`/`..`).
5. `config.json` (API hash, bot token) and the Telegram session file are created with owner-only permissions and never returned by the API.
