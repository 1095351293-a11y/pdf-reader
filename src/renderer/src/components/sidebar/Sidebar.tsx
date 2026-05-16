import { useState, useCallback, useEffect } from 'react'
import {
  FolderOpen,
  Star,
  Trash2,
  Settings,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Search,
  Plus,
  Folder,
  FileText,
  Upload,
  FolderInput,
  X,
  FolderPlus,
} from 'lucide-react'
import { useFileStore } from '../../stores/fileStore'
import { useAppStore } from '../../stores/appStore'
import { CheckSquare, Square } from 'lucide-react'
import type { ChatSession } from '../../types'
import { DEFAULT_CHAT_FOLDERS } from '../../types'
import { FileNode } from '../../stores/fileStore'
import ContextMenu, { MenuItem } from '../common/ContextMenu'

/** 标准化路径（统一使用正斜杠，并转为小写用于比较） */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

interface SidebarProps {
  onOpenSettings: () => void
  width: number
}

export default function Sidebar({ onOpenSettings, width }: SidebarProps): JSX.Element {
  const {
    searchQuery,
    setSearchQuery,
    expandedIds,
    toggleExpanded,
    expand,
    getChildren,
    selectedId,
    setSelected,
    addNode,
    renameNode,
    removeNode,
    moveNode,
  } = useFileStore()
  const { addTab, toggleSidebar, knowledgeBaseFiles, toggleKnowledgeBaseFile } = useAppStore()
  const [activeSection, setActiveSection] = useState<'library' | 'knowledge' | 'chat'>('library')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(
    null
  )
  const [dragOver, setDragOver] = useState(false)
  // 内联重命名状态
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const roots = getChildren(null)

  // 监听主进程发送的拖放文件路径
  useEffect(() => {
    const removeListener = window.api?.on?.('drag:filesDropped', (paths: string[]) => {
      paths.forEach((filePath) => {
        const name = filePath.split(/[\\/]/).pop() || '未命名.pdf'
        const newId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        addNode({
          id: newId,
          name,
          type: 'file',
          path: filePath,
          parentId: 'root1',  // 始终添加到根目录
          sortOrder: 0,
          createdAt: Date.now(),
        })
      })
    })
    return () => removeListener?.()
  }, [addNode])

  const handleNodeClick = (node: FileNode) => {
    if (node.type === 'folder' || node.type === 'root') {
      setSelected(node.id)
      toggleExpanded(node.id)
    } else if (node.type === 'file') {
      setSelected(node.id)
      addTab({
        id: node.id,
        title: node.name,
        filePath: node.path,
      })
    }
  }

  const handleContextMenu = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId })
  }

  const closeContextMenu = () => setContextMenu(null)

  const getContextMenuItems = (nodeId: string): MenuItem[] => {
    const node = useFileStore.getState().nodes[nodeId]
    if (!node) return []

    const isFolder = node.type === 'folder' || node.type === 'root'
    return [
      {
        id: 'open',
        label: '打开',
        icon: <FileText className="w-4 h-4" />,
        onClick: () => handleNodeClick(node),
      },
      ...(isFolder
        ? [
            {
              id: 'new-folder',
              label: '新建文件夹',
              icon: <Plus className="w-4 h-4" />,
              onClick: () => {
                const newId = `folder-${Date.now()}`
                addNode({
                  id: newId,
                  name: '新建文件夹',
                  type: 'folder',
                  parentId: nodeId,
                  children: [],
                  sortOrder: 0,
                  createdAt: Date.now(),
                })
              },
            },
          ]
        : []),
      {
        id: 'rename',
        label: '重命名',
        icon: <FileText className="w-4 h-4" />,
        onClick: () => {
          setEditingNodeId(nodeId)
          setEditingName(node.name)
        },
      },
      {
        id: 'delete',
        label: '删除',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        onClick: () => removeNode(nodeId),
      },
    ]
  }

  const handleImportFiles = async () => {
    const paths = await window.api.openFile()
    paths.forEach((filePath) => {
      const name = filePath.split(/[\\/]/).pop() || '未命名.pdf'
      const newId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      addNode({
        id: newId,
        name,
        type: 'file',
        path: filePath,
        parentId: 'root1',  // 始终添加到根目录
        sortOrder: 0,
        createdAt: Date.now(),
      })
    })
  }

  const handleNewFolder = () => {
    const parentId = selectedId && useFileStore.getState().nodes[selectedId]?.type === 'folder' ? selectedId : 'root1'
    const newId = `folder-${Date.now()}`
    addNode({
      id: newId,
      name: '新建文件夹',
      type: 'folder',
      parentId,
      children: [],
      isExpanded: false,
      sortOrder: 0,
      createdAt: Date.now(),
    })
    // 自动展开父文件夹（只展开，不切换）
    if (parentId !== 'root1') {
      expand(parentId)
    }
  }

  const handleImportFolder = async () => {
    const dirPath = await window.api.openDirectory()
    if (!dirPath) return
    // 创建文件夹节点
    const folderId = `folder-${Date.now()}`
    addNode({
      id: folderId,
      name: dirPath.split(/[\\/]/).pop() || '导入文件夹',
      type: 'folder',
      parentId: 'root1',
      children: [],
      isExpanded: false,
      sortOrder: 0,
      createdAt: Date.now(),
    })
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    // 方法1：尝试从 dataTransfer.files 获取（Electron 中有时可用）
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      pdfFiles.forEach((file) => {
        const newId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const filePath = (file as any).path as string
        if (filePath) {
          addNode({
            id: newId,
            name: file.name,
            type: 'file',
            path: filePath,
            parentId: 'root1',  // 始终添加到根目录
            sortOrder: 0,
            createdAt: Date.now(),
          })
        }
      })
      return
    }

    // 方法2：从 dataTransfer.items 获取（某些系统使用这种方式）
    const items = Array.from(e.dataTransfer.items)
    items.forEach((item) => {
      if (item.kind === 'file') {
        const entry = (item as any).getAsFileSystemEntry?.()
        if (entry?.isFile && entry.fullPath?.toLowerCase().endsWith('.pdf')) {
          // 尝试通过主进程获取真实路径
          console.log('拖放文件路径:', entry.fullPath)
        }
      }
    })
  }, [])

  return (
    <aside
      style={{ width: `${width}px` }}
      className="bg-dark-800 border-r border-dark-500 flex flex-col shrink-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 顶部 Logo */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-dark-500">
        <div className="flex items-center">
          <FileText className="w-5 h-5 text-accent mr-2" />
          <span className="text-base font-semibold text-white tracking-wide">PDF Reader AI</span>
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1 rounded hover:bg-dark-700 text-dark-300 hover:text-white transition-colors"
          title="关闭侧边栏"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 模式切换 */}
      <div className="flex border-b border-dark-500">
        <button
          onClick={() => setActiveSection('library')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeSection === 'library'
              ? 'text-accent border-b-2 border-accent bg-dark-700/30'
              : 'text-dark-200 hover:text-white'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5 inline mr-1" />
          资料库
          {knowledgeBaseFiles.length > 0 && (
            <span className="ml-1 text-[10px] bg-accent/20 text-accent px-1 rounded">
              {knowledgeBaseFiles.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSection('chat')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeSection === 'chat'
              ? 'text-accent border-b-2 border-accent bg-dark-700/30'
              : 'text-dark-200 hover:text-white'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 inline mr-1" />
          聊天
        </button>
      </div>

      {activeSection === 'library' ? (
        <>
          {/* 搜索框 */}
          <div className="px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-300" />
              <input
                type="text"
                placeholder="搜索文件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-dark-700 border border-dark-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-dark-100 placeholder-dark-300 outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {/* 快捷操作 */}
          <div className="px-3 pb-2 flex gap-1">
            <button
              onClick={handleImportFiles}
              className="flex-1 flex items-center justify-center gap-1 bg-dark-700 hover:bg-dark-600 rounded-md py-1.5 text-xs text-dark-100 transition-colors"
            >
              <Upload className="w-3 h-3" />
              导入
            </button>
            <button
              onClick={handleNewFolder}
              className="flex-1 flex items-center justify-center gap-1 bg-dark-700 hover:bg-dark-600 rounded-md py-1.5 text-xs text-dark-100 transition-colors"
            >
              <Plus className="w-3 h-3" />
              新建
            </button>
            <button
              onClick={handleImportFolder}
              className="flex-1 flex items-center justify-center gap-1 bg-dark-700 hover:bg-dark-600 rounded-md py-1.5 text-xs text-dark-100 transition-colors"
            >
              <FolderInput className="w-3 h-3" />
              文件夹
            </button>
          </div>

          {/* 文件树 - 跳过根节点，直接渲染子节点 */}
          <FileTreeDropZone
            roots={roots}
            getChildren={getChildren}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onToggle={toggleExpanded}
            onClick={handleNodeClick}
            onContextMenu={handleContextMenu}
            knowledgeBaseFiles={knowledgeBaseFiles}
            toggleKnowledgeBaseFile={toggleKnowledgeBaseFile}
            editingNodeId={editingNodeId}
            editingName={editingName}
            setEditingNodeId={setEditingNodeId}
            setEditingName={setEditingName}
            renameNode={renameNode}
            moveNode={moveNode}
            onBlankClick={() => setSelected(null)}
          />
        </>
      ) : (
        /* 聊天侧边栏 */
        <ChatSidebar onOpenSettings={onOpenSettings} />
      )}

      {/* 底部 */}
      <div className="h-10 border-t border-dark-500 flex items-center px-3">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-dark-200 hover:text-white transition-colors py-1.5 rounded hover:bg-dark-700 min-w-0"
          title="设置"
        >
          <Settings className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">设置</span>
        </button>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.nodeId)}
          onClose={closeContextMenu}
        />
      )}
    </aside>
  )
}

/** 递归收集文件夹下所有文件路径（返回标准化路径） */
function collectFilePaths(nodeId: string, getChildren: (parentId: string | null) => FileNode[]): string[] {
  const paths: string[] = []
  const children = getChildren(nodeId)
  for (const child of children) {
    if (child.type === 'file' && child.path) {
      paths.push(normalizePath(child.path))
    } else if (child.type === 'folder') {
      paths.push(...collectFilePaths(child.id, getChildren))
    }
  }
  return paths
}

/** 检查文件夹下文件的勾选状态：'all' | 'partial' | 'none' */
function getFolderCheckState(
  nodeId: string,
  getChildren: (parentId: string | null) => FileNode[],
  knowledgeBaseFiles: string[]
): 'all' | 'partial' | 'none' {
  const filePaths = collectFilePaths(nodeId, getChildren)
  if (filePaths.length === 0) return 'none'
  const checkedCount = filePaths.filter((p) => knowledgeBaseFiles.includes(p)).length
  if (checkedCount === 0) return 'none'
  if (checkedCount === filePaths.length) return 'all'
  return 'partial'
}

// 树形节点组件
function TreeNode({
  node,
  level,
  expandedIds,
  selectedId,
  onToggle,
  onClick,
  onContextMenu,
  getChildren,
  knowledgeBaseFiles,
  toggleKnowledgeBaseFile,
  editingNodeId,
  editingName,
  setEditingNodeId,
  setEditingName,
  renameNode,
  moveNode,
}: {
  node: FileNode
  level: number
  expandedIds: Set<string>
  selectedId: string | null
  onToggle: (id: string) => void
  onClick: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  getChildren: (parentId: string | null) => FileNode[]
  knowledgeBaseFiles: string[]
  toggleKnowledgeBaseFile: (filePath: string) => void
  editingNodeId: string | null
  editingName: string
  setEditingNodeId: (id: string | null) => void
  setEditingName: (name: string) => void
  renameNode: (id: string, newName: string) => void
  moveNode: (id: string, newParentId: string | null, newOrder: number) => void
}): JSX.Element {
  const children = getChildren(node.id)
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedId === node.id
  // 文件夹/根节点始终显示展开箭头，即使没有子节点
  const isExpandable = node.type === 'folder' || node.type === 'root'
  const hasVisibleChildren = children.length > 0
  const isFolder = node.type === 'folder' || node.type === 'root'

  // 文件夹勾选状态
  const folderCheckState = isFolder ? getFolderCheckState(node.id, getChildren, knowledgeBaseFiles) : 'none'

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  /** 文件夹勾选：切换该文件夹下所有文件 */
  const handleFolderCheck = (e: React.MouseEvent) => {
    e.stopPropagation()
    const filePaths = collectFilePaths(node.id, getChildren)
    const allChecked = filePaths.every((p) => knowledgeBaseFiles.includes(p))
    filePaths.forEach((p) => {
      const isChecked = knowledgeBaseFiles.includes(p)
      if (allChecked ? isChecked : !isChecked) {
        toggleKnowledgeBaseFile(p)
      }
    })
  }

  // 处理拖拽开始
  const handleDragStart = (e: React.DragEvent) => {
    if (node.type === 'root') {
      e.preventDefault()
      return
    }
    setIsDragging(true)
    e.dataTransfer.setData('text/plain', node.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  // 处理拖拽结束
  const handleDragEnd = () => {
    setIsDragging(false)
  }

  // 处理拖拽进入
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (isFolder) {
      setIsDragOver(true)
    }
  }

  // 处理拖拽离开
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  // 处理拖拽悬停
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (isFolder) {
      e.dataTransfer.dropEffect = 'move'
    }
  }

  // 处理放置
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!isFolder) return

    const draggedNodeId = e.dataTransfer.getData('text/plain')
    if (!draggedNodeId || draggedNodeId === node.id) return

    // 检查是否将文件夹拖入自己的子文件夹中（非法操作）
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = useFileStore.getState().nodes[parentId]
      if (!parent || !parent.children) return false
      if (parent.children.includes(childId)) return true
      return parent.children.some((id) => isDescendant(id, childId))
    }

    if (isDescendant(draggedNodeId, node.id)) {
      console.warn('不能将文件夹拖入其子文件夹中')
      return
    }

    // 移动节点
    moveNode(draggedNodeId, node.id, 0)
    
    // 自动展开目标文件夹
    if (!expandedIds.has(node.id)) {
      onToggle(node.id)
    }
  }

  return (
    <div>
      <div
        draggable={node.type !== 'root' && editingNodeId !== node.id}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => onClick(node)}
        onContextMenu={(e) => onContextMenu(e, node.id)}
        className={`grid gap-0 px-2 py-1.5 rounded-md text-sm transition-all duration-200 ${
          isSelected
            ? 'bg-accent/10 text-accent font-medium'
            : isDragOver
            ? 'bg-accent/20 ring-1 ring-accent/50'
            : isDragging
            ? 'opacity-50'
            : 'text-dark-100 hover:bg-dark-700 hover:text-white'
        } ${editingNodeId === node.id ? '' : 'cursor-pointer'}`}
        style={{ gridTemplateColumns: `${level * 16}px 14px 16px 16px 1fr` }}
      >
        {/* 缩进区域 */}
        <div />
        
        {/* 展开箭头区域 */}
        <div className="flex items-center justify-start">
          {isExpandable ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggle(node.id)
              }}
              className="text-dark-300 hover:text-white transition-colors p-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : null}
        </div>
        
        {/* Icon 区域 */}
        <div className="flex items-center justify-start">
          {node.type === 'file' ? (
            <FileText className="w-4 h-4 text-dark-300" />
          ) : (
            <Folder className="w-4 h-4 text-accent/70" />
          )}
        </div>
        
        {/* Checkbox 区域 */}
        <div className="flex items-center justify-start">
          {node.type === 'file' ? (
            node.path ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleKnowledgeBaseFile(normalizePath(node.path))
                }}
                className="p-0.5 rounded hover:bg-dark-600 transition-colors"
                title={knowledgeBaseFiles.includes(normalizePath(node.path)) ? '从知识库中移除' : '添加到知识库'}
              >
                {knowledgeBaseFiles.includes(normalizePath(node.path)) ? (
                  <CheckSquare className="w-3.5 h-3.5 text-accent" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-dark-400" />
                )}
              </button>
            ) : null
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleFolderCheck(e)
              }}
              className="p-0.5 rounded hover:bg-dark-600 transition-colors"
              title={folderCheckState === 'all' ? '取消勾选文件夹内所有文件' : '勾选文件夹内所有文件'}
            >
              {folderCheckState === 'all' ? (
                <CheckSquare className="w-3.5 h-3.5 text-accent" />
              ) : folderCheckState === 'partial' ? (
                <div className="w-3.5 h-3.5 border border-accent rounded flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-accent rounded-sm" />
                </div>
              ) : (
                <Square className="w-3.5 h-3.5 text-dark-400" />
              )}
            </button>
          )}
        </div>
        
        {/* 名称区域 */}
        <div className="flex items-center min-w-0">
          {editingNodeId === node.id ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => {
                if (editingName.trim()) {
                  renameNode(node.id, editingName.trim())
                }
                setEditingNodeId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (editingName.trim()) {
                    renameNode(node.id, editingName.trim())
                  }
                  setEditingNodeId(null)
                }
                if (e.key === 'Escape') {
                  setEditingNodeId(null)
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
              className="w-full px-1 py-0.5 bg-dark-700 border border-accent rounded text-sm text-dark-100 outline-none select-text"
              autoFocus
            />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
        </div>
      </div>

      {isExpanded && isExpandable && (
        <div>
          {hasVisibleChildren ? (
            children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                level={level + 1}
                expandedIds={expandedIds}
                selectedId={selectedId}
                onToggle={onToggle}
                onClick={onClick}
                onContextMenu={onContextMenu}
                getChildren={getChildren}
                knowledgeBaseFiles={knowledgeBaseFiles}
                toggleKnowledgeBaseFile={toggleKnowledgeBaseFile}
                editingNodeId={editingNodeId}
                editingName={editingName}
                setEditingNodeId={setEditingNodeId}
                setEditingName={setEditingName}
                renameNode={renameNode}
                moveNode={moveNode}
              />
            ))
          ) : (
            <div className="grid gap-0 px-2 py-1 text-xs text-dark-300" style={{ gridTemplateColumns: `${(level + 1) * 16 + 14 + 16 + 16}px 1fr` }}>
              <div />
              <span>空文件夹</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 聊天分组项
function ChatGroupItem({
  icon,
  label,
  isActive,
  onClick,
  onContextMenu,
  folderId,
  onDropSession,
  onDropExpand,
}: {
  icon: React.ReactNode
  label: string
  isActive?: boolean
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  folderId?: string
  onDropSession?: (sessionId: string, folderId: string | null) => void
  onDropExpand?: () => void
}): JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const sessionId = e.dataTransfer.getData('text/plain')
    if (sessionId && onDropSession) {
      onDropSession(sessionId, folderId || null)
      // 拖放完成后自动展开文件夹
      if (onDropExpand) {
        onDropExpand()
      }
    }
  }

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm transition-all duration-200 ${
        isActive
          ? 'bg-accent/10 text-accent'
          : isDragOver
          ? 'bg-accent/20 ring-1 ring-accent/50'
          : 'text-dark-100 hover:bg-dark-700 hover:text-white'
      }`}
    >
      <span className={isActive ? 'text-accent' : 'text-dark-300'}>{icon}</span>
      <span className="truncate flex-1">{label}</span>
    </div>
  )
}

// 聊天侧边栏组件
function ChatSidebar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const {
    chatSessions,
    chatSessionFolders,
    activeChatSessionId,
    selectedChatFolderId,
    createChatSession,
    deleteChatSession,
    switchChatSession,
    updateChatSessionTitle,
    updateChatSessionFolder,
    toggleFavoriteChatSession,
    createChatFolder,
    deleteChatFolder,
    renameChatFolder,
    getSessionsByFolder,
    getRecentSessions,
  } = useAppStore()

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'session' | 'folder'; id: string } | null>(null)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [moveSessionId, setMoveSessionId] = useState<string | null>(null)

  // 获取最近对话
  const recentSessions = getRecentSessions(10)

  // 获取当前选中的文件夹的会话
  const folderSessions = selectedChatFolderId ? getSessionsByFolder(selectedChatFolderId) : []

  // 处理新建会话
  const handleNewSession = () => {
    createChatSession('新对话', selectedChatFolderId)
  }

  // 处理新建文件夹
  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createChatFolder(newFolderName.trim())
      setNewFolderName('')
      setShowNewFolderInput(false)
    }
  }

  // 处理会话点击
  const handleSessionClick = (sessionId: string) => {
    switchChatSession(sessionId)
  }

  // 处理文件夹点击
  const handleFolderClick = (folderId: string) => {
    useAppStore.setState({ selectedChatFolderId: folderId })
  }

  // 处理右键菜单
  const handleSessionContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'session', id: sessionId })
  }

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', id: folderId })
  }

  // 关闭右键菜单
  const closeContextMenu = () => setContextMenu(null)

  // 获取右键菜单项
  const getContextMenuItems = () => {
    if (!contextMenu) return []

    if (contextMenu.type === 'session') {
      const session = chatSessions.find((s) => s.id === contextMenu.id)
      return [
        {
          id: 'rename',
          label: '重命名',
          icon: <FileText className="w-4 h-4" />,
          onClick: () => {
            setEditingSessionId(contextMenu.id)
            setEditingTitle(session?.title || '')
            closeContextMenu()
          },
        },
        {
          id: 'favorite',
          label: session?.isFavorite ? '取消收藏' : '收藏',
          icon: <Star className="w-4 h-4" />,
          onClick: () => {
            toggleFavoriteChatSession(contextMenu.id)
            closeContextMenu()
          },
        },
        {
          id: 'move',
          label: '移动到',
          icon: <Folder className="w-4 h-4" />,
          onClick: () => {
            setMoveSessionId(contextMenu.id)
            setShowMoveDialog(true)
            closeContextMenu()
          },
        },
        {
          id: 'delete',
          label: '删除',
          icon: <Trash2 className="w-4 h-4" />,
          danger: true,
          onClick: () => {
            deleteChatSession(contextMenu.id)
            closeContextMenu()
          },
        },
      ]
    } else {
      const folder = chatSessionFolders.find((f) => f.id === contextMenu.id)
      const isDefaultFolder = DEFAULT_CHAT_FOLDERS.some((f) => f.id === contextMenu.id)
      return [
        {
          id: 'rename',
          label: '重命名',
          icon: <FileText className="w-4 h-4" />,
          onClick: () => {
            setEditingFolderId(contextMenu.id)
            setEditingFolderName(folder?.name || '')
            closeContextMenu()
          },
        },
        ...(!isDefaultFolder
          ? [
              {
                id: 'delete',
                label: '删除',
                icon: <Trash2 className="w-4 h-4" />,
                danger: true,
                onClick: () => {
                  deleteChatFolder(contextMenu.id)
                  closeContextMenu()
                },
              },
            ]
          : []),
      ]
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 快捷操作 */}
      <div className="px-3 py-2 flex gap-1 border-b border-dark-500">
        <button
          onClick={handleNewSession}
          className="flex-1 flex items-center justify-center gap-1 bg-accent/20 hover:bg-accent/30 text-accent rounded-md py-1.5 text-xs font-medium transition-colors min-w-0"
          title="新对话"
        >
          <Plus className="w-3 h-3 shrink-0" />
          <span className="truncate">新对话</span>
        </button>
        <button
          onClick={() => setShowNewFolderInput(true)}
          className="flex-1 flex items-center justify-center gap-1 bg-dark-700 hover:bg-dark-600 rounded-md py-1.5 text-xs text-dark-100 transition-colors min-w-0"
          title="新建分组"
        >
          <FolderPlus className="w-3 h-3 shrink-0" />
          <span className="truncate">新建分组</span>
        </button>
      </div>

      {/* 新建文件夹输入框 */}
      {showNewFolderInput && (
        <div className="px-3 py-2 border-b border-dark-500">
          <div className="flex gap-1">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') {
                  setShowNewFolderInput(false)
                  setNewFolderName('')
                }
              }}
              placeholder="分组名称"
              className="flex-1 bg-dark-700 border border-dark-500 rounded px-2 py-1 text-xs text-dark-100 outline-none focus:border-accent"
              autoFocus
            />
            <button
              onClick={handleCreateFolder}
              className="px-2 py-1 bg-accent/20 text-accent rounded text-xs"
            >
              确定
            </button>
          </div>
        </div>
      )}

      {/* 对话分组 */}
      <div className="px-3 py-2">
        <div className="text-xs font-medium text-dark-200 uppercase tracking-wider px-1 py-2">
          对话分组
        </div>
        <div className="space-y-1">
          {chatSessionFolders.map((folder) => (
            <div key={folder.id}>
              {editingFolderId === folder.id ? (
                <input
                  type="text"
                  value={editingFolderName}
                  onChange={(e) => setEditingFolderName(e.target.value)}
                  onBlur={() => {
                    if (editingFolderName.trim()) {
                      renameChatFolder(folder.id, editingFolderName.trim())
                    }
                    setEditingFolderId(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editingFolderName.trim()) {
                        renameChatFolder(folder.id, editingFolderName.trim())
                      }
                      setEditingFolderId(null)
                    }
                    if (e.key === 'Escape') {
                      setEditingFolderId(null)
                    }
                  }}
                  className="w-full bg-dark-700 border border-accent rounded px-2 py-1.5 text-sm text-dark-100 outline-none"
                  autoFocus
                />
              ) : (
                <ChatGroupItem
                  icon={
                    folder.icon === 'Star' ? (
                      <Star className="w-4 h-4" />
                    ) : folder.icon === 'FileText' ? (
                      <FileText className="w-4 h-4" />
                    ) : (
                      <MessageSquare className="w-4 h-4" />
                    )
                  }
                  label={folder.name}
                  isActive={selectedChatFolderId === folder.id}
                  onClick={() => handleFolderClick(folder.id)}
                  onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
                  folderId={folder.id}
                  onDropSession={updateChatSessionFolder}
                  onDropExpand={() => {
                    if (selectedChatFolderId !== folder.id) {
                      handleFolderClick(folder.id)
                    }
                  }}
                />
              )}
              {/* 显示该文件夹下的会话 */}
              {selectedChatFolderId === folder.id && getSessionsByFolder(folder.id).length > 0 && (
                <div className="ml-4 mt-1 space-y-1">
                  {getSessionsByFolder(folder.id).map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isActive={activeChatSessionId === session.id}
                      isEditing={editingSessionId === session.id}
                      editingTitle={editingTitle}
                      onClick={() => handleSessionClick(session.id)}
                      onContextMenu={(e) => handleSessionContextMenu(e, session.id)}
                      onTitleChange={setEditingTitle}
                      onTitleBlur={() => {
                        if (editingTitle.trim()) {
                          updateChatSessionTitle(session.id, editingTitle.trim())
                        }
                        setEditingSessionId(null)
                      }}
                      onTitleKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editingTitle.trim()) {
                            updateChatSessionTitle(session.id, editingTitle.trim())
                          }
                          setEditingSessionId(null)
                        }
                        if (e.key === 'Escape') {
                          setEditingSessionId(null)
                        }
                      }}
                      onStartEdit={() => {
                        setEditingSessionId(session.id)
                        setEditingTitle(session.title)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 最近对话 */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="text-xs font-medium text-dark-200 uppercase tracking-wider px-1 py-2">
          最近对话
        </div>
        <div className="space-y-1">
          {recentSessions.length === 0 ? (
            <div className="text-xs text-dark-400 px-3 py-4 text-center">
              暂无对话记录
              <br />
              点击"新对话"开始聊天
            </div>
          ) : (
            recentSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={activeChatSessionId === session.id}
                isEditing={editingSessionId === session.id}
                editingTitle={editingTitle}
                onClick={() => handleSessionClick(session.id)}
                onContextMenu={(e) => handleSessionContextMenu(e, session.id)}
                onTitleChange={setEditingTitle}
                onTitleBlur={() => {
                  if (editingTitle.trim()) {
                    updateChatSessionTitle(session.id, editingTitle.trim())
                  }
                  setEditingSessionId(null)
                }}
                onTitleKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (editingTitle.trim()) {
                      updateChatSessionTitle(session.id, editingTitle.trim())
                    }
                    setEditingSessionId(null)
                  }
                  if (e.key === 'Escape') {
                    setEditingSessionId(null)
                  }
                }}
                onStartEdit={() => {
                  setEditingSessionId(session.id)
                  setEditingTitle(session.title)
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={getContextMenuItems()} onClose={closeContextMenu} />
      )}

      {/* 移动到对话框 */}
      {showMoveDialog && moveSessionId && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="bg-dark-800 border border-dark-500 rounded-lg shadow-xl w-80 max-w-[90vw]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-500">
              <h3 className="text-sm font-medium text-white">选择目标分组</h3>
              <button
                onClick={() => {
                  setShowMoveDialog(false)
                  setMoveSessionId(null)
                }}
                className="text-dark-300 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto">
              {/* 根目录选项 */}
              <button
                onClick={() => {
                  updateChatSessionFolder(moveSessionId, null)
                  setShowMoveDialog(false)
                  setMoveSessionId(null)
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-dark-100 hover:bg-dark-700 hover:text-white transition-colors text-left"
              >
                <FolderOpen className="w-4 h-4 text-dark-300" />
                <span>根目录</span>
              </button>

              {/* 分隔线 */}
              <div className="my-2 border-t border-dark-500" />

              {/* 文件夹列表 */}
              {chatSessionFolders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => {
                    updateChatSessionFolder(moveSessionId, folder.id)
                    setShowMoveDialog(false)
                    setMoveSessionId(null)
                    // 自动展开目标文件夹
                    if (selectedChatFolderId !== folder.id) {
                      handleFolderClick(folder.id)
                    }
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-dark-100 hover:bg-dark-700 hover:text-white transition-colors text-left"
                >
                  {folder.icon === 'Star' ? (
                    <Star className="w-4 h-4 text-yellow-400" />
                  ) : folder.icon === 'FileText' ? (
                    <FileText className="w-4 h-4 text-accent" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-dark-300" />
                  )}
                  <span>{folder.name}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-dark-500">
              <button
                onClick={() => {
                  setShowMoveDialog(false)
                  setMoveSessionId(null)
                }}
                className="px-3 py-1.5 text-xs text-dark-200 hover:text-white transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 会话项组件
function SessionItem({
  session,
  isActive,
  isEditing,
  editingTitle,
  onClick,
  onContextMenu,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  onStartEdit,
}: {
  session: ChatSession
  isActive: boolean
  isEditing: boolean
  editingTitle: string
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onTitleChange: (title: string) => void
  onTitleBlur: () => void
  onTitleKeyDown: (e: React.KeyboardEvent) => void
  onStartEdit: () => void
}): JSX.Element {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    e.dataTransfer.setData('text/plain', session.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }

  if (isEditing) {
    return (
      <input
        type="text"
        value={editingTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onTitleBlur}
        onKeyDown={onTitleKeyDown}
        className="w-full bg-dark-700 border border-accent rounded px-2 py-1.5 text-sm text-dark-100 outline-none"
        autoFocus
      />
    )
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-all duration-200 ${
        isActive ? 'bg-accent/10 text-accent' : 'text-dark-100 hover:bg-dark-700 hover:text-white'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <MessageSquare className={`w-4 h-4 shrink-0 ${isActive ? 'text-accent' : 'text-dark-300'}`} />
      <span className="truncate flex-1">{session.title}</span>
      {session.isFavorite && <Star className="w-3 h-3 text-yellow-400 shrink-0" />}
    </div>
  )
}

// 文件树拖放区域组件 - 支持将节点拖出到根目录
interface FileTreeDropZoneProps {
  roots: FileNode[]
  getChildren: (parentId: string | null) => FileNode[]
  expandedIds: Set<string>
  selectedId: string | null
  onToggle: (id: string) => void
  onClick: (node: FileNode) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  knowledgeBaseFiles: string[]
  toggleKnowledgeBaseFile: (filePath: string) => void
  editingNodeId: string | null
  editingName: string
  setEditingNodeId: (id: string | null) => void
  setEditingName: (name: string) => void
  renameNode: (id: string, newName: string) => void
  moveNode: (id: string, newParentId: string | null, newOrder: number) => void
  onBlankClick?: () => void
}

function FileTreeDropZone({
  roots,
  getChildren,
  expandedIds,
  selectedId,
  onToggle,
  onClick,
  onContextMenu,
  knowledgeBaseFiles,
  toggleKnowledgeBaseFile,
  editingNodeId,
  editingName,
  setEditingNodeId,
  setEditingName,
  renameNode,
  moveNode,
  onBlankClick,
}: FileTreeDropZoneProps): JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    // 检查是否真的离开了容器（而不是进入了子元素）
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const draggedNodeId = e.dataTransfer.getData('text/plain')
    if (!draggedNodeId) return

    // 获取被拖拽的节点
    const draggedNode = useFileStore.getState().nodes[draggedNodeId]
    if (!draggedNode) return

    // 如果已经在根目录，不需要移动
    if (!draggedNode.parentId || draggedNode.parentId === 'root1') {
      return
    }

    // 移动到根目录
    moveNode(draggedNodeId, 'root1', 0)
  }

  const handleClick = (e: React.MouseEvent) => {
    // 如果点击的是空白区域（不是子元素），触发取消选择
    if (e.target === e.currentTarget && onBlankClick) {
      onBlankClick()
    }
  }

  return (
    <div
      className="flex-1 overflow-y-auto px-2 pb-2"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      {roots.flatMap((root) => {
        const children = getChildren(root.id);
        const folders = children.filter(c => c.type === 'folder');
        const files = children.filter(c => c.type === 'file');
        const items: React.ReactNode[] = [];
        
        // 渲染文件夹
        folders.forEach((child) => {
          items.push(
            <TreeNode
              key={`folder-${child.id}`}
              node={child}
              level={0}
              expandedIds={expandedIds}
              selectedId={selectedId}
              onToggle={onToggle}
              onClick={onClick}
              onContextMenu={onContextMenu}
              getChildren={getChildren}
              knowledgeBaseFiles={knowledgeBaseFiles}
              toggleKnowledgeBaseFile={toggleKnowledgeBaseFile}
              editingNodeId={editingNodeId}
              editingName={editingName}
              setEditingNodeId={setEditingNodeId}
              setEditingName={setEditingName}
              renameNode={renameNode}
              moveNode={moveNode}
            />
          );
        });
        
        // 文件夹和未归类文件之间的间距
        if (folders.length > 0 && files.length > 0) {
          items.push(<div key={`gap-${root.id}`} className="h-2" />);
        }
        
        // 渲染未归类文件
        files.forEach((child) => {
          items.push(
            <TreeNode
              key={`file-${child.id}`}
              node={child}
              level={0}
              expandedIds={expandedIds}
              selectedId={selectedId}
              onToggle={onToggle}
              onClick={onClick}
              onContextMenu={onContextMenu}
              getChildren={getChildren}
              knowledgeBaseFiles={knowledgeBaseFiles}
              toggleKnowledgeBaseFile={toggleKnowledgeBaseFile}
              editingNodeId={editingNodeId}
              editingName={editingName}
              setEditingNodeId={setEditingNodeId}
              setEditingName={setEditingName}
              renameNode={renameNode}
              moveNode={moveNode}
            />
          );
        });
        
        return items;
      })}
      {/* 空状态提示 */}
      {roots.flatMap((root) => getChildren(root.id)).length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-dark-400 text-xs">
          <FolderOpen className="w-8 h-8 mb-2 opacity-50" />
          <span>暂无文件</span>
          <span className="text-dark-500 mt-1">拖拽文件到此处</span>
        </div>
      )}
    </div>
  )
}
