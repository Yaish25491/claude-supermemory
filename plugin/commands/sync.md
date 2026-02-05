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
