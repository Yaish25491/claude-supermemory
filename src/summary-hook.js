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
