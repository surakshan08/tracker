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
- 🚀 **Fluent Speed Digits & Smooth Interpolation**:
  - Speed numbers now transition continuously and fluently in 60+ FPS via delta-time exponential smoothing with tabular numeral alignment — eliminating all digit jumps and layout jitter.
- 📦 **Clean "No Job" Status**:
  - Displays a clean "No Job" indicator across Cockpit Header, Compact HUD, and Discord Rich Presence whenever the driver is idle or free roaming.
- 🎮 **Real-time ETS2 & ATS Game Detection**:
  - Automatically identifies whether **Euro Truck Simulator 2** (\`eurotrucks2.exe\`) or **American Truck Simulator** (\`amtrucks.exe\`) is running.
  - Tracker stays in clean **Standby** mode until the game launches, then automatically activates live tracking.
- ⚡ **Auto-Show on Launch & Auto-Hide on Exit**:
  - Option to bring Tracker to focus automatically when the game launches.
  - Option to minimize Tracker to the system tray when the game exits.
- 🔄 **GitHub 1-Click Auto-Updates**:
  - Automatically fetches and updates from GitHub releases or repository in real time.
  - Live progress bar, download speed indicator, and 1-click install.
- 📊 **Complete In-Game Telemetry Cluster**:
  - Live Speed, Cruise Control, Gear, RPM, Fuel Range, Engine Temp, Damage, and Navigation ETA.
- 🏢 **TruckersMP Drivers Hub & VTC Integration**:
  - Dynamic profile and VTC synchronization with member counts and event details.
- 💬 **Discord Rich Presence**:
  - Displays live truck model, city-to-city cargo route, and delivery status directly on Discord.

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
