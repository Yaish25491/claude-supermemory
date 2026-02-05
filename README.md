# Claude Memory

A Claude Code plugin that gives your AI persistent memory across sessions using local SQLite storage with GitHub backup.

Your agent remembers what you worked on - across sessions, across projects, across machines.

## Features

- **Local-First Storage** - SQLite database for instant access, works offline
- **Cloud Backup** - Automatic sync to private GitHub repository
- **Full-Text Search** - Fast memory search with relevance ranking
- **Context Injection** - Relevant memories automatically loaded on session start
- **Multi-Device Sync** - Work across machines with conflict resolution
- **No Subscription** - Free, open-source, no API costs

## Installation

```bash
# Add the plugin directory as a marketplace
/plugin marketplace add /path/to/claude-supermemory

# Install the plugin
/plugin install claude-memory

# Verify installation
/plugin list
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

## Commands

### /claude-memory:index
Index your codebase into memory storage.

### /claude-memory:sync
Force immediate sync to GitHub (normally auto-syncs on session end).

### /claude-memory:status
Show memory storage and sync status.

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

## How It Works

### Session Start
- Plugin syncs from GitHub (pulls latest memories)
- Searches for relevant memories based on project context
- Injects memories into Claude's context

### During Session
- Conversation transcript is captured
- Important actions and decisions are noted

### Session End
- Transcript is compressed and saved to local SQLite
- Automatically syncs to GitHub
- Memories organized by project and date

### Offline Mode
- Works completely offline with local SQLite
- Syncs when connection is restored
- Graceful degradation if GitHub unavailable

## Storage Structure

### Local Database
```
~/.claude-memory/
├── memories.db          # SQLite database with FTS5 search
└── repo/               # Git repository for GitHub sync
    ├── memories/       # Memory JSON files
    │   └── project-name/
    │       └── 2026-02/
    │           └── 02-session_123.json
    └── profiles/       # User preferences
        └── user-preferences.json
```

### GitHub Repository
Private repository with organized memory storage:
- `memories/` - Session transcripts organized by project/date
- `profiles/` - User preferences and static facts
- Searchable history via git log
- Cross-device sync via git pull/push

## License

MIT
