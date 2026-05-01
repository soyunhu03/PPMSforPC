const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const os = require('os');

const ALLOWED_DOMAIN = 'ppms-mc.web.app';

// ============ 설정 상태 ============
let appSettings = {
    useGPU: true,
    autoRefresh: true,
    highPriority: false,
    securityOption: false
};

let launcherWindow = null;
let mainWindow = null;
let unresponsiveTimer = null;

// ============ 런처 창 ============
function createLauncherWindow() {
    launcherWindow = new BrowserWindow({
        width: 300,
        height: 420,
        useContentSize: true,
        title: 'PPMS-MC Launcher',
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        frame: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'launcher-preload.js')
        }
    });

    launcherWindow.setMenuBarVisibility(false);
    launcherWindow.loadFile(path.join(__dirname, 'launcher.html'));

    launcherWindow.on('closed', () => {
        launcherWindow = null;
    });
}

// ============ 메인 창 ============
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'PPMS-MC 전용 앱',
        icon: path.join(__dirname, 'icon.ico'),
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'main-preload.js')
        }
    });

    mainWindow.setMenuBarVisibility(false);

    // 네트워크 최적화: 안전한 세션 기반 프리커넥트
    try {
        const ses = mainWindow.webContents.session;
        if (ses && typeof ses.preconnect === 'function') {
            ses.preconnect({
                url: 'https://ppms-mc.web.app',
                numSockets: 2
            });
            console.log('[PPMS] Session preconnect initialized');
        }
    } catch (err) {
        console.error('[PPMS] Network optimization error:', err.message);
    }

    mainWindow.loadURL('https://ppms-mc.web.app', {
        userAgent: 'PPMS-MC-Dedicated-App'
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 보안 옵션: 화면 캡처 차단
    if (appSettings.securityOption) {
        mainWindow.setContentProtection(true);
        console.log('[PPMS] Content protection enabled');
    }

    setupExternalLinkHandlers(mainWindow);
    setupUnresponsiveHandler();
    setupF5Refresh(mainWindow);
    setupCrashHandlers(mainWindow);

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (unresponsiveTimer) {
            clearTimeout(unresponsiveTimer);
            unresponsiveTimer = null;
        }
    });

    return mainWindow;
}

// ============ 자동 새로고침 핸들러 ============
function setupUnresponsiveHandler() {
    if (!appSettings.autoRefresh) return;

    mainWindow.webContents.on('unresponsive', () => {
        console.log('[PPMS] Window unresponsive detected, starting 10s timeout...');
        unresponsiveTimer = setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                console.log('[PPMS] Reloading due to unresponsiveness...');
                mainWindow.reload();
            }
        }, 10000);
    });

    mainWindow.webContents.on('responsive', () => {
        if (unresponsiveTimer) {
            console.log('[PPMS] Window responsive, canceling reload timer');
            clearTimeout(unresponsiveTimer);
            unresponsiveTimer = null;
        }
    });
}

// ============ F5 새로고침 ============
function setupF5Refresh(win) {
    win.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F5' && !input.control && !input.meta && !input.alt && !input.shift) {
            event.preventDefault();
            win.reload();
            console.log('[PPMS] F5 refresh triggered');
        }
    });
}

// ============ 크래시 핸들링 ============
function setupCrashHandlers(win) {
    win.webContents.on('render-process-gone', (event, details) => {
        console.error('[PPMS] Render process gone:', details.reason);
        handleCrash('렌더링 프로세스가 종료되었습니다: ' + details.reason);
    });

    win.webContents.on('child-process-gone', (event, details) => {
        console.error('[PPMS] Child process gone:', details.type, details.reason);
        if (details.type === 'GPU' || details.type === 'Utility') {
            handleCrash('보조 프로세스(' + details.type + ')가 종료되었습니다');
        }
    });
}

function handleCrash(reason) {
    const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'PPMS-MC 오류',
        message: '앱에 오류가 발생하여 복구 중입니다',
        detail: reason,
        buttons: ['앱 다시 시작', '종료'],
        defaultId: 0,
        noLink: true
    });

    if (choice === 0) {
        console.log('[PPMS] Relaunching app...');
        app.relaunch();
        app.quit();
    } else {
        console.log('[PPMS] User chose to exit');
        app.quit();
    }
}

// ============ 외부 링크 차단 ============
function setupExternalLinkHandlers(win) {
    const webContents = win.webContents;

    // 현재 창 내에서 주소 변경 시도 차단
    webContents.on('will-navigate', (event, url) => {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname !== ALLOWED_DOMAIN) {
                event.preventDefault();
                console.log(`[PPMS] Blocked navigation to: ${url}`);
                shell.openExternal(url).catch(err => {
                    console.error('[PPMS] Failed to open external URL:', err.message);
                });
            }
        } catch (err) {
            console.error('[PPMS] Invalid URL in will-navigate:', url, err.message);
            event.preventDefault();
        }
    });

    // 새 창 열기 시도 차단
    webContents.setWindowOpenHandler(({ url }) => {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname === ALLOWED_DOMAIN) {
                return { action: 'allow' };
            }
            console.log(`[PPMS] Blocked new window to: ${url}`);
            shell.openExternal(url).catch(err => {
                console.error('[PPMS] Failed to open external URL:', err.message);
            });
        } catch (err) {
            console.error('[PPMS] Invalid URL in setWindowOpenHandler:', url, err.message);
        }
        return { action: 'deny' };
    });
}

// ============ 우선순위 최적화 ============
function applyPriorityOptimization() {
    if (!appSettings.highPriority) return;

    try {
        const priority = os.constants.priority.PRIORITY_HIGH;
        os.setPriority(priority);
        console.log('[PPMS] Process priority set to HIGH');
    } catch (err) {
        console.error('[PPMS] Failed to set priority:', err.message);
    }
}

// ============ 하드웨어 가속 설정 ============
function configureHardwareAcceleration() {
    if (!appSettings.useGPU) {
        app.disableHardwareAcceleration();
        console.log('[PPMS] Hardware acceleration disabled');
    } else {
        console.log('[PPMS] Hardware acceleration enabled');
    }
}

// ============ IPC 핸들러 ============
function setupIPCHandlers() {
    ipcMain.on('launch-app', (event, settings) => {
        appSettings = { ...appSettings, ...settings };
        console.log('[PPMS] Launching with settings:', appSettings);

        if (launcherWindow) {
            launcherWindow.close();
        }

        configureHardwareAcceleration();
        applyPriorityOptimization();
        createMainWindow();
    });
}

// ============ 앱 초기화 ============
// ============ 네트워크 최적화 ============
function configureNetworkOptimizations() {
    try {
        // QUIC 프로토콜 활성화 (빠른 연결 설정)
        app.commandLine.appendSwitch('enable-quic');
        // TCP Fast Open 활성화 (연결 지연 시간 감소)
        app.commandLine.appendSwitch('enable-tcp-fast-open');
        // 병렬 다운로딩 활성화 (리소스 로딩 속도 향상)
        app.commandLine.appendSwitch('enable-parallel-downloading');
        // DNS 프리패칭 및 네트워크 예측 활성화
        app.commandLine.appendSwitch('enable-features', 'DnsPrefetch,NetworkPrediction,PrefetchPrivacyChanges');
        // DNS 해상도 최적화: 타겟 도메인 우선 처리
        app.commandLine.appendSwitch('host-resolver-rules', 'MAP ppms-mc.web.app ~dnsrule, EXCLUDE *.web.app');
        // 최대 연결 수 증가
        app.commandLine.appendSwitch('max-sockets-per-group', '8');

        console.log('[PPMS] Network optimizations enabled: QUIC, TCP Fast Open, Parallel Downloading, DNS Rules');
    } catch (err) {
        console.error('[PPMS] Failed to configure network optimizations:', err.message);
    }
}

// ============ 세션 기본 설정 ============
function configureDefaultSession() {
    try {
        const defaultSession = session.defaultSession;
        if (!defaultSession) {
            console.warn('[PPMS] Default session not available');
            return;
        }

        // 프록시 설정 확인 (최적화된 경로 사용)
        defaultSession.resolveProxy('https://ppms-mc.web.app')
            .then(proxy => {
                console.log('[PPMS] Proxy resolved:', proxy || 'DIRECT');
            })
            .catch(err => {
                console.warn('[PPMS] Proxy resolution failed:', err.message);
            });

        console.log('[PPMS] Default session configured');
    } catch (err) {
        console.error('[PPMS] Session configuration error:', err.message);
    }
}

app.commandLine.appendSwitch('ignore-certificate-errors');
configureNetworkOptimizations();

app.whenReady().then(() => {
    configureDefaultSession();
    setupIPCHandlers();
    createLauncherWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
