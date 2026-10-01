/**
 * ============================================================
 * AUTO-GIT-SYNC & WATCHER FOR TRACKER
 * ============================================================
 * Automatically detects file changes in the project directory,
 * stages them, commits with a timestamp & modified file summary,
 * and pushes directly to GitHub in real-time.
 *
 * Usage:
 *   node auto_git_sync.js
 *   npm run sync
 *   npm run watch:git
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_DIR = __dirname;
const DEBOUNCE_DELAY_MS = 3500; // Wait 3.5s after last file edit before committing
const RETRY_DELAY_MS = 5000;

// Directories and file patterns to ignore
const IGNORED_PATHS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.tmp',
  'bridge_debug.log',
  'dev-app-update.yml'
];

let debounceTimer = null;
let isSyncing = false;
let pendingChanges = new Set();

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    info: '\x1b[36m[AUTO-SYNC]\x1b[0m',
    success: '\x1b[32m[AUTO-SYNC SUCCESS]\x1b[0m',
    warn: '\x1b[33m[AUTO-SYNC WARNING]\x1b[0m',
    error: '\x1b[31m[AUTO-SYNC ERROR]\x1b[0m',
    change: '\x1b[35m[FILE CHANGE]\x1b[0m'
  }[type] || '\x1b[36m[AUTO-SYNC]\x1b[0m';

  console.log(`${prefix} \x1b[90m${timestamp}\x1b[0m ${msg}`);
}

function runGitCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: PROJECT_DIR, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        return reject({ err, stderr: stderr ? stderr.trim() : '', stdout: stdout ? stdout.trim() : '' });
      }
      resolve(stdout ? stdout.trim() : '');
    });
  });
}

async function getCurrentBranch() {
  try {
    const branch = await runGitCommand('git rev-parse --abbrev-ref HEAD');
    return branch || 'main';
  } catch {
    return 'main';
  }
}

async function getRemoteUrl() {
  try {
    const remote = await runGitCommand('git remote get-url origin');
    return remote;
  } catch {
    return null;
  }
}

async function performSync() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // 1. Check if git repository is initialized
    const isGit = fs.existsSync(path.join(PROJECT_DIR, '.git'));
    if (!isGit) {
      log('Initializing Git repository...', 'info');
      await runGitCommand('git init');
      await runGitCommand('git branch -M main');
    }

    // 2. Check for working tree changes
    const status = await runGitCommand('git status --porcelain');
    if (!status) {
      log('Working directory is clean. Nothing to commit.', 'info');
      pendingChanges.clear();
      isSyncing = false;
      return;
    }

    const changedFiles = status
      .split('\n')
      .map(line => line.trim().replace(/^[A-Z?MADRCU\s]+\s+/, ''))
      .filter(Boolean);

    log(`Detected ${changedFiles.length} modified file(s): ${changedFiles.slice(0, 4).join(', ')}${changedFiles.length > 4 ? '...' : ''}`, 'change');

    // 3. Stage all changes
    log('Staging changes (git add -A)...', 'info');
    await runGitCommand('git add -A');

    // 4. Commit with descriptive summary
    const now = new Date();
    const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);
    const filesSummary = changedFiles.slice(0, 3).map(f => path.basename(f)).join(', ');
    const commitMsg = `Auto-update: ${dateStr} [${filesSummary}${changedFiles.length > 3 ? '...' : ''}]`;

    log(`Committing: "${commitMsg}"...`, 'info');
    await runGitCommand(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);

    // 5. Check remote and push
    const remote = await getRemoteUrl();
    const branch = await getCurrentBranch();

    if (!remote) {
      log('Changes committed locally! (No remote "origin" configured yet).', 'warn');
      log('To link your GitHub repository, run: git remote add origin https://github.com/<your-username>/<your-repo>.git', 'warn');
    } else {
      log(`Pushing commit to GitHub (${remote} -> ${branch})...`, 'info');
      try {
        await runGitCommand(`git push -u origin ${branch}`);
        log(`Successfully pushed latest changes to GitHub (${branch})! 🚀`, 'success');
      } catch (pushErr) {
        log(`Git push failed: ${pushErr.stderr || pushErr.stdout || pushErr.err?.message || 'Unknown push error'}`, 'error');
        log('Verify your internet connection and GitHub repository permissions.', 'warn');
      }
    }

    pendingChanges.clear();
  } catch (err) {
    log(`Sync error: ${err.stderr || err.stdout || err.err?.message || err}`, 'error');
  } finally {
    isSyncing = false;
  }
}

function scheduleSync(filename) {
  if (filename) {
    // Check if filename belongs to ignored path
    const isIgnored = IGNORED_PATHS.some(ignored => {
      return filename.startsWith(ignored) || filename.includes(path.sep + ignored);
    });
    if (isIgnored) return;
    pendingChanges.add(filename);
  }

  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    performSync();
  }, DEBOUNCE_DELAY_MS);
}

function startWatcher() {
  console.log('\n======================================================');
  console.log('   🔄 TRACKER — AUTOMATIC GITHUB PUSH & SYNC WATCHER   ');
  console.log('======================================================');
  log(`Watching "${PROJECT_DIR}" for file modifications...`, 'info');
  log('Any saved change will automatically commit & push to GitHub.\n', 'info');

  // Initial sync check on startup
  performSync();

  if (process.argv.includes('--once')) {
    log('Run with --once: initial sync completed. Exiting.', 'info');
    return;
  }

  // Watch recursive directory
  try {
    fs.watch(PROJECT_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      scheduleSync(filename);
    });
  } catch (err) {
    log(`Failed to attach recursive watcher: ${err.message}. Using polling mode.`, 'error');
    setInterval(() => {
      performSync();
    }, 10000);
  }
}

// Start
startWatcher();
