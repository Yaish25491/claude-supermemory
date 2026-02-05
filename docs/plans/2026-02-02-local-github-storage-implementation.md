# Local + GitHub Memory Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Supermemory paid API with hybrid local SQLite + GitHub storage for persistent memory across sessions.

**Architecture:** Local-first SQLite database for fast queries, GitHub repository for cloud backup/sync, manual conflict resolution, graceful offline mode.

**Tech Stack:** Node.js, better-sqlite3, simple-git (or gh CLI), existing plugin infrastructure

---

## Phase 1: SQLite Storage Layer

### Task 1: Add Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add better-sqlite3 and simple-git**

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "simple-git": "^3.25.0"
  }
}
```

**Step 2: Install dependencies**

Run: `npm install`
Expected: Dependencies installed successfully

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add better-sqlite3 and simple-git for local storage"
```

---

### Task 2: SQLite Manager - Database Setup

**Files:**
- Create: `src/lib/sqlite-manager.js`

**Step 1: Create sqlite-manager.js with schema**

```javascript
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
```

**Step 2: Verify it runs without errors**

Run: `node -e "const {SqliteManager} = require('./src/lib/sqlite-manager.js'); const db = new SqliteManager('/tmp/test-mem.db'); db.close(); console.log('OK')"`
Expected: "OK" printed, no errors

**Step 3: Commit**

```bash
git add src/lib/sqlite-manager.js
git commit -m "feat: add SQLite database manager with schema"
```

---

### Task 3: SQLite Manager - CRUD Operations

**Files:**
- Modify: `src/lib/sqlite-manager.js`

**Step 1: Add memory CRUD methods**

Add to SqliteManager class:

```javascript
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
    if (row && row.metadata) {
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
    const stmt = this.db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`);
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
    return rows.map(row => {
      if (row.metadata) row.metadata = JSON.parse(row.metadata);
      return row;
    });
  }

  getPendingSync() {
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE sync_status = 'pending'`);
    const rows = stmt.all();
    return rows.map(row => {
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
```

**Step 2: Test CRUD operations**

Run:
```bash
node -e "
const {SqliteManager} = require('./src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-crud.db');
db.addMemory('test1', 'Test memory content', 'project1', {source: 'test'});
const mem = db.getMemory('test1');
console.log(mem.content === 'Test memory content' ? 'OK' : 'FAIL');
db.close();
"
```
Expected: "OK" printed

**Step 3: Commit**

```bash
git add src/lib/sqlite-manager.js
git commit -m "feat: add CRUD operations to SQLite manager"
```

---

### Task 4: SQLite Manager - Full-Text Search

**Files:**
- Modify: `src/lib/sqlite-manager.js`

**Step 1: Add search methods**

Add to SqliteManager class:

```javascript
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
    return rows.map(row => {
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
    const relevant = searchStmt.all(projectName, containerTag, Math.floor(limit / 2));

    // Combine and dedupe
    const seen = new Set(recent.map(r => r.id));
    const combined = [...recent];
    for (const mem of relevant) {
      if (!seen.has(mem.id)) {
        combined.push(mem);
        seen.add(mem.id);
      }
    }

    return combined.slice(0, limit).map(row => {
      if (row.metadata) row.metadata = JSON.parse(row.metadata);
      return row;
    });
  }
```

**Step 2: Test search**

Run:
```bash
node -e "
const {SqliteManager} = require('./src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-search.db');
db.addMemory('m1', 'Implemented OAuth authentication flow', 'project1');
db.addMemory('m2', 'Fixed bug in login validation', 'project1');
db.addMemory('m3', 'Added user profile page', 'project1');
const results = db.searchMemories('authentication', 'project1');
console.log(results.length > 0 && results[0].content.includes('OAuth') ? 'OK' : 'FAIL');
db.close();
"
```
Expected: "OK" printed

**Step 3: Commit**

```bash
git add src/lib/sqlite-manager.js
git commit -m "feat: add full-text search to SQLite manager"
```

---

### Task 5: SQLite Manager - Profile Methods

**Files:**
- Modify: `src/lib/sqlite-manager.js`

**Step 1: Add profile CRUD**

Add to SqliteManager class:

```javascript
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
      static: staticFacts.map(r => r.fact),
      dynamic: dynamicFacts.map(r => r.fact)
    };
  }

  deleteProfileFact(id) {
    const stmt = this.db.prepare('DELETE FROM profiles WHERE id = ?');
    stmt.run(id);
  }
```

**Step 2: Test profile operations**

Run:
```bash
node -e "
const {SqliteManager} = require('./src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-profile.db');
db.addProfileFact('p1', 'user', 'Prefers TypeScript', 'static');
db.addProfileFact('p2', 'user', 'Working on auth', 'dynamic');
const profile = db.getProfile('user');
console.log(profile.static.length === 1 && profile.dynamic.length === 1 ? 'OK' : 'FAIL');
db.close();
"
```
Expected: "OK" printed

**Step 3: Commit**

```bash
git add src/lib/sqlite-manager.js
git commit -m "feat: add profile management to SQLite manager"
```

---

## Phase 2: GitHub Authentication

### Task 6: GitHub Auth - gh CLI Detection

**Files:**
- Create: `src/lib/github-auth.js`

**Step 1: Create github-auth.js with gh CLI detection**

```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN_FILE = path.join(os.homedir(), '.claude-memory', 'github-token.json');

class GitHubAuth {
  constructor() {
    this.ghAvailable = this.checkGhCli();
  }

  checkGhCli() {
    try {
      execSync('gh auth status', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async getToken() {
    // 1. Check environment variable
    if (process.env.CLAUDE_MEMORY_GITHUB_TOKEN) {
      return process.env.CLAUDE_MEMORY_GITHUB_TOKEN;
    }

    // 2. Use gh CLI if available
    if (this.ghAvailable) {
      try {
        const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
        return token;
      } catch (err) {
        console.error('Failed to get gh token:', err.message);
      }
    }

    // 3. Check saved token file
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      return data.token;
    }

    throw new Error('No GitHub authentication found. Please authenticate with gh CLI or set CLAUDE_MEMORY_GITHUB_TOKEN');
  }

  saveToken(token) {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }), { mode: 0o600 });
  }

  isAuthenticated() {
    return this.ghAvailable ||
           process.env.CLAUDE_MEMORY_GITHUB_TOKEN ||
           fs.existsSync(TOKEN_FILE);
  }
}

module.exports = { GitHubAuth };
```

**Step 2: Test gh CLI detection**

Run: `node -e "const {GitHubAuth} = require('./src/lib/github-auth.js'); const auth = new GitHubAuth(); console.log(auth.ghAvailable ? 'gh available' : 'gh not available')"`
Expected: Output shows gh availability status

**Step 3: Commit**

```bash
git add src/lib/github-auth.js
git commit -m "feat: add GitHub authentication with gh CLI support"
```

---

### Task 7: GitHub Auth - OAuth Device Flow (Fallback)

**Files:**
- Modify: `src/lib/github-auth.js`

**Step 1: Add OAuth device flow**

Add to GitHubAuth class:

```javascript
  async initiateDeviceFlow() {
    const https = require('https');

    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        client_id: 'Ov23liXXXXXXXXXXXXXX', // TODO: Register GitHub OAuth App
        scope: 'repo'
      });

      const options = {
        hostname: 'github.com',
        port: 443,
        path: '/login/device/code',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async pollForToken(deviceCode, interval = 5) {
    const https = require('https');

    const poll = () => new Promise((resolve, reject) => {
      const data = JSON.stringify({
        client_id: 'Ov23liXXXXXXXXXXXXXX', // TODO: Same as above
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      });

      const options = {
        hostname: 'github.com',
        port: 443,
        path: '/login/oauth/access_token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const result = JSON.parse(body);
          if (result.access_token) {
            resolve(result.access_token);
          } else if (result.error === 'authorization_pending') {
            resolve(null);
          } else {
            reject(new Error(result.error || 'Unknown error'));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });

    // Poll up to 10 minutes
    for (let i = 0; i < 120; i++) {
      const token = await poll();
      if (token) return token;
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
    }

    throw new Error('Device flow timed out');
  }

  async startDeviceFlow() {
    const device = await this.initiateDeviceFlow();
    console.log(`\nGitHub Authentication Required:`);
    console.log(`Visit: ${device.verification_uri}`);
    console.log(`Enter code: ${device.user_code}\n`);

    const token = await this.pollForToken(device.device_code, device.interval);
    this.saveToken(token);
    return token;
  }
```

**Step 2: Manual test (skip for now - requires GitHub OAuth app)**

Note: This will be tested during integration. OAuth app needs to be registered first.

**Step 3: Commit**

```bash
git add src/lib/github-auth.js
git commit -m "feat: add OAuth device flow fallback for GitHub auth"
```

---

## Phase 3: GitHub Sync Layer

### Task 8: GitHub Sync - Repository Setup

**Files:**
- Create: `src/lib/github-sync.js`

**Step 1: Create github-sync.js with repo initialization**

```javascript
const simpleGit = require('simple-git');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SYNC_DIR = path.join(os.homedir(), '.claude-memory', 'repo');
const DEFAULT_REPO_NAME = 'claude-memory-storage';

class GitHubSync {
  constructor(auth, repoOwner = null, repoName = DEFAULT_REPO_NAME) {
    this.auth = auth;
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.syncDir = SYNC_DIR;
    this.git = simpleGit(this.syncDir);
  }

  async ensureRepo() {
    // Check if repo directory exists and is git repo
    if (fs.existsSync(this.syncDir) && fs.existsSync(path.join(this.syncDir, '.git'))) {
      return true;
    }

    // Get authenticated user
    if (!this.repoOwner) {
      const token = await this.auth.getToken();
      const user = JSON.parse(execSync(`gh api user --header "Authorization: Bearer ${token}"`, { encoding: 'utf8' }));
      this.repoOwner = user.login;
    }

    // Check if remote repo exists
    const repoExists = await this.checkRepoExists();

    if (!repoExists) {
      // Create repo
      const created = await this.createRepo();
      if (!created) return false;
    }

    // Clone repo
    await this.cloneRepo();
    return true;
  }

  async checkRepoExists() {
    try {
      const token = await this.auth.getToken();
      execSync(`gh api repos/${this.repoOwner}/${this.repoName} --header "Authorization: Bearer ${token}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async createRepo() {
    try {
      const token = await this.auth.getToken();
      const data = JSON.stringify({
        name: this.repoName,
        private: true,
        description: 'Claude Code memory storage - persistent context across sessions',
        auto_init: true
      });

      execSync(`gh api user/repos --method POST --input - --header "Authorization: Bearer ${token}"`, {
        input: data,
        stdio: 'pipe'
      });

      console.log(`Created private repository: ${this.repoOwner}/${this.repoName}`);
      return true;
    } catch (err) {
      console.error('Failed to create repository:', err.message);
      return false;
    }
  }

  async cloneRepo() {
    const repoUrl = `https://github.com/${this.repoOwner}/${this.repoName}.git`;

    // Ensure parent directory exists
    const parentDir = path.dirname(this.syncDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    await simpleGit().clone(repoUrl, this.syncDir);

    // Configure git user
    await this.git.addConfig('user.name', 'Claude Code');
    await this.git.addConfig('user.email', 'noreply@anthropic.com');
  }
}

module.exports = { GitHubSync };
```

**Step 2: Test repo detection (manual check)**

Run: `node -e "const {GitHubAuth} = require('./src/lib/github-auth.js'); const {GitHubSync} = require('./src/lib/github-sync.js'); const auth = new GitHubAuth(); console.log('GitHubSync loaded OK')"`
Expected: "GitHubSync loaded OK"

**Step 3: Commit**

```bash
git add src/lib/github-sync.js
git commit -m "feat: add GitHub repository setup for sync"
```

---

### Task 9: GitHub Sync - Export to JSON

**Files:**
- Modify: `src/lib/github-sync.js`

**Step 1: Add export methods**

Add to GitHubSync class:

```javascript
  exportMemory(memory) {
    const date = new Date(memory.created_at);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const day = String(date.getDate()).padStart(2, '0');

    const memoryDir = path.join(
      this.syncDir,
      'memories',
      memory.container_tag,
      yearMonth
    );

    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const filename = `${day}-${memory.id}.json`;
    const filepath = path.join(memoryDir, filename);

    const data = {
      id: memory.id,
      content: memory.content,
      containerTag: memory.container_tag,
      metadata: typeof memory.metadata === 'string' ? JSON.parse(memory.metadata) : memory.metadata,
      createdAt: memory.created_at,
      updatedAt: memory.updated_at
    };

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    return filepath;
  }

  exportMemories(memories) {
    const files = [];
    for (const memory of memories) {
      const filepath = this.exportMemory(memory);
      files.push(filepath);
    }
    return files;
  }

  exportProfiles(profiles) {
    const profileDir = path.join(this.syncDir, 'profiles');
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    const filepath = path.join(profileDir, 'user-preferences.json');
    fs.writeFileSync(filepath, JSON.stringify(profiles, null, 2));
    return filepath;
  }
```

**Step 2: Test export**

Run:
```bash
node -e "
const {GitHubSync} = require('./src/lib/github-sync.js');
const {GitHubAuth} = require('./src/lib/github-auth.js');
const fs = require('fs');
const path = require('path');
const tmpDir = '/tmp/test-sync-export';
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
fs.mkdirSync(tmpDir);
const auth = new GitHubAuth();
const sync = new GitHubSync(auth);
sync.syncDir = tmpDir;
const memory = {
  id: 'test1',
  content: 'Test memory',
  container_tag: 'project1',
  metadata: {source: 'test'},
  created_at: Date.now(),
  updated_at: Date.now()
};
const filepath = sync.exportMemory(memory);
console.log(fs.existsSync(filepath) ? 'OK' : 'FAIL');
"
```
Expected: "OK" printed

**Step 3: Commit**

```bash
git add src/lib/github-sync.js
git commit -m "feat: add memory export to JSON for GitHub sync"
```

---

### Task 10: GitHub Sync - Commit and Push

**Files:**
- Modify: `src/lib/github-sync.js`

**Step 1: Add sync methods**

Add to GitHubSync class:

```javascript
  async syncToGitHub(memories, profiles = null) {
    try {
      await this.ensureRepo();

      // Export memories to JSON
      const files = this.exportMemories(memories);

      // Export profiles if provided
      if (profiles) {
        const profileFile = this.exportProfiles(profiles);
        files.push(profileFile);
      }

      if (files.length === 0) {
        return { success: true, synced: 0 };
      }

      // Git add
      for (const file of files) {
        const relativePath = path.relative(this.syncDir, file);
        await this.git.add(relativePath);
      }

      // Git commit
      const containerTags = [...new Set(memories.map(m => m.container_tag))];
      const message = `Session memories: ${containerTags.join(', ')} (${memories.length} new)`;
      await this.git.commit(message);

      // Git push
      await this.git.push('origin', 'main');

      return { success: true, synced: memories.length };
    } catch (err) {
      console.error('GitHub sync failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async pullFromGitHub() {
    try {
      await this.ensureRepo();
      await this.git.pull('origin', 'main');
      return { success: true };
    } catch (err) {
      if (err.message.includes('conflict')) {
        return { success: false, conflict: true, error: err.message };
      }
      return { success: false, conflict: false, error: err.message };
    }
  }
```

**Step 2: Manual test (skip - requires actual GitHub repo)**

Note: Will be tested during integration testing

**Step 3: Commit**

```bash
git add src/lib/github-sync.js
git commit -m "feat: add commit and push to GitHub sync"
```

---

### Task 11: GitHub Sync - Import from JSON

**Files:**
- Modify: `src/lib/github-sync.js`

**Step 1: Add import methods**

Add to GitHubSync class:

```javascript
  importMemories() {
    const memoriesDir = path.join(this.syncDir, 'memories');
    if (!fs.existsSync(memoriesDir)) {
      return [];
    }

    const memories = [];

    const readDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          readDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            memories.push({
              id: data.id,
              content: data.content,
              container_tag: data.containerTag,
              metadata: JSON.stringify(data.metadata || {}),
              created_at: data.createdAt,
              updated_at: data.updatedAt,
              sync_status: 'synced',
              synced_at: Date.now()
            });
          } catch (err) {
            console.error(`Failed to parse ${fullPath}:`, err.message);
          }
        }
      }
    };

    readDir(memoriesDir);
    return memories;
  }

  importProfiles() {
    const profileFile = path.join(this.syncDir, 'profiles', 'user-preferences.json');
    if (!fs.existsSync(profileFile)) {
      return { static: [], dynamic: [] };
    }

    try {
      return JSON.parse(fs.readFileSync(profileFile, 'utf8'));
    } catch (err) {
      console.error('Failed to parse profiles:', err.message);
      return { static: [], dynamic: [] };
    }
  }
```

**Step 2: Test import**

Run:
```bash
node -e "
const {GitHubSync} = require('./src/lib/github-sync.js');
const {GitHubAuth} = require('./src/lib/github-auth.js');
const fs = require('fs');
const path = require('path');
const tmpDir = '/tmp/test-sync-import';
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
fs.mkdirSync(tmpDir);
const auth = new GitHubAuth();
const sync = new GitHubSync(auth);
sync.syncDir = tmpDir;
const memory = {
  id: 'test1',
  content: 'Test import',
  container_tag: 'project1',
  metadata: {},
  created_at: Date.now(),
  updated_at: Date.now()
};
sync.exportMemory(memory);
const imported = sync.importMemories();
console.log(imported.length === 1 && imported[0].content === 'Test import' ? 'OK' : 'FAIL');
"
```
Expected: "OK" printed

**Step 3: Commit**

```bash
git add src/lib/github-sync.js
git commit -m "feat: add import from JSON for GitHub sync"
```

---

## Phase 4: Storage Client Integration

### Task 12: Storage Client - Main Wrapper

**Files:**
- Create: `src/lib/storage-client.js`

**Step 1: Create storage-client.js**

```javascript
const { SqliteManager } = require('./sqlite-manager');
const { GitHubSync } = require('./github-sync');
const { GitHubAuth } = require('./github-auth');
const crypto = require('crypto');

class StorageClient {
  constructor(dbPath = null) {
    this.db = new SqliteManager(dbPath);
    this.auth = new GitHubAuth();
    this.sync = null; // Lazy init
  }

  async initSync() {
    if (!this.sync) {
      this.sync = new GitHubSync(this.auth);
    }
  }

  generateId(prefix = 'mem') {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  }

  // Memory operations
  async addMemory(content, containerTag, metadata = {}, customId = null) {
    const id = customId || this.generateId('mem');
    this.db.addMemory(id, content, containerTag, metadata);
    return { id, status: 'saved', containerTag };
  }

  async search(query, containerTag = null, options = {}) {
    const results = this.db.searchMemories(query, containerTag, options.limit || 10);
    return {
      results: results.map(r => ({
        id: r.id,
        memory: r.content,
        content: r.content,
        similarity: r.relevance_score || 0.5,
        title: r.metadata?.title || null
      })),
      total: results.length
    };
  }

  async getProfile(containerTag, query = null) {
    const profile = this.db.getProfile(containerTag);

    let searchResults = null;
    if (query) {
      const results = this.db.searchMemories(query, containerTag, 10);
      searchResults = {
        results: results.map(r => ({
          id: r.id,
          memory: r.content,
          content: r.content,
          similarity: r.relevance_score || 0.5,
          title: r.metadata?.title || null
        })),
        total: results.length
      };
    }

    return {
      profile: {
        static: profile.static,
        dynamic: profile.dynamic
      },
      searchResults
    };
  }

  async listMemories(containerTag, limit = 20) {
    const memories = this.db.listMemories(containerTag, limit);
    return { memories };
  }

  async deleteMemory(memoryId) {
    this.db.deleteMemory(memoryId);
    return { success: true };
  }

  // GitHub sync operations
  async syncToGitHub() {
    if (!this.auth.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }

    await this.initSync();
    const pending = this.db.getPendingSync();

    if (pending.length === 0) {
      return { success: true, synced: 0 };
    }

    const result = await this.sync.syncToGitHub(pending);

    if (result.success) {
      const ids = pending.map(m => m.id);
      this.db.markSynced(ids);
    }

    return result;
  }

  async syncFromGitHub() {
    if (!this.auth.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }

    await this.initSync();
    const pullResult = await this.sync.pullFromGitHub();

    if (!pullResult.success) {
      return pullResult;
    }

    // Import memories from JSON
    const memories = this.sync.importMemories();

    // Add to database (skip if already exists)
    for (const memory of memories) {
      const existing = this.db.getMemory(memory.id);
      if (!existing) {
        this.db.addMemory(
          memory.id,
          memory.content,
          memory.container_tag,
          JSON.parse(memory.metadata)
        );
      }
    }

    return { success: true, imported: memories.length };
  }

  close() {
    this.db.close();
  }
}

module.exports = { StorageClient };
```

**Step 2: Test storage client**

Run:
```bash
node -e "
const {StorageClient} = require('./src/lib/storage-client.js');
const client = new StorageClient('/tmp/test-storage.db');
const result = client.addMemory('Test content', 'project1', {source: 'test'});
console.log(result.status === 'saved' ? 'OK' : 'FAIL');
client.close();
"
```
Expected: "OK" printed

**Step 3: Commit**

```bash
git add src/lib/storage-client.js
git commit -m "feat: add storage client wrapper for SQLite + GitHub"
```

---

## Phase 5: Hook Integration

### Task 13: Update Context Hook

**Files:**
- Modify: `src/context-hook.js`

**Step 1: Replace SupermemoryClient with StorageClient**

Replace the entire file:

```javascript
const { StorageClient } = require('./lib/storage-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { formatContext } = require('./lib/format-context');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    debugLog(settings, 'SessionStart', { cwd, containerTag, projectName });

    const client = new StorageClient();

    // Sync from GitHub (non-blocking, best effort)
    const syncResult = await client.syncFromGitHub().catch(() => ({ success: false }));
    if (!syncResult.success) {
      debugLog(settings, 'GitHub sync unavailable, working offline');
    }

    const profileResult = await client
      .getProfile(containerTag, projectName)
      .catch(() => null);

    const additionalContext = formatContext(
      profileResult,
      true,
      false,
      settings.maxProfileItems || 5
    );

    if (!additionalContext) {
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `<supermemory-context>
No previous memories found for this project.
Memories will be saved as you work.
${syncResult.success ? '' : '⚠ GitHub sync unavailable - working offline'}
</supermemory-context>`
        }
      });
      client.close();
      return;
    }

    debugLog(settings, 'Context generated', {
      length: additionalContext.length
    });

    const statusNote = syncResult.success ? '' : '\n⚠ GitHub sync unavailable - working offline';

    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: additionalContext + statusNote
      }
    });

    client.close();
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Claude Memory: ${err.message}`);
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<supermemory-status>
Failed to load memories: ${err.message}
Session will continue without memory context.
</supermemory-status>`
      }
    });
  }
}

main().catch((err) => {
  console.error(`Claude Memory fatal: ${err.message}`);
  process.exit(1);
});
```

**Step 2: Test context hook (manual - requires stdin)**

Skip automated test - will test during full integration

**Step 3: Commit**

```bash
git add src/context-hook.js
git commit -m "feat: update context hook to use local storage"
```

---

### Task 14: Update Summary Hook

**Files:**
- Modify: `src/summary-hook.js`

**Step 1: Replace SupermemoryClient with StorageClient and add GitHub sync**

Replace imports and main logic:

```javascript
const { StorageClient } = require('./lib/storage-client');
const { getContainerTag } = require('./lib/container-tag');
const { loadSettings, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { compressTranscript } = require('./lib/compress');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const transcript = input.transcript || [];

    if (transcript.length === 0) {
      debugLog(settings, 'No transcript to save');
      writeOutput({});
      return;
    }

    const cwd = input.cwd || process.cwd();
    const containerTag = getContainerTag(cwd);

    debugLog(settings, 'Stop', {
      cwd,
      containerTag,
      turns: transcript.length
    });

    const client = new StorageClient();

    // Compress and save transcript
    const summary = compressTranscript(transcript, settings);
    const sessionId = `session_${Date.now()}`;

    await client.addMemory(
      summary,
      containerTag,
      {
        sm_source: 'claude-code-plugin',
        sessionId,
        turns: transcript.length
      },
      sessionId
    );

    // Sync to GitHub
    const syncResult = await client.syncToGitHub().catch(() => ({ success: false }));

    if (syncResult.success) {
      debugLog(settings, 'Synced to GitHub', { count: syncResult.synced });
    } else {
      debugLog(settings, 'GitHub sync failed, will retry later');
    }

    client.close();
    writeOutput({});
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Claude Memory: ${err.message}`);
    writeOutput({});
  }
}

main().catch((err) => {
  console.error(`Claude Memory fatal: ${err.message}`);
  process.exit(1);
});
```

**Step 2: Test summary hook (manual - requires stdin)**

Skip automated test - will test during full integration

**Step 3: Commit**

```bash
git add src/summary-hook.js
git commit -m "feat: update summary hook with GitHub sync"
```

---

### Task 15: Update Search Memory

**Files:**
- Modify: `src/search-memory.js`

**Step 1: Replace SupermemoryClient with StorageClient**

Replace the entire file:

```javascript
const { StorageClient } = require('./lib/storage-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings } = require('./lib/settings');

async function main() {
  const query = process.argv.slice(2).join(' ');

  if (!query || !query.trim()) {
    console.log('No search query provided. Please specify what you want to search for.');
    return;
  }

  const settings = loadSettings();
  const cwd = process.cwd();
  const containerTag = getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new StorageClient();
    const result = await client.getProfile(containerTag, query);

    console.log(`## Memory Search: "${query}"`);
    console.log(`Project: ${projectName}\n`);

    if (result.profile) {
      if (result.profile.static?.length > 0) {
        console.log('### User Preferences');
        result.profile.static.forEach((fact) => console.log(`- ${fact}`));
        console.log('');
      }
      if (result.profile.dynamic?.length > 0) {
        console.log('### Recent Context');
        result.profile.dynamic.forEach((fact) => console.log(`- ${fact}`));
        console.log('');
      }
    }

    if (result.searchResults?.results?.length > 0) {
      console.log('### Relevant Memories');
      result.searchResults.results.forEach((mem, i) => {
        const similarity = Math.round((mem.similarity || 0.5) * 100);
        const content = mem.memory || mem.content || '';
        console.log(`\n**Memory ${i + 1}** (${similarity}% match)`);
        if (mem.title) console.log(`*${mem.title}*`);
        console.log(content.slice(0, 500));
      });
    } else {
      const searchResult = await client.search(query, containerTag, { limit: 10 });
      if (searchResult.results?.length > 0) {
        console.log('### Relevant Memories');
        searchResult.results.forEach((mem, i) => {
          const similarity = Math.round((mem.similarity || 0.5) * 100);
          const content = mem.memory || mem.content || '';
          console.log(`\n**Memory ${i + 1}** (${similarity}% match)`);
          if (mem.title) console.log(`*${mem.title}*`);
          console.log(content.slice(0, 500));
        });
      } else {
        console.log('No memories found matching your query.');
        console.log('Memories are automatically saved as you work in this project.');
      }
    }

    client.close();
  } catch (err) {
    console.log(`Error searching memories: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
```

**Step 2: Test search**

Run: `node src/search-memory.js "test query"`
Expected: Outputs "No memories found" message (database is empty)

**Step 3: Commit**

```bash
git add src/search-memory.js
git commit -m "feat: update search-memory to use local storage"
```

---

## Phase 6: Commands

### Task 16: Add Sync Command

**Files:**
- Create: `plugin/commands/sync.md`

**Step 1: Create sync command**

```markdown
---
command-name: claude-memory:sync
description: Force immediate sync to GitHub
---

Force an immediate sync of pending memories to GitHub.

This command will:
1. Export all pending memories to JSON
2. Commit and push to GitHub repository
3. Mark memories as synced

Use this if you want to manually trigger a sync instead of waiting for session end.

**Usage:**
```
/claude-memory:sync
```

**What it does:**
- Exports pending memories to `memories/project-name/YYYY-MM/` in GitHub repo
- Creates a commit with message describing the sync
- Pushes to remote repository
- Updates local database to mark memories as synced

**If offline:**
Will fail gracefully with message about GitHub being unavailable.
```

**Step 2: Create sync script**

Create: `src/commands/sync.js`

```javascript
const { StorageClient } = require('../lib/storage-client');

async function main() {
  try {
    const client = new StorageClient();

    console.log('Syncing memories to GitHub...');
    const result = await client.syncToGitHub();

    if (result.success) {
      console.log(`✓ Synced ${result.synced} memories to GitHub`);
    } else {
      console.log(`✗ Sync failed: ${result.error}`);
      if (result.error.includes('authenticated')) {
        console.log('Run `gh auth login` to authenticate with GitHub');
      }
    }

    client.close();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
```

**Step 3: Update build script to compile sync command**

Will be handled in build step - skip for now

**Step 4: Commit**

```bash
git add plugin/commands/sync.md src/commands/sync.js
git commit -m "feat: add sync command for manual GitHub sync"
```

---

### Task 17: Add Status Command

**Files:**
- Create: `plugin/commands/status.md`
- Create: `src/commands/status.js`

**Step 1: Create status command markdown**

```markdown
---
command-name: claude-memory:status
description: Show memory storage status
---

Display information about local memory storage and GitHub sync status.

**Usage:**
```
/claude-memory:status
```

**Shows:**
- Total memories stored locally
- Memories pending sync to GitHub
- Last GitHub sync time
- GitHub repository info
- Authentication status
```

**Step 2: Create status script**

```javascript
const { StorageClient } = require('../lib/storage-client');
const { GitHubAuth } = require('../lib/github-auth');
const { SqliteManager } = require('../lib/sqlite-manager');

async function main() {
  try {
    const client = new StorageClient();
    const auth = new GitHubAuth();

    // Count total memories
    const db = client.db;
    const totalStmt = db.db.prepare('SELECT COUNT(*) as count FROM memories');
    const total = totalStmt.get().count;

    // Count pending
    const pending = client.db.getPendingSync().length;

    // Last sync time
    const lastSyncStmt = db.db.prepare('SELECT MAX(synced_at) as last_sync FROM memories WHERE synced_at IS NOT NULL');
    const lastSync = lastSyncStmt.get().last_sync;

    console.log('## Claude Memory Status\n');
    console.log(`**Local Storage:**`);
    console.log(`- Total memories: ${total}`);
    console.log(`- Pending sync: ${pending}`);
    console.log(`- Database: ~/.claude-memory/memories.db\n`);

    console.log(`**GitHub Sync:**`);
    if (auth.isAuthenticated()) {
      console.log(`- Status: Authenticated ✓`);
      if (lastSync) {
        const date = new Date(lastSync);
        console.log(`- Last sync: ${date.toLocaleString()}`);
      } else {
        console.log(`- Last sync: Never`);
      }
      console.log(`- Repository: ~/.claude-memory/repo`);
    } else {
      console.log(`- Status: Not authenticated ✗`);
      console.log(`- Run \`gh auth login\` to enable GitHub sync`);
    }

    client.close();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
```

**Step 3: Commit**

```bash
git add plugin/commands/status.md src/commands/status.js
git commit -m "feat: add status command to show storage info"
```

---

### Task 18: Rename Index Command

**Files:**
- Modify: `plugin/commands/index.md`

**Step 1: Update command name**

Change first line from:
```markdown
---
command-name: claude-supermemory:index
```

To:
```markdown
---
command-name: claude-memory:index
```

**Step 2: Update references in description**

Replace "Supermemory" with "Claude Memory" in the description

**Step 3: Commit**

```bash
git add plugin/commands/index.md
git commit -m "refactor: rename index command to claude-memory namespace"
```

---

### Task 19: Remove Logout Command

**Files:**
- Delete: `plugin/commands/logout.md`

**Step 1: Delete logout command**

Run: `git rm plugin/commands/logout.md`

**Step 2: Commit**

```bash
git commit -m "refactor: remove logout command (no external auth)"
```

---

## Phase 7: Build and Package

### Task 20: Update Build Script

**Files:**
- Modify: `scripts/build.js`

**Step 1: Add new files to build**

Add to the files array:

```javascript
  // New storage files
  { src: 'src/lib/sqlite-manager.js', dest: 'plugin/scripts/sqlite-manager.cjs' },
  { src: 'src/lib/github-auth.js', dest: 'plugin/scripts/github-auth.cjs' },
  { src: 'src/lib/github-sync.js', dest: 'plugin/scripts/github-sync.cjs' },
  { src: 'src/lib/storage-client.js', dest: 'plugin/scripts/storage-client.cjs' },

  // New commands
  { src: 'src/commands/sync.js', dest: 'plugin/scripts/sync.cjs' },
  { src: 'src/commands/status.js', dest: 'plugin/scripts/status.cjs' },
```

**Step 2: Build**

Run: `npm run build`
Expected: All files compiled to .cjs without errors

**Step 3: Commit**

```bash
git add scripts/build.js plugin/scripts/*.cjs
git commit -m "build: compile new storage modules"
```

---

### Task 21: Update Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Remove supermemory dependency**

Remove from dependencies:
```json
"supermemory": "^4.0.0"
```

**Step 2: Update package name and description**

```json
{
  "name": "claude-memory",
  "version": "2.0.0",
  "description": "Local + GitHub memory storage for Claude Code",
```

**Step 3: Install and verify**

Run: `npm install`
Expected: Dependencies installed, supermemory removed

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: remove supermemory, bump to v2.0.0"
```

---

## Phase 8: Documentation

### Task 22: Update README

**Files:**
- Modify: `README.md`

**Step 1: Replace installation section**

Update to:

```markdown
## Installation

```bash
# Install from local directory
/plugin install /path/to/claude-memory

# Or add to marketplace
/plugin marketplace add /path/to/claude-memory
/plugin install claude-memory
```

**Prerequisites:**
- GitHub CLI (`gh`) recommended - [Install gh](https://cli.github.com/)
- Or set `CLAUDE_MEMORY_GITHUB_TOKEN` environment variable

## First-Time Setup

On first run, the plugin will:
1. Create local SQLite database at `~/.claude-memory/memories.db`
2. Prompt to create private GitHub repository for cloud backup
3. Authenticate with GitHub (via `gh` CLI or OAuth)

That's it! Memories will now be saved locally and synced to GitHub.
```

**Step 2: Update features section**

```markdown
## Features

- **Local-First Storage** - SQLite database for instant access, works offline
- **Cloud Backup** - Automatic sync to private GitHub repository
- **Full-Text Search** - Fast memory search with relevance ranking
- **Context Injection** - Relevant memories automatically loaded on session start
- **Multi-Device Sync** - Work across machines with conflict resolution
- **No Subscription** - Free, open-source, no API costs
```

**Step 3: Update commands section**

```markdown
## Commands

### /claude-memory:index
Index your codebase into memory storage.

### /claude-memory:sync
Force immediate sync to GitHub (normally auto-syncs on session end).

### /claude-memory:status
Show memory storage and sync status.
```

**Step 4: Update configuration section**

```markdown
## Configuration

### Environment Variables

```bash
# Optional: Custom GitHub repo (default: auto-creates claude-memory-storage)
CLAUDE_MEMORY_REPO=username/custom-repo

# Optional: GitHub PAT for manual auth
CLAUDE_MEMORY_GITHUB_TOKEN=ghp_...

# Optional: Storage location
CLAUDE_MEMORY_DIR=/custom/path

# Optional: Debug logging
CLAUDE_MEMORY_DEBUG=true
```

### Settings File

`~/.claude-memory/settings.json`:

```json
{
  "skipTools": ["Read", "Glob", "Grep"],
  "captureTools": ["Edit", "Write", "Bash", "Task"],
  "maxProfileItems": 5,
  "debug": false
}
```
```

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for local+GitHub storage"
```

---

## Phase 9: Testing & Validation

### Task 23: Integration Test

**Files:**
- Create: `test-integration.sh`

**Step 1: Create integration test script**

```bash
#!/bin/bash
set -e

echo "=== Claude Memory Integration Test ==="

# Cleanup
rm -rf /tmp/claude-memory-test
mkdir -p /tmp/claude-memory-test
cd /tmp/claude-memory-test

echo "1. Testing SQLite database creation..."
node -e "
const {SqliteManager} = require('$(pwd)/src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-integration.db');
console.log('✓ Database created');
db.close();
"

echo "2. Testing memory CRUD..."
node -e "
const {SqliteManager} = require('$(pwd)/src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-integration.db');
db.addMemory('m1', 'Test memory 1', 'project1', {test: true});
db.addMemory('m2', 'Test memory 2', 'project1', {test: true});
const mem = db.getMemory('m1');
if (mem.content !== 'Test memory 1') throw new Error('CRUD failed');
console.log('✓ CRUD operations work');
db.close();
"

echo "3. Testing search..."
node -e "
const {SqliteManager} = require('$(pwd)/src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-integration.db');
const results = db.searchMemories('Test', 'project1');
if (results.length !== 2) throw new Error('Search failed');
console.log('✓ Search works');
db.close();
"

echo "4. Testing storage client..."
node -e "
const {StorageClient} = require('$(pwd)/src/lib/storage-client.js');
const client = new StorageClient('/tmp/test-integration.db');
const result = client.addMemory('Client test', 'project1');
if (result.status !== 'saved') throw new Error('Client failed');
console.log('✓ Storage client works');
client.close();
"

echo "5. Testing pending sync..."
node -e "
const {SqliteManager} = require('$(pwd)/src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-integration.db');
const pending = db.getPendingSync();
if (pending.length === 0) throw new Error('Pending sync failed');
console.log('✓ Pending sync tracking works');
db.close();
"

echo ""
echo "=== All Integration Tests Passed ✓ ==="
```

**Step 2: Make executable and run**

Run:
```bash
chmod +x test-integration.sh
./test-integration.sh
```
Expected: All tests pass with ✓

**Step 3: Commit**

```bash
git add test-integration.sh
git commit -m "test: add integration test suite"
```

---

### Task 24: Manual End-to-End Test

**Manual Testing Checklist:**

1. **First-time setup:**
   - [ ] Delete `~/.claude-memory` if exists
   - [ ] Start Claude Code session
   - [ ] Verify prompt to create GitHub repo
   - [ ] Verify database created
   - [ ] Verify GitHub repo created

2. **Memory capture:**
   - [ ] Make some edits in a project
   - [ ] Stop session
   - [ ] Verify memories saved to SQLite
   - [ ] Check GitHub repo for JSON files

3. **Context injection:**
   - [ ] Start new session in same project
   - [ ] Verify memories injected into context
   - [ ] Ask Claude about previous work

4. **Search:**
   - [ ] Run `/super-search "previous work"`
   - [ ] Verify results returned

5. **Commands:**
   - [ ] Run `/claude-memory:status`
   - [ ] Run `/claude-memory:sync`
   - [ ] Verify sync completes

6. **Offline mode:**
   - [ ] Disconnect internet
   - [ ] Start session
   - [ ] Verify works with offline warning
   - [ ] Make edits, stop session
   - [ ] Reconnect internet
   - [ ] Start session, verify sync resumes

**Document results in:** `docs/manual-test-results.md`

---

## Phase 10: Cleanup

### Task 25: Remove Old Files

**Files:**
- Delete: `src/lib/supermemory-client.js`
- Delete: `src/lib/auth.js` (old Supermemory auth)

**Step 1: Remove old Supermemory client**

Run: `git rm src/lib/supermemory-client.js`

**Step 2: Check if auth.js is still needed**

Review `src/lib/auth.js` - if it's only for Supermemory browser auth, remove it:
Run: `git rm src/lib/auth.js`

If it has utilities used elsewhere, keep it.

**Step 3: Commit**

```bash
git commit -m "cleanup: remove Supermemory client and old auth"
```

---

### Task 26: Final Build

**Step 1: Clean and rebuild**

Run:
```bash
npm run clean
npm run build
```
Expected: All scripts compiled successfully

**Step 2: Verify all hooks have .cjs files**

Run: `ls -la plugin/scripts/`
Expected: All hooks and commands have .cjs versions

**Step 3: Commit**

```bash
git add plugin/scripts/*.cjs
git commit -m "build: final build of all modules"
```

---

### Task 27: Version Tag

**Step 1: Create git tag**

Run: `git tag -a v2.0.0 -m "Release v2.0.0: Local + GitHub storage"`

**Step 2: Verify tag**

Run: `git tag -l`
Expected: v2.0.0 listed

**Step 3: Push (when ready)**

Note: Don't push yet - will be done after full testing

---

## Summary

**Total Tasks:** 27
**Estimated Time:** 8-10 hours

**Key Milestones:**
1. ✓ SQLite storage layer complete (Tasks 1-5)
2. ✓ GitHub authentication (Tasks 6-7)
3. ✓ GitHub sync mechanism (Tasks 8-11)
4. ✓ Storage client integration (Task 12)
5. ✓ Hook updates (Tasks 13-15)
6. ✓ Commands (Tasks 16-19)
7. ✓ Build and package (Tasks 20-21)
8. ✓ Documentation (Task 22)
9. ✓ Testing (Tasks 23-24)
10. ✓ Cleanup and release (Tasks 25-27)

**Next Steps:**
1. Use @superpowers:executing-plans or @superpowers:subagent-driven-development to implement
2. Test thoroughly, especially offline mode and conflict resolution
3. Consider beta testing with users before full release
4. Document migration path for existing Supermemory users
