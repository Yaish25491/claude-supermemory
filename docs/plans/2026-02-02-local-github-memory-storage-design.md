# Local + GitHub Memory Storage Design

**Date:** 2026-02-02
**Status:** Approved
**Goal:** Replace Supermemory paid API with hybrid local+GitHub storage for claude-supermemory plugin

## Overview

This design replaces the dependency on Supermemory's paid cloud API with a hybrid local-first architecture using SQLite for fast local storage and GitHub as a cloud backup/sync layer. This provides:

- **No external API dependency** - Works offline, no subscription required
- **Fast local access** - SQLite provides instant memory retrieval
- **Cloud backup** - GitHub repository for backup and multi-device sync
- **Version control** - Git history of all memory changes
- **Conflict resolution** - Manual control when memories diverge across devices

## Architecture

### Storage Layers

**1. Local SQLite Database (`~/.claude-memory/memories.db`)**
- Primary storage for real-time access
- Full-text search with FTS5 indexes
- Stores all memories, profiles, and metadata
- Instant query performance, works offline

**2. GitHub Private Repository**
- Cloud backup and sync layer
- Human-readable JSON exports organized by project/date
- Structure: `memories/project-name/YYYY-MM/DD-session-id.json`
- Handles multi-device sync with git merge capabilities

### Data Flow

```
Session Start:
├─ Load from local SQLite
├─ Pull latest from GitHub (background)
├─ Detect conflicts → Manual resolution if needed
└─ Inject context into Claude

During Session:
├─ All writes go to SQLite immediately
└─ No network I/O (fast, works offline)

Session End:
├─ Export new/modified memories to JSON
├─ Commit to git with descriptive message
├─ Push to GitHub
└─ Mark memories as synced in SQLite
```

### Sync Strategy

**Background sync on session end:**
- Memories save instantly to SQLite during session
- On session end: export → commit → push to GitHub
- Clean git history, minimal commits
- Graceful degradation if GitHub unavailable

**Conflict resolution:**
- Detected during pull when same memory modified on different devices
- Show side-by-side diff with timestamps
- Prompt user: Keep Local / Keep Remote / Merge Both
- Never auto-resolve to prevent data loss

## Database Schema

### SQLite Tables

```sql
-- Core memories storage
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  container_tag TEXT NOT NULL,
  metadata TEXT,  -- JSON blob
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at INTEGER,  -- Last GitHub sync timestamp
  sync_status TEXT DEFAULT 'pending'  -- pending|synced|conflict
);

-- User profiles and preferences
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  container_tag TEXT NOT NULL,
  fact TEXT NOT NULL,
  type TEXT DEFAULT 'static',  -- static|dynamic
  created_at INTEGER NOT NULL,
  synced_at INTEGER
);

-- Sync state tracking
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);

-- Full-text search index
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  container_tag,
  content=memories,
  content_rowid=rowid
);
```

### Indexes

```sql
CREATE INDEX idx_memories_container ON memories(container_tag);
CREATE INDEX idx_memories_created ON memories(created_at);
CREATE INDEX idx_memories_sync_status ON memories(sync_status);
CREATE INDEX idx_profiles_container ON profiles(container_tag);
```

## GitHub Repository Structure

```
claude-memory-storage/
├── memories/
│   ├── project-name-1/
│   │   ├── 2026-02/
│   │   │   ├── 02-session-abc123.json
│   │   │   └── 02-session-def456.json
│   │   └── 2026-01/
│   │       └── 28-session-xyz789.json
│   └── project-name-2/
│       └── 2026-02/
├── profiles/
│   └── user-preferences.json
├── .metadata/
│   └── sync-manifest.json
└── README.md
```

### Memory JSON Format

```json
{
  "id": "mem_abc123",
  "content": "Implemented OAuth flow using Passport.js...",
  "containerTag": "my-app",
  "metadata": {
    "sm_source": "claude-code-plugin",
    "sessionId": "session-abc123",
    "toolsUsed": ["Edit", "Write"]
  },
  "createdAt": 1738454400000,
  "updatedAt": 1738454400000
}
```

## GitHub Sync Mechanism

### Sync Process (Session End)

1. **Export Phase**
   - Query SQLite: `SELECT * FROM memories WHERE sync_status = 'pending'`
   - Serialize to JSON with full metadata
   - Organize into date/project folder structure

2. **Git Operations**
   - `git pull origin main` - Get latest changes
   - Detect conflicts: compare timestamps/hashes
   - If conflicts → pause and invoke conflict resolution UI
   - If clean → write JSON files, `git add`, `git commit`
   - Commit message: `"Session memories: project-name (3 new)"`
   - `git push origin main`

3. **Update Local State**
   - Mark synced memories: `UPDATE memories SET sync_status = 'synced', synced_at = ? WHERE id IN (?)`
   - Update sync manifest in repo

### Conflict Detection

Conflicts occur when:
- Same `memory.id` exists in both local DB and remote JSON
- `updated_at` timestamps differ
- Content hash differs

Resolution process:
1. Write conflict details to `~/.claude-memory/conflicts/YYYY-MM-DD.json`
2. Display diff in terminal with timestamps
3. Prompt: `"Memory conflict detected. [L]ocal (updated 2h ago) / [R]emote (updated 5h ago) / [M]erge both?"`
4. Apply choice, mark conflict as resolved, continue sync

## Authentication & Setup

### Authentication Hierarchy

**1. GitHub CLI (gh) - Primary**
- Check: `gh auth status`
- If authenticated, use `gh api` for all operations
- No additional setup for developers who already use `gh`

**2. OAuth Device Flow - Fallback**
- If `gh` not available, initiate device flow
- Display code: "Enter code ABC-DEF at github.com/login/device"
- Poll for completion
- Store refresh token: `~/.claude-memory/github-token.json` (encrypted)

**3. Manual PAT - Override**
- Environment variable: `CLAUDE_MEMORY_GITHUB_TOKEN`
- For custom setups or CI/CD environments

### First-Run Setup

```
Session Start:
├─ Check for ~/.claude-memory/memories.db
├─ If missing:
│   ├─ Print: "Claude Memory: First-time setup"
│   ├─ Create SQLite database with schema
│   ├─ Check GitHub authentication
│   ├─ If authenticated:
│   │   ├─ Prompt: "Create private GitHub repo 'claude-memory-storage'? [Y/n]"
│   │   ├─ If yes:
│   │   │   ├─ POST /user/repos {name, private: true}
│   │   │   ├─ Initialize with README
│   │   │   └─ Store repo info in sync_state
│   │   └─ Print: "✓ Local memory initialized. GitHub sync ready."
│   └─ If not authenticated:
│       ├─ Print: "GitHub authentication required for cloud sync"
│       └─ Initiate auth flow
└─ Continue with session
```

### Repository Initialization

- Creates via GitHub API: `POST /user/repos`
- Payload: `{name: "claude-memory-storage", private: true, description: "Claude Code memory storage"}`
- Initializes with README explaining purpose
- Stores config: `~/.claude-memory/sync-config.json` → `{repoOwner, repoName, lastSync}`

## Error Handling & Offline Resilience

### Offline Detection

- Before sync: lightweight check `gh api /user` or ping `api.github.com`
- If fails: set `offline_mode = true`, skip GitHub operations

### Error Scenarios

**1. GitHub Unavailable**
- Network down, API limits, auth expired
- Behavior: Continue session with SQLite-only storage
- UI: `<supermemory-status>⚠ Working offline - GitHub sync will resume when available</supermemory-status>`
- Recovery: Queue memories as `sync_status = 'pending'`, auto-retry next session

**2. Merge Conflicts**
- Detected during pull (file timestamp/hash mismatch)
- Behavior: Halt sync, write conflict details to `~/.claude-memory/conflicts/`
- UI: Show interactive diff, prompt for resolution
- Recovery: After resolution, mark as resolved and complete sync

**3. Repository Deleted/Missing**
- Detected on pull (404 error)
- Behavior: Prompt "GitHub repository not found. Recreate it? [Y/n]"
- If yes: Create new repo, push all local memories
- If no: Continue offline-only mode

**4. SQLite Corruption**
- Keep daily backups: `~/.claude-memory/backups/memories-YYYY-MM-DD.db`
- On corruption: Restore from latest backup
- If backup stale: Re-import from GitHub JSON files

### Recovery Commands

- `/claude-memory:sync` - Force immediate sync attempt
- `/claude-memory:resolve-conflicts` - Open conflict resolution UI
- `/claude-memory:repair` - Rebuild SQLite from GitHub JSON

## Memory Search & Retrieval

### Search Implementation

**FTS5 Full-Text Search:**

```sql
-- Search with ranking
SELECT m.*,
       rank * -1 as relevance_score
FROM memories_fts f
JOIN memories m ON f.rowid = m.rowid
WHERE memories_fts MATCH ?
  AND container_tag = ?
ORDER BY rank
LIMIT 10;
```

### Search Modes

**1. Context Search (Session Start)**

Hybrid query combining:
- Project memories: `container_tag = 'current-project'`
- Recent memories: last 7 days, weighted higher
- Relevant memories: FTS match on project name/keywords
- User profile: Static preferences from `profiles` table

**2. Explicit Search (super-search skill)**

Full-text search across all memories:
- By project: `container_tag = 'project-name'`
- By date range: `created_at BETWEEN ? AND ?`
- Ranked by BM25 similarity

**3. Profile Retrieval**

Combines:
- Static preferences (persistent facts)
- Dynamic context (recent patterns)
- Limited to `maxProfileItems` (default: 5)

### Relevance Scoring

```javascript
// Combined score
score = fts5_bm25_score * recency_boost * project_boost

// Recency boost: newer = higher
recency_boost = 1 / (days_old + 1)

// Project boost: exact match = 2x
project_boost = (container_tag === current_project) ? 2.0 : 1.0
```

### Performance Optimization

- FTS5 index maintained via triggers on INSERT/UPDATE
- Prepared statements for frequent queries
- Index synchronization: `INSERT INTO memories_fts(rowid, content, container_tag) VALUES (new.rowid, new.content, new.container_tag)`

## Migration from Supermemory

### Migration Command: `/claude-memory:import-supermemory`

One-time migration for existing users:

**Process:**

1. **Check Credentials**
   - Look for `SUPERMEMORY_CC_API_KEY`
   - If not found, skip (fresh install)

2. **Fetch Existing Data**
   - Use existing `SupermemoryClient`
   - Call `listMemories()` paginated
   - Call `getProfile()` for user preferences
   - Progress: "Importing memories: 45/120..."

3. **Import to SQLite**
   - Insert each memory preserving timestamps
   - Map fields: `content`, `containerTag → container_tag`, `metadata`
   - Mark as `sync_status = 'pending'`

4. **Initial GitHub Sync**
   - Export all imported memories to JSON
   - Commit: "Initial import from Supermemory (120 memories)"
   - Push to GitHub

5. **Cleanup (Optional)**
   - Prompt: "Delete Supermemory data after successful import? [y/N]"
   - If yes: Call Supermemory delete API for each memory
   - Remove API key reminder

### Backwards Compatibility

- Keep `SupermemoryClient` temporarily for migration only
- After migration, can be removed
- No ongoing dependency on Supermemory SDK

## Hook Modifications

### SessionStart Hook (`context-hook.js`)

**Before:**
```javascript
const client = new SupermemoryClient(apiKey);
const profileResult = await client.getProfile(containerTag, projectName);
```

**After:**
```javascript
const storage = new StorageClient(); // SQLite wrapper
await storage.syncFromGitHub(); // Non-blocking, handles conflicts
const profileResult = await storage.getProfile(containerTag, projectName);
```

Changes:
- Remove API key validation
- Add GitHub connectivity check (non-blocking)
- Handle conflicts if detected
- Fast local SQLite queries

### Stop Hook (`summary-hook.js`)

**Before:**
```javascript
await client.addMemory(summary, containerTag, metadata);
```

**After:**
```javascript
await storage.addMemory(summary, containerTag, metadata);
await storage.syncToGitHub(); // Export, commit, push
```

Changes:
- Save to SQLite immediately
- Export to JSON files
- Commit and push to GitHub
- Handle errors gracefully (queue if offline)

### PostToolUse Hook (`observation-hook.js`)

Minimal changes:
- Still captures Edit/Write/Bash/Task observations
- Stores locally via `StorageClient` instead of API

### UserPromptSubmit Hook (`prompt-hook.js`)

Minimal changes:
- Still processes prompts
- Stores locally instead of API

## Commands & Configuration

### Updated Commands

**`/claude-memory:sync`**
- Force immediate GitHub sync
- Exports pending memories, commits, pushes
- Shows: "✓ Synced 5 memories to GitHub"

**`/claude-memory:resolve-conflicts`**
- Interactive conflict resolution
- Lists all conflicts with diffs
- Prompts: "Keep [L]ocal, [R]emote, or [M]erge?"

**`/claude-memory:status`**
- Display storage status
- Local memory count
- Last GitHub sync time
- Pending sync count
- GitHub repo info

**`/claude-memory:import-supermemory`**
- One-time migration from Supermemory
- Fetches existing memories
- Imports to local SQLite + GitHub

**`/claude-memory:repair`**
- Rebuild SQLite from GitHub JSON
- Useful if database corrupted
- Pulls all JSON, reconstructs database

**`/claude-memory:index`** (renamed from `/claude-supermemory:index`)
- Index codebase into memory
- Stores project structure, patterns, conventions

### Removed Commands

- `/claude-supermemory:logout` - No external auth to logout from

### Environment Variables

```bash
# Optional: Custom GitHub repo (default: auto-creates)
CLAUDE_MEMORY_REPO=username/custom-memory-repo

# Optional: GitHub PAT for manual auth
CLAUDE_MEMORY_GITHUB_TOKEN=ghp_...

# Optional: Storage location (default: ~/.claude-memory)
CLAUDE_MEMORY_DIR=/custom/path

# Optional: Debug logging
CLAUDE_MEMORY_DEBUG=true
```

### Settings File (`~/.claude-memory/settings.json`)

```json
{
  "skipTools": ["Read", "Glob", "Grep"],
  "captureTools": ["Edit", "Write", "Bash", "Task"],
  "maxProfileItems": 5,
  "githubRepo": "username/claude-memory-storage",
  "syncOnSessionEnd": true,
  "autoResolveConflicts": false,
  "debug": false
}
```

## Implementation Notes

### Components Requiring Changes

**New Files:**
- `src/lib/storage-client.js` - SQLite wrapper with search/CRUD operations
- `src/lib/sqlite-manager.js` - Database setup, migrations, schema
- `src/lib/github-sync.js` - Export, commit, push, pull, conflict detection
- `src/lib/github-auth.js` - Authentication via gh CLI / OAuth
- `src/lib/conflict-resolver.js` - Interactive conflict resolution UI

**Modified Files:**
- `src/context-hook.js` - Use `StorageClient` instead of `SupermemoryClient`
- `src/summary-hook.js` - Add GitHub sync on session end
- `src/search-memory.js` - Query local SQLite with FTS5
- `src/add-memory.js` - Write to SQLite + queue for sync

**Removed Dependencies:**
- `supermemory` npm package (4.0.0)

**New Dependencies:**
- `better-sqlite3` - Fast SQLite bindings
- `simple-git` - Git operations (alternative to shelling out)
- Or use `gh` CLI directly via shell commands (zero dependencies)

### Testing Considerations

- Test offline mode thoroughly
- Test conflict resolution with multiple devices
- Test migration from Supermemory
- Test SQLite corruption recovery
- Test large memory collections (1000+ memories)
- Test FTS5 search relevance

## Success Criteria

✓ Plugin works without internet connection
✓ No Supermemory API dependency or subscription required
✓ Memories sync to GitHub automatically on session end
✓ Conflict resolution prevents data loss on multi-device usage
✓ Search performance remains fast with 1000+ memories
✓ Existing Supermemory users can migrate seamlessly
✓ First-time setup is straightforward (< 2 minutes)
✓ Graceful degradation when GitHub unavailable

## Timeline Estimate

- **Phase 1:** SQLite storage layer (2-3 days)
- **Phase 2:** GitHub sync mechanism (2-3 days)
- **Phase 3:** Hook modifications (1-2 days)
- **Phase 4:** Migration tooling (1-2 days)
- **Phase 5:** Testing & refinement (2-3 days)

**Total:** ~8-13 days for full implementation

## Future Enhancements

- Export memories to Markdown for manual review
- Web UI for browsing memory history
- Support other git providers (GitLab, Bitbucket)
- Encrypted memory storage option
- Memory tagging and categorization
- Analytics dashboard (memory growth, most-used projects)
