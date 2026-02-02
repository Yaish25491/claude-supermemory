const { SqliteManager } = require('./sqlite-manager');
const { GitHubSync } = require('./github-sync');
const { GitHubAuth } = require('./github-auth');
const crypto = require('crypto');

class StorageClient {
  constructor(dbPath = null) {
    this.db = new SqliteManager(dbPath);
    this.auth = new GitHubAuth();
    this.sync = null; // Lazy init
  }

  async initSync() {
    if (!this.sync) {
      this.sync = new GitHubSync(this.auth);
    }
  }

  generateId(prefix = 'mem') {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  }

  // Memory operations
  async addMemory(content, containerTag, metadata = {}, customId = null) {
    const id = customId || this.generateId('mem');
    this.db.addMemory(id, content, containerTag, metadata);
    return { id, status: 'saved', containerTag };
  }

  async search(query, containerTag = null, options = {}) {
    const results = this.db.searchMemories(query, containerTag, options.limit || 10);
    return {
      results: results.map(r => ({
        id: r.id,
        memory: r.content,
        content: r.content,
        similarity: r.relevance_score || 0.5,
        title: r.metadata?.title || null
      })),
      total: results.length
    };
  }

  async getProfile(containerTag, query = null) {
    const profile = this.db.getProfile(containerTag);

    let searchResults = null;
    if (query) {
      const results = this.db.searchMemories(query, containerTag, 10);
      searchResults = {
        results: results.map(r => ({
          id: r.id,
          memory: r.content,
          content: r.content,
          similarity: r.relevance_score || 0.5,
          title: r.metadata?.title || null
        })),
        total: results.length
      };
    }

    return {
      profile: {
        static: profile.static,
        dynamic: profile.dynamic
      },
      searchResults
    };
  }

  async listMemories(containerTag, limit = 20) {
    const memories = this.db.listMemories(containerTag, limit);
    return { memories };
  }

  async deleteMemory(memoryId) {
    this.db.deleteMemory(memoryId);
    return { success: true };
  }

  // GitHub sync operations
  async syncToGitHub() {
    if (!this.auth.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }

    await this.initSync();
    const pending = this.db.getPendingSync();

    if (pending.length === 0) {
      return { success: true, synced: 0 };
    }

    const result = await this.sync.syncToGitHub(pending);

    if (result.success) {
      const ids = pending.map(m => m.id);
      this.db.markSynced(ids);
    }

    return result;
  }

  async syncFromGitHub() {
    if (!this.auth.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }

    await this.initSync();
    const pullResult = await this.sync.pullFromGitHub();

    if (!pullResult.success) {
      return pullResult;
    }

    // Import memories from JSON
    const memories = this.sync.importMemories();

    // Add to database (skip if already exists)
    for (const memory of memories) {
      const existing = this.db.getMemory(memory.id);
      if (!existing) {
        this.db.addMemory(
          memory.id,
          memory.content,
          memory.container_tag,
          JSON.parse(memory.metadata)
        );
      }
    }

    return { success: true, imported: memories.length };
  }

  close() {
    this.db.close();
  }
}

module.exports = { StorageClient };
