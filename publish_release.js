const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '1.1.0';
const tagName = `v${version}`;
const releaseTitle = `Tracker v${version} — ETS2 & ATS Overlay Job Tracker`;

console.log('======================================================');
console.log(`🚀 PUBLISHING RELEASE TO GITHUB: ${tagName}`);
console.log('======================================================\n');

// 1. Build binaries with electron-builder
console.log(`[1/3] 🔨 Building binaries for Windows (v${version})...`);
try {
    execSync('npx electron-builder --win', {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true
    });
} catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
}

// 2. Identify output files in dist
const distDir = path.join(__dirname, 'dist');
const installerPath = path.join(distDir, `Tracker-Setup-${version}.exe`);
const portablePath = path.join(distDir, 'Tracker-Portable.exe');
const zipPath = path.join(distDir, `Tracker-${version}-win.zip`);
const latestYmlPath = path.join(distDir, 'latest.yml');
const blockmapPath = path.join(distDir, `Tracker-Setup-${version}.exe.blockmap`);

const filesToUpload = [
    installerPath,
    portablePath,
    zipPath,
    latestYmlPath,
    blockmapPath
].filter(p => fs.existsSync(p));

console.log(`\n[2/3] 📦 Files ready to upload (${filesToUpload.length}):`);
filesToUpload.forEach(f => {
    const stat = fs.statSync(f);
    const mb = (stat.size / (1024 * 1024)).toFixed(2);
    console.log(`  - ${path.basename(f)} (${mb} MB)`);
});

if (filesToUpload.length === 0) {
    console.error('❌ No distribution files found to upload in dist/.');
    process.exit(1);
}

// 3. Compose Release Notes
const releaseNotes = `## 🚛 Tracker v${version} — Release Notes

### 🌟 New Features & Enhancements in v${version}:
- 🇺🇸 **Full American Truck Simulator (ATS) Job Tracking**:
  - Full dual-game telemetry streaming support across ETS2 and ATS on port \`3737\` (native MMF bridge) and port \`25555\` (\`/api/ats/telemetry\` and \`/api/ets2/telemetry\`).
  - Automatic game identification, vehicle recognition (Peterbilt, Kenworth, Freightliner, Mack, International, Volvo VNL), and real-time driving status.
- 🚚 **Dynamic ATS & ETS2 Route Dispatcher**:
  - Expanded library of authentic American Truck Simulator routes (Los Angeles, San Francisco, Seattle, Salt Lake City, Denver, Dallas, Houston, Portland, San Diego, Phoenix, Albuquerque, Las Vegas, Reno, El Paso, etc.).
  - Real-time preset switching when toggling between ETS2 and ATS in the Dispatch modal.
- 📋 **Logbook Game Filter & Multi-Currency Support**:
  - Quick filter pills (**All Deliveries**, **🇪🇺 ETS2**, **🇺🇸 ATS**) in the Logbook tab for instantaneous filtering and totals calculation.
  - Automatic currency formatting (**\`$\` for ATS**, **\`€\` for ETS2**) across HUD active cards, logbook, completion modals, Discord receipts, and CSV exports.
- 💬 **Discord Rich Presence for ATS**:
  - ATS activity presence with unit-aware speed and distance display (\`mi\` vs \`km\`).
- 🚀 **Smooth 60+ FPS Interpolated Cockpit Gauges**:
  - Fluid delta-time continuous speedometer and tachometer smoothing.

---

### 📥 Download Options:
1. **Setup Installer** (\`Tracker-Setup-${version}.exe\`): Recommended for automatic desktop shortcut, start menu entry, and seamless auto-updates.
2. **Standalone Portable** (\`Tracker-Portable.exe\`): No installation required — run instantly on any Windows PC.
3. **ZIP Archive** (\`Tracker-${version}-win.zip\`): Portable extracted folder.

Developed by **Sukku** (GitHub: [@surakshan08](https://github.com/surakshan08))
`;

const notesFile = path.join(distDir, 'release_notes.tmp.md');
fs.writeFileSync(notesFile, releaseNotes, 'utf8');

// 4. Upload to GitHub Releases via gh CLI
console.log(`\n[3/3] 🌐 Uploading release to GitHub (surakshan08/tracker -> ${tagName})...`);

// Add gh path if needed
const machinePath = process.env.Path || '';
const customEnv = {
    ...process.env,
    Path: `${machinePath};C:\\Program Files\\GitHub CLI;C:\\Users\\saksm\\AppData\\Local\\Programs\\GitHub CLI`
};

// Check if release already exists
const checkRes = spawnSync('gh', ['release', 'view', tagName], { env: customEnv, encoding: 'utf8' });

if (checkRes.status === 0) {
    console.log(`ℹ️ Release ${tagName} already exists. Uploading/updating assets...`);
    const uploadArgs = ['release', 'upload', tagName, ...filesToUpload, '--clobber'];
    const uploadRes = spawnSync('gh', uploadArgs, { env: customEnv, stdio: 'inherit' });
    if (uploadRes.status !== 0) {
        console.error('❌ Failed to upload assets to existing release.');
        process.exit(1);
    }
} else {
    console.log(`✨ Creating new release ${tagName}...`);
    const createArgs = [
        'release',
        'create',
        tagName,
        ...filesToUpload,
        '--title',
        releaseTitle,
        '--notes-file',
        notesFile
    ];
    const createRes = spawnSync('gh', createArgs, { env: customEnv, stdio: 'inherit' });
    if (createRes.status !== 0) {
        console.error('❌ Failed to create release.');
        process.exit(1);
    }
}

// Clean up notes file
try { fs.unlinkSync(notesFile); } catch {}

console.log('\n======================================================');
console.log(`🎉 RELEASE PUBLISHED SUCCESSFULLY!`);
console.log(`🔗 https://github.com/surakshan08/tracker/releases/tag/${tagName}`);
console.log('======================================================\n');
