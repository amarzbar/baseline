// Baseline for Mac as a desktop app: runs the same local server as `pnpm mac`
// inside Electron and shows its UI in a window instead of a browser tab.
import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';

process.env.BASELINE_UI_DIR ??= path.join(app.getAppPath(), 'dist/mac');

let url: string | null = null;

function openWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 860,
    minWidth: 640,
    minHeight: 600,
    title: 'Baseline',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    // A translucent sidebar like Finder's; the content pane paints its own background.
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links to anything but the local UI open in the real browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  win.loadURL(url!);
}

app.whenReady().then(async () => {
  const { ready } = await import('../mac/index.ts');
  url = await ready;
  openWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && openWindow());
});

app.on('window-all-closed', () => app.quit());
