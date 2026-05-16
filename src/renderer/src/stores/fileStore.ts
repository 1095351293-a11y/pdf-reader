import { create } from 'zustand'

export interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder' | 'root'
  path?: string
  parentId: string | null
  children?: string[]
  isExpanded?: boolean
  isDeleted?: boolean
  deletedAt?: number
  sortOrder: number
  createdAt: number
}

interface FileState {
  nodes: Record<string, FileNode>
  rootIds: string[]
  searchQuery: string
  selectedId: string | null
  expandedIds: Set<string>
  loaded: boolean

  // 操作
  addNode: (node: FileNode) => void
  removeNode: (id: string) => void
  renameNode: (id: string, newName: string) => void
  moveNode: (id: string, newParentId: string | null, newOrder: number) => void
  toggleExpanded: (id: string) => void
  setSelected: (id: string | null) => void
  setSearchQuery: (query: string) => void

  // 回收站
  restoreNode: (id: string) => void
  permanentlyDelete: (id: string) => void
  emptyTrash: () => void

  // 持久化
  loadFromDB: () => Promise<void>

  // 派生数据
  getChildren: (parentId: string | null) => FileNode[]
  getTrashItems: () => FileNode[]
  getSearchResults: () => FileNode[]
}

// 默认初始数据（数据库为空时使用）
const DEFAULT_NODES: Record<string, FileNode> = {
  root1: {
    id: 'root1',
    name: '我的资料库',
    type: 'root',
    parentId: null,
    children: ['folder1', 'folder2', 'folder3'],
    isExpanded: true,
    sortOrder: 0,
    createdAt: Date.now(),
  },
  folder1: {
    id: 'folder1',
    name: '学术论文',
    type: 'folder',
    parentId: 'root1',
    children: [],
    isExpanded: false,
    sortOrder: 0,
    createdAt: Date.now(),
  },
  folder2: {
    id: 'folder2',
    name: '技术文档',
    type: 'folder',
    parentId: 'root1',
    children: [],
    isExpanded: false,
    sortOrder: 1,
    createdAt: Date.now(),
  },
  folder3: {
    id: 'folder3',
    name: '电子书籍',
    type: 'folder',
    parentId: 'root1',
    children: [],
    isExpanded: false,
    sortOrder: 2,
    createdAt: Date.now(),
  },
}

export const useFileStore = create<FileState>((set, get) => ({
  nodes: {},
  rootIds: [],
  searchQuery: '',
  selectedId: null,
  expandedIds: new Set<string>(),
  loaded: false,

  addNode: (node) => {
    set((state) => {
      const newNodes = { ...state.nodes, [node.id]: node }
      if (node.parentId) {
        const parent = newNodes[node.parentId]
        if (parent && parent.children) {
          parent.children = [...parent.children, node.id]
        }
      }
      return { nodes: newNodes }
    })
    // 计算 sortOrder：如果有同父节点的其他子节点，则取最大值 + 1
    const siblings = Object.values(get().nodes).filter(
      (n) => n.parentId === node.parentId && !n.isDeleted && n.id !== node.id
    )
    const maxSortOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) : -1
    const finalSortOrder = maxSortOrder + 1

    // 更新节点的 sortOrder
    set((state) => ({
      nodes: {
        ...state.nodes,
        [node.id]: { ...state.nodes[node.id], sortOrder: finalSortOrder },
      },
    }))

    // 同步写入 SQLite
    window.api?.file?.add?.({
      id: node.id,
      name: node.name,
      type: node.type,
      path: node.path || null,
      parentId: node.parentId || null,
      sortOrder: finalSortOrder,
    })
  },

  removeNode: (id) => {
    set((state) => {
      const node = state.nodes[id]
      if (!node) return state
      const newNodes = { ...state.nodes }
      newNodes[id] = { ...node, isDeleted: true, deletedAt: Date.now() }
      return { nodes: newNodes }
    })
    // 同步写入 SQLite
    window.api?.file?.delete?.(id)
  },

  renameNode: (id, newName) => {
    set((state) => ({
      nodes: {
        ...state.nodes,
        [id]: { ...state.nodes[id], name: newName },
      },
    }))
    // 同步写入 SQLite
    window.api?.file?.rename?.({ id, name: newName })
  },

  moveNode: (id, newParentId, newOrder) => {
    let finalSortOrder = newOrder
    set((state) => {
      const node = state.nodes[id]
      if (!node) return state

      const newNodes = { ...state.nodes }
      
      // 从旧父节点移除
      if (node.parentId) {
        const oldParent = newNodes[node.parentId]
        if (oldParent?.children) {
          oldParent.children = oldParent.children.filter((cid) => cid !== id)
        }
      }
      
      // 计算正确的 sortOrder：如果有同父子节点，取最大值 + 1
      const siblings = Object.values(newNodes).filter(
        (n) => n.parentId === newParentId && !n.isDeleted && n.id !== id
      )
      const maxSortOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) : -1
      finalSortOrder = newOrder === 0 ? maxSortOrder + 1 : newOrder
      
      // 添加到新父节点
      if (newParentId) {
        const newParent = newNodes[newParentId]
        if (newParent?.children) {
          newParent.children = [...newParent.children, id]
        }
      }
      newNodes[id] = { ...node, parentId: newParentId, sortOrder: finalSortOrder }
      return { nodes: newNodes }
    })
    
    // 同步写入 SQLite
    window.api?.file?.move?.({ id, parentId: newParentId, sortOrder: finalSortOrder })
  },

  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedIds: next }
    }),

  expand: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds)
      next.add(id)
      return { expandedIds: next }
    }),

  setSelected: (id) => set({ selectedId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  restoreNode: (id) => {
    set((state) => ({
      nodes: {
        ...state.nodes,
        [id]: { ...state.nodes[id], isDeleted: false, deletedAt: undefined },
      },
    }))
    // 同步写入 SQLite
    window.api?.file?.restore?.(id)
  },

  permanentlyDelete: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.nodes
      return { nodes: rest }
    })
    // 同步写入 SQLite
    window.api?.file?.permanentDelete?.(id)
  },

  emptyTrash: () =>
    set((state) => {
      const newNodes: Record<string, FileNode> = {}
      const toDelete: string[] = []
      for (const [key, node] of Object.entries(state.nodes)) {
        if (!node.isDeleted) newNodes[key] = node
        else toDelete.push(key)
      }
      // 同步删除 SQLite 中的记录
      toDelete.forEach((id) => window.api?.file?.permanentDelete?.(id))
      return { nodes: newNodes }
    }),

  // 从 SQLite 加载文件树
  loadFromDB: async () => {
    try {
      const rows = await window.api?.file?.getTree?.()
      if (!rows || rows.length === 0) {
        // 数据库为空，使用默认数据并初始化
        const rootIds: string[] = []
        const nodes: Record<string, FileNode> = {}
        for (const node of Object.values(DEFAULT_NODES)) {
          nodes[node.id] = node
          if (!node.parentId) rootIds.push(node.id)
          // 将默认数据写入 SQLite
          window.api?.file?.add?.({
            id: node.id,
            name: node.name,
            type: node.type,
            path: node.path || null,
            parentId: node.parentId || null,
            sortOrder: node.sortOrder || 0,
          })
        }
        set({ nodes, rootIds, expandedIds: new Set(['root1']), loaded: true })
        return
      }

      // 从数据库行构建 nodes 和 rootIds
      const nodes: Record<string, FileNode> = {}
      const rootIds: string[] = []
      const expandedIds = new Set<string>()

      for (const row of rows) {
        const node: FileNode = {
          id: row.id,
          name: row.name,
          type: row.type,
          path: row.path || undefined,
          parentId: row.parent_id || null,
          sortOrder: row.sort_order || 0,
          createdAt: row.created_at || Date.now(),
          isExpanded: false,
          children: [],
        }
        nodes[row.id] = node
        if (!row.parent_id) rootIds.push(row.id)
      }

      // 构建 children 关系
      for (const node of Object.values(nodes)) {
        if (node.parentId && nodes[node.parentId]) {
          const parent = nodes[node.parentId]
          if (!parent.children) parent.children = []
          parent.children.push(node.id)
        }
      }

      // 默认展开根节点
      rootIds.forEach((id) => expandedIds.add(id))

      set({ nodes, rootIds, expandedIds, loaded: true })
    } catch (err) {
      console.error('从数据库加载文件树失败:', err)
      // 失败时使用默认数据
      set({ nodes: DEFAULT_NODES, rootIds: ['root1'], expandedIds: new Set(['root1']), loaded: true })
    }
  },

  getChildren: (parentId) => {
    const state = get()
    return Object.values(state.nodes)
      .filter((n) => n.parentId === parentId && !n.isDeleted)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  },

  getTrashItems: () => {
    const state = get()
    return Object.values(state.nodes).filter((n) => n.isDeleted)
  },

  getSearchResults: () => {
    const state = get()
    if (!state.searchQuery.trim()) return []
    const q = state.searchQuery.toLowerCase()
    return Object.values(state.nodes).filter(
      (n) => !n.isDeleted && n.name.toLowerCase().includes(q)
    )
  },
}))
