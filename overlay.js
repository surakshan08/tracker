// =======================================================
//  TRACKER — TRUCKERSMP JOB TRACKER & OVERLAY
// =======================================================

const { ipcRenderer, shell } = require('electron');

const TMP_API_BASE = 'https://api.truckersmp.com/v2';
const SCS_TELEMETRY_URL = 'http://localhost:25555/api/ets2/telemetry';

// =======================================================
//  APP STATE
// =======================================================
let activeJob = null;
let jobHistory = [];
let driverProfile = {
    callsign: 'Driver #01',
    tmpId: '',
    tmpName: '',
    avatar: '',
    groupName: 'VTC Driver',
    groupColor: '',
    joinDate: '',
    banned: false,
    vtc: null,
    unit: 'kmh' // 'kmh' or 'mph'
};

// =======================================================
//  ACTIVE GAME DETECTION STATE (ETS2 vs ATS)
// =======================================================
let activeGame = {
    code: null, // 'ETS2' | 'ATS' | null
    name: 'No Game Running',
    exe: null,
    isProcessRunning: false,
    isTelemetryLive: false,
    isPaused: false,
    truckBrand: '',
    truckModel: '',
    licensePlate: ''
};
let previousGameCode = null;
let selectedDispatchGame = 'ETS2';
let gameProcessCheckInterval = null;

function normalizeGame(rawGame) {
    if (!rawGame) return null;
    const str = String(rawGame).toLowerCase().trim();
    if (str.includes('ats') || str.includes('american') || str.includes('amtrucks')) {
        return 'ATS';
    }
    if (str.includes('ets') || str.includes('euro') || str.includes('eurotrucks')) {
        return 'ETS2';
    }
    return null;
}

function getGameFullName(code) {
    if (code === 'ATS') return 'American Truck Simulator';
    if (code === 'ETS2') return 'Euro Truck Simulator 2';
    return 'No Game Running';
}

let telemetryConnected = false;
let isDemoMode = false;
let demoInterval = null;
let telemetryPollInterval = null;

// Discord Rich Presence state
let discordRpcConnected = false;
let discordRpcEnabled = true;
let discordShowSpeed = true;
let discordShowElapsed = true;
let discordSessionStart = Date.now();
let discordPresenceInterval = null;
let discordElapsedTimer = null;

// Telemetry live values
let currentSpeed = 0;
let currentLimit = 90;
let currentGear = 'N';
let currentCruise = 0;
let currentRpm = 0;
let currentFuel = 100; // percentage
let currentTruckDmg = 0.0;
let currentCargoDmg = 0.0;

// Presets database for instant job generation
const JOB_PRESETS = [
    { originCity: 'Rotterdam', originCompany: 'EuroGoodies', destCity: 'Berlin', destCompany: 'LKW Logistik', cargo: 'Electronics Components', weight: 22.4, distance: 850, income: 38500, game: 'ETS2' },
    { originCity: 'Paris', originCompany: 'Tradeaux', destCity: 'Milano', destCompany: 'Transinet', cargo: 'Heavy Industrial Machinery', weight: 28.0, distance: 840, income: 42000, game: 'ETS2' },
    { originCity: 'Calais', originCompany: 'Sanbuilders', destCity: 'Duisburg', destCompany: 'BCP', cargo: 'Chemical Contraband / Hazmat', weight: 19.5, distance: 410, income: 24500, game: 'ETS2' },
    { originCity: 'Hamburg', originCompany: 'EuroAcres', destCity: 'Kraków', destCompany: 'POSPED', cargo: 'Medical Vaccines & Supplies', weight: 14.2, distance: 780, income: 49000, game: 'ETS2' },
    { originCity: 'Los Angeles', originCompany: 'Coastline Mining', destCity: 'Las Vegas', destCompany: 'Charged', cargo: 'Luxury Beverages', weight: 18.0, distance: 440, income: 21000, game: 'ATS' },
    { originCity: 'Phoenix', originCompany: 'SellPlan', destCity: 'Albuquerque', destCompany: 'Wallbert', cargo: 'Fresh Farm Produce', weight: 21.5, distance: 720, income: 33400, game: 'ATS' },
    { originCity: 'Amsterdam', originCompany: 'Marina', destCity: 'Prague', destCompany: 'ITCC', cargo: 'Auto Parts & Engines', weight: 24.8, distance: 890, income: 41200, game: 'ETS2' },
    { originCity: 'London', originCompany: 'Stokes', destCity: 'Frankfurt', destCompany: 'Trameri', cargo: 'Aircraft Components', weight: 16.0, distance: 790, income: 51000, game: 'ETS2' }
];

// =======================================================
//  INITIALIZATION
// =======================================================
document.addEventListener('DOMContentLoaded', () => {
    loadSavedData();
    setupTitlebar();
    setupTabs();
    setupModals();
    setupTelemetryControls();
    setupJobActionHandlers();
    setupLogbookControls();
    setupDriverProfileHandlers();
    setupExternalLinks();

    // Render Initial State
    renderActiveJob();
    renderLogbook();
    updateDriverStats();
    updateCockpitDisplays();
    updateCompactHUD();

    // Start Telemetry Poller & VTC data loader
    startTelemetryPolling();
    pollSCS(); // Immediate detection query on launch
    setupVtcControls();
    loadVTCData();
    setupServerControls();
    loadServersData();
    startServersPolling();

    // Discord Rich Presence
    setupDiscordRPC();

    // Auto-Updater
    setupAutoUpdater();

    // Compact Mode IPC
    ipcRenderer.on('compact-toggle', (_, isCompact) => {
        document.body.classList.toggle('compact', isCompact);
        updateCompactHUD();
    });
});

// =======================================================
//  STORAGE & PERSISTENCE
// =======================================================
function loadSavedData() {
    try {
        const savedHistory = localStorage.getItem('tracker_job_history');
        if (savedHistory) {
            jobHistory = JSON.parse(savedHistory);
        } else {
            // Seed initial realistic VTC job history so new drivers start with clean stats
            jobHistory = [
                {
                    id: 'job_init_1',
                    date: new Date(Date.now() - 86400000 * 2).toISOString(),
                    game: 'ETS2',
                    originCity: 'Rotterdam',
                    originCompany: 'EuroGoodies',
                    destCity: 'Berlin',
                    destCompany: 'LKW',
                    cargo: 'Medical Vaccines',
                    weight: 18.5,
                    distance: 850,
                    income: 38500,
                    truckDamage: 0.0,
                    cargoDamage: 0.0,
                    rating: '5.0 ★'
                },
                {
                    id: 'job_init_2',
                    date: new Date(Date.now() - 86400000).toISOString(),
                    game: 'ETS2',
                    originCity: 'Paris',
                    originCompany: 'Tradeaux',
                    destCity: 'Duisburg',
                    destCompany: 'BCP',
                    cargo: 'Electronic Chips',
                    weight: 22.0,
                    distance: 510,
                    income: 27900,
                    truckDamage: 0.2,
                    cargoDamage: 0.0,
                    rating: '5.0 ★'
                }
            ];
            saveHistory();
        }

        const savedActive = localStorage.getItem('tracker_active_job');
        if (savedActive) {
            try {
                activeJob = JSON.parse(savedActive);
            } catch {
                activeJob = null;
            }
        } else {
            activeJob = null;
        }

        const savedProfile = localStorage.getItem('tracker_driver_profile') || localStorage.getItem('pean_driver_profile');
        if (savedProfile) {
            driverProfile = { ...driverProfile, ...JSON.parse(savedProfile) };
        }
        document.getElementById('driverCallsign').value = driverProfile.callsign;
        document.getElementById('driverTmpId').value = driverProfile.tmpId || '';
        renderDriverProfileUI();
        if (driverProfile.tmpId) {
            fetchDriverTruckersMP(driverProfile.tmpId, false);
        } else if (driverProfile.vtc && driverProfile.vtc.id) {
            loadVTCData(driverProfile.vtc.id);
        } else {
            loadVTCData(0);
        }
    } catch (e) {
        console.error('Failed to load local data:', e);
    }
}

function saveActiveJob() {
    if (activeJob) {
        localStorage.setItem('tracker_active_job', JSON.stringify(activeJob));
    } else {
        localStorage.removeItem('tracker_active_job');
    }
}

function saveHistory() {
    localStorage.setItem('tracker_job_history', JSON.stringify(jobHistory));
}

function saveProfile() {
    localStorage.setItem('tracker_driver_profile', JSON.stringify(driverProfile));
}

// =======================================================
//  TITLEBAR & DRAGGING
// =======================================================
function setupTitlebar() {
    document.getElementById('btnMinimize').addEventListener('click', () => {
        ipcRenderer.send('window-minimize');
    });
    document.getElementById('btnClose').addEventListener('click', () => {
        ipcRenderer.send('window-close');
    });
    document.getElementById('btnCompact').addEventListener('click', () => {
        ipcRenderer.send('toggle-compact');
    });

    // Window Dragging
    const titlebar = document.getElementById('titlebar');
    let isDragging = false;
    let startX = 0, startY = 0;

    titlebar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.tb-btn') || e.target.closest('button')) return;
        isDragging = true;
        startX = e.screenX;
        startY = e.screenY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaX = e.screenX - startX;
        const deltaY = e.screenY - startY;
        startX = e.screenX;
        startY = e.screenY;
        ipcRenderer.send('window-drag', { deltaX, deltaY });
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Window Resizing (Multi-directional Edge, Corner, and Grip Resizing)
    let isResizing = false;
    let resizeDir = 'se';
    let startMouseX = 0, startMouseY = 0;
    let startW = 450, startH = 720;
    let startWinX = 0, startWinY = 0;

    const MIN_W = 320;
    const MIN_H = 180;
    const MAX_W = 3840;
    const MAX_H = 2160;

    function startResize(e, direction) {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        resizeDir = direction || 'se';
        startMouseX = e.screenX;
        startMouseY = e.screenY;
        startW = window.innerWidth || 450;
        startH = window.innerHeight || 720;
        startWinX = window.screenX || 0;
        startWinY = window.screenY || 0;
        document.body.classList.add('is-resizing');
    }

    document.querySelectorAll('.resize-edge, .resize-corner, #resizeHandle').forEach(el => {
        el.addEventListener('mousedown', (e) => {
            const dir = el.dataset.direction || 'se';
            startResize(e, dir);
        });

        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            ipcRenderer.send('window-resize', { width: 450, height: 720 });
        });
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        if (e.buttons === 0) {
            isResizing = false;
            document.body.classList.remove('is-resizing');
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const deltaX = (e.screenX - startMouseX) / dpr;
        const deltaY = (e.screenY - startMouseY) / dpr;

        let newW = startW;
        let newH = startH;
        let newX = startWinX;
        let newY = startWinY;
        let posChanged = false;

        // Horizontal resizing
        if (resizeDir.includes('e')) {
            newW = Math.min(MAX_W, Math.max(MIN_W, startW + deltaX));
        } else if (resizeDir.includes('w')) {
            const calculatedW = startW - deltaX;
            newW = Math.min(MAX_W, Math.max(MIN_W, calculatedW));
            newX = Math.round(startWinX + (startW - newW));
            posChanged = true;
        }

        // Vertical resizing
        if (resizeDir.includes('s')) {
            newH = Math.min(MAX_H, Math.max(MIN_H, startH + deltaY));
        } else if (resizeDir.includes('n')) {
            const calculatedH = startH - deltaY;
            newH = Math.min(MAX_H, Math.max(MIN_H, calculatedH));
            newY = Math.round(startWinY + (startH - newH));
            posChanged = true;
        }

        if (posChanged) {
            ipcRenderer.send('window-resize', {
                width: Math.round(newW),
                height: Math.round(newH),
                x: newX,
                y: newY
            });
        } else {
            ipcRenderer.send('window-resize', {
                width: Math.round(newW),
                height: Math.round(newH)
            });
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('is-resizing');
        }
    });

    // Prevent accidental Chromium page zooming (Ctrl + mouse wheel or Ctrl + +/-)
    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0')) {
            e.preventDefault();
        }
    });
}

// =======================================================
//  TABS
// =======================================================
function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const targetEl = document.getElementById(`tab-${target}`);
            if (targetEl) targetEl.classList.add('active');

            if (target === 'logbook') renderLogbook();
            if (target === 'driver') updateDriverStats();
            if (target === 'vtc') loadVTCData();
            if (target === 'servers') loadServersData();
        });
    });
}

// =======================================================
//  SCS TELEMETRY CLIENT & DEMO SIMULATION
// =======================================================
function setupTelemetryControls() {
    document.getElementById('btnCheckTelemetry').addEventListener('click', async () => {
        showToast('Connecting to ETS2 / ATS Telemetry...');
        // Request main process to verify/launch the bridge
        ipcRenderer.send('restart-bridge');
        
        setTimeout(async () => {
            const ok = await pollSCS();
            if (ok) {
                showToast('🟢 Telemetry Connected to ETS2!');
            } else {
                showToast('Searching for ETS2 (Port 3737 / 25555)...');
            }
        }, 350);
    });

    document.getElementById('btnToggleDemo').addEventListener('click', () => {
        toggleDemoMode();
    });

    document.getElementById('btnToggleUnit').addEventListener('click', () => {
        driverProfile.unit = driverProfile.unit === 'kmh' ? 'mph' : 'kmh';
        saveProfile();
        updateSpeedometer();
    });
}

function startTelemetryPolling() {
    if (telemetryPollInterval) clearInterval(telemetryPollInterval);
    telemetryPollInterval = setInterval(pollSCS, 250); // 4 updates/sec for smooth cockpit response

    if (gameProcessCheckInterval) clearInterval(gameProcessCheckInterval);
    gameProcessCheckInterval = setInterval(checkGameProcess, 1500); // Check running game executable every 1.5s
    checkGameProcess();

    // Listen for real-time game status broadcast from main.js watcher
    ipcRenderer.on('game-status-changed', (_, data) => {
        if (data && data.running) {
            const detectedCode = normalizeGame(data.game) || 'ETS2';
            const isNew = previousGameCode !== detectedCode;
            activeGame.code = detectedCode;
            activeGame.name = data.gameName || getGameFullName(detectedCode);
            activeGame.exe = data.exe;
            activeGame.isProcessRunning = true;

            if (data.justLaunched || isNew) {
                showToast(`🎮 ${activeGame.name} Started — Tracking Live!`);
                previousGameCode = detectedCode;
            }
            updateActiveGameUI();
            pollSCS();
        } else {
            activeGame.code = null;
            activeGame.name = 'No Game Running';
            activeGame.exe = null;
            activeGame.isProcessRunning = false;
            activeGame.isTelemetryLive = false;
            telemetryConnected = false;
            previousGameCode = null;

            if (data && data.justClosed) {
                showToast('🛑 Game Closed — Tracker entering Standby');
            }
            setTelemetryStatus('STANDBY', false, false, false, 'ETS2');
            updateActiveGameUI();

            if (discordRpcEnabled) {
                ipcRenderer.send('discord-clear-activity');
            }
        }
    });
}

async function checkGameProcess() {
    if (isDemoMode) return;
    try {
        const proc = await ipcRenderer.invoke('detect-game-process');
        if (proc && proc.running) {
            const detectedCode = normalizeGame(proc.game) || 'ETS2';
            const isNew = previousGameCode !== detectedCode;
            activeGame.code = detectedCode;
            activeGame.name = proc.gameName || getGameFullName(detectedCode);
            activeGame.exe = proc.exe;
            activeGame.isProcessRunning = true;

            if (isNew && !telemetryConnected) {
                showToast(`🎮 ${activeGame.name} (${detectedCode}) Running`);
                previousGameCode = detectedCode;
            }
            if (!telemetryConnected) {
                setTelemetryStatus('STANDBY', false, false, false, detectedCode);
            }
        } else {
            activeGame.isProcessRunning = false;
            if (!telemetryConnected) {
                activeGame.code = null;
                activeGame.name = 'No Game Running';
                activeGame.exe = null;
                previousGameCode = null;
                setTelemetryStatus('STANDBY', false, false, false, 'ETS2');
            }
        }
        updateActiveGameUI();
    } catch {}
}

function updateActiveGameUI() {
    const pill = document.getElementById('activeGamePill');
    const pillTxt = document.getElementById('activeGamePillText');
    const chip = document.getElementById('gameDetectedChip');
    const cgbBadge = document.getElementById('cgbBadge');
    const cgbName = document.getElementById('cgbGameName');
    const cgbStatus = document.getElementById('cgbGameStatus');
    const cgbTruck = document.getElementById('cgbTruckName');
    const compactTag = document.getElementById('compactGameTag');
    const jobTag = document.getElementById('jobGameTag');

    const code = activeGame.code;
    const isLive = activeGame.isTelemetryLive;
    const isPaused = activeGame.isPaused;

    // 1. Titlebar Active Game Pill
    if (pill && pillTxt) {
        if (code === 'ATS') {
            pill.className = `active-game-pill ats ${isPaused ? 'paused' : ''}`;
            pillTxt.textContent = isPaused ? 'ATS (PAUSED)' : (isLive ? 'ATS PLAYING' : 'ATS OPEN');
        } else if (code === 'ETS2') {
            pill.className = `active-game-pill ets2 ${isPaused ? 'paused' : ''}`;
            pillTxt.textContent = isPaused ? 'ETS2 (PAUSED)' : (isLive ? 'ETS2 PLAYING' : 'ETS2 OPEN');
        } else if (isDemoMode) {
            pill.className = 'active-game-pill ets2';
            pillTxt.textContent = 'DEMO DRIVE';
        } else {
            pill.className = 'active-game-pill idle';
            pillTxt.textContent = 'NO GAME';
        }
    }

    // 2. Telemetry Bar Game Chip
    if (chip) {
        if (code === 'ATS') {
            chip.className = 'game-detected-chip ats';
            chip.textContent = isLive ? '🎮 ATS LIVE' : '🎮 ATS OPEN';
        } else if (code === 'ETS2') {
            chip.className = 'game-detected-chip ets2';
            chip.textContent = isLive ? '🎮 ETS2 LIVE' : '🎮 ETS2 OPEN';
        } else if (isDemoMode) {
            chip.className = 'game-detected-chip ets2';
            chip.textContent = '🎮 DEMO SIM';
        } else {
            chip.className = 'game-detected-chip idle';
            chip.textContent = '🎮 NO GAME';
        }
    }

    // 3. Compact HUD Tag
    if (compactTag) {
        const displayCode = code || (activeJob && activeJob.game) || 'NO GAME';
        compactTag.textContent = displayCode;
        compactTag.className = `compact-game-tag ${code ? code.toLowerCase() : 'idle'}`;
    }

    // 4. Cockpit Live Vehicle & Game Banner
    if (cgbBadge && cgbName && cgbStatus && cgbTruck) {
        if (code === 'ATS') {
            cgbBadge.textContent = 'ATS';
            cgbBadge.className = 'cgb-badge ats';
            cgbName.textContent = 'American Truck Simulator';
            cgbStatus.textContent = isLive
                ? (isPaused ? '🟡 In Menu / Paused • Live Telemetry' : '🟢 Live Driving • Telemetry Streaming')
                : '🟡 Game Running • Waiting for SCS Plugin...';
        } else if (code === 'ETS2') {
            cgbBadge.textContent = 'ETS2';
            cgbBadge.className = 'cgb-badge ets2';
            cgbName.textContent = 'Euro Truck Simulator 2';
            cgbStatus.textContent = isLive
                ? (isPaused ? '🟡 In Menu / Paused • Live Telemetry' : '🟢 Live Driving • Telemetry Streaming')
                : '🟡 Game Running • Waiting for SCS Plugin...';
        } else if (isDemoMode) {
            cgbBadge.textContent = 'DEMO';
            cgbBadge.className = 'cgb-badge ets2';
            cgbName.textContent = 'Simulation Drive Mode';
            cgbStatus.textContent = '🔵 Cruising Highway Dynamics';
        } else {
            cgbBadge.textContent = 'STANDBY';
            cgbBadge.className = 'cgb-badge idle';
            cgbName.textContent = 'No Game Running';
            cgbStatus.textContent = '⚪ Waiting for ETS2 or ATS to open';
        }

        // Truck details
        const truckStr = [activeGame.truckBrand, activeGame.truckModel].filter(Boolean).join(' ');
        if (truckStr) {
            cgbTruck.textContent = truckStr;
        } else if (activeJob && activeJob.game) {
            cgbTruck.textContent = activeJob.game === 'ATS' ? 'Peterbilt / Kenworth' : 'Scania / Volvo';
        } else {
            cgbTruck.textContent = '—';
        }
    }

    // 5. Active Job Card Game Tag
    if (jobTag) {
        const gameForJob = (activeJob && activeJob.game) ? activeJob.game : (code || 'ETS2');
        jobTag.textContent = gameForJob;
        jobTag.className = `game-tag ${gameForJob.toLowerCase()}`;
    }
}

async function pollSCS() {
    if (isDemoMode) return false;

    // 1. Try our native zero-dependency MMF bridge (port 3737)
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 800);
        const res = await fetch('http://127.0.0.1:3737/api/ets2/telemetry', { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            handleLiveTelemetryData(data);
            return true;
        }
    } catch {
        // Bridge may be starting
    }

    // 2. Fallback to standard SCS / Funbit server (port 25555)
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 800);
        const res = await fetch('http://127.0.0.1:25555/api/ets2/telemetry', { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            handleLiveTelemetryData(data);
            return true;
        }
    } catch {
        setTelemetryStatus('STANDBY', false);
        return false;
    }
}

function setTelemetryStatus(status, isLive, isDemo = false, isPaused = false, game = 'ETS2') {
    const badge = document.getElementById('telemetryBadge');
    const txt = document.getElementById('telemetryStatusText');
    const chip = document.getElementById('sourceChip');
    const details = document.getElementById('sourceDetails');

    const normGame = normalizeGame(game) || (activeGame.code || 'ETS2');
    const gameFull = getGameFullName(normGame);

    badge.className = 'telemetry-badge';
    if (isLive) {
        badge.classList.add('online');
        txt.textContent = 'TELEMETRY LIVE';
        chip.textContent = `${normGame} Online`;
        chip.className = `telemetry-chip ${normGame.toLowerCase()}`;
        details.textContent = isPaused ? `${normGame} Connected (Game Paused / In Menu)` : `Live telemetry streaming from ${normGame}`;
    } else if (isDemo) {
        badge.classList.add('demo');
        txt.textContent = 'DEMO DRIVE';
        chip.textContent = 'Simulation Mode';
        chip.className = 'telemetry-chip';
        details.textContent = 'Simulating driving dynamics';
    } else if (activeGame.isProcessRunning) {
        txt.textContent = `${normGame} OPEN`;
        chip.textContent = `${normGame} Detected`;
        chip.className = `telemetry-chip ${normGame.toLowerCase()}`;
        details.textContent = `${gameFull} open. Waiting for SCS SDK plugin on Port 3737/25555`;
    } else {
        txt.textContent = 'STANDBY';
        chip.textContent = 'SCS SDK Standby';
        chip.className = 'telemetry-chip';
        details.textContent = 'Waiting for ETS2 / ATS to launch';
        currentSpeed = 0;
        currentCruise = 0;
        currentGear = 'N';
        currentRpm = 0;
        updateCockpitDisplays();
        updateCompactHUD();
        // Clear Discord presence when game is not running
        telemetryConnected = false;
        if (discordRpcEnabled) {
            ipcRenderer.send('discord-clear-activity');
        }
    }

    updateActiveGameUI();
}

function handleLiveTelemetryData(data) {
    if (!data) return;

    let isConnected = false;
    let isPaused = false;
    let gameName = 'ETS2';
    let speedKph = 0;
    let speedMphVal = 0;
    let speedLimitKph = 90;
    let speedLimitMphVal = 55;
    let gearVal = 0;
    let rpmVal = 1000;
    let cruiseSpeed = 0;
    let fuelPercent = 75;
    let truckDmgVal = 0.0;
    let cargoDmgVal = 0.0;
    let hasJobInGame = false;
    let jobDelivered = false;
    let jobFinished = false;
    let jobData = null;
    let truckBrand = '';
    let truckModel = '';
    let licensePlate = '';

    // 1. Raw SCSTelemetry format directly from MMF if passed
    if (data.TruckValues) {
        const tv = data.TruckValues || {};
        const cv = tv.CurrentValues || {};
        const dv = cv.DashboardValues || {};
        const jv = data.JobValues || {};
        const nv = data.NavigationValues || {};
        const dmg = cv.DamageValues || {};
        const cap = tv.ConstantsValues?.CapacityValues || {};
        const trailers = data.TrailerValues || [];

        if (tv.ConstantsValues) {
            truckBrand = tv.ConstantsValues.Brand || '';
            truckModel = tv.ConstantsValues.Name || '';
            licensePlate = tv.ConstantsValues.LicensePlate || '';
        }

        const capFuel = cap.Fuel || 0;
        const fuelAmt = dv.FuelValue?.Amount || 0;
        const fuelRange = dv.FuelValue?.Range || 0;
        fuelPercent = capFuel > 0 ? (fuelAmt / capFuel) * 100 : (fuelRange > 0 ? Math.min(100, (fuelRange / 1400) * 100) : 75);

        truckDmgVal = ((dmg.Engine || 0) + (dmg.Transmission || 0) + (dmg.Cabin || 0) + (dmg.Chassis || 0) + (dmg.WheelsAvg || 0)) / 5 * 100;
        cargoDmgVal = (trailers.length > 0 && trailers[0]?.DamageValues) ? (trailers[0].DamageValues.Chassis * 100) : 0;

        isConnected = data.SdkActive !== false;
        isPaused = Boolean(data.Paused);
        gameName = String(data.Game || 'ETS2');
        speedKph = dv.Speed?.Kph || 0;
        speedMphVal = dv.Speed?.Mph || 0;
        speedLimitKph = nv.SpeedLimit?.Kph || 90;
        speedLimitMphVal = nv.SpeedLimit?.Mph || 55;
        gearVal = dv.GearDashboards || 0;
        rpmVal = dv.RPM || 1000;
        cruiseSpeed = dv.CruiseControl ? (dv.CruiseControlSpeed?.Kph || 0) : 0;

        const dest = jv.CityDestination ? jv.CityDestination.trim() : '';
        const src = jv.CitySource ? jv.CitySource.trim() : '';
        const cName = (jv.CargoValues && jv.CargoValues.Name) ? jv.CargoValues.Name.trim() : '';
        hasJobInGame = Boolean((dest !== '') || (src !== '') || (cName !== '') || jv.CargoLoaded || (jv.Income && jv.Income > 0));

        if (data.SpecialEventsValues) {
            jobDelivered = Boolean(data.SpecialEventsValues.JobDelivered);
            jobFinished = Boolean(data.SpecialEventsValues.JobFinished);
        }

        jobData = {
            originCity: jv.CitySource || '',
            originCompany: jv.CompanySource || '',
            destCity: jv.CityDestination || '',
            destCompany: jv.CompanyDestination || '',
            cargo: jv.CargoValues?.Name || '',
            mass: jv.CargoValues?.Mass ? Math.round(jv.CargoValues.Mass / 1000) : 0,
            cargoLoaded: Boolean(jv.CargoLoaded),
            plannedDistance: jv.PlannedDistanceKm || 0,
            distanceRemaining: nv.NavigationDistance ? Math.round(nv.NavigationDistance / 1000) : 0,
            income: jv.Income || 0
        };
    } else if (data.speed !== undefined && data.gear !== undefined && data.truckDamage !== undefined) {
        // 2. High-performance C# native bridge format (Port 3737)
        isConnected = Boolean(data.connected);
        isPaused = Boolean(data.paused);
        gameName = data.game || 'ETS2';
        speedKph = data.speed || 0;
        speedMphVal = data.speedMph || 0;
        speedLimitKph = data.speedLimit || 90;
        speedLimitMphVal = data.speedLimitMph || 55;
        gearVal = data.gear || 0;
        rpmVal = data.rpm || 1000;
        cruiseSpeed = data.cruiseControl || 0;
        fuelPercent = data.fuelPct || 75;
        truckDmgVal = parseFloat(data.truckDamage || 0.0);
        cargoDmgVal = parseFloat(data.cargoDamage || 0.0);
        hasJobInGame = Boolean(data.hasJob);
        jobDelivered = Boolean(data.jobDelivered);
        jobFinished = Boolean(data.jobFinished);
        jobData = data.job || null;
        if (data.truck) {
            truckBrand = data.truck.brand || '';
            truckModel = data.truck.model || '';
            licensePlate = data.truck.licensePlate || '';
        }
    } else {
        // 3. Funbit / SCS Telemetry server fallback format (Port 25555)
        const truck = data.truck || {};
        const job = data.job || {};
        const nav = data.navigation || {};
        const trailer = data.trailer || {};

        isConnected = Boolean(data.connected !== false && truck.speed !== undefined);
        isPaused = Boolean(data.paused);
        gameName = data.game?.gameName || 'ETS2';
        speedKph = truck.speed || 0;
        speedMphVal = speedKph * 0.621371;
        speedLimitKph = nav.speedLimit || 90;
        speedLimitMphVal = speedLimitKph * 0.621371;
        gearVal = truck.gear || 0;
        rpmVal = truck.engineRpm || 1000;
        cruiseSpeed = truck.cruiseControlSpeed || 0;
        fuelPercent = truck.fuelCapacity > 0 ? ((truck.fuel / truck.fuelCapacity) * 100) : 75;
        truckDmgVal = Math.min(100, ((truck.wearEngine || 0) + (truck.wearTransmission || 0) + (truck.wearChassis || 0)) * 100);
        cargoDmgVal = Math.min(100, (trailer.wear || 0) * 100);
        hasJobInGame = Boolean(job.destinationCity && job.destinationCity.trim() !== '');

        if (truck.make) truckBrand = truck.make;
        if (truck.model) truckModel = truck.model;

        jobData = {
            originCity: job.sourceCity || '',
            originCompany: job.sourceCompany || '',
            destCity: job.destinationCity || '',
            destCompany: job.destinationCompany || '',
            cargo: job.cargo || '',
            mass: job.mass ? Math.round(job.mass / 1000) : 0,
            cargoLoaded: Boolean(job.cargoLoaded),
            plannedDistance: job.estimatedDistance ? Math.round(job.estimatedDistance / 1000) : 0,
            distanceRemaining: nav.estimatedDistance ? Math.round(nav.estimatedDistance / 1000) : 0,
            income: job.income || 0
        };
    }

    if (!isConnected) {
        setTelemetryStatus('STANDBY', false);
        return;
    }

    const normGame = normalizeGame(gameName) || 'ETS2';
    activeGame.code = normGame;
    activeGame.name = getGameFullName(normGame);
    activeGame.isTelemetryLive = true;
    activeGame.isProcessRunning = true;
    activeGame.isPaused = isPaused;
    if (truckBrand || truckModel) {
        activeGame.truckBrand = truckBrand;
        activeGame.truckModel = truckModel;
    }
    if (licensePlate) {
        activeGame.licensePlate = licensePlate;
    }

    if (previousGameCode !== normGame) {
        showToast(`🎮 Telemetry Streaming: ${activeGame.name} (${normGame})`);
        previousGameCode = normGame;
    }

    telemetryConnected = true;
    setTelemetryStatus('ONLINE', true, false, isPaused, normGame);

    // Start Discord presence polling now that the game is running
    if (discordRpcEnabled && discordRpcConnected) {
        startDiscordPolling();
    }

    const isMph = driverProfile.unit === 'mph';
    const absKph = Math.abs(speedKph || 0);
    const absMph = Math.abs(speedMphVal || (speedKph || 0) * 0.621371);
    currentSpeed = Math.round(isMph ? absMph : absKph);
    currentLimit = Math.abs(Math.round(isMph ? (speedLimitMphVal || speedLimitKph * 0.621371) : speedLimitKph));
    currentGear = formatGear(gearVal);
    currentCruise = Math.round(cruiseSpeed);
    currentRpm = Math.round(rpmVal);
    currentFuel = Math.round(fuelPercent);
    currentTruckDmg = truckDmgVal.toFixed(1);
    currentCargoDmg = cargoDmgVal.toFixed(1);

    // ==========================================
    // AUTO-DETECT & SYNC IN-GAME JOB
    // ==========================================
    if (hasJobInGame && jobData && (jobData.destCity || jobData.cargo || jobData.originCity)) {
        const originCity = jobData.originCity || 'Depot';
        const originCompany = jobData.originCompany || 'Company';
        const destCity = jobData.destCity || 'Destination';
        const destCompany = jobData.destCompany || 'Company';
        const cargo = jobData.cargo || 'General Cargo';
        const mass = jobData.mass !== undefined ? jobData.mass : 20;
        const plannedDist = jobData.plannedDistance || 0;
        const distRem = jobData.distanceRemaining !== undefined ? jobData.distanceRemaining : 0;
        const income = jobData.income || 0;
        const cargoLoaded = jobData.cargoLoaded !== undefined ? jobData.cargoLoaded : true;

        const isNewJob = !activeJob ||
            activeJob.originCity !== originCity ||
            activeJob.destCity !== destCity ||
            (cargo && activeJob.cargo !== cargo);

        if (isNewJob) {
            const distTotal = plannedDist > 0 ? plannedDist : (distRem > 0 ? distRem : 500);
            const distDriven = (distRem > 0 && distTotal >= distRem) ? (distTotal - distRem) : 0;

            activeJob = {
                isLiveGameJob: true,
                game: normGame,
                originCity: originCity,
                originCompany: originCompany,
                destCity: destCity,
                destCompany: destCompany,
                cargo: cargo,
                weight: mass,
                distance: distTotal,
                drivenDistance: distDriven,
                income: income > 0 ? income : 28500,
                status: cargoLoaded ? 'IN TRANSIT' : 'CARGO ASSIGNED',
                startTime: Date.now()
            };
            saveActiveJob();
            updateDiscordPresence();
            showToast(`🎮 In-Game Job Detected: ${originCity} ➔ ${destCity} (${cargo})`);
        } else {
            // Continuously update live progress for existing job
            if (plannedDist > 0 && (!activeJob.distance || activeJob.distance < plannedDist)) {
                activeJob.distance = plannedDist;
            }
            if (income > 0) activeJob.income = income;
            if (mass > 0) activeJob.weight = mass;
            if (cargoLoaded) activeJob.status = 'IN TRANSIT';

            if (distRem >= 0 && activeJob.distance > 0) {
                const calculatedDriven = Math.max(0, activeJob.distance - distRem);
                activeJob.drivenDistance = calculatedDriven;
            }
            saveActiveJob();
        }
    } else if (isConnected && activeJob && activeJob.isLiveGameJob && !hasJobInGame) {
        // Player had a live in-game job and it completed / finished or was cancelled
        if (jobDelivered || jobFinished || (activeJob.distance > 0 && activeJob.drivenDistance >= activeJob.distance * 0.85)) {
            finishActiveJob();
            showToast('🎉 In-Game Delivery Finished & Logged!');
        } else {
            // Cancelled in game
            activeJob = null;
            saveActiveJob();
            updateDiscordPresence();
        }
    }

    updateCockpitDisplays();
    renderActiveJob();
    updateCompactHUD();
    updateActiveGameUI();
}

function formatGear(gear) {
    if (gear === undefined || gear === null) return 'N';
    if (gear === 0) return 'N';
    if (gear < 0) return `R${Math.abs(gear)}`;
    return `D${gear}`;
}

// Demo Mode Toggle
function toggleDemoMode() {
    isDemoMode = !isDemoMode;
    const btn = document.getElementById('btnToggleDemo');

    if (isDemoMode) {
        btn.classList.remove('btn-accent');
        btn.classList.add('btn-ghost');
        btn.textContent = '⏹ Stop Demo';
        setTelemetryStatus('DEMO', false, true);

        // Run simulation step every 800ms
        demoInterval = setInterval(simulateDrivingStep, 800);
        showToast('Demo driving mode enabled');
    } else {
        clearInterval(demoInterval);
        btn.classList.add('btn-accent');
        btn.classList.remove('btn-ghost');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Demo Drive`;
        currentSpeed = 0;
        setTelemetryStatus('STANDBY', false);
        checkGameProcess();
        updateCockpitDisplays();
        showToast('Demo driving mode stopped');
    }
}

function simulateDrivingStep() {
    // Realistic highway cruising simulation
    const targetCruise = 85;
    const jitter = (Math.random() * 8) - 4; // -4 to +4 km/h fluctuation
    currentSpeed = Math.max(0, Math.min(105, Math.round(targetCruise + jitter)));
    currentLimit = 90;
    currentCruise = targetCruise;
    currentGear = currentSpeed > 75 ? 'D12' : 'D11';
    currentRpm = Math.round(1150 + (currentSpeed * 4) + (Math.random() * 40));

    // Progress active job distance
    if (activeJob) {
        if (!activeJob.drivenDistance) activeJob.drivenDistance = 0;
        activeJob.drivenDistance += Math.round((currentSpeed / 3600) * 12); // simulated fast forward
        if (activeJob.drivenDistance >= activeJob.distance) {
            activeJob.drivenDistance = activeJob.distance;
            finishActiveJob();
            toggleDemoMode();
            return;
        }
        saveActiveJob();
    }

    // Gradual fuel consumption
    currentFuel = Math.max(12, currentFuel - 0.02);

    updateCockpitDisplays();
    renderActiveJob();
    updateCompactHUD();
}

// =======================================================
//  TRIP ESTIMATION (ETA, DURATION, SPEED ESTIMATION)
// =======================================================
function calculateTripEstimation() {
    if (!activeJob) {
        return {
            hasJob: false,
            durationMins: 0,
            durationFormatted: '--',
            etaFormatted: '--:--',
            etaDate: null,
            avgSpeedKmh: 0,
            avgSpeedFormatted: '--',
            distanceRemaining: 0
        };
    }

    const isMph = driverProfile.unit === 'mph';
    const totalDistKm = activeJob.distance || 1;
    const drivenKm = activeJob.drivenDistance || 0;
    const remKm = Math.max(0, totalDistKm - drivenKm);

    // Dynamic speed estimation for ETA calculation
    let effectiveKmh = 80;
    if (telemetryConnected && currentSpeed > 25) {
        // Truck is driving live
        effectiveKmh = currentSpeed;
    } else if (currentLimit && currentLimit > 30) {
        // Truck is stopped / idling / in city: use road speed limit pace
        effectiveKmh = Math.max(45, Math.min(90, currentLimit));
    }

    // Trip duration remaining in minutes
    const durationMins = Math.max(1, Math.round((remKm / effectiveKmh) * 60));

    // Format duration string
    let durationFormatted = '';
    if (remKm === 0) {
        durationFormatted = 'Arrived';
    } else if (durationMins >= 60) {
        const hrs = Math.floor(durationMins / 60);
        const mins = durationMins % 60;
        durationFormatted = `${hrs}h ${mins}m left`;
    } else {
        durationFormatted = `${durationMins}m left`;
    }

    // Format ETA arrival clock time (e.g. 15:40)
    const etaDate = new Date(Date.now() + durationMins * 60 * 1000);
    const etaHrs = String(etaDate.getHours()).padStart(2, '0');
    const etaMins = String(etaDate.getMinutes()).padStart(2, '0');
    const etaFormatted = remKm === 0 ? 'Arrived' : `${etaHrs}:${etaMins}`;

    // Estimated speed / average trip pace
    let paceKmh = effectiveKmh;
    if (activeJob.startTime && drivenKm > 0) {
        const elapsedHours = (Date.now() - activeJob.startTime) / 3600000;
        if (elapsedHours > 0.01) {
            const calculatedPace = Math.round(drivenKm / elapsedHours);
            if (calculatedPace > 15 && calculatedPace < 180) {
                paceKmh = calculatedPace;
            }
        }
    }
    const displayPace = isMph ? Math.round(paceKmh * 0.621371) : paceKmh;
    const unitLabel = isMph ? 'mph' : 'km/h';
    const avgSpeedFormatted = `${displayPace} ${unitLabel}`;

    return {
        hasJob: true,
        durationMins,
        durationFormatted,
        etaFormatted,
        etaDate,
        avgSpeedKmh: paceKmh,
        avgSpeedFormatted,
        distanceRemaining: remKm
    };
}

// =======================================================
//  UI RENDERING: ACTIVE JOB & COCKPIT
// =======================================================
function renderActiveJob() {
    if (!activeJob) {
        document.getElementById('jobOriginCity').textContent = 'No Active Job';
        document.getElementById('jobOriginCompany').textContent = 'Click "New Job" to dispatch';
        document.getElementById('jobDestCity').textContent = '—';
        document.getElementById('jobDestCompany').textContent = '—';
        document.getElementById('jobCargoName').textContent = 'No Cargo Assigned';
        document.getElementById('jobCargoWeight').textContent = '0.0 t';
        document.getElementById('jobIncomeTag').textContent = '€0';
        document.getElementById('jobStatusPill').textContent = 'IDLE';
        document.getElementById('jobStatusPill').className = 'job-status-pill idle';
        document.getElementById('routeProgressFill').style.width = '0%';
        document.getElementById('jobDrivenDist').textContent = '0 km driven';
        document.getElementById('jobProgressPct').textContent = '0%';
        document.getElementById('jobRemainingDist').textContent = '0 km left';

        const elDur = document.getElementById('jobDurationLeft');
        if (elDur) elDur.textContent = '--';
        const elEta = document.getElementById('jobArrivalTime');
        if (elEta) elEta.textContent = '--:--';
        const elPace = document.getElementById('jobEstSpeed');
        if (elPace) elPace.textContent = '--';
        return;
    }

    // Set Header
    document.getElementById('jobGameTag').textContent = activeJob.game || 'ETS2';
    document.getElementById('jobGameTag').className = `game-tag ${(activeJob.game || 'ets2').toLowerCase()}`;
    document.getElementById('jobIncomeTag').textContent = `€${Number(activeJob.income).toLocaleString()}`;
    document.getElementById('jobStatusPill').textContent = activeJob.status || 'IN TRANSIT';
    document.getElementById('jobStatusPill').className = 'job-status-pill in-transit';

    // Route
    document.getElementById('jobOriginCity').textContent = activeJob.originCity;
    document.getElementById('jobOriginCompany').textContent = activeJob.originCompany;
    document.getElementById('jobDestCity').textContent = activeJob.destCity;
    document.getElementById('jobDestCompany').textContent = activeJob.destCompany;

    // Cargo
    document.getElementById('jobCargoName').textContent = activeJob.cargo;
    document.getElementById('jobCargoWeight').textContent = `${activeJob.weight} tonnes`;

    // Progress
    const totalDist = activeJob.distance || 1;
    const driven = activeJob.drivenDistance || 0;
    const rem = Math.max(0, totalDist - driven);
    const pct = Math.min(100, Math.round((driven / totalDist) * 100));

    document.getElementById('routeProgressFill').style.width = `${pct}%`;
    document.getElementById('jobDrivenDist').textContent = `${driven.toLocaleString()} km driven`;
    document.getElementById('jobProgressPct').textContent = `${pct}%`;
    document.getElementById('jobRemainingDist').textContent = `${rem.toLocaleString()} km left`;

    // ETA & Trip Estimations
    const est = calculateTripEstimation();
    const elDur = document.getElementById('jobDurationLeft');
    if (elDur) elDur.textContent = est.durationFormatted;
    const elEta = document.getElementById('jobArrivalTime');
    if (elEta) elEta.textContent = est.etaFormatted;
    const elPace = document.getElementById('jobEstSpeed');
    if (elPace) elPace.textContent = est.avgSpeedFormatted;
}

function updateCockpitDisplays() {
    updateSpeedometer();

    // Dynamics
    document.getElementById('telemGear').textContent = currentGear;
    document.getElementById('telemCruise').textContent = currentCruise > 0 ? currentCruise : 'OFF';
    document.getElementById('telemRpm').textContent = currentRpm.toLocaleString();

    const rpmMax = 2500;
    const rpmPct = Math.min(100, Math.round((currentRpm / rpmMax) * 100));
    document.getElementById('telemRpmBar').style.width = `${rpmPct}%`;

    // Damage Displays
    const truckDmgEl = document.getElementById('telemDmgTruck');
    const barTruckEl = document.getElementById('barDmgTruck');
    truckDmgEl.textContent = `${currentTruckDmg}%`;
    barTruckEl.style.width = `${Math.min(100, currentTruckDmg * 5)}%`;
    setDamageColorClass(truckDmgEl, barTruckEl, currentTruckDmg);

    const cargoDmgEl = document.getElementById('telemDmgCargo');
    const barCargoEl = document.getElementById('barDmgCargo');
    cargoDmgEl.textContent = `${currentCargoDmg}%`;
    barCargoEl.style.width = `${Math.min(100, currentCargoDmg * 5)}%`;
    setDamageColorClass(cargoDmgEl, barCargoEl, currentCargoDmg);

    // Fuel
    document.getElementById('telemFuel').textContent = `${Math.round(currentFuel)}%`;
    document.getElementById('barFuel').style.width = `${Math.round(currentFuel)}%`;
    document.getElementById('telemFuelRange').textContent = `~${Math.round(currentFuel * 16)} km range`;

    // Clean Run Rating
    const totalDmg = parseFloat(currentTruckDmg) + parseFloat(currentCargoDmg);
    let rating = '5.0 ★';
    let ratingLabel = 'Clean Run (No Penalty)';
    if (totalDmg > 5) {
        rating = '3.5 ★';
        ratingLabel = 'Damage Penalty Applied';
    } else if (totalDmg > 1) {
        rating = '4.5 ★';
        ratingLabel = 'Minor Scratches';
    }
    document.getElementById('jobRating').textContent = rating;
    document.getElementById('jobRatingLabel').textContent = ratingLabel;
}

function updateSpeedometer() {
    const isMph = driverProfile.unit === 'mph';
    const rawSpeed = Math.abs(currentSpeed || 0);
    const displaySpeed = Math.abs(isMph ? Math.round(rawSpeed * 0.621371) : rawSpeed);
    const displayLimit = Math.abs(isMph ? Math.round(currentLimit * 0.621371) : currentLimit);
    const unitLabel = isMph ? 'MPH' : 'KM/H';

    document.getElementById('telemSpeed').textContent = displaySpeed;
    document.getElementById('telemUnit').textContent = unitLabel;
    document.getElementById('telemLimitBadge').textContent = `LIMIT ${displayLimit}`;

    // Overspeed check
    const isOverspeed = displaySpeed > (displayLimit + 3);
    const badgeEl = document.getElementById('telemLimitBadge');
    const diffEl = document.getElementById('telemSpeedDiff');

    if (isOverspeed) {
        badgeEl.classList.add('overspeed');
        diffEl.textContent = `+${displaySpeed - displayLimit} ${unitLabel.toLowerCase()}`;
        diffEl.style.color = 'var(--red)';
    } else {
        badgeEl.classList.remove('overspeed');
        if (!telemetryConnected && !isDemoMode) {
            diffEl.textContent = `0 ${unitLabel.toLowerCase()}`;
            diffEl.style.color = 'var(--text-muted)';
        } else if (displaySpeed === 0) {
            diffEl.textContent = `0 ${unitLabel.toLowerCase()}`;
            diffEl.style.color = 'var(--text-muted)';
        } else {
            const diff = displaySpeed - displayLimit;
            diffEl.textContent = `${diff <= 0 ? diff : '+' + diff} ${unitLabel.toLowerCase()}`;
            diffEl.style.color = 'var(--text-muted)';
        }
    }
}

function setDamageColorClass(textEl, barEl, val) {
    const num = parseFloat(val);
    textEl.classList.remove('safe', 'warn', 'danger');
    barEl.classList.remove('safe', 'warn', 'danger');

    if (num < 1.5) {
        textEl.classList.add('safe');
        barEl.classList.add('safe');
    } else if (num < 5.0) {
        textEl.classList.add('warn');
        barEl.classList.add('warn');
    } else {
        textEl.classList.add('danger');
        barEl.classList.add('danger');
    }
}

function updateCompactHUD() {
    if (!document.body.classList.contains('compact')) return;

    const isMph = driverProfile.unit === 'mph';
    const displaySpeed = isMph ? Math.round(currentSpeed * 0.621371) : currentSpeed;
    const displayLimit = isMph ? Math.round(currentLimit * 0.621371) : currentLimit;

    document.getElementById('compactSpeed').textContent = displaySpeed;
    document.getElementById('compactSpeedUnit').textContent = isMph ? 'mph' : 'km/h';
    document.getElementById('compactLimit').textContent = `LIMIT ${displayLimit}`;
    document.getElementById('compactLimit').classList.toggle('overspeed', displaySpeed > displayLimit + 3);

    const est = calculateTripEstimation();

    if (activeJob) {
        document.getElementById('compactRoute').textContent = `${activeJob.originCity} ➔ ${activeJob.destCity}`;
        document.getElementById('compactCargo').textContent = `${activeJob.cargo} (${activeJob.weight}t)`;

        const rem = Math.max(0, (activeJob.distance || 0) - (activeJob.drivenDistance || 0));
        document.getElementById('compactDistRem').textContent = `${rem.toLocaleString()} km left (~${est.durationFormatted})`;

        const pct = Math.min(100, Math.round(((activeJob.drivenDistance || 0) / (activeJob.distance || 1)) * 100));
        document.getElementById('compactProgressFill').style.width = `${pct}%`;

        const compactEtaEl = document.getElementById('compactEta');
        if (compactEtaEl) {
            compactEtaEl.textContent = `🏁 ETA: ${est.etaFormatted}`;
        }
    } else {
        document.getElementById('compactRoute').textContent = 'No Active Job';
        document.getElementById('compactCargo').textContent = 'Standby';
        document.getElementById('compactDistRem').textContent = '0 km';
        document.getElementById('compactProgressFill').style.width = '0%';

        const compactEtaEl = document.getElementById('compactEta');
        if (compactEtaEl) {
            compactEtaEl.textContent = '🏁 Standby';
        }
    }

    document.getElementById('compactDmgTruck').textContent = `🚛 ${currentTruckDmg}%`;
    document.getElementById('compactDmgCargo').textContent = `📦 ${currentCargoDmg}%`;
    document.getElementById('compactGearCC').textContent = `GEAR: ${currentGear} • CC: ${currentCruise || 'OFF'}`;
}

// =======================================================
//  JOB ACTIONS (DISPATCH, FINISH, CANCEL)
// =======================================================
function setupJobActionHandlers() {
    document.getElementById('btnFinishJob').addEventListener('click', finishActiveJob);
    document.getElementById('compactBtnFinish').addEventListener('click', finishActiveJob);

    document.getElementById('btnCancelJob').addEventListener('click', () => {
        if (!activeJob) return;
        if (confirm('Are you sure you want to abandon this delivery?')) {
            activeJob = null;
            saveActiveJob();
            renderActiveJob();
            updateCompactHUD();
            updateDiscordPresence();
            showToast('Job cancelled');
        }
    });
}

function finishActiveJob() {
    if (!activeJob) {
        showToast('No active job to finish!');
        return;
    }

    // Calculate final score and penalties
    const totalDmg = (parseFloat(currentTruckDmg) + parseFloat(currentCargoDmg));
    const damagePenaltyPct = Math.min(50, totalDmg * 3);
    const finalPayout = Math.round(activeJob.income * (1 - (damagePenaltyPct / 100)));

    let rating = '5.0 ★';
    if (totalDmg > 5) rating = '3.0 ★';
    else if (totalDmg > 2) rating = '4.0 ★';
    else if (totalDmg > 0.5) rating = '4.8 ★';

    const completedJob = {
        id: `job_${Date.now()}`,
        date: new Date().toISOString(),
        game: activeJob.game || 'ETS2',
        originCity: activeJob.originCity,
        originCompany: activeJob.originCompany,
        destCity: activeJob.destCity,
        destCompany: activeJob.destCompany,
        cargo: activeJob.cargo,
        weight: activeJob.weight,
        distance: activeJob.distance,
        income: finalPayout,
        truckDamage: currentTruckDmg,
        cargoDamage: currentCargoDmg,
        rating: rating
    };

    // Save to history (prepend)
    jobHistory.unshift(completedJob);
    saveHistory();

    // Reset active job
    activeJob = null;
    saveActiveJob();

    // Reset damage
    currentTruckDmg = 0.0;
    currentCargoDmg = 0.0;

    renderActiveJob();
    renderLogbook();
    updateDriverStats();
    updateCompactHUD();
    updateDiscordPresence();

    // Show completion dialog
    showCompletionModal(completedJob);
}

// =======================================================
//  DISPATCH MODAL & JOB CREATION
// =======================================================
function setupModals() {
    const optETS2 = document.getElementById('optGameETS2');
    const optATS = document.getElementById('optGameATS');

    function setDispatchGame(game) {
        selectedDispatchGame = game;
        if (optETS2) optETS2.classList.toggle('active', game === 'ETS2');
        if (optATS) optATS.classList.toggle('active', game === 'ATS');

        // Filter and apply first matching preset for the chosen game
        const matching = JOB_PRESETS.filter(p => p.game === game);
        if (matching.length > 0) {
            applyPreset(matching[0]);
        }
    }

    if (optETS2) {
        optETS2.addEventListener('click', () => setDispatchGame('ETS2'));
    }
    if (optATS) {
        optATS.addEventListener('click', () => setDispatchGame('ATS'));
    }

    // Open Dispatch Modal
    document.getElementById('btnOpenDispatch').addEventListener('click', () => {
        const defaultGame = activeGame.code || (activeJob && activeJob.game) || 'ETS2';
        setDispatchGame(defaultGame);
        document.getElementById('dispatchModal').style.display = 'flex';
    });

    // Close Dispatch Modal
    document.getElementById('btnCloseDispatchModal').addEventListener('click', () => {
        document.getElementById('dispatchModal').style.display = 'none';
    });
    document.getElementById('btnCancelDispatch').addEventListener('click', () => {
        document.getElementById('dispatchModal').style.display = 'none';
    });

    // Quick Preset Chips
    document.querySelectorAll('.preset-chip[data-preset]').forEach(chip => {
        chip.addEventListener('click', () => {
            const idx = parseInt(chip.dataset.preset, 10) - 1;
            applyPreset(JOB_PRESETS[idx]);
        });
    });

    // Random Preset Button
    document.getElementById('btnRandomDispatch').addEventListener('click', () => {
        const matching = JOB_PRESETS.filter(p => p.game === selectedDispatchGame);
        const list = matching.length > 0 ? matching : JOB_PRESETS;
        const rand = list[Math.floor(Math.random() * list.length)];
        applyPreset(rand);
    });

    // Start Custom Job
    document.getElementById('btnStartCustomJob').addEventListener('click', () => {
        const originCity = document.getElementById('inputOriginCity').value.trim() || 'Rotterdam';
        const originCompany = document.getElementById('inputOriginCompany').value.trim() || 'EuroGoodies';
        const destCity = document.getElementById('inputDestCity').value.trim() || 'Berlin';
        const destCompany = document.getElementById('inputDestCompany').value.trim() || 'LKW Logistik';
        const cargo = document.getElementById('inputCargo').value.trim() || 'Freight';
        const weight = parseFloat(document.getElementById('inputWeight').value) || 20;
        const distance = parseInt(document.getElementById('inputDistance').value, 10) || 500;
        const income = parseInt(document.getElementById('inputIncome').value, 10) || 25000;

        const targetGame = selectedDispatchGame || activeGame.code || 'ETS2';

        activeJob = {
            game: targetGame,
            originCity,
            originCompany,
            destCity,
            destCompany,
            cargo,
            weight,
            distance,
            drivenDistance: 0,
            income,
            status: 'IN TRANSIT',
            startTime: Date.now()
        };

        saveActiveJob();
        renderActiveJob();
        updateCompactHUD();
        updateDiscordPresence();
        updateActiveGameUI();

        document.getElementById('dispatchModal').style.display = 'none';
        showToast(`Dispatched: ${originCity} ➔ ${destCity} (${targetGame})!`);
    });

    // Completion Modal buttons
    document.getElementById('btnCloseCompletionModal').addEventListener('click', () => {
        document.getElementById('completionModal').style.display = 'none';
    });
    document.getElementById('btnDismissCompletion').addEventListener('click', () => {
        document.getElementById('completionModal').style.display = 'none';
    });
    document.getElementById('btnCopyDiscordReceipt').addEventListener('click', () => {
        const text = document.getElementById('discordReceiptText').textContent;
        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied Discord delivery report!');
        });
    });

    const btnSubmitToHub = document.getElementById('btnSubmitToHub');
    if (btnSubmitToHub) {
        btnSubmitToHub.addEventListener('click', (e) => {
            e.preventDefault();
            const text = document.getElementById('discordReceiptText').textContent;
            navigator.clipboard.writeText(text).then(() => {
                showToast('Copied receipt! Opening VTC Portal...');
            });
            const vtcUrl = (driverProfile.vtc && driverProfile.vtc.id) 
                ? `https://truckersmp.com/vtc/${driverProfile.vtc.id}` 
                : 'https://truckersmp.com/vtc';
            shell.openExternal(vtcUrl);
        });
    }
}

function applyPreset(preset) {
    if (!preset) return;
    if (preset.game) {
        selectedDispatchGame = preset.game;
        const optETS2 = document.getElementById('optGameETS2');
        const optATS = document.getElementById('optGameATS');
        if (optETS2) optETS2.classList.toggle('active', preset.game === 'ETS2');
        if (optATS) optATS.classList.toggle('active', preset.game === 'ATS');
    }
    document.getElementById('inputOriginCity').value = preset.originCity;
    document.getElementById('inputOriginCompany').value = preset.originCompany;
    document.getElementById('inputDestCity').value = preset.destCity;
    document.getElementById('inputDestCompany').value = preset.destCompany;
    document.getElementById('inputCargo').value = preset.cargo;
    document.getElementById('inputWeight').value = preset.weight;
    document.getElementById('inputDistance').value = preset.distance;
    document.getElementById('inputIncome').value = preset.income;
}

function showCompletionModal(job) {
    document.getElementById('compRouteTitle').textContent = `${job.originCity} ➔ ${job.destCity}`;
    document.getElementById('compCargoSubtitle').textContent = `Delivered ${job.weight}t of ${job.cargo}`;
    document.getElementById('compFinalPayout').textContent = `€${Number(job.income).toLocaleString()}`;
    document.getElementById('compFinalDistance').textContent = `${job.distance.toLocaleString()} km`;
    document.getElementById('compFinalDamage').textContent = `${job.cargoDamage}%`;
    document.getElementById('compFinalRating').textContent = job.rating;

    // Build Formatted Discord VTC Receipt
    const receipt = generateDiscordReceipt(job);
    document.getElementById('discordReceiptText').textContent = receipt;
    document.getElementById('completionModal').style.display = 'flex';
}

function generateDiscordReceipt(job) {
    const callsign = driverProfile.callsign || 'Driver #01';
    const dateStr = new Date(job.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `══════════════════════════════════════════
🚚 DELIVERY DISPATCH LOG
══════════════════════════════════════════
👤 Driver: ${callsign}
🎮 Game: ${job.game}
📍 Departure: ${job.originCity} (${job.originCompany})
🏁 Destination: ${job.destCity} (${job.destCompany})
📦 Cargo: ${job.cargo} [${job.weight} Tonnes]
🛣️ Distance: ${job.distance} km
💰 Payout: €${Number(job.income).toLocaleString()}
🚛 Truck Damage: ${job.truckDamage}% | 📦 Cargo Damage: ${job.cargoDamage}%
⭐ Performance Score: ${job.rating}
📅 Timestamp: ${dateStr}
TruckersMP / TrucklineMP Verified Delivery ✅
══════════════════════════════════════════`;
}

// =======================================================
//  LOGBOOK MANAGEMENT
// =======================================================
function setupLogbookControls() {
    document.getElementById('lbSearchInput').addEventListener('input', (e) => {
        renderLogbook(e.target.value.toLowerCase().trim());
    });

    document.getElementById('btnCopyAllDiscord').addEventListener('click', () => {
        if (jobHistory.length === 0) {
            showToast('No jobs to copy!');
            return;
        }

        const totalKm = jobHistory.reduce((acc, j) => acc + (j.distance || 0), 0);
        const totalRev = jobHistory.reduce((acc, j) => acc + (j.income || 0), 0);
        const summary = `📊 **Driver Logbook Summary**\n` +
            `Driver: **${driverProfile.callsign}**\n` +
            `Total Deliveries: **${jobHistory.length}**\n` +
            `Total Distance Hauled: **${totalKm.toLocaleString()} km**\n` +
            `Total Revenue Earned: **€${totalRev.toLocaleString()}**\n` +
            `Verified with Tracker Overlay 🚚`;

        navigator.clipboard.writeText(summary).then(() => {
            showToast('Copied logbook summary for Discord!');
        });
    });

    document.getElementById('btnExportCSV').addEventListener('click', exportLogbookCSV);

    document.getElementById('btnClearLogbook').addEventListener('click', () => {
        if (confirm('Clear all logged deliveries from history?')) {
            jobHistory = [];
            saveHistory();
            renderLogbook();
            updateDriverStats();
            showToast('Logbook cleared');
        }
    });
}

function renderLogbook(searchQuery = '') {
    const listEl = document.getElementById('logbookList');

    // Totals
    const totalJobs = jobHistory.length;
    const totalKm = jobHistory.reduce((acc, j) => acc + (j.distance || 0), 0);
    const totalRev = jobHistory.reduce((acc, j) => acc + (j.income || 0), 0);

    document.getElementById('lbTotalJobs').textContent = totalJobs;
    document.getElementById('lbTotalDistance').textContent = `${totalKm.toLocaleString()} km`;
    document.getElementById('lbTotalRevenue').textContent = `€${totalRev.toLocaleString()}`;

    // Filter
    let filtered = jobHistory;
    if (searchQuery) {
        filtered = jobHistory.filter(j =>
            j.originCity.toLowerCase().includes(searchQuery) ||
            j.destCity.toLowerCase().includes(searchQuery) ||
            j.cargo.toLowerCase().includes(searchQuery) ||
            (j.originCompany && j.originCompany.toLowerCase().includes(searchQuery))
        );
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 11px;">No deliveries found in logbook.</div>`;
        return;
    }

    listEl.innerHTML = filtered.map(job => {
        const dateStr = new Date(job.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        return `
            <div class="log-item" data-id="${job.id}">
                <div class="log-item-header">
                    <span class="game-tag ${(job.game || 'ets2').toLowerCase()}">${job.game || 'ETS2'}</span>
                    <span class="log-date">${dateStr}</span>
                    <span class="log-payout">+€${Number(job.income).toLocaleString()}</span>
                </div>
                <div class="log-route">${escapeHtml(job.originCity)} ➔ ${escapeHtml(job.destCity)}</div>
                <div class="log-details">
                    <span>${escapeHtml(job.cargo)} (${job.weight}t)</span>
                    <span>${job.distance.toLocaleString()} km • ${job.rating}</span>
                </div>
                <div class="log-actions">
                    <button class="btn-xs btn-ghost btn-copy-single" data-id="${job.id}">📋 Copy Discord</button>
                    <button class="btn-xs btn-danger btn-delete-single" data-id="${job.id}">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    // Attach row events
    listEl.querySelectorAll('.btn-copy-single').forEach(btn => {
        btn.addEventListener('click', () => {
            const j = jobHistory.find(item => item.id === btn.dataset.id);
            if (j) {
                navigator.clipboard.writeText(generateDiscordReceipt(j)).then(() => {
                    showToast('Copied delivery report!');
                });
            }
        });
    });

    listEl.querySelectorAll('.btn-delete-single').forEach(btn => {
        btn.addEventListener('click', () => {
            jobHistory = jobHistory.filter(item => item.id !== btn.dataset.id);
            saveHistory();
            renderLogbook(searchQuery);
            updateDriverStats();
        });
    });
}

function exportLogbookCSV() {
    if (jobHistory.length === 0) {
        showToast('Logbook is empty!');
        return;
    }

    const headers = ['Date', 'Game', 'Origin City', 'Origin Company', 'Destination City', 'Destination Company', 'Cargo', 'Weight (t)', 'Distance (km)', 'Revenue (EUR)', 'Truck Damage (%)', 'Cargo Damage (%)', 'Rating'];
    const rows = jobHistory.map(j => [
        `"${j.date}"`,
        `"${j.game || 'ETS2'}"`,
        `"${j.originCity}"`,
        `"${j.originCompany}"`,
        `"${j.destCity}"`,
        `"${j.destCompany}"`,
        `"${j.cargo}"`,
        j.weight,
        j.distance,
        j.income,
        j.truckDamage,
        j.cargoDamage,
        `"${j.rating}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Logbook_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Logbook CSV downloaded!');
}

// =======================================================
//  DRIVER PROFILE & CAREER METRICS
// =======================================================
function setupDriverProfileHandlers() {
    const callsignInput = document.getElementById('driverCallsign');
    if (callsignInput) {
        callsignInput.addEventListener('change', () => {
            driverProfile.callsign = callsignInput.value.trim() || 'Driver #01';
            saveProfile();
            showToast('Callsign updated');
        });
    }

    const tmpIdInput = document.getElementById('driverTmpId');
    const btnSave = document.getElementById('btnSaveDriverProfile');

    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const idVal = tmpIdInput ? tmpIdInput.value.trim() : '';
            if (idVal) {
                fetchDriverTruckersMP(idVal, true);
            } else {
                if (callsignInput) {
                    driverProfile.callsign = callsignInput.value.trim() || 'Driver #01';
                }
                driverProfile.tmpId = '';
                driverProfile.tmpName = '';
                driverProfile.vtc = null;
                saveProfile();
                renderDriverProfileUI();
                loadVTCData(0);
                showToast('Driver profile updated (Independent Driver)');
            }
        });
    }

    if (tmpIdInput) {
        tmpIdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const idVal = tmpIdInput.value.trim();
                if (idVal) {
                    fetchDriverTruckersMP(idVal, true);
                }
            }
        });
    }
}

function renderDriverProfileUI() {
    const avatarEl = document.getElementById('driverAvatar');
    if (avatarEl) {
        if (driverProfile.avatar) {
            avatarEl.src = driverProfile.avatar;
        } else {
            avatarEl.src = 'icon.png';
        }
    }

    const callsignInput = document.getElementById('driverCallsign');
    if (callsignInput && driverProfile.callsign) {
        callsignInput.value = driverProfile.callsign;
    }

    const quickInput = document.getElementById('quickVtcTmpId');
    if (quickInput) {
        quickInput.value = driverProfile.tmpId || '';
    }

    const groupTag = document.getElementById('driverGroupTag');
    if (groupTag) {
        groupTag.textContent = (driverProfile.groupName || 'VTC DRIVER').toUpperCase();
        if (driverProfile.groupColor) {
            groupTag.style.borderColor = driverProfile.groupColor;
            groupTag.style.color = driverProfile.groupColor;
            groupTag.style.background = `${driverProfile.groupColor}22`;
        }
    }

    const vtcNameEl = document.getElementById('driverVtcName');
    if (vtcNameEl) {
        const vtcName = (driverProfile.vtc && driverProfile.vtc.name) ? driverProfile.vtc.name : 'Independent / None';
        vtcNameEl.textContent = vtcName;
    }

    const tmpIdDisplay = document.getElementById('driverTmpIdDisplay');
    if (tmpIdDisplay) {
        tmpIdDisplay.textContent = driverProfile.tmpId ? `#${driverProfile.tmpId}` : '—';
    }

    const extraMeta = document.getElementById('driverExtraMeta');
    const joinDateEl = document.getElementById('driverJoinDate');
    const bannedEl = document.getElementById('driverBannedStatus');

    if (extraMeta) {
        if (driverProfile.tmpId) {
            extraMeta.style.display = 'flex';
            if (joinDateEl) {
                const dateClean = driverProfile.joinDate ? driverProfile.joinDate.split(' ')[0] : '—';
                joinDateEl.textContent = `Member: ${dateClean}`;
            }
            if (bannedEl) {
                if (driverProfile.banned) {
                    bannedEl.textContent = '⚠️ Active Ban';
                    bannedEl.className = 'driver-meta-item banned';
                } else {
                    bannedEl.textContent = '✓ Clean Record';
                    bannedEl.className = 'driver-meta-item clean';
                }
            }
        } else {
            extraMeta.style.display = 'none';
        }
    }
}

// Fetch Player Profile & Affiliated VTC from TruckersMP API v2
async function fetchDriverTruckersMP(queryId, isManual = false) {
    const cleanId = String(queryId).trim();
    if (!cleanId) return;

    const btn = document.getElementById('btnSaveDriverProfile');
    const statusHint = document.getElementById('driverSyncStatus') || document.getElementById('driverSyncStatusHint');

    if (btn) btn.disabled = true;
    if (statusHint) statusHint.textContent = 'Syncing...';

    const vtcSyncSub = document.getElementById('vtcSyncSub');
    if (vtcSyncSub) vtcSyncSub.textContent = `Syncing TruckersMP Driver #${cleanId}...`;

    try {
        const data = await fetchTruckersMP(`player/${encodeURIComponent(cleanId)}`);
        if (data && !data.error && data.response) {
            const p = data.response;
            driverProfile.tmpId = String(p.id);
            driverProfile.tmpName = p.name || '';
            
            // Auto-update callsign with real TruckersMP username if user has default callsign or manual sync
            if (!driverProfile.callsign || driverProfile.callsign === 'Driver #01' || isManual) {
                driverProfile.callsign = p.name || driverProfile.callsign;
            }

            driverProfile.avatar = p.avatar || p.smallAvatar || '';
            driverProfile.groupName = p.groupName || 'VTC Driver';
            driverProfile.groupColor = p.groupColor || '';
            driverProfile.joinDate = p.joinDate || '';
            driverProfile.banned = !!p.banned;
            driverProfile.vtc = p.vtc || null;

            saveProfile();
            renderDriverProfileUI();

            const inputTmpId = document.getElementById('driverTmpId');
            if (inputTmpId) inputTmpId.value = driverProfile.tmpId;

            const quickInput = document.getElementById('quickVtcTmpId');
            if (quickInput) quickInput.value = driverProfile.tmpId;

            // Automatically reload the VTC Info tab according to the driver's TruckersMP VTC!
            if (driverProfile.vtc && Number(driverProfile.vtc.id) > 0) {
                await loadVTCData(Number(driverProfile.vtc.id));
            } else {
                await loadVTCData(0);
            }

            if (statusHint) statusHint.textContent = 'Synced Live';

            if (isManual) {
                const vtcLabel = (driverProfile.vtc && driverProfile.vtc.name)
                    ? ` • VTC: ${driverProfile.vtc.name}`
                    : ' • Independent Driver';
                showToast(`🟢 Connected to ${p.name} (#${p.id})${vtcLabel}!`);
            }
        } else {
            const msg = (data && data.descriptor) ? data.descriptor : 'TruckersMP player not found';
            if (statusHint) statusHint.textContent = 'Not found';
            if (isManual) showToast(`❌ ${msg}`);
        }
    } catch (err) {
        console.warn('Failed to fetch driver profile from TruckersMP:', err);
        if (statusHint) statusHint.textContent = 'Sync failed';
        if (isManual) showToast('❌ Failed to fetch TruckersMP driver');
    } finally {
        if (btn) btn.disabled = false;
        setTimeout(() => {
            if (statusHint && (statusHint.textContent === 'Synced Live' || statusHint.textContent === 'Not found' || statusHint.textContent === 'Sync failed')) {
                statusHint.textContent = 'Live API Sync';
            }
        }, 3000);
    }
}

function updateDriverStats() {
    const totalKm = jobHistory.reduce((acc, j) => acc + (j.distance || 0), 0);
    const totalEarnings = jobHistory.reduce((acc, j) => acc + (j.income || 0), 0);
    const totalFreight = jobHistory.reduce((acc, j) => acc + (j.weight || 0), 0);

    const avgDmg = jobHistory.length > 0
        ? (jobHistory.reduce((acc, j) => acc + parseFloat(j.cargoDamage || 0), 0) / jobHistory.length).toFixed(1)
        : '0.0';

    document.getElementById('dmDistance').textContent = `${totalKm.toLocaleString()} km`;
    document.getElementById('dmEarnings').textContent = `€${totalEarnings.toLocaleString()}`;
    document.getElementById('dmFreight').textContent = `${Math.round(totalFreight)} t`;
    document.getElementById('dmAvgDamage').textContent = `${avgDmg}%`;

    // Calculate Rank
    let rank = '🔰 Novice Hauler';
    let nextRank = 'Junior Freight Pilot';
    let targetKm = 2500;

    if (totalKm >= 50000) {
        rank = '🌟 Legend of the Autobahn';
        nextRank = 'Maximum Rank Reached';
        targetKm = 50000;
    } else if (totalKm >= 25000) {
        rank = '👑 Fleet Elite';
        nextRank = 'Legend of the Autobahn';
        targetKm = 50000;
    } else if (totalKm >= 10000) {
        rank = '⭐ Senior Master Hauler';
        nextRank = 'Fleet Elite';
        targetKm = 25000;
    } else if (totalKm >= 2500) {
        rank = '🚛 Junior Freight Pilot';
        nextRank = 'Senior Master Hauler';
        targetKm = 10000;
    }

    document.getElementById('driverRankBadge').textContent = rank;
    document.getElementById('nextRankTitle').textContent = nextRank;
    document.getElementById('rankDistanceProgress').textContent = `${totalKm.toLocaleString()} / ${targetKm.toLocaleString()} km`;

    const progressPct = Math.min(100, Math.round((totalKm / targetKm) * 100));
    document.getElementById('rankBarFill').style.width = `${progressPct}%`;
}

// =======================================================
//  VTC INFO & TRUCKERSMP SERVERS
// =======================================================
// TruckersMP API Helper (Bypasses CORS via Electron IPC with graceful fallback)
async function fetchTruckersMP(endpoint) {
    if (typeof ipcRenderer !== 'undefined' && ipcRenderer.invoke) {
        try {
            const res = await ipcRenderer.invoke('fetch-tmp-api', endpoint);
            if (res && res.success) {
                return res.data;
            }
            if (res && res.error) {
                console.warn(`IPC fetch returned error for ${endpoint}:`, res.error);
            }
        } catch (ipcErr) {
            console.warn('IPC invoke error, using direct fetch:', ipcErr);
        }
    }

    const url = endpoint.startsWith('http')
        ? endpoint
        : `${TMP_API_BASE}/${endpoint.replace(/^\//, '')}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
}

function setupVtcControls() {
    const quickInput = document.getElementById('quickVtcTmpId');
    const btnQuickSync = document.getElementById('btnQuickSyncVtc');
    const btnSyncVtc = document.getElementById('btnSyncVtcFromDriver');

    const handleSync = () => {
        const val = quickInput ? quickInput.value.trim() : '';
        if (!val) {
            if (driverProfile.tmpId) {
                showToast(`Syncing VTC for active driver #${driverProfile.tmpId}...`);
                fetchDriverTruckersMP(driverProfile.tmpId, true);
            } else {
                showToast('Enter a TruckersMP Profile ID or VTC # to sync');
            }
            return;
        }

        // Direct VTC ID syntax: "vtc:64631" or "vtc 64631"
        const vtcMatch = val.match(/^vtc[:\s#]?(\d+)$/i);
        if (vtcMatch) {
            const vtcId = Number(vtcMatch[1]);
            showToast(`Loading VTC #${vtcId} directly...`);
            loadVTCData(vtcId);
            return;
        }

        // Standard TruckersMP Player ID: sync driver profile and its VTC
        showToast(`Syncing TruckersMP profile #${val}...`);
        fetchDriverTruckersMP(val, true);
    };

    if (btnQuickSync) {
        btnQuickSync.addEventListener('click', handleSync);
    }
    if (quickInput) {
        quickInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSync();
            }
        });
    }
    if (btnSyncVtc) {
        btnSyncVtc.addEventListener('click', () => {
            if (driverProfile.tmpId) {
                showToast('Syncing VTC from TruckersMP profile...');
                fetchDriverTruckersMP(driverProfile.tmpId, true);
            } else {
                showToast('Please enter your TruckersMP ID in the Driver tab first!');
                const driverTab = document.querySelector('.tab[data-tab="driver"]');
                if (driverTab) driverTab.click();
            }
        });
    }

    // Copy Hub / Website Link button
    const btnCopyHubLink = document.getElementById('btnCopyHubLink');
    if (btnCopyHubLink) {
        btnCopyHubLink.addEventListener('click', () => {
            const btnOpenHub = document.getElementById('btnOpenHub');
            const targetUrl = (btnOpenHub && btnOpenHub.href) ? btnOpenHub.href : 'https://truckersmp.com/vtc';
            navigator.clipboard.writeText(targetUrl).then(() => {
                showToast(`Copied URL (${targetUrl})!`);
            });
        });
    }
}

function getActiveVtcId() {
    if (driverProfile && driverProfile.vtc && driverProfile.vtc.id && Number(driverProfile.vtc.id) > 0) {
        return Number(driverProfile.vtc.id);
    }
    return null;
}

async function loadVTCData(customVtcId = undefined) {
    let targetId;
    if (customVtcId !== undefined) {
        targetId = customVtcId ? Number(customVtcId) : null;
    } else {
        targetId = getActiveVtcId();
    }

    const vtcSyncDot = document.getElementById('vtcSyncDot');
    const vtcSyncSub = document.getElementById('vtcSyncSub');

    if (!targetId) {
        if (vtcSyncDot) vtcSyncDot.className = 'vtc-sync-dot warning';
        if (vtcSyncSub) {
            if (driverProfile.tmpId) {
                vtcSyncSub.textContent = `Driver: ${driverProfile.tmpName || driverProfile.callsign} • Independent Driver (No VTC on TruckersMP)`;
            } else {
                vtcSyncSub.textContent = 'No TruckersMP ID linked — enter Profile ID above to auto-sync';
            }
        }

        setText('vtcName', 'Independent Driver');
        setText('vtcSlogan', 'Not currently registered with a TruckersMP Virtual Trucking Company');
        setText('statMembers', '1 (Solo)');
        setText('statEvents', '0');
        setText('statOnline', '—');

        const logoEl = document.getElementById('vtcLogo');
        if (logoEl) logoEl.src = 'icon.png';

        const badgeVerified = document.getElementById('badgeVerified');
        if (badgeVerified) badgeVerified.style.display = 'none';
        const badgeRecruitment = document.getElementById('badgeRecruitment');
        if (badgeRecruitment) {
            badgeRecruitment.textContent = 'Independent';
            badgeRecruitment.className = 'badge';
        }

        const ownerLink = document.getElementById('ownerLink');
        if (ownerLink) {
            ownerLink.textContent = driverProfile.tmpName || driverProfile.callsign || '—';
            ownerLink.href = driverProfile.tmpId ? `https://truckersmp.com/user/${driverProfile.tmpId}` : '#';
        }

        const hubHeroIcon = document.getElementById('hubHeroIcon');
        if (hubHeroIcon) hubHeroIcon.innerHTML = '🏢';
        const hubHeroTitle = document.getElementById('hubHeroTitle');
        if (hubHeroTitle) hubHeroTitle.textContent = 'TruckersMP VTC Directory';
        const hubHeroDomain = document.getElementById('hubHeroDomain');
        if (hubHeroDomain) hubHeroDomain.textContent = 'truckersmp.com/vtc';
        const hubHeroDesc = document.getElementById('hubHeroDesc');
        if (hubHeroDesc) hubHeroDesc.textContent = 'You are driving independently. Enter your TruckersMP Profile ID above to automatically load your company stats, roster, and convoys!';
        const btnOpenHub = document.getElementById('btnOpenHub');
        if (btnOpenHub) btnOpenHub.href = 'https://truckersmp.com/vtc';
        const btnOpenHubText = document.getElementById('btnOpenHubText');
        if (btnOpenHubText) btnOpenHubText.textContent = 'Browse TruckersMP VTCs';

        const qlHub = document.getElementById('qlHub');
        if (qlHub) {
            qlHub.href = 'https://truckersmp.com/vtc';
            qlHub.innerHTML = '<span>🏢</span> Browse VTCs';
        }
        const qlWebsite = document.getElementById('qlWebsite');
        if (qlWebsite) qlWebsite.style.display = 'none';
        const qlTMP = document.getElementById('qlTMP');
        if (qlTMP) {
            qlTMP.href = 'https://truckersmp.com';
            qlTMP.style.display = 'inline-flex';
        }
        const qlDiscord = document.getElementById('qlDiscord');
        if (qlDiscord) {
            qlDiscord.href = 'https://discord.gg/truckersmp';
            qlDiscord.style.display = 'inline-flex';
        }

        const nextEvent = document.getElementById('nextEventContent');
        if (nextEvent) nextEvent.textContent = 'Connect a TruckersMP profile with a registered VTC to view upcoming company convoys.';
        return;
    }

    if (vtcSyncDot) vtcSyncDot.className = 'vtc-sync-dot online';
    if (vtcSyncSub) {
        vtcSyncSub.textContent = `Driver: ${driverProfile.tmpName || driverProfile.callsign} • Linked to VTC #${targetId}`;
    }

    try {
        const data = await fetchTruckersMP(`vtc/${targetId}`);
        if (data && !data.error && data.response) {
            const vtc = data.response;
            if (vtcSyncSub) {
                vtcSyncSub.textContent = `Driver: ${driverProfile.tmpName || driverProfile.callsign} ➔ ${vtc.name} (#${vtc.id})`;
            }
            setText('vtcName', vtc.name);
            setText('vtcSlogan', vtc.slogan || (vtc.tag ? `Tag: ${vtc.tag}` : 'Virtual Trucking Company'));
            setText('statMembers', (vtc.members_count || 0).toLocaleString());
            setText('statEvents', vtc.events_count || 0);

            // Update VTC Logo
            const logoEl = document.getElementById('vtcLogo');
            if (logoEl) {
                logoEl.src = vtc.logo || 'icon.png';
            }

            // Update Badges
            const badgeVerified = document.getElementById('badgeVerified');
            if (badgeVerified) {
                if (vtc.verified) {
                    badgeVerified.style.display = 'inline-flex';
                    badgeVerified.textContent = '✓ Verified';
                    badgeVerified.className = 'badge badge-verified';
                } else if (vtc.validated) {
                    badgeVerified.style.display = 'inline-flex';
                    badgeVerified.textContent = '✓ Validated';
                    badgeVerified.className = 'badge badge-verified';
                } else {
                    badgeVerified.style.display = 'inline-flex';
                    badgeVerified.textContent = 'Community';
                    badgeVerified.className = 'badge';
                }
            }

            const badgeRecruitment = document.getElementById('badgeRecruitment');
            if (badgeRecruitment) {
                const isOpen = String(vtc.recruitment || '').toLowerCase() === 'open';
                badgeRecruitment.textContent = vtc.recruitment || 'Open';
                badgeRecruitment.className = `badge ${isOpen ? 'badge-open' : 'badge-closed'}`;
            }

            // Owner Link
            const ownerLink = document.getElementById('ownerLink');
            if (ownerLink) {
                ownerLink.textContent = vtc.owner_username || '—';
                ownerLink.href = vtc.owner_id ? `https://truckersmp.com/user/${vtc.owner_id}` : '#';
            }

            // Games
            const gameTags = document.getElementById('gameTags');
            if (gameTags) {
                let tagsHtml = '';
                if (vtc.games?.ets) tagsHtml += '<span class="game-tag ets2">ETS2</span> ';
                if (vtc.games?.ats) tagsHtml += '<span class="game-tag ats">ATS</span>';
                gameTags.innerHTML = tagsHtml || '<span class="game-tag ets2">ETS2</span>';
            }

            // Quick links
            const qlHub = document.getElementById('qlHub');
            if (qlHub) {
                qlHub.href = vtc.website || `https://truckersmp.com/vtc/${vtc.id}`;
                qlHub.innerHTML = `<span>🏢</span> ${vtc.website ? 'Drivers Portal' : 'VTC Page'}`;
                qlHub.style.display = 'inline-flex';
            }

            const qlWebsite = document.getElementById('qlWebsite');
            if (qlWebsite) {
                if (vtc.website) {
                    qlWebsite.href = vtc.website;
                    qlWebsite.style.display = 'inline-flex';
                } else {
                    qlWebsite.style.display = 'none';
                }
            }

            const qlTMP = document.getElementById('qlTMP');
            if (qlTMP) {
                qlTMP.href = `https://truckersmp.com/vtc/${vtc.id}`;
                qlTMP.style.display = 'inline-flex';
            }

            const qlDiscord = document.getElementById('qlDiscord');
            if (qlDiscord) {
                const discordUrl = vtc.socials?.discord;
                if (discordUrl) {
                    qlDiscord.href = discordUrl;
                    qlDiscord.style.display = 'inline-flex';
                } else {
                    qlDiscord.style.display = 'none';
                }
            }

            // Portal Hero Card
            const hubHeroIcon = document.getElementById('hubHeroIcon');
            const hubHeroTitle = document.getElementById('hubHeroTitle');
            const hubHeroDomain = document.getElementById('hubHeroDomain');
            const hubHeroDesc = document.getElementById('hubHeroDesc');
            const btnOpenHub = document.getElementById('btnOpenHub');
            const btnOpenHubText = document.getElementById('btnOpenHubText');

            if (vtc.logo) {
                if (hubHeroIcon) hubHeroIcon.innerHTML = `<img src="${vtc.logo}" style="width: 28px; height: 28px; border-radius: 6px; object-fit: contain;">`;
            } else {
                if (hubHeroIcon) hubHeroIcon.innerHTML = '🏢';
            }

            if (vtc.website) {
                let domain = vtc.website;
                try { domain = new URL(vtc.website).hostname; } catch {}
                if (hubHeroTitle) hubHeroTitle.textContent = `${vtc.name} Portal`;
                if (hubHeroDomain) hubHeroDomain.textContent = domain;
                if (hubHeroDesc) hubHeroDesc.textContent = `Official company website and dispatch portal for ${vtc.name}. Connect with drivers, check convoy events, and community updates.`;
                if (btnOpenHub) btnOpenHub.href = vtc.website;
                if (btnOpenHubText) btnOpenHubText.textContent = 'Visit Company Website';
            } else {
                if (hubHeroTitle) hubHeroTitle.textContent = `${vtc.name} on TruckersMP`;
                if (hubHeroDomain) hubHeroDomain.textContent = `truckersmp.com/vtc/${vtc.id}`;
                if (hubHeroDesc) hubHeroDesc.textContent = `Official TruckersMP company page for ${vtc.name}. View member rosters, requirements, and company announcements.`;
                if (btnOpenHub) btnOpenHub.href = `https://truckersmp.com/vtc/${vtc.id}`;
                if (btnOpenHubText) btnOpenHubText.textContent = 'Open TruckersMP VTC';
            }
        }
    } catch (err) {
        console.warn(`VTC fetch failed for ${targetId}:`, err);
    }

    // Next event for target VTC
    try {
        const data = await fetchTruckersMP(`vtc/${targetId}/events`);
        const events = data ? (data.response || []) : [];
        const container = document.getElementById('nextEventContent');
        if (events.length > 0 && container) {
            const next = events[0];
            container.innerHTML = `<strong>${escapeHtml(next.title)}</strong><br><span style="color: var(--accent-light)">Departure: ${escapeHtml(next.departure?.city || 'TBD')}</span>`;
        } else if (container) {
            container.textContent = 'No upcoming public convoys listed.';
        }
    } catch {
        // silently fallback
    }
}

let serversData = [];
let currentServerFilter = 'all';
let lastServerUpdateTime = null;
let serverRelativeTimer = null;
let serverPollInterval = null;

function setupServerControls() {
    // Refresh button
    const btnRefresh = document.getElementById('btnRefreshServers');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            loadServersData(true);
        });
    }

    // Filter pills
    document.querySelectorAll('.server-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.server-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentServerFilter = btn.dataset.filter || 'all';
            renderServersList();
        });
    });

    // Copy Hub / Website Link button
    const btnCopyHubLink = document.getElementById('btnCopyHubLink');
    if (btnCopyHubLink) {
        btnCopyHubLink.addEventListener('click', () => {
            const btnOpenHub = document.getElementById('btnOpenHub');
            const targetUrl = (btnOpenHub && btnOpenHub.href) ? btnOpenHub.href : 'https://hub.plvtc.com/';
            navigator.clipboard.writeText(targetUrl).then(() => {
                showToast(`Copied URL (${targetUrl})!`);
            });
        });
    }
}

function startServersPolling() {
    if (serverPollInterval) clearInterval(serverPollInterval);
    // Poll TruckersMP servers every 25 seconds for live status
    serverPollInterval = setInterval(() => {
        loadServersData(false);
    }, 25000);

    // Update relative time ("Updated X seconds ago") every 3 seconds
    if (serverRelativeTimer) clearInterval(serverRelativeTimer);
    serverRelativeTimer = setInterval(updateServerRelativeTime, 3000);
}

function updateServerRelativeTime() {
    const el = document.getElementById('serversLastUpdated');
    if (!el || !lastServerUpdateTime) return;
    const diffSec = Math.round((Date.now() - lastServerUpdateTime) / 1000);
    if (diffSec < 4) {
        el.textContent = 'Updated just now';
    } else if (diffSec < 60) {
        el.textContent = `Updated ${diffSec}s ago`;
    } else {
        el.textContent = `Updated ${Math.floor(diffSec / 60)}m ago`;
    }
}

async function loadServersData(isManual = false) {
    const refreshBtn = document.getElementById('btnRefreshServers');
    if (isManual && refreshBtn) {
        refreshBtn.style.opacity = '0.5';
        showToast('Refreshing TruckersMP live servers...');
    }

    try {
        const data = await fetchTruckersMP('servers');
        serversData = (data && data.response) ? data.response : [];
        if (serversData.length > 0) {
            try {
                localStorage.setItem('tracker_servers_cache', JSON.stringify({
                    timestamp: Date.now(),
                    servers: serversData
                }));
            } catch {}
        }
        lastServerUpdateTime = Date.now();

        // Calculate aggregate live statistics
        const totalOnline = serversData.reduce((acc, s) => acc + (s.players || 0), 0);
        const ets2Players = serversData.filter(s => (s.game || '').toUpperCase() === 'ETS2').reduce((acc, s) => acc + (s.players || 0), 0);
        const atsPlayers = serversData.filter(s => (s.game || '').toUpperCase() === 'ATS').reduce((acc, s) => acc + (s.players || 0), 0);
        const onlineCount = serversData.filter(s => s.online).length;

        setText('totalPlayers', totalOnline.toLocaleString());
        setText('ets2Players', ets2Players.toLocaleString());
        setText('atsPlayers', atsPlayers.toLocaleString());
        setText('totalServers', `${onlineCount} Live`);
        setText('statOnline', totalOnline.toLocaleString());

        // Update counts on filter tabs
        const ets2Count = serversData.filter(s => (s.game || '').toUpperCase() === 'ETS2').length;
        const atsCount = serversData.filter(s => (s.game || '').toUpperCase() === 'ATS').length;
        setText('countAllServers', serversData.length);
        setText('countETS2Servers', ets2Count);
        setText('countATSServers', atsCount);

        updateServerRelativeTime();
        renderServersList();

        if (isManual) {
            showToast(`🟢 TruckersMP: ${totalOnline.toLocaleString()} drivers online!`);
        }
    } catch (err) {
        console.warn('Servers fetch failed:', err);
        // Attempt to load from cache if available
        try {
            const cached = localStorage.getItem('tracker_servers_cache');
            if (cached && serversData.length === 0) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.servers && parsed.servers.length > 0) {
                    serversData = parsed.servers;
                    lastServerUpdateTime = parsed.timestamp;
                    renderServersList();
                    const el = document.getElementById('serversLastUpdated');
                    if (el) el.textContent = 'Loaded from cache (offline)';
                    return;
                }
            }
        } catch {}

        const el = document.getElementById('serversLastUpdated');
        if (el) el.textContent = 'Failed to fetch (offline)';
    } finally {
        if (refreshBtn) refreshBtn.style.opacity = '1';
    }
}

function renderServersList() {
    const list = document.getElementById('serversList');
    if (!list) return;

    let filtered = serversData;
    if (currentServerFilter !== 'all') {
        filtered = serversData.filter(s => (s.game || '').toUpperCase() === currentServerFilter.toUpperCase());
    }

    // Sort by players descending
    filtered = [...filtered].sort((a, b) => (b.players || 0) - (a.players || 0));

    if (filtered.length === 0) {
        list.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 11px;">No ${escapeHtml(currentServerFilter)} servers found.</div>`;
        return;
    }

    list.innerHTML = filtered.map(sv => {
        const game = (sv.game || 'ETS2').toUpperCase();
        const gameClass = game === 'ATS' ? 'ats' : 'ets2';
        const pct = sv.maxplayers ? Math.min(100, Math.round((sv.players / sv.maxplayers) * 100)) : 0;
        const barClass = pct > 85 ? 'bar-red' : pct > 50 ? 'bar-yellow' : 'bar-green';

        // Features pills
        const limiterTag = sv.speedlimiter === 1
            ? `<span class="server-tag-chip">⚡ 110 km/h Limiter</span>`
            : `<span class="server-tag-chip active-feature">🚀 No Speed Limiter</span>`;
        
        const collisionTag = sv.collisions
            ? `<span class="server-tag-chip">💥 Collisions On</span>`
            : `<span class="server-tag-chip">👻 Ghost Mode</span>`;

        const promodsTag = sv.promods ? `<span class="server-tag-chip active-feature">🗺️ ProMods Map</span>` : '';
        const carsTag = sv.carsforplayers ? `<span class="server-tag-chip">🚗 Scout Cars</span>` : '';
        const afkTag = sv.afkenabled ? `<span class="server-tag-chip">💤 AFK Kick</span>` : '';

        const queueHtml = sv.queue > 0
            ? `<span class="server-queue-tag has-queue">⏳ Queue: ${sv.queue}</span>`
            : `<span class="server-queue-tag">No Queue</span>`;

        return `
            <div class="server-card">
                <div class="server-card-header">
                    <div class="server-title-group">
                        <span class="server-game-badge ${gameClass}">${game}</span>
                        <span class="server-name">${escapeHtml(sv.name)}</span>
                    </div>
                    <span class="server-status-pill ${sv.online ? 'online' : 'offline'}">
                        <span class="live-dot-pulse" style="${sv.online ? '' : 'background:#ef4444;box-shadow:none;'}"></span>
                        ${sv.online ? 'Online' : 'Offline'}
                    </span>
                </div>

                <div class="server-bar-container" title="${pct}% capacity">
                    <div class="server-bar ${barClass}" style="width: ${pct}%"></div>
                </div>

                <div class="server-metrics-row">
                    <span class="server-players-count">${(sv.players || 0).toLocaleString()} / ${(sv.maxplayers || 0).toLocaleString()} <span style="color: var(--text-muted); font-weight: normal; font-size: 9px;">(${pct}%)</span></span>
                    ${queueHtml}
                </div>

                <div class="server-meta-tags">
                    ${limiterTag}
                    ${collisionTag}
                    ${promodsTag}
                    ${carsTag}
                    ${afkTag}
                </div>
            </div>
        `;
    }).join('');
}

// =======================================================
//  UTILITIES & EXTERNAL LINKS
// =======================================================
function setupExternalLinks() {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="http"]');
        if (link) {
            e.preventDefault();
            shell.openExternal(link.href);
        }
    });
}

function showToast(msg) {
    const t = document.getElementById('toastMessage');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => {
        t.classList.remove('show');
    }, 3000);
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// =======================================================
//  DISCORD RICH PRESENCE
// =======================================================
function setupDiscordRPC() {
    // Load saved settings
    const savedRpcEnabled = localStorage.getItem('discord_rpc_enabled');
    if (savedRpcEnabled !== null) {
        discordRpcEnabled = savedRpcEnabled !== 'false';
    }
    discordShowSpeed = localStorage.getItem('discord_show_speed') !== 'false';
    discordShowElapsed = localStorage.getItem('discord_show_elapsed') !== 'false';



    // Sync toggle UI with state
    const toggle = document.getElementById('discordRpcToggle');
    if (toggle) toggle.checked = discordRpcEnabled;
    const speedToggle = document.getElementById('discordShowSpeed');
    if (speedToggle) speedToggle.checked = discordShowSpeed;
    const elapsedToggle = document.getElementById('discordShowElapsed');
    if (elapsedToggle) elapsedToggle.checked = discordShowElapsed;

    updateDiscordStatusUI(discordRpcConnected);

    // Main enable/disable toggle
    if (toggle) {
        toggle.addEventListener('change', () => {
            discordRpcEnabled = toggle.checked;
            localStorage.setItem('discord_rpc_enabled', discordRpcEnabled);
            ipcRenderer.send('discord-toggle', discordRpcEnabled);
            updateDiscordStatusUI(discordRpcEnabled ? discordRpcConnected : false);
            if (!discordRpcEnabled) {
                updateDiscordPreview();
                clearInterval(discordPresenceInterval);
                clearInterval(discordElapsedTimer);
            } else {
                startDiscordPolling();
            }
        });
    }

    // Speed toggle
    if (speedToggle) {
        speedToggle.addEventListener('change', () => {
            discordShowSpeed = speedToggle.checked;
            localStorage.setItem('discord_show_speed', discordShowSpeed);
            updateDiscordPresence();
        });
    }

    // Elapsed toggle
    if (elapsedToggle) {
        elapsedToggle.addEventListener('change', () => {
            discordShowElapsed = elapsedToggle.checked;
            localStorage.setItem('discord_show_elapsed', discordShowElapsed);
            updateDiscordPresence();
        });
    }

    // Auto-Show on Game Launch toggle
    const autoShowToggle = document.getElementById('toggleAutoShowGame');
    if (autoShowToggle) {
        const savedAutoShow = localStorage.getItem('tracker_auto_show_game');
        if (savedAutoShow !== null) {
            autoShowToggle.checked = savedAutoShow !== 'false';
            ipcRenderer.send('set-auto-show-game', autoShowToggle.checked);
        } else {
            ipcRenderer.invoke('get-game-settings').then((settings) => {
                if (settings) autoShowToggle.checked = !!settings.autoShowOnGameLaunch;
            }).catch(() => {});
        }

        autoShowToggle.addEventListener('change', () => {
            localStorage.setItem('tracker_auto_show_game', autoShowToggle.checked);
            ipcRenderer.send('set-auto-show-game', autoShowToggle.checked);
            showToast(autoShowToggle.checked ? 'Auto-show on game launch enabled' : 'Auto-show on game launch disabled');
        });
    }

    // Auto-Hide on Game Exit toggle
    const autoHideToggle = document.getElementById('toggleAutoHideGame');
    if (autoHideToggle) {
        const savedAutoHide = localStorage.getItem('tracker_auto_hide_game');
        if (savedAutoHide !== null) {
            autoHideToggle.checked = savedAutoHide === 'true';
            ipcRenderer.send('set-auto-hide-game', autoHideToggle.checked);
        } else {
            ipcRenderer.invoke('get-game-settings').then((settings) => {
                if (settings) autoHideToggle.checked = !!settings.autoHideOnGameExit;
            }).catch(() => {});
        }

        autoHideToggle.addEventListener('change', () => {
            localStorage.setItem('tracker_auto_hide_game', autoHideToggle.checked);
            ipcRenderer.send('set-auto-hide-game', autoHideToggle.checked);
            showToast(autoHideToggle.checked ? 'Auto-hide on game exit enabled' : 'Auto-hide on game exit disabled');
        });
    }

    // Auto-start with Windows toggle
    const autoStartToggle = document.getElementById('toggleAutoStart');
    if (autoStartToggle) {
        ipcRenderer.invoke('get-autostart').then((enabled) => {
            autoStartToggle.checked = !!enabled;
        }).catch(() => {});

        autoStartToggle.addEventListener('change', () => {
            ipcRenderer.send('set-autostart', autoStartToggle.checked);
            showToast(autoStartToggle.checked ? 'Enabled start with Windows' : 'Disabled start with Windows');
        });

        ipcRenderer.on('autostart-state', (_, enabled) => {
            autoStartToggle.checked = !!enabled;
        });
    }

    localStorage.removeItem('discord_client_id');

    // Helper to render user info card
    function renderDiscordUserCard(user) {
        const userCard = document.getElementById('discordUserCard');
        if (!userCard) return;
        if (user) {
            userCard.style.display = 'block';
            const nameEl = document.getElementById('discordUserName');
            if (nameEl) nameEl.textContent = user.global_name || user.username || '—';
            const idEl = document.getElementById('discordUserId');
            if (idEl) idEl.textContent = `#${user.discriminator || '0000'} • ID: ${user.id || '—'}`;

            const avatarImg = document.getElementById('discordUserAvatar');
            const avatarPh = document.getElementById('discordUserAvatarPlaceholder');
            if (user.avatar && user.id) {
                const avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
                if (avatarImg) { avatarImg.src = avatarUrl; avatarImg.style.display = ''; }
                if (avatarPh) avatarPh.style.display = 'none';
            } else {
                if (avatarImg) avatarImg.style.display = 'none';
                if (avatarPh) avatarPh.style.display = '';
            }
        } else {
            userCard.style.display = 'none';
        }
    }

    // IPC: Discord connection status
    ipcRenderer.on('discord-status', (_, status) => {
        discordRpcConnected = status.connected;
        updateDiscordStatusUI(status.connected, status.reason);
        renderDiscordUserCard(status.connected ? status.user : null);

        if (status.connected) {
            discordSessionStart = Date.now();
            if (telemetryConnected) {
                startDiscordPolling();
            } else {
                // Game not running — immediately clear any stale presence
                ipcRenderer.send('discord-clear-activity');
            }
        } else {
            clearInterval(discordPresenceInterval);
            clearInterval(discordElapsedTimer);
        }
    });

    // IPC: Discord RPC error
    ipcRenderer.on('discord-error', (_, err) => {
        const msg = (err && (err.message || err.code)) ? (err.message || `Code ${err.code}`) : 'RPC Error';
        updateDiscordStatusUI(false, msg);
    });

    // IPC: Discord toggled from tray menu
    ipcRenderer.on('discord-toggle-state', (_, enabled) => {
        discordRpcEnabled = enabled;
        const t = document.getElementById('discordRpcToggle');
        if (t) t.checked = enabled;
        updateDiscordStatusUI(enabled ? discordRpcConnected : false);
    });

    // Initial status query to main process
    ipcRenderer.invoke('discord-get-status').then((status) => {
        if (!status) return;
        discordRpcConnected = Boolean(status.connected);
        discordRpcEnabled = Boolean(status.enabled);
        updateDiscordStatusUI(status.connected, status.reason);
        renderDiscordUserCard(status.connected ? status.user : null);
        if (status.connected) {
            startDiscordPolling();
        }
    }).catch(() => {});

    // Start elapsed timer for preview
    startDiscordElapsedTimer();

    // Initial presence push
    if (discordRpcEnabled) {
        updateDiscordPresence();
        startDiscordPolling();
    }
}

function updateDiscordStatusUI(connected, reason = '') {
    const pill = document.getElementById('discordStatusPill');
    const txt = document.getElementById('discordStatusText');

    if (!pill) return;

    const r = String(reason || '').toLowerCase();

    if (!discordRpcEnabled) {
        pill.className = 'discord-rpc-status-pill disabled';
        if (txt) txt.textContent = 'Disabled';
    } else if (connected) {
        pill.className = 'discord-rpc-status-pill connected';
        if (txt) txt.textContent = 'Connected';
    } else if (r.includes('invalid') || r.includes('client id') || r.includes('4000')) {
        pill.className = 'discord-rpc-status-pill error';
        if (txt) txt.textContent = 'Invalid App ID';
    } else if (r.includes('not running') || r.includes('not detected') || r.includes('socket closed') || r.includes('closed')) {
        pill.className = 'discord-rpc-status-pill warning';
        if (txt) txt.textContent = 'Discord Offline';
    } else {
        pill.className = 'discord-rpc-status-pill';
        if (txt) txt.textContent = 'Connecting...';
    }
}

function startDiscordPolling() {
    clearInterval(discordPresenceInterval);
    discordPresenceInterval = setInterval(() => {
        if (discordRpcEnabled) updateDiscordPresence();
    }, 5000); // Update every 5 seconds
    updateDiscordPresence();
}

function startDiscordElapsedTimer() {
    clearInterval(discordElapsedTimer);
    discordElapsedTimer = setInterval(() => {
        updateDiscordPreview();
    }, 1000);
}

function buildDiscordActivity() {
    const game = (activeJob && activeJob.game) ? activeJob.game.toUpperCase() : (activeGame.code || 'ETS2');
    const gameFullName = getGameFullName(game);
    const hasJob = !!activeJob;
    const est = calculateTripEstimation();

    let details, state;

    if (hasJob) {
        const route = `${activeJob.originCity} ➔ ${activeJob.destCity}`;
        const pct = Math.min(100, Math.round(((activeJob.drivenDistance || 0) / (activeJob.distance || 1)) * 100));

        details = `🚛 ${route} (${game})`;

        let stateParts = [`${activeJob.cargo || 'Cargo'} • ${pct}% • ${est.distanceRemaining} km left (~${est.durationFormatted})`];
        if (discordShowSpeed && telemetryConnected && currentSpeed > 0) {
            const isMph = driverProfile.unit === 'mph';
            const spd = isMph ? Math.round(currentSpeed * 0.621371) : currentSpeed;
            const unit = isMph ? 'mph' : 'km/h';
            stateParts.push(`${spd} ${unit}`);
        }
        state = stateParts.join(' • ');
    } else if (telemetryConnected && currentSpeed > 0) {
        details = `🎮 Free Driving in ${game}`;
        const isMph = driverProfile.unit === 'mph';
        const spd = isMph ? Math.round(currentSpeed * 0.621371) : currentSpeed;
        const unit = isMph ? 'mph' : 'km/h';
        state = discordShowSpeed ? `${spd} ${unit} • TruckersMP` : 'TruckersMP';
    } else {
        const driver = driverProfile.callsign || 'Driver';
        const vtcName = (driverProfile.vtc && driverProfile.vtc.name) ? driverProfile.vtc.name : null;
        details = vtcName ? `🏢 ${vtcName}` : `🚚 Tracker — ${game}`;
        state = `Driver: ${driver} • No Active Job`;
    }

    const activity = {
        details: details.substring(0, 128),
        state: state.substring(0, 128),
        assets: {
            large_image: 'truck',
            large_text: `Tracker by Sukku • ${gameFullName}`,
            small_image: telemetryConnected ? 'online' : 'idle',
            small_text: telemetryConnected ? `${game} Telemetry Live` : `${game} Standby`
        }
    };

    if (discordShowElapsed) {
        activity.timestamps = {
            start: hasJob && activeJob.startTime
                ? Math.floor(activeJob.startTime / 1000)
                : Math.floor(discordSessionStart / 1000)
        };

        // If active job has valid ETA, provide end timestamp so Discord shows native countdown
        if (hasJob && est.etaDate && est.distanceRemaining > 0) {
            activity.timestamps.end = Math.floor(est.etaDate.getTime() / 1000);
        }
    }

    return activity;
}

function updateDiscordPresence() {
    if (!discordRpcEnabled) return;
    // Only show Discord presence when the game is actually running
    if (!telemetryConnected) {
        ipcRenderer.send('discord-clear-activity');
        updateDiscordPreview();
        return;
    }
    const activity = buildDiscordActivity();
    ipcRenderer.send('discord-set-activity', activity);
    updateDiscordPreview();
}

function updateDiscordPreview() {
    const hasJob = !!activeJob;
    const game = (activeJob && activeJob.game) ? activeJob.game.toUpperCase() : (activeGame.code || 'ETS2');
    const gameFullName = getGameFullName(game);
    const est = calculateTripEstimation();

    // Game name
    const gameNameEl = document.getElementById('dpmGameName');
    if (gameNameEl) gameNameEl.textContent = `Tracker — ${game} • TruckersMP`;

    // Detail line 1
    const detail1El = document.getElementById('dpmDetail1');
    if (detail1El) {
        if (hasJob) {
            detail1El.textContent = `🚛 ${activeJob.originCity} ➔ ${activeJob.destCity} (${game})`;
        } else if (telemetryConnected) {
            detail1El.textContent = `🎮 Free Driving in ${gameFullName}`;
        } else {
            detail1El.textContent = `🚚 No Active Job (${game})`;
        }
    }

    // Detail line 2
    const detail2El = document.getElementById('dpmDetail2');
    if (detail2El) {
        if (hasJob) {
            const pct = Math.min(100, Math.round(((activeJob.drivenDistance || 0) / (activeJob.distance || 1)) * 100));
            let parts = [`${activeJob.cargo || 'Cargo'} • ${pct}% • ${est.distanceRemaining} km (${est.durationFormatted})`];
            if (discordShowSpeed && telemetryConnected && currentSpeed > 0) {
                const isMph = driverProfile.unit === 'mph';
                const spd = isMph ? Math.round(currentSpeed * 0.621371) : currentSpeed;
                const unit = isMph ? 'mph' : 'km/h';
                parts.push(`${spd} ${unit}`);
            }
            detail2El.textContent = parts.join(' • ');
        } else {
            const driver = driverProfile.callsign || 'Driver';
            detail2El.textContent = `🕹️ Driver: ${driver}`;
        }
    }

    // Elapsed time & ETA info
    const elapsedEl = document.getElementById('dpmElapsed');
    if (elapsedEl) {
        if (!discordShowElapsed) {
            elapsedEl.textContent = '';
        } else {
            const start = (hasJob && activeJob.startTime) ? activeJob.startTime : discordSessionStart;
            const elapsed = Math.floor((Date.now() - start) / 1000);
            const h = Math.floor(elapsed / 3600);
            const m = Math.floor((elapsed % 3600) / 60);
            const s = elapsed % 60;
            const elapsedStr = h > 0
                ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} elapsed`
                : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} elapsed`;

            if (hasJob && est.distanceRemaining > 0) {
                elapsedEl.textContent = `⏱️ ${elapsedStr} • 🏁 ETA: ${est.etaFormatted} (~${est.durationFormatted})`;
            } else {
                elapsedEl.textContent = `${elapsedStr}`;
            }
        }
    }

    // Art box color when active job
    const artBox = document.getElementById('dpmArtBox');
    if (artBox) {
        if (hasJob) {
            artBox.style.background = 'linear-gradient(135deg, rgba(196,135,59,0.35), rgba(196,135,59,0.1))';
            artBox.style.borderColor = 'rgba(196,135,59,0.4)';
            artBox.style.color = 'rgba(196,135,59,0.9)';
        } else {
            artBox.style.background = '';
            artBox.style.borderColor = '';
            artBox.style.color = '';
        }
    }
}

// =======================================================
//  AUTO-UPDATER LOGIC (GITHUB RELEASES)
// =======================================================
function setupAutoUpdater() {
    let isUpdateDownloaded = false;
    let manualCheckTriggered = false;
    let currentAppVer = '1.1.0';

    // Retrieve current app version
    ipcRenderer.invoke('get-app-version').then((ver) => {
        if (ver) {
            currentAppVer = ver;
            const footerVer = document.getElementById('footerVersion');
            if (footerVer) footerVer.textContent = `v${ver}`;
            const curVerEl = document.getElementById('updateCurrentVer');
            if (curVerEl) curVerEl.textContent = `v${ver}`;
        }
    }).catch(() => {});

    // Elements
    const updateModal = document.getElementById('updateModal');
    const updateBadgeDot = document.getElementById('updateBadgeDot');
    const btnCheckUpdate = document.getElementById('btnCheckUpdate');
    const btnSettingsCheck = document.getElementById('btnSettingsCheckUpdate');
    const footerVersion = document.getElementById('footerVersion');
    const btnCloseModal = document.getElementById('btnCloseUpdateModal');
    const btnUpdateLater = document.getElementById('btnUpdateLater');
    const btnDownloadUpdate = document.getElementById('btnStartDownloadUpdate');
    const btnDownloadText = document.getElementById('btnDownloadUpdateText');
    const updateProgressSection = document.getElementById('updateProgressSection');
    const progressBarFill = document.getElementById('updateProgressBarFill');
    const progressPercent = document.getElementById('updateProgressPercent');
    const progressSpeed = document.getElementById('updateProgressSpeed');
    const progressStatus = document.getElementById('updateProgressStatus');
    const updateModalTitle = document.getElementById('updateModalTitle');
    const updateModalVersionTag = document.getElementById('updateModalVersionTag');
    const updateNewVer = document.getElementById('updateNewVer');
    const updateNotesContent = document.getElementById('updateNotesContent');

    function triggerManualCheck() {
        manualCheckTriggered = true;
        showToast('Checking for updates on GitHub...');
        ipcRenderer.invoke('check-for-updates').catch((err) => {
            showToast(`Update check failed: ${err.message || err}`);
            manualCheckTriggered = false;
        });
    }

    if (btnCheckUpdate) {
        btnCheckUpdate.addEventListener('click', triggerManualCheck);
    }
    if (btnSettingsCheck) {
        btnSettingsCheck.addEventListener('click', triggerManualCheck);
    }
    if (footerVersion) {
        footerVersion.addEventListener('click', triggerManualCheck);
    }

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            if (updateModal) updateModal.style.display = 'none';
        });
    }
    if (btnUpdateLater) {
        btnUpdateLater.addEventListener('click', () => {
            if (updateModal) updateModal.style.display = 'none';
        });
    }

    if (btnDownloadUpdate) {
        btnDownloadUpdate.addEventListener('click', () => {
            if (isUpdateDownloaded) {
                // Quit and install immediately
                if (btnDownloadText) btnDownloadText.textContent = 'Restarting...';
                btnDownloadUpdate.disabled = true;
                ipcRenderer.send('quit-and-install-update');
            } else {
                // Start downloading
                if (btnDownloadText) btnDownloadText.textContent = 'Connecting...';
                btnDownloadUpdate.disabled = true;
                if (updateProgressSection) updateProgressSection.style.display = 'flex';
                if (progressStatus) progressStatus.textContent = 'Connecting to download stream...';
                ipcRenderer.send('start-download-update');
            }
        });
    }

    // IPC Events from electron-updater in main.js
    ipcRenderer.on('update-status', (_, { status }) => {
        if (status === 'checking') {
            console.log('[Updater] Checking for updates on GitHub...');
        }
    });

    ipcRenderer.on('update-available', (_, info) => {
        manualCheckTriggered = false;
        isUpdateDownloaded = false;

        if (updateBadgeDot) updateBadgeDot.style.display = 'block';

        if (updateModalTitle) updateModalTitle.textContent = 'Update Available';
        if (updateModalVersionTag) updateModalVersionTag.textContent = `v${info.version}`;
        if (updateNewVer) updateNewVer.textContent = `v${info.version}`;
        if (updateNotesContent) {
            let notes = info.releaseNotes;
            if (Array.isArray(notes)) {
                notes = notes.map(n => n.note || n).join('\n');
            }
            updateNotesContent.innerHTML = notes
                ? escapeHtml(notes).replace(/\n/g, '<br>')
                : 'A new version of Tracker is available on GitHub with enhancements, performance improvements, and bug fixes.';
        }

        if (updateProgressSection) updateProgressSection.style.display = 'none';
        if (btnDownloadText) btnDownloadText.textContent = 'Download Update';
        if (btnDownloadUpdate) btnDownloadUpdate.disabled = false;

        if (updateModal) updateModal.style.display = 'flex';
        showToast(`Update v${info.version} is available!`);
    });

    ipcRenderer.on('update-not-available', (_, info) => {
        if (updateBadgeDot) updateBadgeDot.style.display = 'none';
        if (manualCheckTriggered) {
            const v = (info && info.version) ? info.version : currentAppVer;
            showToast(`You are on the latest version (v${v})! 🎉`);
            manualCheckTriggered = false;
        }
    });

    ipcRenderer.on('update-download-progress', (_, progress) => {
        if (updateProgressSection) updateProgressSection.style.display = 'flex';
        const pct = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
        if (progressBarFill) progressBarFill.style.width = `${pct}%`;
        if (progressPercent) progressPercent.textContent = `${pct}%`;

        const speedMB = ((progress.bytesPerSecond || 0) / (1024 * 1024)).toFixed(2);
        const transMB = ((progress.transferred || 0) / (1024 * 1024)).toFixed(1);
        const totalMB = ((progress.total || 0) / (1024 * 1024)).toFixed(1);

        if (progressSpeed) {
            progressSpeed.textContent = `${speedMB} MB/s • ${transMB} MB / ${totalMB} MB`;
        }
        if (progressStatus) {
            progressStatus.textContent = `Downloading update (${pct}%)...`;
        }
        if (btnDownloadText) {
            btnDownloadText.textContent = `Downloading (${pct}%)...`;
        }
    });

    ipcRenderer.on('update-downloaded', (_, info) => {
        isUpdateDownloaded = true;
        if (updateBadgeDot) updateBadgeDot.style.display = 'block';

        if (updateModalTitle) updateModalTitle.textContent = 'Update Ready to Install! 🎉';
        if (progressStatus) progressStatus.textContent = 'Download complete & verified!';
        if (progressBarFill) {
            progressBarFill.style.width = '100%';
            progressBarFill.style.background = '#4ade80';
        }
        if (progressPercent) progressPercent.textContent = '100%';

        if (btnDownloadText) btnDownloadText.textContent = 'Restart & Install Now';
        if (btnDownloadUpdate) btnDownloadUpdate.disabled = false;

        if (updateModal) updateModal.style.display = 'flex';
        showToast(`Update v${info.version} downloaded! Ready to install.`);
    });

    ipcRenderer.on('update-error', (_, { message }) => {
        console.warn('[Updater Error/Notice]', message);
        if (manualCheckTriggered) {
            if (message && message.includes('404')) {
                showToast(`No releases published on GitHub yet (v${currentAppVer})`);
            } else if (message && message.includes('dev-app-update')) {
                showToast('Running in dev mode. Updates enabled when packaged.');
            } else {
                showToast(`Update notice: ${message}`);
            }
            manualCheckTriggered = false;
        }
        if (btnDownloadText) btnDownloadText.textContent = 'Download Update';
        if (btnDownloadUpdate) btnDownloadUpdate.disabled = false;
    });
}

