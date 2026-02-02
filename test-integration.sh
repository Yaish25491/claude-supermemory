#!/bin/bash
set -e

echo "=== Claude Memory Integration Test ==="

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cleanup
rm -rf /tmp/claude-memory-test
mkdir -p /tmp/claude-memory-test

echo "1. Testing SQLite database creation..."
node -e "
const {SqliteManager} = require('${REPO_DIR}/src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-integration.db');
console.log('✓ Database created');
db.close();
"

echo "2. Testing memory CRUD..."
node -e "
const {SqliteManager} = require('${REPO_DIR}/src/lib/sqlite-manager.js');
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
const {SqliteManager} = require('${REPO_DIR}/src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-integration.db');
const results = db.searchMemories('Test', 'project1');
if (results.length !== 2) throw new Error('Search failed');
console.log('✓ Search works');
db.close();
"

echo "4. Testing storage client..."
node -e "
(async () => {
  const {StorageClient} = require('${REPO_DIR}/src/lib/storage-client.js');
  const client = new StorageClient('/tmp/test-integration.db');
  const result = await client.addMemory('Client test', 'project1');
  if (result.status !== 'saved') throw new Error('Client failed');
  console.log('✓ Storage client works');
  client.close();
})();
"

echo "5. Testing pending sync..."
node -e "
const {SqliteManager} = require('${REPO_DIR}/src/lib/sqlite-manager.js');
const db = new SqliteManager('/tmp/test-integration.db');
const pending = db.getPendingSync();
if (pending.length === 0) throw new Error('Pending sync failed');
console.log('✓ Pending sync tracking works');
db.close();
"

echo ""
echo "=== All Integration Tests Passed ✓ ==="
