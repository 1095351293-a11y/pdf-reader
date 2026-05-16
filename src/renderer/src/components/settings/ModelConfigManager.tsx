import { useState, useMemo, useEffect } from 'react'
import {
  Folder,
  ChevronRight,
  Plus,
  Settings,
  MessageSquare,
  Eye,
  Layers,
  Mic,
  Star,
  MoreVertical,
  Trash2,
  Edit3,
  Check,
  X,
  FolderPlus,
  GripVertical,
  Wifi,
  WifiOff,
  Loader2,
  ScanLine,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { DEFAULT_MODEL_FOLDERS, type ModelConfig, type ModelFolder, type ModelCapability } from '../../types'

interface ModelConfigManagerProps {
  onClose: () => void
}

// 图标映射
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  MessageSquare,
  Eye,
  Layers,
  Mic,
}

// 文件夹图标选项
const FOLDER_ICONS = [
  { id: 'MessageSquare', label: '对话', Icon: MessageSquare },
  { id: 'Eye', label: '视觉', Icon: Eye },
  { id: 'Layers', label: '多模态', Icon: Layers },
  { id: 'Mic', label: '语音', Icon: Mic },
]

// 生成唯一ID
const generateId = () => `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

export default function ModelConfigManager({ onClose }: ModelConfigManagerProps): JSX.Element {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  // 文件夹管理状态
  const [customFolders, setCustomFolders] = useState<ModelFolder[]>([])
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [showNewFolderForm, setShowNewFolderForm] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderIcon, setNewFolderIcon] = useState('MessageSquare')
  const [newFolderCapability, setNewFolderCapability] = useState<ModelCapability>('text')
  const [customCapability, setCustomCapability] = useState('')
  const [isCustomCapability, setIsCustomCapability] = useState(false)

  // OCR 配置弹窗状态
  const [showOCRConfig, setShowOCRConfig] = useState(false)
  const [ocrModelId, setOcrModelId] = useState<string>('')

  const modelConfigs = useAppStore((s) => s.modelConfigs)
  const addModelConfig = useAppStore((s) => s.addModelConfig)
  const removeModelConfig = useAppStore((s) => s.removeModelConfig)
  const updateModelConfig = useAppStore((s) => s.updateModelConfig)

  // 从 localStorage 加载自定义文件夹和 OCR 配置
  useEffect(() => {
    try {
      const saved = localStorage.getItem('model_custom_folders')
      if (saved) {
        setCustomFolders(JSON.parse(saved))
      }
      // 加载 OCR 模型配置
      const savedOcrModelId = localStorage.getItem('ocrModelId')
      if (savedOcrModelId) {
        setOcrModelId(savedOcrModelId)
      }
    } catch (e) {
      console.error('加载自定义文件夹失败:', e)
    }
  }, [])

  // 保存自定义文件夹到 localStorage
  const saveCustomFolders = (folders: ModelFolder[]) => {
    try {
      localStorage.setItem('model_custom_folders', JSON.stringify(folders))
    } catch (e) {
      console.error('保存自定义文件夹失败:', e)
    }
  }

  // 获取所有文件夹（默认 + 自定义）
  const folders = useMemo(() => {
    const allFolders = [...DEFAULT_MODEL_FOLDERS, ...customFolders]
    return allFolders.sort((a, b) => a.order - b.order)
  }, [customFolders])

  // 获取选中文件夹的模型列表
  const folderModels = useMemo(() => {
    if (!selectedFolderId) return []
    return modelConfigs
      .filter((m) => m.folderId === selectedFolderId)
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
  }, [modelConfigs, selectedFolderId])

  // 获取选中文件夹的信息
  const selectedFolder = useMemo(() => {
    return folders.find((f) => f.id === selectedFolderId)
  }, [folders, selectedFolderId])

  // 获取文件夹中的模型数量
  const getModelCount = (folderId: string) => {
    return modelConfigs.filter((m) => m.folderId === folderId).length
  }

  // 获取文件夹的默认模型
  const getDefaultModel = (folderId: string) => {
    return modelConfigs.find((m) => m.folderId === folderId && m.isDefault)
  }

  // 创建新文件夹
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return

    const capability = isCustomCapability && customCapability.trim() 
      ? customCapability.trim() 
      : newFolderCapability

    const newFolder: ModelFolder = {
      id: generateId(),
      name: newFolderName.trim(),
      capability: capability,
      description: `自定义${capability}模型文件夹`,
      icon: newFolderIcon,
      order: folders.length + 1,
    }

    const updatedFolders = [...customFolders, newFolder]
    setCustomFolders(updatedFolders)
    saveCustomFolders(updatedFolders)

    // 重置表单
    setNewFolderName('')
    setNewFolderIcon('MessageSquare')
    setNewFolderCapability('text')
    setCustomCapability('')
    setIsCustomCapability(false)
    setShowNewFolderForm(false)

    // 选中新创建的文件夹
    setSelectedFolderId(newFolder.id)
  }

  // 重命名文件夹
  const handleRenameFolder = (folderId: string) => {
    if (!editingFolderName.trim()) {
      setEditingFolderId(null)
      return
    }

    // 检查是否是默认文件夹
    const isDefault = DEFAULT_MODEL_FOLDERS.some((f) => f.id === folderId)
    if (isDefault) {
      // 默认文件夹不能修改，这里可以添加提示
      setEditingFolderId(null)
      return
    }

    const updatedFolders = customFolders.map((f) =>
      f.id === folderId ? { ...f, name: editingFolderName.trim() } : f
    )
    setCustomFolders(updatedFolders)
    saveCustomFolders(updatedFolders)
    setEditingFolderId(null)
  }

  // 删除文件夹
  const handleDeleteFolder = (folderId: string) => {
    // 检查是否是默认文件夹
    const isDefault = DEFAULT_MODEL_FOLDERS.some((f) => f.id === folderId)
    if (isDefault) {
      alert('默认文件夹不能删除')
      return
    }

    // 检查文件夹中是否有模型
    const modelCount = getModelCount(folderId)
    if (modelCount > 0) {
      if (!confirm(`该文件夹中有 ${modelCount} 个模型，删除文件夹将同时删除这些模型配置。确定删除吗？`)) {
        return
      }
      // 删除文件夹中的所有模型
      modelConfigs
        .filter((m) => m.folderId === folderId)
        .forEach((m) => removeModelConfig(m.id))
    }

    const updatedFolders = customFolders.filter((f) => f.id !== folderId)
    setCustomFolders(updatedFolders)
    saveCustomFolders(updatedFolders)

    if (selectedFolderId === folderId) {
      setSelectedFolderId(null)
    }
  }

  // 开始重命名
  const startRename = (folder: ModelFolder) => {
    setEditingFolderId(folder.id)
    setEditingFolderName(folder.name)
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-dark-500 shrink-0">
        <h2 className="text-base font-semibold text-white">设置</h2>
        <div className="flex items-center gap-2">
          {/* OCR 配置按钮 */}
          <button
            onClick={() => setShowOCRConfig(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 text-dark-200 rounded-lg transition-colors"
          >
            <ScanLine className="w-3.5 h-3.5" />
            OCR 识别设置
          </button>
          <span className="text-xs text-dark-400">AI 模型管理</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-dark-200 hover:bg-dark-700 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
      {/* 左侧：文件夹列表 */}
      <div className="w-72 border-r border-dark-500 flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-500">
          <h2 className="text-sm font-medium text-dark-100">AI 模型管理</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewFolderForm(true)}
              className="p-1.5 rounded hover:bg-dark-600 text-dark-300 hover:text-white transition-colors"
              title="新建文件夹"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 新建文件夹表单 */}
        {showNewFolderForm && (
          <div className="px-3 py-3 border-b border-dark-500 bg-dark-700/30">
            <div className="space-y-3">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="文件夹名称"
                className="w-full px-3 py-2 bg-dark-700 border border-dark-500 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent/50"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder()
                  if (e.key === 'Escape') setShowNewFolderForm(false)
                }}
              />
              <div className="flex gap-2">
                <select
                  value={isCustomCapability ? 'custom' : newFolderCapability}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setIsCustomCapability(true)
                    } else {
                      setIsCustomCapability(false)
                      setNewFolderCapability(e.target.value as ModelCapability)
                    }
                  }}
                  className="flex-1 px-2 py-1.5 bg-dark-700 border border-dark-500 rounded text-xs text-dark-100 focus:outline-none focus:border-accent/50"
                >
                  <option value="text">文本</option>
                  <option value="vision">视觉</option>
                  <option value="multimodal">多模态</option>
                  <option value="audio">语音</option>
                  <option value="custom">自定义...</option>
                </select>
              </div>
              {isCustomCapability && (
                <input
                  type="text"
                  value={customCapability}
                  onChange={(e) => setCustomCapability(e.target.value)}
                  placeholder="输入自定义能力类型"
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-500 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent/50"
                  autoFocus
                />
              )}
              <div className="flex gap-1">
                {FOLDER_ICONS.map(({ id, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setNewFolderIcon(id)}
                    className={`p-1.5 rounded transition-colors ${
                      newFolderIcon === id
                        ? 'bg-accent/20 text-accent'
                        : 'hover:bg-dark-600 text-dark-400'
                    }`}
                    title={id}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim() || (isCustomCapability && !customCapability.trim())}
                  className="flex-1 px-3 py-1.5 bg-accent hover:bg-accent/80 disabled:bg-dark-600 text-dark-900 text-xs font-medium rounded-lg transition-colors"
                >
                  创建
                </button>
                <button
                  onClick={() => {
                    setShowNewFolderForm(false)
                    setNewFolderName('')
                    setCustomCapability('')
                    setIsCustomCapability(false)
                  }}
                  className="px-3 py-1.5 text-dark-400 hover:text-white text-xs transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 文件夹列表 */}
        <div className="flex-1 overflow-y-auto py-2">
          {folders.map((folder) => {
            const Icon = iconMap[folder.icon || 'MessageSquare'] || MessageSquare
            const modelCount = getModelCount(folder.id)
            const defaultModel = getDefaultModel(folder.id)
            const isSelected = selectedFolderId === folder.id
            const isEditing = editingFolderId === folder.id
            const isDefaultFolder = DEFAULT_MODEL_FOLDERS.some((f) => f.id === folder.id)

            return (
              <div
                key={folder.id}
                onClick={() => !isEditing && setSelectedFolderId(folder.id)}
                className={`mx-2 mb-1 rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-accent/10 border border-accent/30'
                    : 'hover:bg-dark-700 border border-transparent'
                }`}
              >
                <div className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${isSelected ? 'bg-accent/20' : 'bg-dark-600'}`}>
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-accent' : 'text-dark-300'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingFolderName}
                            onChange={(e) => setEditingFolderName(e.target.value)}
                            className="flex-1 px-2 py-1 bg-dark-700 border border-dark-500 rounded text-sm text-dark-100 focus:outline-none focus:border-accent/50"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameFolder(folder.id)
                              if (e.key === 'Escape') setEditingFolderId(null)
                            }}
                            onBlur={() => handleRenameFolder(folder.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-dark-100 truncate">
                            {folder.name}
                          </span>
                          <ChevronRight className="w-4 h-4 text-dark-400" />
                        </div>
                      )}
                      <p className="text-xs text-dark-400 mt-0.5 line-clamp-1">
                        {folder.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] bg-dark-600 text-dark-300 px-1.5 py-0.5 rounded">
                          {modelCount} 个模型
                        </span>
                        {defaultModel && (
                          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Star className="w-3 h-3" />
                            默认
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 文件夹操作菜单 */}
                    {!isEditing && (
                      <FolderActionsMenu
                        folder={folder}
                        isDefaultFolder={isDefaultFolder}
                        onRename={() => startRename(folder)}
                        onDelete={() => handleDeleteFolder(folder.id)}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 右侧：模型列表详情 */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFolder ? (
          <>
            {/* 文件夹头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-dark-500">
              <div>
                <h3 className="text-lg font-medium text-dark-100">{selectedFolder.name}</h3>
                <p className="text-sm text-dark-400 mt-1">{selectedFolder.description}</p>
              </div>
              <button
                onClick={() => setEditingModelId('new')}
                className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 text-dark-900 text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加模型
              </button>
            </div>

            {/* 模型列表 */}
            <div className="flex-1 overflow-y-auto p-6">
              {folderModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-16 h-16 rounded-full bg-dark-700/50 flex items-center justify-center mb-4">
                    <Settings className="w-8 h-8 text-dark-400" />
                  </div>
                  <h4 className="text-dark-200 font-medium mb-2">暂无模型配置</h4>
                  <p className="text-sm text-dark-400 mb-4">点击右上角添加模型</p>
                  <button
                    onClick={() => setEditingModelId('new')}
                    className="px-4 py-2 bg-accent/20 hover:bg-accent/30 text-accent text-sm rounded-lg transition-colors"
                  >
                    添加第一个模型
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {folderModels.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      isDefault={model.isDefault || false}
                      onEdit={() => setEditingModelId(model.id)}
                      onDelete={() => removeModelConfig(model.id)}
                      onSetDefault={() => {
                        // 取消该文件夹下其他模型的默认状态
                        folderModels.forEach((m) => {
                          if (m.id !== model.id && m.isDefault) {
                            updateModelConfig(m.id, { isDefault: false })
                          }
                        })
                        updateModelConfig(model.id, { isDefault: true })
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          /* 未选择文件夹时的提示 */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-full bg-dark-700/50 flex items-center justify-center mb-4">
              <Folder className="w-10 h-10 text-dark-400" />
            </div>
            <h4 className="text-dark-200 font-medium mb-2">选择文件夹</h4>
            <p className="text-sm text-dark-400">从左侧选择一个模型文件夹查看详情</p>
          </div>
        )}
      </div>
      </div>

      {/* 编辑/添加模型弹窗 */}
      {editingModelId && (
        <ModelEditModal
          folderId={selectedFolderId!}
          modelId={editingModelId === 'new' ? null : editingModelId}
          onClose={() => setEditingModelId(null)}
        />
      )}

      {/* OCR 配置弹窗 */}
      {showOCRConfig && (
        <OCRConfigModal
          modelConfigs={modelConfigs}
          currentModelId={ocrModelId}
          onClose={() => setShowOCRConfig(false)}
          onSave={(modelId) => {
            setOcrModelId(modelId)
            localStorage.setItem('ocrModelId', modelId)
            // 通知主进程更新 OCR 配置
            if (window.api?.ocr?.setModel) {
              window.api.ocr.setModel(modelId)
            }
          }}
        />
      )}
    </div>
  )
}

// 文件夹操作菜单组件
interface FolderActionsMenuProps {
  folder: ModelFolder
  isDefaultFolder: boolean
  onRename: () => void
  onDelete: () => void
}

function FolderActionsMenu({ folder, isDefaultFolder, onRename, onDelete }: FolderActionsMenuProps): JSX.Element {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-white transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(false)
            }}
          />
          <div
            className="absolute right-0 top-full mt-1 w-36 bg-dark-800 border border-dark-500 rounded-lg shadow-xl z-50 py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRename()
                setShowMenu(false)
              }}
              disabled={isDefaultFolder}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-dark-200 hover:bg-dark-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isDefaultFolder ? '默认文件夹不能重命名' : ''}
            >
              <Edit3 className="w-4 h-4" />
              重命名
            </button>
            <div className="border-t border-dark-600 my-1" />
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
                setShowMenu(false)
              }}
              disabled={isDefaultFolder}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isDefaultFolder ? '默认文件夹不能删除' : ''}
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// 模型卡片组件
interface ModelCardProps {
  model: ModelConfig
  isDefault: boolean
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
}

function ModelCard({ model, isDefault, onEdit, onDelete, onSetDefault }: ModelCardProps): JSX.Element {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="bg-dark-700/50 border border-dark-500 rounded-lg p-4 hover:border-dark-400 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-dark-100">{model.name}</h4>
            {isDefault && (
              <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded flex items-center gap-1">
                <Star className="w-3 h-3" />
                默认
              </span>
            )}
          </div>
          <p className="text-sm text-dark-400 mb-2">{model.model}</p>
          <div className="flex items-center gap-4 text-xs text-dark-500">
            <span>Provider: {model.provider}</span>
            <span>Base URL: {model.baseUrl}</span>
          </div>
        </div>

        {/* 操作菜单 */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded hover:bg-dark-600 text-dark-400 hover:text-white transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-40 bg-dark-800 border border-dark-500 rounded-lg shadow-xl z-50 py-1">
                <button
                  onClick={() => {
                    onEdit()
                    setShowMenu(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-dark-200 hover:bg-dark-700 transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                  编辑
                </button>
                {!isDefault && (
                  <button
                    onClick={() => {
                      onSetDefault()
                      setShowMenu(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-dark-200 hover:bg-dark-700 transition-colors"
                  >
                    <Star className="w-4 h-4" />
                    设为默认
                  </button>
                )}
                <div className="border-t border-dark-600 my-1" />
                <button
                  onClick={() => {
                    onDelete()
                    setShowMenu(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// OCR 配置弹窗
interface OCRConfigModalProps {
  modelConfigs: ModelConfig[]
  currentModelId: string
  onClose: () => void
  onSave: (modelId: string) => void
}

function OCRConfigModal({ modelConfigs, currentModelId, onClose, onSave }: OCRConfigModalProps): JSX.Element {
  const [selectedModelId, setSelectedModelId] = useState(currentModelId)

  // 获取视觉和多模态模型
  const visionModels = useMemo(() => {
    return modelConfigs.filter(
      config =>
        config.folderId === 'folder-vision' ||
        config.folderId === 'folder-multimodal' ||
        config.folderId.includes('vision') ||
        config.folderId.includes('multimodal')
    )
  }, [modelConfigs])

  const selectedModel = modelConfigs.find(m => m.id === selectedModelId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-dark-800 border border-dark-500 rounded-xl w-[480px] max-h-[80vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-500">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-accent" />
            <h3 className="text-base font-medium text-white">OCR 识别设置</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-sm text-dark-300">
            选择用于识别 PDF 中图片、图表、表格的 AI 模型。建议选择支持视觉的多模态模型。
          </p>

          {/* 模型选择 */}
          <div>
            <label className="block text-sm font-medium text-dark-200 mb-2">选择识别模型</label>
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-dark-100 outline-none focus:border-accent transition-colors"
            >
              <option value="">请选择模型...</option>
              {visionModels.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name} ({config.provider})
                </option>
              ))}
            </select>
            {visionModels.length === 0 && (
              <p className="text-xs text-amber-400 mt-2">
                未找到视觉或多模态模型。请先添加支持图像识别的模型到"视觉模型"或"多模态模型"文件夹。
              </p>
            )}
          </div>

          {/* 当前配置详情 */}
          {selectedModel && (
            <div className="p-3 bg-dark-700/50 rounded-lg border border-dark-500">
              <h4 className="text-xs font-medium text-dark-200 mb-2">当前配置</h4>
              <div className="space-y-1 text-xs text-dark-300">
                <p><span className="text-dark-400">名称:</span> {selectedModel.name}</p>
                <p><span className="text-dark-400">提供商:</span> {selectedModel.provider}</p>
                <p><span className="text-dark-400">模型:</span> {selectedModel.model}</p>
                <p><span className="text-dark-400">Base URL:</span> {selectedModel.baseUrl}</p>
              </div>
            </div>
          )}

          {/* 使用说明 */}
          <div className="p-3 bg-dark-700/30 rounded-lg border border-dark-500/50">
            <h4 className="text-xs font-medium text-dark-200 mb-2">使用说明</h4>
            <ul className="text-xs text-dark-400 space-y-1 list-disc list-inside">
              <li>选择支持图像识别的模型（如 GLM-4V、GPT-4V、Gemini 等）</li>
              <li>模型需要先在左侧文件夹中添加</li>
              <li>OCR 功能用于识别 PDF 中的图片、图表、表格内容</li>
              <li>识别后的内容将用于全文检索和 AI 对话</li>
            </ul>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-dark-500">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-dark-300 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => {
              onSave(selectedModelId)
              onClose()
            }}
            disabled={!selectedModelId}
            className="px-4 py-2 bg-accent hover:bg-accent/80 disabled:bg-dark-600 disabled:text-dark-400 text-dark-900 text-sm font-medium rounded-lg transition-colors"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  )
}

// 模型编辑弹窗
interface ModelEditModalProps {
  folderId: string
  modelId: string | null
  onClose: () => void
}

// 服务商 → 默认 Base URL
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1' },
  custom: { baseUrl: '' },
}

function ModelEditModal({ folderId, modelId, onClose }: ModelEditModalProps): JSX.Element {
  const modelConfigs = useAppStore((s) => s.modelConfigs)
  const addModelConfig = useAppStore((s) => s.addModelConfig)
  const updateModelConfig = useAppStore((s) => s.updateModelConfig)

  const existingModel = modelId ? modelConfigs.find((m) => m.id === modelId) : null

  const [formData, setFormData] = useState({
    name: existingModel?.name || '',
    provider: existingModel?.provider || 'openai',
    model: existingModel?.model || '',
    baseUrl: existingModel?.baseUrl || '',
    apiKey: existingModel?.apiKey || '',
    isDefault: existingModel?.isDefault || false,
  })

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleSubmit = () => {
    if (!formData.model) return

    const now = Date.now()
    // 如果没有填写显示名称，使用模型ID作为名称
    const submitData = {
      ...formData,
      name: formData.name || formData.model,
    }
    if (existingModel) {
      updateModelConfig(existingModel.id, {
        ...submitData,
        updatedAt: now,
      })
    } else {
      addModelConfig({
        folderId,
        ...submitData,
        createdAt: now,
        updatedAt: now,
      })
    }
    onClose()
  }

  // 检测模型类型
  const detectModelType = (modelName: string): 'chat' | 'embedding' | 'reranker' => {
    const lowerName = modelName.toLowerCase()
    // Reranker 模型关键词
    const rerankerKeywords = ['rerank', 'reranker', 'bge-reranker']
    if (rerankerKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'reranker'
    }
    // Embedding 模型关键词
    const embeddingKeywords = ['embedding', 'embed', 'text-embedding', 'bge-', 'm3e', 'gte']
    if (embeddingKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'embedding'
    }
    return 'chat'
  }

  // 连接测试
  const handleTestConnection = async () => {
    if (!formData.apiKey || !formData.model) {
      setTestResult({ success: false, message: '请先填写 API Key 和模型名称' })
      return
    }
    const effectiveBaseUrl = formData.baseUrl || PROVIDER_DEFAULTS[formData.provider]?.baseUrl || ''
    if (!effectiveBaseUrl && formData.provider !== 'anthropic') {
      setTestResult({ success: false, message: '请先填写 Base URL' })
      return
    }
    if (!window.api?.ai?.testConnection) {
      setTestResult({ success: false, message: 'API 不可用，请重启应用后再试' })
      return
    }

    const modelType = detectModelType(formData.model)

    setTesting(true)
    setTestResult(null)
    try {
      // 根据模型类型选择测试方式
      if (modelType === 'reranker') {
        // 测试 Reranker 接口
        const result = await testRerankerConnection({
          baseUrl: effectiveBaseUrl,
          apiKey: formData.apiKey,
          model: formData.model,
        })
        setTestResult(result)
      } else if (modelType === 'embedding') {
        // 测试 Embedding 接口
        const result = await testEmbeddingConnection({
          baseUrl: effectiveBaseUrl,
          apiKey: formData.apiKey,
          model: formData.model,
        })
        setTestResult(result)
      } else {
        // 测试 Chat 接口
        const result = await window.api.ai.testConnection({
          provider: formData.provider,
          baseUrl: effectiveBaseUrl,
          apiKey: formData.apiKey,
          model: formData.model,
        })
        setTestResult(result)
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '测试失败' })
    } finally {
      setTesting(false)
    }
  }

  // 测试 Reranker 连接
  const testRerankerConnection = async (config: {
    baseUrl: string
    apiKey: string
    model: string
  }): Promise<{ success: boolean; message: string }> => {
    try {
      const response = await fetch(`${config.baseUrl}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          query: 'test query',
          documents: ['test document 1', 'test document 2'],
          top_n: 2,
        }),
      })

      if (response.ok) {
        return { success: true, message: 'Reranker 连接成功' }
      } else {
        const error = await response.json().catch(() => ({}))
        return {
          success: false,
          message: `HTTP ${response.status}: ${error.error?.message || error.message || response.statusText}`,
        }
      }
    } catch (err: any) {
      return { success: false, message: err.message || '连接失败' }
    }
  }

  // 测试 Embedding 连接
  const testEmbeddingConnection = async (config: {
    baseUrl: string
    apiKey: string
    model: string
  }): Promise<{ success: boolean; message: string }> => {
    try {
      const response = await fetch(`${config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: 'test',
        }),
      })

      if (response.ok) {
        return { success: true, message: 'Embedding 连接成功' }
      } else {
        const error = await response.json().catch(() => ({}))
        return {
          success: false,
          message: `HTTP ${response.status}: ${error.error?.message || error.message || response.statusText}`,
        }
      }
    } catch (err: any) {
      return { success: false, message: err.message || '连接失败' }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-dark-800 border border-dark-500 rounded-xl w-[500px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-500">
          <h3 className="text-lg font-medium text-dark-100">
            {existingModel ? '编辑模型' : '添加模型'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-dark-600 text-dark-400 hover:text-white transition-colors"
          >
            <span className="sr-only">关闭</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 表单 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 服务商 */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">服务商</label>
            <select
              value={formData.provider}
              onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-500 rounded-lg text-dark-100 focus:outline-none focus:border-accent/50"
            >
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="zhipu">智谱 AI</option>
              <option value="kimi">Kimi</option>
              <option value="qwen">通义千问</option>
              <option value="gemini">Gemini</option>
              <option value="anthropic">Anthropic</option>
              <option value="custom">自定义</option>
            </select>
          </div>

          {/* 模型 ID */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">模型 ID</label>
            <input
              type="text"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              placeholder="例如：gpt-4o"
              className="w-full px-3 py-2 bg-dark-700 border border-dark-500 rounded-lg text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Base URL</label>
            <input
              type="text"
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 bg-dark-700 border border-dark-500 rounded-lg text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">API Key</label>
            <input
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full px-3 py-2 bg-dark-700 border border-dark-500 rounded-lg text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* 连接测试 */}
          <div className="pt-2 space-y-2">
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg border border-dark-500 bg-dark-700/50 hover:bg-dark-600 text-dark-100 transition-colors disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : testResult?.success ? (
                <Wifi className="w-4 h-4 text-green-400" />
              ) : testResult ? (
                <WifiOff className="w-4 h-4 text-red-400" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              {testing ? '测试中...' : '连接测试'}
            </button>
            {testResult && (
              <div
                className={`text-xs px-3 py-2 rounded-lg ${
                  testResult.success
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}
              >
                {testResult.message}
              </div>
            )}
          </div>

          {/* 设为默认 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.isDefault}
              onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              className="w-4 h-4 rounded border-dark-500 bg-dark-700 text-accent focus:ring-accent/50"
            />
            <span className="text-sm text-dark-300">设为默认模型</span>
          </label>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-500">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-dark-300 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!formData.model}
            className="px-4 py-2 bg-accent hover:bg-accent/80 disabled:bg-dark-600 disabled:text-dark-400 text-dark-900 text-sm font-medium rounded-lg transition-colors"
          >
            {existingModel ? '保存' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
