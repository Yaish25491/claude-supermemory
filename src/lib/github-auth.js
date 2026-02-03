const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TOKEN_FILE = path.join(
  os.homedir(),
  '.claude-memory',
  'github-token.json',
);

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

    throw new Error(
      'No GitHub authentication found. Please authenticate with gh CLI or set CLAUDE_MEMORY_GITHUB_TOKEN',
    );
  }

  saveToken(token) {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }), { mode: 0o600 });
  }

  isAuthenticated() {
    return (
      this.ghAvailable ||
      process.env.CLAUDE_MEMORY_GITHUB_TOKEN ||
      fs.existsSync(TOKEN_FILE)
    );
  }

  async initiateDeviceFlow() {
    const https = require('node:https');

    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        client_id: 'Ov23liXXXXXXXXXXXXXX', // TODO: Register GitHub OAuth App
        scope: 'repo',
      });

      const options = {
        hostname: 'github.com',
        port: 443,
        path: '/login/device/code',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Accept: 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve(JSON.parse(body)));
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async pollForToken(deviceCode, interval = 5) {
    const https = require('node:https');

    const poll = () =>
      new Promise((resolve, reject) => {
        const data = JSON.stringify({
          client_id: 'Ov23liXXXXXXXXXXXXXX', // TODO: Same as above
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });

        const options = {
          hostname: 'github.com',
          port: 443,
          path: '/login/oauth/access_token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            Accept: 'application/json',
          },
        };

        const req = https.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const result = JSON.parse(body);
            if (result.access_token) {
              resolve(result.access_token);
            } else if (result.error === 'authorization_pending') {
              resolve(null);
            } else {
              reject(new Error(result.error || 'Unknown error'));
            }
          });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
      });

    // Poll up to 10 minutes
    for (let i = 0; i < 120; i++) {
      const token = await poll();
      if (token) return token;
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }

    throw new Error('Device flow timed out');
  }

  async startDeviceFlow() {
    const device = await this.initiateDeviceFlow();
    console.log(`\nGitHub Authentication Required:`);
    console.log(`Visit: ${device.verification_uri}`);
    console.log(`Enter code: ${device.user_code}\n`);

    const token = await this.pollForToken(device.device_code, device.interval);
    this.saveToken(token);
    return token;
  }
}

module.exports = { GitHubAuth };
