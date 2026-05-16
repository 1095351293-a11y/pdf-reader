import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from './stores/appStore'
import { useFileStore } from './stores/fileStore'
import Sidebar from './components/sidebar/Sidebar'
import TabBar from './components/pdf/TabBar'
import PDFViewer from './components/pdf/PDFViewer'
import ChatPanel from './components/chat/ChatPanel'
import StatusBar from './components/layout/StatusBar'
import Toolbar from './components/layout/Toolbar'
import SettingsModal from './components/settings/SettingsModal'
import ErrorBoundary from './components/ErrorBoundary'
import ResizeHandle from './components/common/ResizeHandle'
import type { PDFRenderHandle } from './components/pdf/PDFRender'

function App(): JSX.Element {
  const { sidebarVisible, chatPanelVisible, toolbarVisible, immersiveMode, exitImmersive, loadTabsFromDB, loadTranslateModelId, loadCitationsFromDB, loadModelConfigsFromDB, loadChatSessionsFromDB, toggleSidebar } =
    useAppStore()
  const { loadFromDB, loaded } = useFileStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pdfSidePanel, setPdfSidePanel] = useState<'thumbnails' | 'bookmarks' | null>(null)
  const pdfRenderRef = useRef<PDFRenderHandle>(null)
  // 记录目录打开前侧边栏的状态
  const sidebarVisibleBeforeBookmarksRef = useRef<boolean>(true)

  // 面板宽度状态
  const [sidebarWidth, setSidebarWidth] = useState(256)  // w-64 = 256px
  const [chatWidth, setChatWidth] = useState(320)        // w-80 = 320px
  const [pdfSidePanelWidth, setPdfSidePanelWidth] = useState(280)  // PDF侧边栏宽度

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.min(400, Math.max(200, w + delta)))
  }, [])

  const handlePdfSidePanelResize = useCallback((delta: number) => {
    setPdfSidePanelWidth((w) => Math.min(400, Math.max(180, w + delta)))
  }, [])

  const handleChatResize = useCallback((delta: number) => {
    setChatWidth((w) => Math.min(500, Math.max(240, w + delta)))
  }, [])

  // 应用启动时从数据库加载数据
  useEffect(() => {
    loadFromDB()
    loadTabsFromDB()
    loadTranslateModelId()
    loadCitationsFromDB()
    loadModelConfigsFromDB()
    loadChatSessionsFromDB()
  }, [])

  // 监听主进程快捷键
  useEffect(() => {
    const removeListener = window.api?.on?.('shortcut:escape', () => {
      if (immersiveMode) exitImmersive()
      // 重新分发 ESC keydown 事件，因为 globalShortcut 拦截了原始按键
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    return () => {
      removeListener?.()
    }
  }, [immersiveMode, exitImmersive])

  // 监听 ChatPanel 的打开设置请求
  useEffect(() => {
    const handler = () => setSettingsOpen(true)
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  const togglePdfPanel = (panel: 'thumbnails' | 'bookmarks') => {
    setPdfSidePanel((current) => {
      const isOpening = current !== panel
      const isBookmarksPanel = panel === 'bookmarks'

      if (isBookmarksPanel) {
        if (isOpening) {
          // 打开目录时，记录当前侧边栏状态并收起
          sidebarVisibleBeforeBookmarksRef.current = sidebarVisible
          if (sidebarVisible) {
            toggleSidebar()
          }
        } else {
          // 关闭目录时，恢复侧边栏状态
          if (!sidebarVisible && sidebarVisibleBeforeBookmarksRef.current) {
            toggleSidebar()
          }
        }
      }

      return current === panel ? null : panel
    })
  }

  return (
    <ErrorBoundary>
      <div className="flex h-full bg-dark-900 text-dark-100 overflow-hidden">
        {/* 左侧文件管理侧边栏 - 使用丝滑过渡动画 */}
        {!immersiveMode && (
          <>
            <div
              className="flex shrink-0 overflow-hidden"
              style={{
                width: sidebarVisible ? sidebarWidth : 0,
                opacity: sidebarVisible ? 1 : 0,
                transform: sidebarVisible ? 'translateX(0)' : 'translateX(-20px)',
                transition: 'width 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 300ms ease-out, transform 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                willChange: 'width, opacity, transform',
              }}
            >
              <Sidebar onOpenSettings={() => setSettingsOpen(true)} width={sidebarWidth} />
            </div>
            {sidebarVisible && (
              <ResizeHandle onResize={handleSidebarResize} side="left" />
            )}
          </>
        )}

        {/* 中间 PDF 阅读区 */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          {/* 顶部工具栏 */}
          {!immersiveMode && toolbarVisible && (
            <Toolbar onTogglePanel={togglePdfPanel} activePanel={pdfSidePanel} pdfRenderRef={pdfRenderRef} />
          )}

          {/* 标签栏 */}
          {!immersiveMode && <TabBar />}

          {/* PDF 渲染区 */}
          <PDFViewer 
            sidePanel={pdfSidePanel} 
            onCloseSidePanel={() => {
              // 关闭目录面板时，恢复侧边栏状态
              if (pdfSidePanel === 'bookmarks') {
                if (!sidebarVisible && sidebarVisibleBeforeBookmarksRef.current) {
                  toggleSidebar()
                }
              }
              setPdfSidePanel(null)
            }} 
            pdfSidePanelWidth={pdfSidePanelWidth}
            onResizePdfSidePanel={handlePdfSidePanelResize}
            pdfRenderRef={pdfRenderRef} 
          />

          {/* 底部状态栏 */}
          {!immersiveMode && <StatusBar />}

          {/* 沉浸模式退出按钮 */}
          {immersiveMode && (
            <button
              onClick={exitImmersive}
              className="absolute top-4 right-4 bg-dark-700/80 hover:bg-dark-600 text-white px-3 py-1.5 rounded-lg text-sm backdrop-blur-sm transition-all opacity-0 hover:opacity-100 focus:opacity-100 z-50"
              title="退出沉浸模式 (Esc)"
            >
              退出沉浸
            </button>
          )}
        </main>

        {/* 右侧 AI 对话面板 */}
        {!immersiveMode && chatPanelVisible && (
          <>
            <ResizeHandle onResize={handleChatResize} side="right" />
            <ChatPanel width={chatWidth} />
          </>
        )}

        {/* 设置弹窗 */}
        <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </ErrorBoundary>
  )
}

export default App
