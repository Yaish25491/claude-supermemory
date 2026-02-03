#!/usr/bin/env node
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'plugin', 'scripts');

const hooks = [
  'context-hook',
  'prompt-hook',
  'observation-hook',
  'summary-hook',
  'search-memory',
  'add-memory',
];

const commands = ['commands/sync', 'commands/status'];

async function build() {
  console.log('Building scripts...\n');

  fs.mkdirSync(OUT, { recursive: true });

  const allFiles = [
    ...hooks.map((h) => ({ name: h, path: h })),
    ...commands.map((c) => ({ name: c.split('/')[1], path: c })),
  ];

  for (const { name, path: filePath } of allFiles) {
    const entry = path.join(SRC, `${filePath}.js`);
    const out = path.join(OUT, `${name}.cjs`);

    try {
      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        outfile: out,
        minify: true,
        banner: { js: '#!/usr/bin/env node' },
        loader: { '.html': 'text' },
      });

      fs.chmodSync(out, 0o755);
      const stats = fs.statSync(out);
      console.log(`  ${name}.cjs (${(stats.size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`Failed to build ${name}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\nBuild complete!');
}

build();
