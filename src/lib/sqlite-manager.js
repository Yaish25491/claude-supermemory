const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DEFAULT_DB_DIR = path.join(os.homedir(), '.claude-memory');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'memories.db');

class SqliteManager {
  constructor(dbPath = DEFAULT_DB_PATH) {
    // Handle null/undefined explicitly
    if (!dbPath) {
      dbPath = DEFAULT_DB_PATH;
    }

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

  addMemory(id, content, containerTag, metadata = {}) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, container_tag, metadata, created_at, updated_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    stmt.run(id, content, containerTag, JSON.stringify(metadata), now, now);
    return { id, createdAt: now };
  }

  getMemory(id) {
    const stmt = this.db.prepare('SELECT * FROM memories WHERE id = ?');
    const row = stmt.get(id);
    if (row?.metadata) {
      row.metadata = JSON.parse(row.metadata);
    }
    return row;
  }

  updateMemory(id, content, metadata = null) {
    const now = Date.now();
    const updates = ['content = ?', 'updated_at = ?', 'sync_status = ?'];
    const params = [content, now, 'pending'];

    if (metadata !== null) {
      updates.push('metadata = ?');
      params.push(JSON.stringify(metadata));
    }

    params.push(id);
    const stmt = this.db.prepare(
      `UPDATE memories SET ${updates.join(', ')} WHERE id = ?`,
    );
    stmt.run(...params);
  }

  deleteMemory(id) {
    const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
    stmt.run(id);
  }

  listMemories(containerTag, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE container_tag = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(containerTag, limit);
    return rows.map((row) => {
      if (row.metadata) row.metadata = JSON.parse(row.metadata);
      return row;
    });
  }

  getPendingSync() {
    const stmt = this.db.prepare(
      `SELECT * FROM memories WHERE sync_status = 'pending'`,
    );
    const rows = stmt.all();
    return rows.map((row) => {
      if (row.metadata) row.metadata = JSON.parse(row.metadata);
      return row;
    });
  }

  markSynced(ids) {
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      UPDATE memories
      SET sync_status = 'synced', synced_at = ?
      WHERE id IN (${placeholders})
    `);
    stmt.run(now, ...ids);
  }

  searchMemories(query, containerTag = null, limit = 10) {
    let sql = `
      SELECT m.*, rank * -1 as relevance_score
      FROM memories_fts f
      JOIN memories m ON f.rowid = m.rowid
      WHERE memories_fts MATCH ?
    `;
    const params = [query];

    if (containerTag) {
      sql += ' AND m.container_tag = ?';
      params.push(containerTag);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => {
      if (row.metadata) row.metadata = JSON.parse(row.metadata);
      return row;
    });
  }

  getContextMemories(containerTag, projectName, limit = 10) {
    // Hybrid: recent + relevant memories for context injection
    const recentStmt = this.db.prepare(`
      SELECT *, 1.0 as score FROM memories
      WHERE container_tag = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const recent = recentStmt.all(containerTag, Math.floor(limit / 2));

    // FTS search for project-relevant
    const searchStmt = this.db.prepare(`
      SELECT m.*, rank * -1 as score
      FROM memories_fts f
      JOIN memories m ON f.rowid = m.rowid
      WHERE memories_fts MATCH ? AND m.container_tag = ?
      ORDER BY rank
      LIMIT ?
    `);
    const relevant = searchStmt.all(
      projectName,
      containerTag,
      Math.floor(limit / 2),
    );

    // Combine and dedupe
    const seen = new Set(recent.map((r) => r.id));
    const combined = [...recent];
    for (const mem of relevant) {
      if (!seen.has(mem.id)) {
        combined.push(mem);
        seen.add(mem.id);
      }
    }

    return combined.slice(0, limit).map((row) => {
      if (row.metadata) row.metadata = JSON.parse(row.metadata);
      return row;
    });
  }

  addProfileFact(id, containerTag, fact, type = 'static') {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO profiles (id, container_tag, fact, type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, containerTag, fact, type, now);
  }

  getProfile(containerTag, maxItems = 5) {
    const staticStmt = this.db.prepare(`
      SELECT fact FROM profiles
      WHERE container_tag = ? AND type = 'static'
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const staticFacts = staticStmt.all(containerTag, maxItems);

    const dynamicStmt = this.db.prepare(`
      SELECT fact FROM profiles
      WHERE container_tag = ? AND type = 'dynamic'
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const dynamicFacts = dynamicStmt.all(containerTag, maxItems);

    return {
      static: staticFacts.map((r) => r.fact),
      dynamic: dynamicFacts.map((r) => r.fact),
    };
  }

  deleteProfileFact(id) {
    const stmt = this.db.prepare('DELETE FROM profiles WHERE id = ?');
    stmt.run(id);
  }

  close() {
    this.db.close();
  }
}

module.exports = { SqliteManager, DEFAULT_DB_PATH };
