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
