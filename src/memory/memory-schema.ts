export const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'file',
    hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS memory_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES memory_files(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    start_line INTEGER NOT NULL DEFAULT 0,
    end_line INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON memory_chunks(file_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_hash ON memory_chunks(hash);

  CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
    content,
    content='memory_chunks',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS embedding_cache (
    chunk_id INTEGER NOT NULL REFERENCES memory_chunks(id) ON DELETE CASCADE,
    provider_model TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dimensions INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (chunk_id, provider_model)
  );
`;

export const CHAT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'web',
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    memory_file_id INTEGER REFERENCES memory_files(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_chat_channel_ts ON chat_messages(channel_id, timestamp);
`;

export const GCC_SCHEMA = `
  CREATE TABLE IF NOT EXISTS gcc_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_type TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    head_commit_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(memory_type, branch_name)
  );

  CREATE TABLE IF NOT EXISTS gcc_commits (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    memory_type TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    parent_hash TEXT,
    delta TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    message TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'MEDIUM_CONFIDENCE',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_gcc_commits_type_branch_seq
    ON gcc_commits(memory_type, branch_name, seq DESC);
`;

export const FTS_SYNC_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
    INSERT INTO memory_chunks_fts(rowid, content) VALUES (new.id, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
    INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS memory_chunks_au AFTER UPDATE ON memory_chunks BEGIN
    INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO memory_chunks_fts(rowid, content) VALUES (new.id, new.content);
  END;
`;
