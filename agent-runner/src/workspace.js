const { exec } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

const BASE = path.join(os.tmpdir(), 'issueforge-workspaces');

async function create(runId) {
  const dir = path.join(BASE, runId.replace(/[^a-z0-9_-]/gi, '_'));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function remove(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (_) {}
}

async function listRecursive(dir, maxDepth = 3) {
  const results = [];
  async function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const rel = path.relative(dir, path.join(current, e.name));
      results.push(e.isDirectory() ? rel + '/' : rel);
      if (e.isDirectory()) await walk(path.join(current, e.name), depth + 1);
    }
  }
  await walk(dir, 0);
  return results;
}

// Run a shell command with a timeout, capturing stdout + stderr.
// Returns { stdout, stderr, exitCode }.
async function shell(command, cwd, timeoutSeconds = 120) {
  return new Promise(resolve => {
    const child = require('child_process').exec(
      command,
      { cwd, timeout: timeoutSeconds * 1000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          stdout: (stdout || '').slice(0, 16_000),
          stderr: (stderr || '').slice(0, 8_000),
          exitCode: err ? (err.code || 1) : 0,
        });
      }
    );
  });
}

module.exports = { create, remove, listRecursive, shell };
