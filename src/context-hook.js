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
    const syncResult = await client
      .syncFromGitHub()
      .catch(() => ({ success: false }));
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
      settings.maxProfileItems || 5,
    );

    if (!additionalContext) {
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `<supermemory-context>
No previous memories found for this project.
Memories will be saved as you work.
${syncResult.success ? '' : '⚠ GitHub sync unavailable - working offline'}
</supermemory-context>`,
        },
      });
      client.close();
      return;
    }

    debugLog(settings, 'Context generated', {
      length: additionalContext.length,
    });

    const statusNote = syncResult.success
      ? ''
      : '\n⚠ GitHub sync unavailable - working offline';

    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: additionalContext + statusNote,
      },
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
</supermemory-status>`,
      },
    });
  }
}

main().catch((err) => {
  console.error(`Claude Memory fatal: ${err.message}`);
  process.exit(1);
});
