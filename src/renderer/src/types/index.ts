// 全局类型定义

export interface PDFDocument {
  id: string
  filePath: string
  fileName: string
  totalPages: number
  currentPage: number
  scale: number
  bookmarks?: Bookmark[]
  pageMapping?: PageMapping
  readingProgress?: number
  createdAt: number
  updatedAt: number
}

export interface Bookmark {
  id: string
  title: string
  pageNumber: number
  level: number
  children?: Bookmark[]
}

export interface PageMapping {
  // PDF 内部页码 -> 实体书页码
  mappings: { pdfPage: number; bookPage: string }[]
  // 偏移规则（如：前 10 页为罗马数字，第 11 页开始为 1）
  rules?: MappingRule[]
}

export interface MappingRule {
  startPage: number
  endPage: number
  prefix?: string
  suffix?: string
  offset?: number
  isRoman?: boolean
}

export interface Annotation {
  id: string
  pageNumber: number
  type: 'highlight' | 'underline' | 'note' | 'stamp'
  rect: { x: number; y: number; width: number; height: number }
  color: string
  content?: string
  createdAt: number
}

// 模型能力分类（文件夹类型）
export type ModelCapability = 'text' | 'vision' | 'multimodal' | 'audio' | string

// 模型文件夹
export interface ModelFolder {
  id: string
  name: string
  capability: ModelCapability
  description?: string
  icon?: string
  order: number // 排序
}

// 基础模型配置
export interface ModelConfig {
  id: string
  folderId: string // 所属文件夹ID
  name: string
  provider: 'openai' | 'deepseek' | 'siliconflow' | 'zhipu' | 'kimi' | 'qwen' | 'gemini' | 'anthropic' | 'custom' | 'local'
  apiKey: string
  baseUrl: string
  model: string
  temperature?: number
  maxTokens?: number
  isDefault?: boolean // 是否为该文件夹的默认模型
  createdAt: number
  updatedAt: number
}

// 预设的模型文件夹
export const DEFAULT_MODEL_FOLDERS: ModelFolder[] = [
  {
    id: 'folder-text',
    name: '文本生成模型',
    capability: 'text',
    description: '用于对话、文本生成、代码编写等',
    icon: 'MessageSquare',
    order: 1,
  },
  {
    id: 'folder-vision',
    name: '视觉模型',
    capability: 'vision',
    description: '用于图像理解、OCR、图表分析等',
    icon: 'Eye',
    order: 2,
  },
  {
    id: 'folder-multimodal',
    name: '多模态模型',
    capability: 'multimodal',
    description: '支持文本、图像、音频等多种输入',
    icon: 'Layers',
    order: 3,
  },
  {
    id: 'folder-audio',
    name: '语音模型',
    capability: 'audio',
    description: '用于语音识别、语音合成等',
    icon: 'Mic',
    order: 4,
  },
]

// 旧的类型保留兼容
/** @deprecated 使用 ModelConfig 替代 */
export interface AIConfig {
  id: string
  name: string
  provider: 'openai' | 'deepseek' | 'siliconflow' | 'zhipu' | 'kimi' | 'qwen' | 'gemini' | 'anthropic' | 'custom'
  apiKey: string
  baseUrl: string
  model: string
  embeddingModel?: string
  temperature?: number
  maxTokens?: number
  isDefault?: boolean
}

// 对话分组/文件夹
export interface ChatSessionFolder {
  id: string
  name: string
  icon?: string
  sortOrder: number
  createdAt: number
}

// 预设的默认分组
export const DEFAULT_CHAT_FOLDERS: ChatSessionFolder[] = [
  { id: 'folder-general', name: '通用问答', icon: 'MessageSquare', sortOrder: 0, createdAt: Date.now() },
  { id: 'folder-favorite', name: '收藏对话', icon: 'Star', sortOrder: 1, createdAt: Date.now() },
  { id: 'folder-document', name: '文档对话', icon: 'FileText', sortOrder: 2, createdAt: Date.now() },
]

export interface ChatSession {
  id: string
  folderId: string | null  // 所属分组ID，null表示在根目录
  pdfId?: string
  pdfFilePath?: string
  title: string
  messages: ChatMessage[]
  isFavorite?: boolean
  systemPrompt?: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: MessageAttachment[]
  pageRef?: number
  timestamp: number
}

export interface MessageAttachment {
  id: string
  type: 'page' | 'range' | 'screenshot' | 'selection'
  label: string
  data: string // base64 或 blob url
  pageNumbers?: number[]
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  defaultScale: number
  sidebarWidth: number
  chatPanelWidth: number
  aiConfigs: AIConfig[]
  defaultAIConfigId?: string
  enableMinerU: boolean
  minerUPath?: string
}

export interface ExportData {
  version: string
  exportDate: string
  fileTree: FileNodeExport[]
  pdfSettings: Record<string, PDFSettingsExport>
  chatSessions: ChatSession[]
  appSettings: AppSettings
}

export interface FileNodeExport {
  id: string
  name: string
  type: 'file' | 'folder'
  path?: string
  children?: FileNodeExport[]
  sortOrder: number
}

export interface PDFSettingsExport {
  pageMapping?: PageMapping
  bookmarks?: Bookmark[]
  annotations?: Annotation[]
  readingProgress: number
  systemPrompt?: string
  chatSessions: string[] // session ids
}

// 论文引用相关类型
export interface Citation {
  id: string
  pdfId: string
  pageIndex: number
  selectedText: string
  contextText: string
  rects: { x: number; y: number; width: number; height: number }[]

  // 元数据
  title?: string
  authors?: string[]
  journal?: string
  year?: number
  doi?: string

  // 引用管理
  format: 'gb7714' | 'apa' | 'mla' | 'chicago' | 'ieee' | 'custom'
  formattedCitation: string
  note?: string
  tags: string[]

  // 状态
  isProcessed: boolean
  createdAt: number
  updatedAt: number
}

export type CitationFormat = 'gb7714' | 'apa' | 'mla' | 'chicago' | 'ieee' | 'custom'

export interface CitationMetadata {
  title?: string
  authors?: string[]
  journal?: string
  year?: number
  doi?: string
  url?: string
  publisher?: string
  volume?: string
  issue?: string
  pages?: string
}
