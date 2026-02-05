const simpleGit = require('simple-git');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SYNC_DIR = path.join(os.homedir(), '.claude-memory', 'repo');
const DEFAULT_REPO_NAME = 'claude-memory-storage';

class GitHubSync {
  constructor(auth, repoOwner = null, repoName = DEFAULT_REPO_NAME) {
    this.auth = auth;
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.syncDir = SYNC_DIR;
    this._git = null;
  }

  get git() {
    if (!this._git) {
      this._git = simpleGit(this.syncDir);
    }
    return this._git;
  }

  async ensureRepo() {
    // Check if repo directory exists and is git repo
    if (
      fs.existsSync(this.syncDir) &&
      fs.existsSync(path.join(this.syncDir, '.git'))
    ) {
      return true;
    }

    // Get authenticated user
    if (!this.repoOwner) {
      const token = await this.auth.getToken();
      const user = JSON.parse(
        execSync(`gh api user --header "Authorization: Bearer ${token}"`, {
          encoding: 'utf8',
        }),
      );
      this.repoOwner = user.login;
    }

    // Check if remote repo exists
    const repoExists = await this.checkRepoExists();

    if (!repoExists) {
      // Create repo
      const created = await this.createRepo();
      if (!created) return false;
    }

    // Clone repo
    await this.cloneRepo();
    return true;
  }

  async checkRepoExists() {
    try {
      const token = await this.auth.getToken();
      execSync(
        `gh api repos/${this.repoOwner}/${this.repoName} --header "Authorization: Bearer ${token}"`,
        { stdio: 'pipe' },
      );
      return true;
    } catch {
      return false;
    }
  }

  async createRepo() {
    try {
      const token = await this.auth.getToken();
      const data = JSON.stringify({
        name: this.repoName,
        private: true,
        description:
          'Claude Code memory storage - persistent context across sessions',
        auto_init: true,
      });

      execSync(
        `gh api user/repos --method POST --input - --header "Authorization: Bearer ${token}"`,
        {
          input: data,
          stdio: 'pipe',
        },
      );

      console.log(
        `Created private repository: ${this.repoOwner}/${this.repoName}`,
      );
      return true;
    } catch (err) {
      console.error('Failed to create repository:', err.message);
      return false;
    }
  }

  async cloneRepo() {
    const repoUrl = `https://github.com/${this.repoOwner}/${this.repoName}.git`;

    // Ensure parent directory exists
    const parentDir = path.dirname(this.syncDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    await simpleGit().clone(repoUrl, this.syncDir);

    // Configure git user
    await this.git.addConfig('user.name', 'Claude Code');
    await this.git.addConfig('user.email', 'noreply@anthropic.com');
  }

  exportMemory(memory) {
    const date = new Date(memory.created_at);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const day = String(date.getDate()).padStart(2, '0');

    const memoryDir = path.join(
      this.syncDir,
      'memories',
      memory.container_tag,
      yearMonth,
    );

    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const filename = `${day}-${memory.id}.json`;
    const filepath = path.join(memoryDir, filename);

    const data = {
      id: memory.id,
      content: memory.content,
      containerTag: memory.container_tag,
      metadata:
        typeof memory.metadata === 'string'
          ? JSON.parse(memory.metadata)
          : memory.metadata,
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
    };

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    return filepath;
  }

  exportMemories(memories) {
    const files = [];
    for (const memory of memories) {
      const filepath = this.exportMemory(memory);
      files.push(filepath);
    }
    return files;
  }

  exportProfiles(profiles) {
    const profileDir = path.join(this.syncDir, 'profiles');
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    const filepath = path.join(profileDir, 'user-preferences.json');
    fs.writeFileSync(filepath, JSON.stringify(profiles, null, 2));
    return filepath;
  }

  async syncToGitHub(memories, profiles = null) {
    try {
      await this.ensureRepo();

      // Export memories to JSON
      const files = this.exportMemories(memories);

      // Export profiles if provided
      if (profiles) {
        const profileFile = this.exportProfiles(profiles);
        files.push(profileFile);
      }

      if (files.length === 0) {
        return { success: true, synced: 0 };
      }

      // Git add
      for (const file of files) {
        const relativePath = path.relative(this.syncDir, file);
        await this.git.add(relativePath);
      }

      // Git commit
      const containerTags = [...new Set(memories.map((m) => m.container_tag))];
      const message = `Session memories: ${containerTags.join(', ')} (${memories.length} new)`;
      await this.git.commit(message);

      // Git push
      await this.git.push('origin', 'main');

      return { success: true, synced: memories.length };
    } catch (err) {
      console.error('GitHub sync failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async pullFromGitHub() {
    try {
      await this.ensureRepo();
      await this.git.pull('origin', 'main');
      return { success: true };
    } catch (err) {
      if (err.message.includes('conflict')) {
        return { success: false, conflict: true, error: err.message };
      }
      return { success: false, conflict: false, error: err.message };
    }
  }

  importMemories() {
    const memoriesDir = path.join(this.syncDir, 'memories');
    if (!fs.existsSync(memoriesDir)) {
      return [];
    }

    const memories = [];

    const readDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          readDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            memories.push({
              id: data.id,
              content: data.content,
              container_tag: data.containerTag,
              metadata: JSON.stringify(data.metadata || {}),
              created_at: data.createdAt,
              updated_at: data.updatedAt,
              sync_status: 'synced',
              synced_at: Date.now(),
            });
          } catch (err) {
            console.error(`Failed to parse ${fullPath}:`, err.message);
          }
        }
      }
    };

    readDir(memoriesDir);
    return memories;
  }

  importProfiles() {
    const profileFile = path.join(
      this.syncDir,
      'profiles',
      'user-preferences.json',
    );
    if (!fs.existsSync(profileFile)) {
      return { static: [], dynamic: [] };
    }

    try {
      return JSON.parse(fs.readFileSync(profileFile, 'utf8'));
    } catch (err) {
      console.error('Failed to parse profiles:', err.message);
      return { static: [], dynamic: [] };
    }
  }
}

module.exports = { GitHubSync };
