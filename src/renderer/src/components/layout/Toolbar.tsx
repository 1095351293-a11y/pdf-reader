import { useEffect } from 'react'
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize,
  PanelLeftClose,
  PanelRightClose,
  BookOpen,
  LayoutGrid,
  Camera,
  Crop,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import type { PDFRenderHandle } from '../pdf/PDFRender'

interface ToolbarProps {
  onTogglePanel: (panel: 'thumbnails' | 'bookmarks') => void
  activePanel: 'thumbnails' | 'bookmarks' | null
  pdfRenderRef?: React.Ref<PDFRenderHandle | null>
}

const SCALE_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0]

function getNextScale(current: number, direction: 'in' | 'out'): number {
  const idx = SCALE_STEPS.findIndex((s) => s >= current)
  if (direction === 'in') {
    if (idx === -1) return SCALE_STEPS[SCALE_STEPS.length - 1]
    return SCALE_STEPS[Math.min(idx + 1, SCALE_STEPS.length - 1)]
  } else {
    if (idx === -1) return SCALE_STEPS[0]
    // 如果当前值正好匹配某个 step，往前走一步；否则跳到当前或更小
    const targetIdx = SCALE_STEPS[idx] === current ? idx - 1 : idx
    return SCALE_STEPS[Math.max(targetIdx, 0)]
  }
}

export default function Toolbar({ onTogglePanel, activePanel, pdfRenderRef }: ToolbarProps): JSX.Element {
  const {
    sidebarVisible,
    chatPanelVisible,
    toggleSidebar,
    toggleChatPanel,
    toggleImmersive,
    tabs,
    activeTabId,
    updateTab,
  } = useAppStore()

  // 监听截图事件（从ChatPanel触发）
  useEffect(() => {
    const handleStartScreenshot = () => {
      const renderHandle = (pdfRenderRef as React.MutableRefObject<PDFRenderHandle | null>)?.current
      renderHandle?.startRegionScreenshot()
    }
    const handleCaptureCurrentPage = async () => {
      const renderHandle = (pdfRenderRef as React.MutableRefObject<PDFRenderHandle | null>)?.current
      if (renderHandle) {
        const dataUrl = await renderHandle.captureScreenshot()
        if (dataUrl) {
          const page = renderHandle.getCurrentPage()
          window.dispatchEvent(new CustomEvent('page-captured', { 
            detail: { dataUrl, pageIndex: page - 1 } 
          }))
        }
      }
    }
    window.addEventListener('start-screenshot', handleStartScreenshot)
    window.addEventListener('capture-current-page', handleCaptureCurrentPage)
    return () => {
      window.removeEventListener('start-screenshot', handleStartScreenshot)
      window.removeEventListener('capture-current-page', handleCaptureCurrentPage)
    }
  }, [pdfRenderRef])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const currentScale = activeTab?.scale || 1.0

  const handleZoomIn = () => {
    if (!activeTabId) return
    const next = getNextScale(currentScale, 'in')
    updateTab(activeTabId, { scale: next })
  }

  const handleZoomOut = () => {
    if (!activeTabId) return
    const next = getNextScale(currentScale, 'out')
    updateTab(activeTabId, { scale: next })
  }

  const handleFitPage = () => {
    if (!activeTabId) return
    updateTab(activeTabId, { scale: 1.0 })
  }

  return (
    <div className="h-10 bg-dark-800 border-b border-dark-500 flex items-center px-3 gap-1 shrink-0">
      {/* 视图控制 */}
      <ToolbarButton
        icon={<PanelLeftClose className="w-4 h-4" />}
        label="侧边栏"
        active={sidebarVisible}
        onClick={toggleSidebar}
        tooltip={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
      />
      <ToolbarButton
        icon={<PanelRightClose className="w-4 h-4" />}
        label="对话"
        active={chatPanelVisible}
        onClick={toggleChatPanel}
        tooltip={chatPanelVisible ? '隐藏对话面板' : '显示对话面板'}
      />

      <div className="w-px h-5 bg-dark-500 mx-1" />

      {/* PDF 工具 */}
      <ToolbarButton
        icon={<ZoomOut className="w-4 h-4" />}
        onClick={handleZoomOut}
        tooltip="缩小 (Ctrl+-)"
      />
      <span className="text-xs text-dark-200 w-12 text-center select-none">
        {Math.round(currentScale * 100)}%
      </span>
      <ToolbarButton
        icon={<ZoomIn className="w-4 h-4" />}
        onClick={handleZoomIn}
        tooltip="放大 (Ctrl++)"
      />
      <ToolbarButton
        icon={<RotateCcw className="w-4 h-4" />}
        label="适应"
        onClick={handleFitPage}
        tooltip="适应页面"
      />

      <div className="w-px h-5 bg-dark-500 mx-1" />

      {/* 截图工具 */}
      <ToolbarButton
        icon={<Camera className="w-4 h-4" />}
        label="截图"
        onClick={() => {
          // 启动区域截图模式
          const renderHandle = (pdfRenderRef as React.MutableRefObject<PDFRenderHandle | null>)?.current
          renderHandle?.startRegionScreenshot()
        }}
        tooltip="框选截图 (Ctrl+Shift+S)"
      />

      <div className="w-px h-5 bg-dark-500 mx-1" />

      {/* 阅读工具 */}
      <ToolbarButton
        icon={<LayoutGrid className="w-4 h-4" />}
        label="缩略图"
        active={activePanel === 'thumbnails'}
        onClick={() => onTogglePanel('thumbnails')}
        tooltip="页面缩略图"
      />
      <ToolbarButton
        icon={<BookOpen className="w-4 h-4" />}
        label="目录"
        active={activePanel === 'bookmarks'}
        onClick={() => onTogglePanel('bookmarks')}
        tooltip="显示目录"
      />

      <div className="flex-1" />

      {/* 沉浸模式 */}
      <ToolbarButton
        icon={<Maximize className="w-4 h-4" />}
        label="沉浸"
        onClick={toggleImmersive}
        tooltip="沉浸阅读模式"
      />
    </div>
  )
}

function ToolbarButton({
  icon,
  label,
  active,
  onClick,
  tooltip,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
  tooltip?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={tooltip || label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200 ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-dark-200 hover:bg-dark-700 hover:text-white'
      }`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}
