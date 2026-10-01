# 🚛 Tracker (v1.0.0)
**Developer**: Sukku

A complete standalone, overlay telemetry tracker and live TruckersMP companion app for Euro Truck Simulator 2 (ETS2) and American Truck Simulator (ATS).

---

## 🚀 How to Run on Any Windows PC

No developer tools, Node.js, or Administrator permissions are required to run this application on other computers.

### Option 1: Standalone Portable (Recommended)
1. Copy `Tracker-Portable.exe` from the `dist/` folder to any computer (send via Discord, Google Drive, or USB drive).
2. Double-click **`Tracker-Portable.exe`**.
3. The tracker will immediately launch on screen!

### Option 2: Setup Installer
1. Send `Tracker-Setup-1.0.0.exe` to the other computer.
2. Run the installer (it does **not** ask for Admin rights and installs directly into user AppData).
3. It automatically creates a **Desktop Shortcut** and a **Start Menu** entry named `Tracker`.

### Option 3: Extracted Folder (.zip)
1. Send `Tracker-1.0.0-win.zip`.
2. Extract the `.zip` anywhere.
3. Double-click `Tracker.exe`.

---

## 🌟 Features Included

- **Developer Credit**: Developed by **Sukku** (`DEV: SUKKU` badge and footer).
- **Auto Game Detection & Smart Launch Trigger (ETS2 & ATS)**:
  - Real-time detection of whether **Euro Truck Simulator 2 (ETS2)** (`eurotrucks2.exe`) or **American Truck Simulator (ATS)** (`amtrucks.exe`) is launched.
  - **Launch-Only Active Mode**: Tracker stays on clean Standby until the game launches, then automatically triggers live telemetry streaming and truck tracking.
  - **Auto-Show on Launch & Auto-Hide to Tray on Exit**: Customizable settings to automatically bring up Tracker when your game starts and minimize it to the tray when you exit.
  - Dynamic game indicators in the titlebar, cockpit telemetry cluster, compact overlay HUD, and Discord Rich Presence.
  - Automatic truck brand/model recognition (Scania, Volvo, Peterbilt, Kenworth, etc.) and game-aware job dispatch presets.
- **Live TruckersMP Servers**: Real-time server statuses (Simulation 1, Simulation 2, ProMods, Arcade, etc.), player queue, and latency.
- **Driver Profile Live Sync**: Enter any TruckersMP Player ID or SteamID64 to instantly fetch avatar, roles/groups, badges, join date, and ban history.
- **Dynamic VTC Info Tab**: Automatically loads the driver's registered VTC on TruckersMP, showing live member count, recruitment status, website, and upcoming VTC events.
- **In-Game Telemetry HUD**:
  - Live Speed, Cruise Control, Gear, and RPM.
  - Fuel level (liters + % + range), Engine Temperature, Battery Voltage.
  - Cargo, Destination, Navigation ETA, and Job Delivery status.
  - Real-time Truck & Trailer damage meters.
- **Click-through & Always-on-Top toggles**.
- **Seamless Auto-Updates for All Users**:
  - Automatically queries GitHub Releases (`Sukku/tracker`) on launch and every 2 hours in the background.
  - Interactive notification modal displaying release notes, new version tag, and 1-click download.
  - Live download progress bar showing download speed (MB/s) and percentage.
  - 1-click "Restart & Install Now" button or silent install on app exit.
  - Manual check triggers from the titlebar icon, Settings tab, footer version tag, and system tray menu.

---

## 🔄 How to Publish Updates to Every User

Whenever you want to release an update to all your users:

1. **Bump the Version**:
   In `package.json`, update `"version": "1.2.0"` (or your next version number).
2. **Build the Installer & Update Metadata**:
   Run:
   ```powershell
   npm run build:installer
   ```
   This generates:
   - `dist/Tracker-Setup-1.2.0.exe`
   - `dist/latest.yml` (the auto-update definition manifest)
   - `dist/Tracker-Setup-1.2.0.exe.blockmap`
3. **Publish on GitHub**:
   - Go to `https://github.com/Sukku/tracker/releases/new`
   - Create a release tag matching the version (e.g. `v1.2.0`).
   - Title your release (e.g. `Tracker v1.2.0`).
   - Attach `Tracker-Setup-1.2.0.exe` and `latest.yml`.
   - Click **Publish release**.
   *(Alternative: set `$env:GH_TOKEN="your_personal_access_token"` and run `npm run release` to automatically build and upload in one command).*
4. **Automatic Delivery**:
   Every user running Tracker will automatically receive the update prompt on their screen with release notes, a progress bar, and 1-click installation!

---

## 🎮 Connecting Live In-Game ETS2 / ATS Telemetry

The tracker works standalone immediately in Demo/Dashboard mode. To feed **live in-game telemetry** from ETS2 or ATS into the tracker on other PCs:

1. Download the standard **`scs-telemetry.dll`** (64-bit) from the SCS Telemetry SDK.
2. Place `scs-telemetry.dll` into your game's plugins folder:
   - **ETS2**: `<Steam Library>\steamapps\common\Euro Truck Simulator 2\bin\win_x64\plugins\`
   - **ATS**: `<Steam Library>\steamapps\common\American Truck Simulator\bin\win_x64\plugins\`
   *(If the `plugins` folder does not exist, simply create a new folder named `plugins`)*.
3. Start the game. When prompted with the SDK warning *"SDK plugin detected"*, click **OK**.
4. Launch **Tracker** — it will automatically detect the telemetry bridge and display your live truck stats in real time!

---

## 🛠️ System Compatibility

- **OS**: Windows 10 / Windows 11 / Windows 8.1 (64-bit).
- **Permissions**: Runs cleanly under standard user privileges (`asInvoker`).
- **Dependencies**: None. The built-in SCS bridge is pre-compiled for .NET Framework 4.0, which is pre-installed on all modern Windows versions.
- **Single Instance**: Protected against multiple launches interfering with telemetry port 3737.
