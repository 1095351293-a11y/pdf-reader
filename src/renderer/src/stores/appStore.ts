import { create } from 'zustand'
import type { Citation, CitationFormat, ModelConfig, ModelCategory, ChatModelConfig, EmbeddingModelConfig, VisionModelConfig, ChatSession, ChatSessionFolder } from '../types'
import { DEFAULT_CHAT_FOLDERS } from '../types'

export interface TabItem {
  id: string
  title: string
  filePath?: string
  pageNumber?: number
  totalPages?: number
  scale?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: Attachment[]
  pageRef?: number
  timestamp: number
}

export interface Attachment {
  id: string
  type: 'page' | 'range' | 'screenshot' | 'selection'
  label: string
  data: string // base64 或路径
  pageNumbers?: number[]
}

export interface Annotation {
  id: string
  pageIndex: number
  text: string
  color: string
  rects: { x: number; y: number; width: number; height: number }[]
  note: string // 批注文字
  timestamp: number
}

interface AppState {
  // 加载状态
  chatSessionsLoaded: boolean
  setChatSessionsLoaded: (loaded: boolean) => void

  // 标签页管理
  tabs: TabItem[]
  activeTabId: string | null
  addTab: (tab: TabItem) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, patch: Partial<TabItem>) => void

  // AI 对话
  messages: ChatMessage[]
  addMessage: (msg: ChatMessage) => void
  clearMessages: () => void
  setMessages: (messages: ChatMessage[]) => void

  // 附件（工具栏触发，ChatPanel 消费）
  pendingAttachment: Attachment | null
  setPendingAttachment: (att: Attachment | null) => void

  // 批注
  annotations: Annotation[]
  addAnnotation: (ann: Annotation) => void
  removeAnnotation: (id: string) => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  highlightMode: boolean
  toggleHighlightMode: () => void

  // 翻译面板
  translatePanelVisible: boolean
  translateExpanded: boolean
  translateSourceText: string
  translateResult: string
  translateLoading: boolean
  translateRealtime: boolean
  translateModelId: string | null
  _translateRequestId: number
  toggleTranslatePanel: () => void
  setTranslateExpanded: (expanded: boolean) => void
  setTranslateSourceText: (text: string) => void
  setTranslateResult: (result: string) => void
  setTranslateLoading: (loading: boolean) => void
  setTranslateRealtime: (on: boolean) => void
  setTranslateModelId: (id: string | null) => void
  startTranslate: (text: string) => void

  // UI 状态
  sidebarVisible: boolean
  chatPanelVisible: boolean
  toolbarVisible: boolean
  immersiveMode: boolean
  toggleSidebar: () => void
  toggleChatPanel: () => void
  toggleToolbar: () => void
  toggleImmersive: () => void
  exitImmersive: () => void

  // 视图模式
  viewMode: 'reader' | 'chat'
  setViewMode: (mode: 'reader' | 'chat') => void

  // PDF 全文上下文
  pdfFullText: string
  setPdfFullText: (text: string) => void

  // RAG 索引状态
  ragIndexStatus: { hasIndex: boolean; totalChunks: number; embeddedChunks: number } | null
  setRagIndexStatus: (status: { hasIndex: boolean; totalChunks: number; embeddedChunks: number } | null) => void
  ragIndexing: boolean
  setRagIndexing: (indexing: boolean) => void

  // RAG 和 Rerank 模型选择
  ragModelId: string | null
  setRagModelId: (id: string | null) => void
  rerankerModelId: string | null
  setRerankerModelId: (id: string | null) => void

  // 其他功能模型选择
  ocrModelId: string | null
  setOcrModelId: (id: string | null) => void
  translateModelId: string | null
  setTranslateModelId: (id: string | null) => void
  tocModelId: string | null
  setTocModelId: (id: string | null) => void

  // 联网搜索 API Key
  webSearchApiKey: string
  setWebSearchApiKey: (apiKey: string) => void

  // 论文引用管理
  citations: Citation[]
  addCitation: (citation: Omit<Citation, 'id' | 'createdAt' | 'updatedAt'>) => string
  removeCitation: (id: string) => void
  updateCitation: (id: string, patch: Partial<Citation>) => void
  getCitationsByPdfId: (pdfId: string) => Citation[]
  getCitationById: (id: string) => Citation | undefined
  defaultCitationFormat: CitationFormat
  setDefaultCitationFormat: (format: CitationFormat) => void
  citationPanelVisible: boolean
  toggleCitationPanel: () => void
  citationPanelWidth: number
  setCitationPanelWidth: (width: number) => void

  // 知识库选择（用于AI检索）
  knowledgeBaseFiles: string[] // 选中的文件路径列表
  toggleKnowledgeBaseFile: (filePath: string) => void
  setKnowledgeBaseFiles: (files: string[]) => void
  isFileInKnowledgeBase: (filePath: string) => boolean

  // 模型配置管理（新）
  modelConfigs: ModelConfig[]
  addModelConfig: (config: Omit<ModelConfig, 'id'>) => string
  removeModelConfig: (id: string) => void
  updateModelConfig: (id: string, patch: Partial<ModelConfig>) => void
  getModelConfigsByCategory: (category: ModelCategory) => ModelConfig[]
  getDefaultModelConfig: (category: ModelCategory) => ModelConfig | undefined
  setDefaultModelConfig: (id: string) => void
  
  // 当前使用的模型配置ID
  currentChatModelId: string | null
  currentEmbeddingModelId: string | null
  currentVisionModelId: string | null
  setCurrentModelId: (category: ModelCategory, id: string | null) => void

  // 聊天会话管理
  chatSessions: ChatSession[]
  chatSessionFolders: ChatSessionFolder[]
  activeChatSessionId: string | null
  selectedChatFolderId: string | null
  createChatSession: (title?: string, folderId?: string | null, pdfId?: string, pdfFilePath?: string) => string
  deleteChatSession: (id: string) => void
  switchChatSession: (id: string) => void
  updateChatSessionTitle: (id: string, title: string) => void
  updateChatSessionFolder: (sessionId: string, folderId: string | null) => void
  toggleFavoriteChatSession: (id: string) => void
  addMessageToSession: (sessionId: string, msg: ChatMessage) => void
  createChatFolder: (name: string) => string
  deleteChatFolder: (id: string) => void
  renameChatFolder: (id: string, name: string) => void
  getSessionsByFolder: (folderId: string | null) => ChatSession[]
  getRecentSessions: (limit?: number) => ChatSession[]

  // 持久化
  loadTabsFromDB: () => Promise<void>
  loadTranslateModelId: () => Promise<void>
  loadCitationsFromDB: () => Promise<void>
  saveCitationsToDB: () => Promise<void>
  loadModelConfigsFromDB: () => Promise<void>
  saveModelConfigsToDB: () => Promise<void>
  loadChatSessionsFromDB: () => Promise<void>
  saveChatSessionsToDB: () => Promise<void>
}

// 从 localStorage 加载模型ID
const loadModelIdFromStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// 从 localStorage 加载字符串
const loadFromStorage = (key: string, defaultValue: string): string => {
  try {
    return localStorage.getItem(key) || defaultValue
  } catch {
    return defaultValue
  }
}

export const useAppStore = create<AppState>((set) => ({
  chatSessionsLoaded: false,
  setChatSessionsLoaded: (loaded) => set({ chatSessionsLoaded: loaded }),
  
  tabs: [],
  activeTabId: null,
  addTab: (tab) =>
    set((state) => {
      const exists = state.tabs.find((t) => t.id === tab.id)
      if (exists) return { activeTabId: tab.id }
      const newTabs = [...state.tabs, tab]
      // 持久化标签页
      persistTabs(newTabs, tab.id)
      return { tabs: newTabs, activeTabId: tab.id }
    }),
  removeTab: (id) =>
    set((state) => {
      // 1. 找到要关闭的 tab
      const tabToRemove = state.tabs.find((t) => t.id === id)
      
      // 2. 从知识库中移除（如果存在）
      if (tabToRemove?.filePath) {
        const normalizedPath = tabToRemove.filePath.replace(/\\/g, '/').toLowerCase()
        if (state.knowledgeBaseFiles.includes(normalizedPath)) {
          const newKnowledgeBaseFiles = state.knowledgeBaseFiles.filter(
            (f) => f !== normalizedPath
          )
          console.log(`[RAG] 关闭 PDF，从知识库移除: ${normalizedPath}`)
          set({ knowledgeBaseFiles: newKnowledgeBaseFiles })
        }
      }
      
      // 3. 移除 tab
      const newTabs = state.tabs.filter((t) => t.id !== id)
      let newActiveId = state.activeTabId
      if (state.activeTabId === id) {
        newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null
      }
      persistTabs(newTabs, newActiveId)
      return { tabs: newTabs, activeTabId: newActiveId }
    }),
  setActiveTab: (id) => {
    set({ activeTabId: id })
    persistTabs(useAppStore.getState().tabs, id)
  },
  updateTab: (id, patch) =>
    set((state) => {
      const newTabs = state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
      persistTabs(newTabs, state.activeTabId)
      return { tabs: newTabs }
    }),

  messages: [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '你好！我是你的 AI 阅读助手，具备以下能力：\n\n📄 **文档搜索** - 在 PDF 中搜索相关内容\n📝 **文档总结** - 总结文档主要内容\n📖 **获取页面** - 获取指定页码的内容\n🌐 **联网搜索** - 搜索实时信息（天气、股价、新闻等）\n\n打开 PDF 后，你可以直接向我提问，我会自动选择合适的工具来回答你！',
      timestamp: Date.now(),
    },
  ],
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  clearMessages: () => set({ messages: [] }),
  setMessages: (messages) => set({ messages }),

  pendingAttachment: null,
  setPendingAttachment: (att) => set({ pendingAttachment: att }),

  annotations: [],
  addAnnotation: (ann) => set((state) => ({ annotations: [...state.annotations, ann] })),
  removeAnnotation: (id) => set((state) => ({ annotations: state.annotations.filter((a) => a.id !== id) })),
  updateAnnotation: (id, patch) => set((state) => ({
    annotations: state.annotations.map((a) => a.id === id ? { ...a, ...patch } : a),
  })),
  highlightMode: false,
  toggleHighlightMode: () => set((state) => ({ highlightMode: !state.highlightMode })),

  translatePanelVisible: true,
  translateExpanded: false,
  translateSourceText: '',
  translateResult: '',
  translateLoading: false,
  translateRealtime: false,
  translateModelId: null,
  _translateRequestId: 0,
  toggleTranslatePanel: () => set((state) => ({ translatePanelVisible: !state.translatePanelVisible })),
  setTranslateExpanded: (expanded) => set({ translateExpanded: expanded }),
  setTranslateSourceText: (text) => set({ translateSourceText: text }),
  setTranslateResult: (result) => set({ translateResult: result }),
  setTranslateLoading: (loading) => set({ translateLoading: loading }),
  setTranslateRealtime: (on) => set({ translateRealtime: on }),
  setTranslateModelId: (id) => {
    set({ translateModelId: id })
    // 持久化到 SQLite
    try {
      window.api?.appSettings?.set?.('translate_model_id', id || '')
    } catch {}
  },
  startTranslate: (text) => set({ translatePanelVisible: true, translateExpanded: true, translateSourceText: text, translateResult: '', translateLoading: true, _translateRequestId: Date.now() }),

  sidebarVisible: true,
  chatPanelVisible: true,
  toolbarVisible: true,
  immersiveMode: false,
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleChatPanel: () => set((state) => ({ chatPanelVisible: !state.chatPanelVisible })),
  toggleToolbar: () => set((state) => ({ toolbarVisible: !state.toolbarVisible })),
  toggleImmersive: () =>
    set({
      immersiveMode: true,
      sidebarVisible: false,
      chatPanelVisible: false,
      toolbarVisible: false,
    }),
  exitImmersive: () =>
    set({
      immersiveMode: false,
      sidebarVisible: true,
      chatPanelVisible: true,
      toolbarVisible: true,
    }),

  viewMode: 'reader',
  setViewMode: (mode) => set({ viewMode: mode }),

  pdfFullText: '',
  setPdfFullText: (text) => set({ pdfFullText: text }),

  ragIndexStatus: null,
  setRagIndexStatus: (status) => set({ ragIndexStatus: status }),
  ragIndexing: false,
  setRagIndexing: (indexing) => set({ ragIndexing: indexing }),

  // RAG 和 Rerank 模型选择
  ragModelId: loadModelIdFromStorage('ragModelId'),
  setRagModelId: (id) => {
    set({ ragModelId: id })
    try {
      if (id) localStorage.setItem('ragModelId', id)
      else localStorage.removeItem('ragModelId')
    } catch {}
  },
  rerankerModelId: loadModelIdFromStorage('rerankerModelId'),
  setRerankerModelId: (id) => {
    set({ rerankerModelId: id })
    try {
      if (id) localStorage.setItem('rerankerModelId', id)
      else localStorage.removeItem('rerankerModelId')
    } catch {}
  },

  // 其他功能模型选择
  ocrModelId: loadModelIdFromStorage('ocrModelId'),
  setOcrModelId: (id) => {
    set({ ocrModelId: id })
    try {
      if (id) localStorage.setItem('ocrModelId', id)
      else localStorage.removeItem('ocrModelId')
    } catch {}
  },
  translateModelId: loadModelIdFromStorage('translateModelId'),
  setTranslateModelId: (id) => {
    set({ translateModelId: id })
    try {
      if (id) localStorage.setItem('translateModelId', id)
      else localStorage.removeItem('translateModelId')
    } catch {}
  },
  tocModelId: loadModelIdFromStorage('tocModelId'),
  setTocModelId: (id) => {
    set({ tocModelId: id })
    try {
      if (id) localStorage.setItem('tocModelId', id)
      else localStorage.removeItem('tocModelId')
    } catch {}
  },

  // 联网搜索 API Key
  webSearchApiKey: loadFromStorage('webSearchApiKey', ''),
  setWebSearchApiKey: (apiKey) => {
    set({ webSearchApiKey: apiKey })
    try {
      localStorage.setItem('webSearchApiKey', apiKey)
    } catch {}
  },

  // 论文引用管理
  citations: [],
  addCitation: (citationData) => {
    const id = `cite-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()
    const newCitation: Citation = {
      ...citationData,
      id,
      createdAt: now,
      updatedAt: now,
    }
    set((state) => {
      const newCitations = [...state.citations, newCitation]
      // 异步保存到数据库
      setTimeout(() => useAppStore.getState().saveCitationsToDB(), 0)
      return { citations: newCitations }
    })
    return id
  },
  removeCitation: (id) =>
    set((state) => {
      const newCitations = state.citations.filter((c) => c.id !== id)
      setTimeout(() => useAppStore.getState().saveCitationsToDB(), 0)
      return { citations: newCitations }
    }),
  updateCitation: (id, patch) =>
    set((state) => {
      const newCitations = state.citations.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c
      )
      setTimeout(() => useAppStore.getState().saveCitationsToDB(), 0)
      return { citations: newCitations }
    }),
  getCitationsByPdfId: (pdfId) => {
    return useAppStore.getState().citations.filter((c) => c.pdfId === pdfId)
  },
  getCitationById: (id) => {
    return useAppStore.getState().citations.find((c) => c.id === id)
  },
  defaultCitationFormat: 'gb7714',
  setDefaultCitationFormat: (format) => {
    set({ defaultCitationFormat: format })
    try {
      window.api?.appSettings?.set?.('default_citation_format', format)
    } catch {}
  },
  citationPanelVisible: false,
  toggleCitationPanel: () => set((state) => ({ citationPanelVisible: !state.citationPanelVisible })),
  citationPanelWidth: 320,
  setCitationPanelWidth: (width) => set({ citationPanelWidth: width }),

  // 知识库选择
  knowledgeBaseFiles: [],
  toggleKnowledgeBaseFile: (filePath) =>
    set((state) => {
      // 标准化路径
      const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
      const exists = state.knowledgeBaseFiles.includes(normalizedPath)
      const newFiles = exists
        ? state.knowledgeBaseFiles.filter((f) => f !== normalizedPath)
        : [...state.knowledgeBaseFiles, normalizedPath]
      return { knowledgeBaseFiles: newFiles }
    }),
  setKnowledgeBaseFiles: (files) =>
    set({
      knowledgeBaseFiles: files.map((f) => f.replace(/\\/g, '/').toLowerCase()),
    }),
  isFileInKnowledgeBase: (filePath) => {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
    return useAppStore.getState().knowledgeBaseFiles.includes(normalizedPath)
  },

  // 模型配置管理（新）
  modelConfigs: [],
  addModelConfig: (configData) => {
    const id = `model-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newConfig: ModelConfig = { ...configData, id } as ModelConfig
    set((state) => {
      const newConfigs = [...state.modelConfigs, newConfig]
      return { modelConfigs: newConfigs }
    })
    setTimeout(() => useAppStore.getState().saveModelConfigsToDB(), 0)
    return id
  },
  removeModelConfig: (id) => {
    set((state) => ({
      modelConfigs: state.modelConfigs.filter((c) => c.id !== id),
    }))
    setTimeout(() => useAppStore.getState().saveModelConfigsToDB(), 0)
  },
  updateModelConfig: (id, patch) => {
    set((state) => ({
      modelConfigs: state.modelConfigs.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    }))
    setTimeout(() => useAppStore.getState().saveModelConfigsToDB(), 0)
  },
  getModelConfigsByCategory: (category) => {
    return useAppStore.getState().modelConfigs.filter((c) => c.category === category)
  },
  getDefaultModelConfig: (category) => {
    return useAppStore
      .getState()
      .modelConfigs.find((c) => c.category === category && c.isDefault)
  },
  setDefaultModelConfig: (id) => {
    set((state) => {
      const config = state.modelConfigs.find((c) => c.id === id)
      if (!config) return state
      return {
        modelConfigs: state.modelConfigs.map((c) =>
          c.category === config.category ? { ...c, isDefault: c.id === id } : c
        ),
      }
    })
    setTimeout(() => useAppStore.getState().saveModelConfigsToDB(), 0)
  },
  currentChatModelId: null,
  currentEmbeddingModelId: null,
  currentVisionModelId: null,
  setCurrentModelId: (category, id) => {
    switch (category) {
      case 'chat':
        set({ currentChatModelId: id })
        break
      case 'embedding':
        set({ currentEmbeddingModelId: id })
        break
      case 'vision':
        set({ currentVisionModelId: id })
        break
    }
    // 持久化当前选中的模型ID
    try {
      window.api?.appSettings?.set?.(`current_model_${category}`, id || '')
    } catch {}
  },

  loadTabsFromDB: async () => {
    try {
      const data = await window.api?.appSettings?.get?.('open_tabs')
      if (data) {
        const parsed = JSON.parse(data)
        if (parsed.tabs && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          set({ tabs: parsed.tabs, activeTabId: parsed.activeTabId || null })
        }
      }
    } catch (err) {
      console.error('加载标签页失败:', err)
    }
  },
  loadTranslateModelId: async () => {
    try {
      const data = await window.api?.appSettings?.get?.('translate_model_id')
      if (data) {
        set({ translateModelId: data })
      }
    } catch (err) {
      console.error('加载翻译模型设置失败:', err)
    }
  },

  loadCitationsFromDB: async () => {
    try {
      const data = await window.api?.appSettings?.get?.('citations')
      if (data) {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) {
          set({ citations: parsed })
        }
      }
      // 加载默认引用格式
      const formatData = await window.api?.appSettings?.get?.('default_citation_format')
      if (formatData) {
        set({ defaultCitationFormat: formatData as CitationFormat })
      }
    } catch (err) {
      console.error('加载引用数据失败:', err)
    }
  },

  saveCitationsToDB: async () => {
    try {
      const citations = useAppStore.getState().citations
      await window.api?.appSettings?.set?.('citations', JSON.stringify(citations))
    } catch (err) {
      console.error('保存引用数据失败:', err)
    }
  },

  loadModelConfigsFromDB: async () => {
    try {
      // 首先尝试加载新的模型配置格式
      const data = await window.api?.appSettings?.get?.('model_configs')
      if (data) {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) {
          set({ modelConfigs: parsed })
        }
      }
      
      // 如果没有新的模型配置，尝试从旧的AI配置迁移
      const currentConfigs = useAppStore.getState().modelConfigs
      if (currentConfigs.length === 0) {
        const oldData = await window.api?.appSettings?.get?.('ai_configs')
        if (oldData) {
          try {
            const oldConfigs = JSON.parse(oldData)
            if (Array.isArray(oldConfigs) && oldConfigs.length > 0) {
              console.log('发现旧的AI配置，正在迁移到新格式...')
              // 将旧配置转换为新的ModelConfig格式
              const newConfigs = oldConfigs.map((oldConfig: any) => {
                const now = Date.now()
                // 根据模型类型分配默认文件夹
                let folderId = 'folder-text' // 默认文本生成模型文件夹
                if (oldConfig.embeddingModel) {
                  folderId = 'folder-vision' // 有embedding模型的放到视觉模型文件夹
                }
                
                return {
                  id: `model-${now}-${Math.random().toString(36).substr(2, 9)}`,
                  folderId,
                  name: oldConfig.name || oldConfig.model,
                  provider: oldConfig.provider,
                  apiKey: oldConfig.apiKey,
                  baseUrl: oldConfig.baseUrl,
                  model: oldConfig.model,
                  temperature: oldConfig.temperature,
                  maxTokens: oldConfig.maxTokens,
                  isDefault: oldConfig.isDefault,
                  createdAt: now,
                  updatedAt: now,
                }
              })
              
              // 确保至少有一个默认模型
              const hasDefault = newConfigs.some((c: any) => c.isDefault)
              if (!hasDefault && newConfigs.length > 0) {
                newConfigs[0].isDefault = true
              }
              
              // 保存迁移后的配置
              set({ modelConfigs: newConfigs })
              // 保存到数据库
              setTimeout(() => useAppStore.getState().saveModelConfigsToDB(), 0)
              console.log(`已迁移 ${newConfigs.length} 个旧配置到新格式`)
              
              // 迁移完成后清空旧数据，避免数据不一致
              try {
                await window.api?.appSettings?.set?.('ai_configs', '[]')
                console.log('已清空旧版 ai_configs 数据')
              } catch (err) {
                console.log('清空旧数据失败:', err)
              }
            }
          } catch (err) {
            console.error('迁移旧配置失败:', err)
          }
        }
      }
      
      // 加载当前选中的模型ID
      const chatId = await window.api?.appSettings?.get?.('current_model_chat')
      const embeddingId = await window.api?.appSettings?.get?.('current_model_embedding')
      const visionId = await window.api?.appSettings?.get?.('current_model_vision')
      if (chatId) set({ currentChatModelId: chatId })
      if (embeddingId) set({ currentEmbeddingModelId: embeddingId })
      if (visionId) set({ currentVisionModelId: visionId })
    } catch (err) {
      console.error('加载模型配置失败:', err)
    }
  },

  saveModelConfigsToDB: async () => {
    try {
      const modelConfigs = useAppStore.getState().modelConfigs
      await window.api?.appSettings?.set?.('model_configs', JSON.stringify(modelConfigs))
    } catch (err) {
      console.error('保存模型配置失败:', err)
    }
  },

  // ========== 聊天会话管理 ==========
  chatSessions: [],
  chatSessionFolders: [...DEFAULT_CHAT_FOLDERS],
  activeChatSessionId: null,
  selectedChatFolderId: null,

  createChatSession: (title, folderId = null, pdfId, pdfFilePath) => {
    const id = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()
    const newSession: ChatSession = {
      id,
      folderId,
      pdfId,
      pdfFilePath,
      title: title || '新对话',
      messages: [{
        id: `msg-${now}`,
        role: 'assistant',
        content: '你好！我是你的 AI 阅读助手，具备以下能力：\n\n📄 **文档搜索** - 在 PDF 中搜索相关内容\n📝 **文档总结** - 总结文档主要内容\n📖 **获取页面** - 获取指定页码的内容\n🌐 **联网搜索** - 搜索实时信息（天气、股价、新闻等）\n📚 **论文搜索** - 搜索 arXiv 学术论文\n\n打开 PDF 后，你可以直接向我提问，我会自动选择合适的工具来回答你！',
        timestamp: now,
      }],
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({
      chatSessions: [newSession, ...state.chatSessions],
      activeChatSessionId: id,
    }))
    // 持久化
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
    return id
  },

  deleteChatSession: (id) => {
    set((state) => ({
      chatSessions: state.chatSessions.filter((s) => s.id !== id),
      activeChatSessionId: state.activeChatSessionId === id ? null : state.activeChatSessionId,
    }))
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
  },

  switchChatSession: (id) => {
    set({ activeChatSessionId: id })
  },

  updateChatSessionTitle: (id, title) => {
    set((state) => ({
      chatSessions: state.chatSessions.map((s) =>
        s.id === id ? { ...s, title, updatedAt: Date.now() } : s
      ),
    }))
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
  },

  updateChatSessionFolder: (sessionId, folderId) => {
    set((state) => ({
      chatSessions: state.chatSessions.map((s) =>
        s.id === sessionId ? { ...s, folderId, updatedAt: Date.now() } : s
      ),
    }))
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
  },

  toggleFavoriteChatSession: (id) => {
    set((state) => ({
      chatSessions: state.chatSessions.map((s) =>
        s.id === id ? { ...s, isFavorite: !s.isFavorite, updatedAt: Date.now() } : s
      ),
    }))
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
  },

  addMessageToSession: (sessionId, msg) => {
    set((state) => ({
      chatSessions: state.chatSessions.map((s) => {
        if (s.id !== sessionId) return s

        // 如果是第一条用户消息，自动更新会话标题
        let newTitle = s.title
        if (msg.role === 'user' && s.messages.length <= 1 && s.title === '新对话') {
          // 提取消息内容作为标题（取前20个字符）
          const content = typeof msg.content === 'string' ? msg.content : ''
          newTitle = content.slice(0, 20) + (content.length > 20 ? '...' : '')
        }

        return {
          ...s,
          title: newTitle,
          messages: [...s.messages, msg],
          updatedAt: Date.now(),
        }
      }),
    }))
    // 延迟保存，避免频繁写入
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 500)
  },

  createChatFolder: (name) => {
    const id = `folder-chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newFolder: ChatSessionFolder = {
      id,
      name,
      sortOrder: useAppStore.getState().chatSessionFolders.length,
      createdAt: Date.now(),
    }
    set((state) => ({
      chatSessionFolders: [...state.chatSessionFolders, newFolder],
    }))
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
    return id
  },

  deleteChatFolder: (id) => {
    set((state) => ({
      chatSessionFolders: state.chatSessionFolders.filter((f) => f.id !== id),
      // 将该文件夹下的会话移动到根目录
      chatSessions: state.chatSessions.map((s) =>
        s.folderId === id ? { ...s, folderId: null, updatedAt: Date.now() } : s
      ),
    }))
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
  },

  renameChatFolder: (id, name) => {
    set((state) => ({
      chatSessionFolders: state.chatSessionFolders.map((f) =>
        f.id === id ? { ...f, name } : f
      ),
    }))
    setTimeout(() => useAppStore.getState().saveChatSessionsToDB(), 0)
  },

  getSessionsByFolder: (folderId) => {
    const state = useAppStore.getState()
    return state.chatSessions
      .filter((s) => s.folderId === folderId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },

  getRecentSessions: (limit = 10) => {
    const state = useAppStore.getState()
    return [...state.chatSessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  },

  loadChatSessionsFromDB: async () => {
    try {
      // 加载会话
      const sessionsData = await window.api?.appSettings?.get?.('chat_sessions')
      let sessions: ChatSession[] = []
      if (sessionsData) {
        sessions = JSON.parse(sessionsData)
      }
      
      // 加载文件夹
      const foldersData = await window.api?.appSettings?.get?.('chat_session_folders')
      let folders: ChatSessionFolder[] = [...DEFAULT_CHAT_FOLDERS]
      if (foldersData) {
        folders = JSON.parse(foldersData)
      }
      
      // 获取当前状态
      const currentState = useAppStore.getState()
      
      // 如果数据库中有会话，使用数据库中的会话
      // 如果当前已有活跃会话且数据库中也有会话，优先使用数据库中的第一个会话
      let newActiveSessionId = currentState.activeChatSessionId
      if (sessions.length > 0) {
        // 如果当前活跃会话不在数据库会话列表中，切换到数据库中的第一个会话
        const currentSessionExists = sessions.some(s => s.id === currentState.activeChatSessionId)
        if (!currentSessionExists) {
          newActiveSessionId = sessions[0].id
        }
      }
      
      // 设置状态
      set({ chatSessions: sessions, chatSessionFolders: folders, activeChatSessionId: newActiveSessionId })
      
      // 标记加载完成
      set({ chatSessionsLoaded: true })
    } catch (err) {
      console.error('加载聊天会话失败:', err)
      // 即使加载失败也要标记完成，避免无限等待
      set({ chatSessionsLoaded: true })
    }
  },

  saveChatSessionsToDB: async () => {
    try {
      const { chatSessions, chatSessionFolders } = useAppStore.getState()
      await window.api?.appSettings?.set?.('chat_sessions', JSON.stringify(chatSessions))
      await window.api?.appSettings?.set?.('chat_session_folders', JSON.stringify(chatSessionFolders))
    } catch (err) {
      console.error('保存聊天会话失败:', err)
    }
  },
}))

// 持久化标签页到 SQLite (app_settings)
function persistTabs(tabs: TabItem[], activeTabId: string | null): void {
  try {
    const value = JSON.stringify({ tabs, activeTabId })
    window.api?.appSettings?.set?.('open_tabs', value)
  } catch (err) {
    console.error('保存标签页失败:', err)
  }
}
