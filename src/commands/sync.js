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
