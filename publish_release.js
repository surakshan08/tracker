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
- 🚚 **Live Dispatched Job Tracking for ATS & ETS2**:
  - Full support for tracking manually dispatched jobs or quick presets with live truck odometer telemetry.
  - Automatic distance progression via real-time odometer delta tracking and speed integration while driving in ATS or ETS2.
  - Automatic delivery completion, VTC score calculation, and formatted Discord receipts upon reaching target distance.
- 🏙️ **Dynamic Autocomplete & Datalists for ATS & ETS2**:
  - Smart autocomplete for origin/destination cities, companies (Wallbert, Charged, Coastline Mining, Bitumen, etc.), and authentic cargo types.
  - Automatic context switching when toggling between ATS and ETS2.
- 🇺🇸 **Dual-Game Telemetry & Native MMF Bridge**:
  - Real-time detection across ATS and ETS2 on native high-speed bridge (\`port 3737\`) and SCS REST (\`port 25555\`).
  - Truck brand/model detection (Peterbilt, Kenworth, Freightliner, Mack, International, Volvo, Scania).
- 📋 **Logbook Multi-Game Filters & Currency Formatting**:
  - Filter delivery records by **All**, **🇪🇺 ETS2**, or **🇺🇸 ATS** with dynamic totals and currency formatting (\`$\` for ATS, \`€\` for ETS2).
- 💬 **Discord Rich Presence & 60+ FPS Cockpit Gauges**:
  - Live Discord Rich Presence showing active game, route, cargo weight, speed, and elapsed time.

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
