const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeImage,
  shell,
  globalShortcut
} = require('electron');

const { autoUpdater } = require('electron-updater');

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ============================================================
// ELECTRON FULLSCREEN OVERLAY SETTINGS
// ============================================================

// Prevent Electron renderer throttling when ETS2 has focus
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Helps prevent Chromium from reducing timer priority
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Helps Electron overlays behave better over fullscreen games
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Disable GPU hardware acceleration.
// This is useful for transparent Electron overlays over DirectX
// fullscreen applications such as Euro Truck Simulator 2.
app.disableHardwareAcceleration();

// ============================================================
// SINGLE INSTANCE
// ============================================================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });
}

// ============================================================
// GLOBAL VARIABLES
// ============================================================

const { DiscordRPC, DEFAULT_CLIENT_ID } = require('./discord_rpc');

const isSilentStart = process.argv.includes('--hidden') ||
                      process.argv.includes('--minimized') ||
                      process.argv.includes('--autostart');

let mainWindow = null;
let tray = null;

let isLocked = false;
let isCompact = false;
let bridgeProcess = null;
let discordRpc = null;
let discordRpcEnabled = true;

// ============================================================
// AUTO UPDATER (GITHUB RELEASES)
// ============================================================

// Ask before downloading: user confirms download first
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

// Custom logging for updates
autoUpdater.logger = {
  info: (msg) => console.log('[AutoUpdater]', msg),
  warn: (msg) => console.warn('[AutoUpdater]', msg),
  error: (msg) => console.error('[AutoUpdater]', msg)
};

let updateCheckInProgress = false;
let downloadedUpdateInfo = null;

function sendToWindow(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

autoUpdater.on('checking-for-update', () => {
  updateCheckInProgress = true;
  console.log('[AutoUpdater] Checking for updates on GitHub Releases...');
  sendToWindow('update-status', { status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  updateCheckInProgress = false;
  console.log('[AutoUpdater] Update available:', info.version);
  sendToWindow('update-available', {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes,
    currentVersion: app.getVersion()
  });
  if (tray) {
    tray.setToolTip(`Tracker (Update v${info.version} Available)`);
  }
});

autoUpdater.on('update-not-available', (info) => {
  updateCheckInProgress = false;
  console.log('[AutoUpdater] Update not available. Running latest version.');
  sendToWindow('update-not-available', {
    version: info ? info.version : app.getVersion(),
    currentVersion: app.getVersion()
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  sendToWindow('update-download-progress', {
    percent: Math.round(progressObj.percent || 0),
    bytesPerSecond: progressObj.bytesPerSecond || 0,
    transferred: progressObj.transferred || 0,
    total: progressObj.total || 0
  });
});

autoUpdater.on('update-downloaded', (info) => {
  downloadedUpdateInfo = info;
  console.log('[AutoUpdater] Update downloaded successfully:', info.version);
  sendToWindow('update-downloaded', {
    version: info.version,
    releaseNotes: info.releaseNotes
  });
  if (tray) {
    tray.setToolTip(`Tracker (Update v${info.version} Ready to Install)`);
    updateTrayMenu();
  }
});

autoUpdater.on('error', (err) => {
  updateCheckInProgress = false;
  console.warn('[AutoUpdater] Notice/Error:', err.message);
  sendToWindow('update-error', {
    message: err.message
  });
});

function checkForUpdatesManual() {
  if (updateCheckInProgress) return;
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[AutoUpdater] Manual check notice:', err.message);
    sendToWindow('update-error', { message: err.message });
  });
}

// ============================================================
// AUTO-START ON BOOT (WINDOWS STARTUP)
// ============================================================

function setAutoStart(enable) {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: !!enable,
        path: process.execPath,
        args: ['--hidden', '--autostart']
      });
    } else {
      app.setLoginItemSettings({
        openAtLogin: !!enable,
        args: ['--hidden', '--autostart']
      });
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('autostart-state', !!enable);
    }
  } catch (err) {
    console.error('Failed to set login item settings:', err);
  }
}

function isAutoStartEnabled() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

// ============================================================
// DISCORD RICH PRESENCE (RPC)
// ============================================================

function initDiscordRPC() {
  if (discordRpc) return;

  try {
    discordRpc = new DiscordRPC(DEFAULT_CLIENT_ID);

    discordRpc.on('ready', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-status', {
          connected: true,
          user: data.user,
          clientId: discordRpc.clientId
        });
      }
    });

    discordRpc.on('disconnected', (reason) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-status', {
          connected: false,
          reason,
          clientId: discordRpc ? discordRpc.clientId : DEFAULT_CLIENT_ID
        });
      }
    });

    discordRpc.on('rpc-error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-error', err);
      }
    });

    discordRpc.connect();
  } catch (err) {
    console.error('Failed to init Discord RPC:', err);
  }
}

function cleanupDiscordRPC() {
  if (discordRpc) {
    try {
      discordRpc.disconnect();
    } catch {}
    discordRpc = null;
  }
}

// ============================================================
// BRIDGE PROCESS
// ============================================================

function startBridge() {
  const os = require('os');

  const logFile = path.join(
    os.tmpdir(),
    'bridge_debug.log'
  );

  function log(msg) {
    try {
      fs.appendFileSync(
        logFile,
        msg + '\n'
      );
    } catch {}
  }

  log(
    `startBridge called at ${new Date().toISOString()}`
  );

  log(
    `process.resourcesPath: ${process.resourcesPath}`
  );

  log(
    `app.getAppPath(): ${app.getAppPath()}`
  );

  log(
    `process.execPath: ${process.execPath}`
  );

  // Already running
  if (
    bridgeProcess &&
    !bridgeProcess.killed
  ) {
    log('Bridge is already running');
    return;
  }

  const possiblePaths = [
    path.join(
      process.resourcesPath || '',
      'app.asar.unpacked',
      'bridge',
      'scs_bridge.exe'
    ),

    path.join(
      process.resourcesPath || '',
      'bridge',
      'scs_bridge.exe'
    ),

    path.join(
      process.resourcesPath || '',
      'scs_bridge.exe'
    ),

    path.join(
      path.dirname(process.execPath || ''),
      'resources',
      'app.asar.unpacked',
      'bridge',
      'scs_bridge.exe'
    ),

    path.join(
      path.dirname(process.execPath || ''),
      'resources',
      'bridge',
      'scs_bridge.exe'
    ),

    path.join(
      path.dirname(process.execPath || ''),
      'bridge',
      'scs_bridge.exe'
    ),

    path.join(
      __dirname,
      'bridge',
      'scs_bridge.exe'
    )
  ];

  for (const p of possiblePaths) {

    // Don't try to execute files directly from app.asar
    if (
      p.includes('app.asar\\') ||
      p.includes('app.asar/')
    ) {
      continue;
    }

    const exists = fs.existsSync(p);

    log(
      `Checking path: ${p} | exists: ${exists}`
    );

    if (!exists) {
      continue;
    }

    try {

      log(
        `Attempting spawn: ${p} with cwd: ${path.dirname(p)}`
      );

      bridgeProcess = spawn(
        p,
        [],
        {
          cwd: path.dirname(p),
          windowsHide: true,
          stdio: 'ignore',
          detached: false
        }
      );

      bridgeProcess.on(
        'error',
        (err) => {
          log(
            `Bridge spawn error: ${err.message}`
          );
        }
      );

      bridgeProcess.on(
        'exit',
        (code) => {
          log(
            `Bridge exited with code: ${code}`
          );

          bridgeProcess = null;
        }
      );

      log(
        `Spawned bridge successfully with PID: ${bridgeProcess.pid}`
      );

      break;

    } catch (e) {

      log(
        `Failed to start bridge: ${e.message}`
      );
    }
  }
}

// ============================================================
// STOP BRIDGE
// ============================================================

function stopBridge() {

  if (bridgeProcess) {

    try {
      bridgeProcess.kill();
    } catch {}

    bridgeProcess = null;
  }
}

// ============================================================
// CREATE OVERLAY WINDOW
// ============================================================

function createWindow() {

  const {
    width: screenW,
    height: screenH
  } = screen.getPrimaryDisplay().workAreaSize;

  const winW = 450;
  const winH = 720;

  const initialX = Math.max(
    10,
    screenW - winW - 20
  );

  const initialY = Math.max(
    10,
    Math.min(20, screenH - winH)
  );

  mainWindow = new BrowserWindow({

    // --------------------------------------------------------
    // WINDOW SIZE & VISIBILITY
    // --------------------------------------------------------

    show: !isSilentStart,

    width: winW,
    height: winH,

    x: initialX,
    y: initialY,

    // --------------------------------------------------------
    // OVERLAY APPEARANCE
    // --------------------------------------------------------

    frame: false,

    transparent: true,

    resizable: true,

    useContentSize: true,

    minWidth: 320,

    minHeight: 180,

    maxWidth: 3840,

    maxHeight: 2160,

    hasShadow: false,

    // Prevent being pushed into a native fullscreen space
    fullscreenable: false,

    // --------------------------------------------------------
    // FULLSCREEN OVERLAY
    // --------------------------------------------------------

    title: 'Tracker — TruckersMP Job Tracker',

    alwaysOnTop: true,

    // Show overlay in Windows taskbar and Alt+Tab so users can easily interact with it
    skipTaskbar: false,

    // --------------------------------------------------------
    // ICON
    // --------------------------------------------------------

    icon: path.join(
      __dirname,
      'icon.png'
    ),

    // --------------------------------------------------------
    // WEB SETTINGS
    // --------------------------------------------------------

    webPreferences: {

      nodeIntegration: true,

      contextIsolation: false,

      webSecurity: false,

      // IMPORTANT:
      // Prevent Chromium renderer throttling when
      // ETS2 is the focused application.
      backgroundThrottling: false
    }
  });

  // ==========================================================
  // LOAD OVERLAY
  // ==========================================================

  mainWindow.loadFile(
    path.join(
      __dirname,
      'overlay.html'
    )
  );

  // ==========================================================
  // FULLSCREEN Z-ORDER
  // ==========================================================

  // 'screen-saver' level keeps the overlay above fullscreen
  // DirectX applications such as ETS2, even when it is not
  // the focused window (e.g. after Alt+Tab).
  mainWindow.setAlwaysOnTop(
    true,
    'screen-saver',
    1
  );

  // Make the overlay visible on fullscreen workspaces
  mainWindow.setVisibleOnAllWorkspaces(
    true,
    {
      visibleOnFullScreen: true
    }
  );

  // Lock visual zoom to 1.0 to prevent scaling/expansion on Ctrl + scroll
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.webContents.setZoomFactor(1.0);
  mainWindow.webContents.on('zoom-changed', (e) => {
    e.preventDefault();
  });

  // Re-assert z-order whenever the user focuses the overlay if not already set
  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isAlwaysOnTop()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
  });

  // ==========================================================
  // EXTERNAL LINKS
  // ==========================================================

  mainWindow.webContents.setWindowOpenHandler(
    ({ url }) => {

      shell.openExternal(url);

      return {
        action: 'deny'
      };
    }
  );

  mainWindow.webContents.on(
    'will-navigate',
    (event, url) => {

      if (
        url !==
        mainWindow.webContents.getURL()
      ) {

        event.preventDefault();

        shell.openExternal(url);
      }
    }
  );

  // ==========================================================
  // WINDOW CLOSED
  // ==========================================================

  mainWindow.on(
    'closed',
    () => {

      mainWindow = null;
    }
  );
}

// ============================================================
// CREATE SYSTEM TRAY
// ============================================================

function createTray() {

  const iconPath = path.join(
    __dirname,
    'icon.png'
  );

  let trayIcon;

  try {

    trayIcon =
      nativeImage.createFromPath(
        iconPath
      );

    if (
      trayIcon.isEmpty()
    ) {
      throw new Error('Empty icon');
    }

  } catch {

    // --------------------------------------------------------
    // FALLBACK ICON
    // --------------------------------------------------------

    const size = 32;

    const buf = Buffer.alloc(
      size * size * 4
    );

    for (
      let i = 0;
      i < size * size;
      i++
    ) {

      // Amber #C4873B

      buf[i * 4] = 0xC4;
      buf[i * 4 + 1] = 0x87;
      buf[i * 4 + 2] = 0x3B;
      buf[i * 4 + 3] = 0xFF;
    }

    trayIcon =
      nativeImage.createFromBuffer(
        buf,
        {
          width: size,
          height: size
        }
      );
  }

  tray = new Tray(
    trayIcon.resize({
      width: 16,
      height: 16
    })
  );

  // ==========================================================
  // TRAY MENU BUILDER
  // ==========================================================

  function buildTrayMenu() {
    const isUpdateReady = !!downloadedUpdateInfo;
    return Menu.buildFromTemplate([
      {
        label: `🚚 Tracker (v${app.getVersion()})`,
        enabled: false
      },
      {
        type: 'separator'
      },
      ...(isUpdateReady ? [
        {
          label: `⚡ Restart to Install Update (v${downloadedUpdateInfo.version})`,
          click: () => {
            autoUpdater.quitAndInstall(false, true);
          }
        },
        {
          type: 'separator'
        }
      ] : []),
      {
        label: 'Show / Hide',
        click: () => {
          if (!mainWindow) return;
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
          }
        }
      },
      {
        label: 'Lock Position',
        type: 'checkbox',
        checked: isLocked,
        click: (item) => {
          if (!mainWindow) return;
          isLocked = item.checked;
          mainWindow.webContents.send('lock-toggle', isLocked);
          if (isLocked) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
          } else {
            mainWindow.setIgnoreMouseEvents(false);
          }
        }
      },
      {
        label: 'Compact Mode',
        type: 'checkbox',
        checked: isCompact,
        click: (item) => {
          if (!mainWindow) return;
          isCompact = item.checked;
          mainWindow.webContents.send('compact-toggle', isCompact);
          if (isCompact) {
            mainWindow.setSize(450, 190);
          } else {
            mainWindow.setSize(450, 720);
          }
        }
      },
      {
        label: 'Discord Rich Presence',
        type: 'checkbox',
        checked: discordRpcEnabled,
        click: (item) => {
          discordRpcEnabled = item.checked;
          if (discordRpc) {
            discordRpc.setEnabled(discordRpcEnabled);
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('discord-toggle-state', discordRpcEnabled);
          }
        }
      },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: isAutoStartEnabled(),
        click: (item) => {
          setAutoStart(item.checked);
        }
      },
      {
        label: 'Check for Updates...',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
          }
          checkForUpdatesManual();
        }
      },
      {
        label: 'Reset Position',
        click: () => {
          if (!mainWindow) return;
          const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
          mainWindow.setPosition(sw - 470, 20);
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Opacity',
        submenu: [
          { label: '100%', click: () => mainWindow && mainWindow.setOpacity(1.0) },
          { label: '90%', click: () => mainWindow && mainWindow.setOpacity(0.9) },
          { label: '80%', click: () => mainWindow && mainWindow.setOpacity(0.8) },
          { label: '70%', click: () => mainWindow && mainWindow.setOpacity(0.7) },
          { label: '50%', click: () => mainWindow && mainWindow.setOpacity(0.5) }
        ]
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        }
      }
    ]);
  }

  function updateTrayMenu() {
    if (tray && !tray.isDestroyed()) {
      tray.setContextMenu(buildTrayMenu());
    }
  }

  tray.setToolTip(
    'Tracker — TruckersMP Job Tracker & Overlay'
  );

  tray.setContextMenu(
    buildTrayMenu()
  );

  tray.on(
    'click',
    () => {

      if (!mainWindow) {
        return;
      }

      if (
        mainWindow.isVisible()
      ) {

        mainWindow.hide();

      } else {

        mainWindow.show();
      }
    }
  );
}

// ============================================================
// IPC — WINDOW DRAG
// ============================================================

ipcMain.on(
  'window-drag',
  (event, { deltaX, deltaY }) => {

    if (
      isLocked ||
      !mainWindow
    ) {
      return;
    }

    const [
      x,
      y
    ] =
      mainWindow.getPosition();

    mainWindow.setPosition(
      x + deltaX,
      y + deltaY
    );
  }
);

// ============================================================
// IPC — WINDOW RESIZE
// ============================================================

ipcMain.on(
  'window-resize',
  (event, payload) => {

    if (
      isLocked ||
      !mainWindow
    ) {
      return;
    }

    const { width, height, x, y } = payload || {};
    const clampedW = Math.min(3840, Math.max(300, Math.round(width || 450)));
    const clampedH = Math.min(2160, Math.max(160, Math.round(height || 720)));

    if (typeof x === 'number' && typeof y === 'number') {
      mainWindow.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: clampedW,
        height: clampedH
      });
    } else {
      mainWindow.setSize(clampedW, clampedH);
    }
  }
);

// ============================================================
// IPC — MINIMIZE
// ============================================================

ipcMain.on(
  'window-minimize',
  () => {

    if (mainWindow) {
      mainWindow.minimize();
    }
  }
);

// ============================================================
// IPC — CLOSE
// ============================================================

ipcMain.on(
  'window-close',
  () => {

    app.quit();
  }
);

// ============================================================
// IPC — RESTART BRIDGE
// ============================================================

ipcMain.on(
  'restart-bridge',
  () => {

    stopBridge();

    startBridge();
  }
);

// ============================================================
// IPC — COMPACT MODE
// ============================================================

ipcMain.on(
  'toggle-compact',
  () => {

    if (!mainWindow) {
      return;
    }

    isCompact =
      !isCompact;

    if (isCompact) {

      mainWindow.setSize(
        450,
        190
      );

    } else {

      mainWindow.setSize(
        450,
        720
      );
    }

    mainWindow.webContents.send(
      'compact-toggle',
      isCompact
    );
  }
);

// ============================================================
// TRUCKERSMP API
// ============================================================

ipcMain.handle(
  'fetch-tmp-api',
  async (event, endpoint) => {

    try {

      const url =
        endpoint.startsWith('http')
          ? endpoint
          : `https://api.truckersmp.com/v2/${endpoint.replace(
              /^\//,
              ''
            )}`;

      const res =
        await fetch(
          url,
          {
            headers: {
              'User-Agent':
                'Tracker/1.0 (Developer: Sukku; TruckersMP Overlay)'
            }
          }
        );

      if (!res.ok) {

        return {
          success: false,
          status: res.status,
          error:
            `HTTP ${res.status} ${res.statusText}`
        };
      }

      const data =
        await res.json();

      return {
        success: true,
        data
      };

    } catch (err) {

      return {
        success: false,
        error: err.message
      };
    }
  }
);

// ============================================================
// IPC — DISCORD RICH PRESENCE
// ============================================================

ipcMain.on('discord-set-activity', (event, activity) => {
  if (discordRpc && discordRpcEnabled) {
    discordRpc.setActivity(activity);
  }
});

ipcMain.on('discord-clear-activity', () => {
  if (discordRpc) {
    discordRpc.clearActivity();
  }
});

ipcMain.on('discord-toggle', (event, enabled) => {
  discordRpcEnabled = !!enabled;
  if (discordRpc) {
    discordRpc.setEnabled(discordRpcEnabled);
  }
});



ipcMain.handle('discord-get-status', () => {
  return {
    connected: discordRpc ? discordRpc.isConnected : false,
    enabled: discordRpcEnabled,
    user: discordRpc ? discordRpc.user : null,
    clientId: discordRpc ? discordRpc.clientId : DEFAULT_CLIENT_ID
  };
});

// ============================================================
// IPC & WATCHER — GAME PROCESS DETECTION (ETS2 & ATS)
// ============================================================

let cachedGameCheck = { timestamp: 0, result: { running: false, game: null, gameName: null, exe: null } };
let lastGameStatus = { running: false, game: null, gameName: null, exe: null };
let gameWatcherInterval = null;
let autoShowOnGameLaunch = true;
let autoHideOnGameExit = false;

function checkGameProcessDirect() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      const res = { running: false, game: null, gameName: null, exe: null };
      cachedGameCheck = { timestamp: Date.now(), result: res };
      return resolve(res);
    }

    const { exec } = require('child_process');
    exec('tasklist /FI "IMAGENAME eq eurotrucks2.exe" /FI "IMAGENAME eq amtrucks.exe" /FO CSV /NH', { windowsHide: true, timeout: 2500 }, (err, stdout) => {
      let res = { running: false, game: null, gameName: null, exe: null };
      if (!err && stdout) {
        const lower = stdout.toLowerCase();
        if (lower.includes('amtrucks.exe')) {
          res = {
            running: true,
            game: 'ATS',
            gameName: 'American Truck Simulator',
            exe: 'amtrucks.exe'
          };
        } else if (lower.includes('eurotrucks2.exe')) {
          res = {
            running: true,
            game: 'ETS2',
            gameName: 'Euro Truck Simulator 2',
            exe: 'eurotrucks2.exe'
          };
        }
      }
      cachedGameCheck = { timestamp: Date.now(), result: res };
      resolve(res);
    });
  });
}

function startGameWatcher() {
  if (gameWatcherInterval) return;

  async function check() {
    const current = await checkGameProcessDirect();
    const wasRunning = lastGameStatus.running;
    const isRunning = current.running;
    const gameChanged = lastGameStatus.game !== current.game;

    if (isRunning && (!wasRunning || gameChanged)) {
      // Game launched or switched
      console.log(`[GameWatcher] Game detected: ${current.gameName} (${current.game})`);
      startBridge();
      if (tray && !tray.isDestroyed()) {
        tray.setToolTip(`Tracker — ${current.gameName} Playing`);
      }
      sendToWindow('game-status-changed', {
        ...current,
        justLaunched: true
      });
      if (autoShowOnGameLaunch && mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
      }
    } else if (!isRunning && wasRunning) {
      // Game closed
      console.log('[GameWatcher] Game closed. Tracker entering Standby.');
      if (discordRpc) {
        discordRpc.clearActivity();
      }
      if (tray && !tray.isDestroyed()) {
        tray.setToolTip('Tracker — Standby (Waiting for ETS2 / ATS)');
      }
      sendToWindow('game-status-changed', {
        running: false,
        game: null,
        gameName: null,
        exe: null,
        justClosed: true
      });
      if (autoHideOnGameExit && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    }

    lastGameStatus = current;
  }

  // Initial check
  check();
  // Poll every 2 seconds in background
  gameWatcherInterval = setInterval(check, 2000);
}

ipcMain.handle('detect-game-process', async () => {
  const now = Date.now();
  if (now - cachedGameCheck.timestamp < 1200) {
    return cachedGameCheck.result;
  }
  return checkGameProcessDirect();
});

ipcMain.on('set-auto-show-game', (event, enable) => {
  autoShowOnGameLaunch = !!enable;
});

ipcMain.on('set-auto-hide-game', (event, enable) => {
  autoHideOnGameExit = !!enable;
});

ipcMain.handle('get-game-settings', () => {
  return {
    autoShowOnGameLaunch,
    autoHideOnGameExit
  };
});

ipcMain.handle('get-autostart', () => {
  return isAutoStartEnabled();
});

ipcMain.on('set-autostart', (event, enable) => {
  setAutoStart(!!enable);
});

// ============================================================
// IPC — AUTO UPDATER
// ============================================================

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (err) {
    console.warn('[AutoUpdater] Check handler error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.on('start-download-update', () => {
  console.log('[AutoUpdater] User requested download of update...');
  autoUpdater.downloadUpdate().catch((err) => {
    console.warn('[AutoUpdater] Download error:', err.message);
    sendToWindow('update-error', { message: err.message });
  });
});

ipcMain.on('quit-and-install-update', () => {
  console.log('[AutoUpdater] Quitting and installing update...');
  autoUpdater.quitAndInstall(false, true);
});

// ============================================================
// ELECTRON READY
// ============================================================

app.whenReady().then(() => {

  app.setAppUserModelId(
    'com.tracker.overlay'
  );

  // Start SCS bridge
  startBridge();

  // Initialize Discord Rich Presence
  initDiscordRPC();

  // Ensure auto-start on boot is registered (runs silently in tray)
  if (!isAutoStartEnabled()) {
    setAutoStart(true);
  }

  // Create overlay
  createWindow();

  // Create tray
  createTray();

  // Start background game process watcher (auto detects ETS2 / ATS launch)
  startGameWatcher();

  // Schedule auto-update checks for users
  // Check automatically 8 seconds after app launch (ensures smooth UI startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[AutoUpdater] Initial check notice:', err.message);
    });
  }, 8000);

  // Automatically check every 2 hours while the app is running
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[AutoUpdater] Periodic check notice:', err.message);
    });
  }, 2 * 60 * 60 * 1000);
});

// ============================================================
// APPLICATION EXIT
// ============================================================

app.on(
  'will-quit',
  () => {

    stopBridge();
    cleanupDiscordRPC();
  }
);

// ============================================================
// ALL WINDOWS CLOSED
// ============================================================

app.on(
  'window-all-closed',
  () => {

    stopBridge();
    cleanupDiscordRPC();

    app.quit();
  }
);