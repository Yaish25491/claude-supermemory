const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN_FILE = path.join(os.homedir(), '.claude-memory', 'github-token.json');

class GitHubAuth {
  constructor() {
    this.ghAvailable = this.checkGhCli();
  }

  checkGhCli() {
    try {
      execSync('gh auth status', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async getToken() {
    // 1. Check environment variable
    if (process.env.CLAUDE_MEMORY_GITHUB_TOKEN) {
      return process.env.CLAUDE_MEMORY_GITHUB_TOKEN;
    }

    // 2. Use gh CLI if available
    if (this.ghAvailable) {
      try {
        const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
        return token;
      } catch (err) {
        console.error('Failed to get gh token:', err.message);
      }
    }

    // 3. Check saved token file
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      return data.token;
    }

    throw new Error('No GitHub authentication found. Please authenticate with gh CLI or set CLAUDE_MEMORY_GITHUB_TOKEN');
  }

  saveToken(token) {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }), { mode: 0o600 });
  }

  isAuthenticated() {
    return this.ghAvailable ||
           process.env.CLAUDE_MEMORY_GITHUB_TOKEN ||
           fs.existsSync(TOKEN_FILE);
  }
}

module.exports = { GitHubAuth };
