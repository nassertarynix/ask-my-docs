PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('Movie', 'Anime', 'Show')) NOT NULL,
    release_year INTEGER,
    genre TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    season_number INTEGER DEFAULT NULL,
    episode_number INTEGER DEFAULT NULL,
    quality_resolution TEXT, -- e.g., '1080p', '4K', '720p'
    telegram_file_id TEXT UNIQUE NOT NULL,
    telegram_message_id INTEGER UNIQUE NOT NULL,
    channel_id INTEGER NOT NULL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_title ON media(title);
CREATE INDEX IF NOT EXISTS idx_media_files_lookup ON media_files(media_id, season_number, episode_number);

-- ---------------------------------------------------------------------------------------------------------------------
-- Addition to the specification (everything above is as specified):
-- one `media` row per title + type + year, case-insensitively. This is what makes "deduplicate by title and type" a rule
-- of the database and not just of the Python code. The year is part of the identity so that "Dune" (1984) and "Dune" (2021)
-- stay separate; a missing year counts as 0 here, and database.py merges a year-less caption into the only matching title.
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_identity ON media(title COLLATE NOCASE, type, COALESCE(release_year, 0));
