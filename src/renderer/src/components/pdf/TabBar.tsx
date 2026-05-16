import { X, Plus } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'

export default function TabBar(): JSX.Element {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useAppStore()

  const handleAddTab = () => {
    // 创建一个空的tab，这样中间区域会显示拖放界面
    addTab({
      id: `tab-${Date.now()}`,
      title: '未命名.pdf',
    })
  }

  return (
    <div className="h-9 bg-dark-800 border-b border-dark-500 flex items-center px-1 gap-0.5 overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-xs cursor-pointer transition-all duration-200 whitespace-nowrap max-w-[200px] ${
            activeTabId === tab.id
              ? 'bg-dark-600 text-white font-medium'
              : 'text-dark-200 hover:bg-dark-700 hover:text-white'
          }`}
        >
          <span className="truncate">{tab.title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeTab(tab.id)
            }}
            className={`opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-dark-500 p-0.5 ${
              activeTabId === tab.id ? 'opacity-100' : ''
            }`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}

      {tabs.length === 0 && (
        <span className="text-xs text-dark-300 px-3">暂无打开的文档</span>
      )}

      <div className="flex-1 min-w-[20px]" />

      <button
        onClick={handleAddTab}
        className="p-1.5 rounded-md text-dark-300 hover:bg-dark-700 hover:text-white transition-colors shrink-0"
        title="新建空白文档"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}
