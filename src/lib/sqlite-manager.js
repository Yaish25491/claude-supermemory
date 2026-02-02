const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULT_DB_DIR = path.join(os.homedir(), '.claude-memory');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'memories.db');

class SqliteManager {
  constructor(dbPath = DEFAULT_DB_PATH) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        container_tag TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        synced_at INTEGER,
        sync_status TEXT DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        container_tag TEXT NOT NULL,
        fact TEXT NOT NULL,
        type TEXT DEFAULT 'static',
        created_at INTEGER NOT NULL,
        synced_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_memories_container ON memories(container_tag);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_sync_status ON memories(sync_status);
      CREATE INDEX IF NOT EXISTS idx_profiles_container ON profiles(container_tag);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        container_tag,
        content=memories,
        content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, container_tag)
        VALUES (new.rowid, new.content, new.container_tag);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        DELETE FROM memories_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        UPDATE memories_fts SET content = new.content, container_tag = new.container_tag
        WHERE rowid = new.rowid;
      END;
    `);
  }

  close() {
    this.db.close();
  }
}

module.exports = { SqliteManager, DEFAULT_DB_PATH };
