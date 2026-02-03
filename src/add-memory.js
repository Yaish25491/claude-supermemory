const { StorageClient } = require('./lib/storage-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings } = require('./lib/settings');

async function main() {
  const content = process.argv.slice(2).join(' ');

  if (!content || !content.trim()) {
    console.log(
      'No content provided. Usage: node add-memory.cjs "content to save"',
    );
    return;
  }

  const _settings = loadSettings();
  const cwd = process.cwd();
  const containerTag = getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new StorageClient();
    const result = await client.addMemory(content, containerTag, {
      type: 'manual',
      project: projectName,
      timestamp: new Date().toISOString(),
    });

    console.log(`Memory saved to project: ${projectName}`);
    console.log(`ID: ${result.id}`);

    client.close();
  } catch (err) {
    console.log(`Error saving memory: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
