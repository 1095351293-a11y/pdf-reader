import { app, shell, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIPCHandlers } from './ipcHandlers'
import { closeDatabase } from './db'
import { registerDragService } from './services/dragService'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (is.dev) {
      mainWindow.webContents.openDevTools()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 加载应用页面
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 使用 IPC 从主进程转发拖放文件路径
  ipcMain.on('renderer:dragDropFiles', (_, paths: string[]) => {
    const pdfPaths = paths.filter((p) => p.toLowerCase().endsWith('.pdf'))
    if (pdfPaths.length > 0) {
      mainWindow.webContents.send('drag:filesDropped', pdfPaths)
    }
  })

  // 注册全局快捷键
  mainWindow.on('focus', () => {
    globalShortcut.register('Escape', () => {
      mainWindow.webContents.send('shortcut:escape')
    })
    globalShortcut.register('CommandOrControl+Shift+F', () => {
      mainWindow.webContents.send('shortcut:search')
    })
  })

  mainWindow.on('blur', () => {
    globalShortcut.unregisterAll()
  })

  mainWindow.on('closed', () => {
    globalShortcut.unregisterAll()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron.pdf-reader-ai')

  app.on('browser-window-created', (_, window) => {
    // zoom: true 允许 Ctrl+= / Ctrl+- 传递到渲染进程
    optimizer.watchWindowShortcuts(window, { zoom: true })
  })

  // 注册 IPC
  registerIPCHandlers()
  registerDragService()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDatabase()
})
