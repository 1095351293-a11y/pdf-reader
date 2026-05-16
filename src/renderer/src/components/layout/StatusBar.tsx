import { useAppStore } from '../../stores/appStore'

export default function StatusBar(): JSX.Element {
  const { tabs, activeTabId } = useAppStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="h-7 bg-dark-800 border-t border-dark-500 flex items-center px-3 text-[11px] text-dark-200 shrink-0">
      {activeTab ? (
        <>
          <span className="mr-4">
            第 {activeTab.pageNumber || 1} 页 / 共 {activeTab.totalPages || '-'} 页
          </span>
          <span className="mr-4">缩放: {activeTab.scale ? `${Math.round(activeTab.scale * 100)}%` : '100%'}</span>
        </>
      ) : (
        <span className="mr-4">未打开文档</span>
      )}

      <div className="flex-1" />

      <span className="text-dark-300">就绪</span>
    </div>
  )
}
