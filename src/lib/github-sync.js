const simpleGit = require('simple-git');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SYNC_DIR = path.join(os.homedir(), '.claude-memory', 'repo');
const DEFAULT_REPO_NAME = 'claude-memory-storage';

class GitHubSync {
  constructor(auth, repoOwner = null, repoName = DEFAULT_REPO_NAME) {
    this.auth = auth;
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.syncDir = SYNC_DIR;
    this.git = simpleGit(this.syncDir);
  }

  async ensureRepo() {
    // Check if repo directory exists and is git repo
    if (fs.existsSync(this.syncDir) && fs.existsSync(path.join(this.syncDir, '.git'))) {
      return true;
    }

    // Get authenticated user
    if (!this.repoOwner) {
      const token = await this.auth.getToken();
      const user = JSON.parse(execSync(`gh api user --header "Authorization: Bearer ${token}"`, { encoding: 'utf8' }));
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
      execSync(`gh api repos/${this.repoOwner}/${this.repoName} --header "Authorization: Bearer ${token}"`, { stdio: 'pipe' });
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
        description: 'Claude Code memory storage - persistent context across sessions',
        auto_init: true
      });

      execSync(`gh api user/repos --method POST --input - --header "Authorization: Bearer ${token}"`, {
        input: data,
        stdio: 'pipe'
      });

      console.log(`Created private repository: ${this.repoOwner}/${this.repoName}`);
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
}

module.exports = { GitHubSync };
