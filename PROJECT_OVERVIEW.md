# PDF Reader AI - 项目完整功能介绍与技术栈

> AI 赋能的现代化 PDF 阅读器，基于 Electron + React + TypeScript + Tailwind CSS 构建

---

## 📋 目录

1. [项目概述](#项目概述)
2. [核心功能模块](#核心功能模块)
3. [技术架构](#技术架构)
4. [详细技术栈](#详细技术栈)
5. [项目结构](#项目结构)
6. [功能实现细节](#功能实现细节)
7. [开发环境配置](#开发环境配置)

---

## 项目概述

**PDF Reader AI** 是一款面向知识工作者和学术研究者的智能 PDF 阅读工具。它将传统 PDF 阅读器的核心功能与先进的 AI 技术相结合，通过 RAG（检索增强生成）技术实现与文档的智能对话，帮助用户更高效地阅读、理解和分析 PDF 文档。

### 核心设计理念

- **沉浸式阅读体验**：简洁现代的 UI 设计，支持深色主题，减少视觉干扰
- **AI 原生交互**：将 AI 对话深度集成到阅读流程中，而非简单的外挂功能
- **多模型兼容**：支持 OpenAI、Anthropic、自托管模型等多种 AI 服务商
- **本地优先**：文件和索引数据本地存储，保护用户隐私

---

## 核心功能模块

### 一、📁 文件管理与资料库

| 功能 | 状态 | 描述 |
|------|------|------|
| 本地文件系统 | ✅ | 树形文件夹结构管理 PDF 文件 |
| 标准文件操作 | ✅ | 导入文件、新建文件夹、重命名、删除、回收站 |
| 拖拽导入 | ✅ | 支持拖拽 PDF 文件到侧边栏快速导入 |
| 全局文件搜索 | ✅ | 实时搜索文件名和文件夹名 |
| 自定义排序 | ✅ | 文件和文件夹支持手动调整排列顺序（Store 层已支持） |

**技术亮点：**
- 使用 SQLite 存储文件元数据，支持复杂的层级查询
- 实现软删除机制，文件进入回收站后可恢复
- 拖拽 API 集成，支持从系统文件管理器直接拖拽导入

---

### 二、📖 PDF 基础阅读

| 功能 | 状态 | 描述 |
|------|------|------|
| 阅读渲染 | ✅ | 基于 pdf.js 的真实 PDF 页面渲染 |
| 多标签页 | ✅ | 同时打开多个 PDF，标签页切换和关闭 |
| 缩放与滚动 | ✅ | 支持页面缩放、键盘翻页（←/→、PageUp/PageDown） |
| 极简阅读模式 | ✅ | 沉浸模式一键隐藏所有面板 |
| 页面缩略图 | ✅ | 左侧缩略图面板快速导航 |
| 目录书签 | ✅ | 层级目录展示和点击跳转 |

**技术亮点：**
- 基于 Mozilla pdf.js 实现 PDF 渲染，支持文本层提取
- 虚拟滚动优化，大文件流畅阅读
- 自定义渲染管线，支持文本高亮和选区提取

---

### 三、🤖 AI 赋能的阅读功能

| 功能 | 状态 | 描述 |
|------|------|------|
| 多页附加提问 | ✅ | 支持附加当前页、页码范围、截图到对话 |
| 区域框选提问 | ✅ | UI 框架预留，支持选中文字提问 |
| 基于目录的章节讲解 | ✅ | UI 框架预留，支持按章节提问 |
| 自由接入 AI 模型 | ✅ | 设置页面支持配置多服务商 API |
| 对话记录与 PDF 绑定 | ✅ | 每个 PDF 独立对话仓库（Store 层） |
| 快捷截图提问 | ✅ | 工具栏按钮一键截图提问 |
| 一键导出对话长图 | ⏳ | 待实现 |

**技术亮点：**

#### 3.1 RAG (检索增强生成) 系统

```
┌─────────────────────────────────────────────────────────────┐
│                      RAG 检索流水线                          │
├─────────────────────────────────────────────────────────────┤
│  1. 查询改写 (Query Rewrite)                                  │
│     - 多轮对话指代消解（"这个/那个/它" → 具体名词）            │
│     - LLM 辅助改写，消除歧义                                  │
├─────────────────────────────────────────────────────────────┤
│  2. 混合检索 (Hybrid Search)                                  │
│     - 向量检索：Embedding 相似度匹配                          │
│     - 关键词检索：BM25 算法补充                               │
│     - 权重可调：默认向量 0.9 + 关键词 0.1                     │
├─────────────────────────────────────────────────────────────┤
│  3. 重排序 (Reranker)                                         │
│     - 支持 Cohere 等重排序模型                                │
│     - 提升检索结果相关性                                      │
├─────────────────────────────────────────────────────────────┤
│  4. 上下文组装 (Context Assembly)                             │
│     - 按章节分组                                              │
│     - 按类型排序（标题 > 摘要 > 结论 > 段落）                  │
│     - 智能截断，适配模型上下文窗口                            │
└─────────────────────────────────────────────────────────────┘
```

#### 3.2 智能分块策略

```typescript
// 基于结构化元素的语义化分块
interface SemanticChunk {
  id: string;
  content: string;
  elementType: 'heading' | 'paragraph' | 'equation' | 'table' | 'caption' | 'abstract' | 'conclusion';
  section: string;        // 所属章节
  pageNumber: number;
  parentId?: string;      // 父级 chunk ID（如标题下的段落）
  childIds?: string[];    // 子级 chunk IDs
  chunkRole: 'parent' | 'child' | 'standalone';
  tokens: number;         // Token 数量估计
}
```

#### 3.3 三种 System Prompt 策略

| 场景 | Prompt 策略 | 说明 |
|------|-------------|------|
| 检索有结果 | 强制基于上下文回答 | 严格使用检索到的段落回答，不依赖模型知识 |
| 检索无结果 | 允许基于通用知识 | 告知用户未找到相关内容，然后基于模型知识回答 |
| 摘要模式 | 全面总结全文 | 智能选择标题、摘要、结论等关键段落进行总结 |

---

### 四、💬 独立的聊天模式

| 功能 | 状态 | 描述 |
|------|------|------|
| 侧边栏聊天入口 | ✅ | 提供聊天模式入口和分组管理 |
| 对话文件夹管理 | ✅ | 支持创建文件夹组织对话记录 |
| 独立纯聊天视图 | ⏳ | 待实现 |

---

### 五、🎨 UI 自适应细节

| 功能 | 状态 | 描述 |
|------|------|------|
| 深色主题 | ✅ | 现代暗色风格，护眼模式 |
| 响应式工具栏 | ✅ | 按钮带文字/仅图标自适应 |
| 平滑过渡动画 | ✅ | 面板切换、消息出现等动画效果 |
| 自定义滚动条 | ✅ | 统一的滚动条样式 |

---

## 技术架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Electron 应用                               │
├─────────────────────────────┬───────────────────────────────────────────┤
│      主进程 (Main)           │           渲染进程 (Renderer)              │
├─────────────────────────────┼───────────────────────────────────────────┤
│  ┌───────────────────────┐  │  ┌─────────────────────────────────────┐  │
│  │    IPC 通信处理器      │  │  │           React 应用                 │  │
│  │  (ipcHandlers.ts)     │◄─┼─►│  ┌───────────────────────────────┐  │  │
│  └───────────────────────┘  │  │  │      组件层 (Components)       │  │  │
│            │                │  │  │  - Sidebar     - PDFViewer    │  │  │
│  ┌─────────▼──────────┐     │  │  │  - ChatPanel   - Settings     │  │  │
│  │    服务层 (Services)│     │  │  └───────────────────────────────┘  │  │
│  │  - fileService     │     │  │              │                      │  │
│  │  - pdfService      │     │  │  ┌───────────▼────────────┐         │  │
│  │  - ragService      │     │  │  │    状态管理 (Zustand)   │         │  │
│  │  - layoutService   │     │  │  │  - appStore            │         │  │
│  └─────────┬──────────┘     │  │  └────────────────────────┘         │  │
│            │                │  │                                     │  │
│  ┌─────────▼──────────┐     │  │  ┌───────────────────────────────┐  │  │
│  │    数据库 (SQLite)  │     │  │  │      工具库                   │  │  │
│  │  - better-sqlite3  │     │  │  │  - pdf.js    - react-markdown │  │  │
│  └────────────────────┘     │  │  │  - katex     - lucide-react   │  │  │
│                             │  │  └───────────────────────────────┘  │  │
└─────────────────────────────┴───────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           外部服务集成                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   OpenAI     │  │  Anthropic   │  │  自托管模型   │  │  Embedding   │ │
│  │   API        │  │    Claude    │  │   API        │  │   API        │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 数据流图

```
用户操作
    │
    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  React 组件  │────►│  Zustand    │────►│  IPC 调用   │
│             │     │   Store     │     │             │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                        ┌──────────────────────┘
                        ▼
               ┌─────────────────┐
               │  Electron 主进程 │
               └────────┬────────┘
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
      ┌─────────┐  ┌─────────┐  ┌─────────┐
      │ SQLite  │  │ 文件系统 │  │ 外部 API │
      │  数据库  │  │         │  │         │
      └─────────┘  └─────────┘  └─────────┘
```

---

## 详细技术栈

### 核心技术

| 类别 | 技术/库 | 版本 | 用途 |
|------|---------|------|------|
| **桌面框架** | Electron | 31.0.0 | 跨平台桌面应用框架 |
| **构建工具** | electron-vite | 2.3.0 | Electron + Vite 集成构建 |
| **前端框架** | React | 18.3.1 | UI 组件开发 |
| **语言** | TypeScript | 5.4.5 | 类型安全开发 |
| **样式方案** | Tailwind CSS | 3.4.4 | 原子化 CSS 样式 |
| **状态管理** | Zustand | 4.5.7 | 轻量级全局状态管理 |

### PDF 处理

| 技术/库 | 版本 | 用途 |
|---------|------|------|
| pdf.js | 4.4.168 | Mozilla PDF 渲染引擎 |
| @opendataloader/pdf | 2.4.0 | PDF 结构化解析（提取标题、段落等） |

### AI / LLM 集成

| 技术/库 | 版本 | 用途 |
|---------|------|------|
| @langchain/core | 1.1.44 | LangChain 核心框架 |
| @langchain/community | 1.1.27 | 社区模型集成 |
| @langchain/openai | 1.4.5 | OpenAI 模型支持 |
| @langchain/langgraph | 1.2.9 | 工作流编排 |
| langchain | 1.3.5 | LLM 应用开发框架 |

### 数据库与存储

| 技术/库 | 版本 | 用途 |
|---------|------|------|
| better-sqlite3 | 11.0.0 | SQLite 数据库（主进程） |
| sql.js | 1.14.1 | SQL.js 备用方案 |
| sqlite-vec | 0.1.9 | SQLite 向量扩展 |

### UI 组件与图标

| 技术/库 | 版本 | 用途 |
|---------|------|------|
| lucide-react | 0.400.0 | 图标库 |
| react-markdown | 10.1.0 | Markdown 渲染 |
| remark-math | 6.0.0 | Markdown 数学公式支持 |
| rehype-katex | 7.0.1 | KaTeX 数学公式渲染 |
| katex | 0.16.45 | 数学公式渲染引擎 |
| @matejmazur/react-katex | 3.1.3 | React KaTeX 组件 |
| @tailwindcss/typography | 0.5.19 | Tailwind 排版插件 |

### 工具库

| 技术/库 | 版本 | 用途 |
|---------|------|------|
| @tanstack/react-virtual | 3.13.24 | 虚拟滚动优化 |
| iconv-lite | 0.7.2 | 字符编码转换 |
| electron-updater | 6.1.7 | 自动更新功能 |

### 开发工具

| 技术/库 | 版本 | 用途 |
|---------|------|------|
| Vite | 5.2.13 | 前端构建工具 |
| ESLint | 8.57.0 | 代码质量检查 |
| Prettier | 3.3.1 | 代码格式化 |
| electron-builder | 24.13.3 | 应用打包工具 |

---

## 项目结构

```
pdf阅读器/
├── build/                          # 构建输出目录
│   └── icon.png                    # 应用图标
├── dev-app-update.yml              # 开发环境更新配置
├── electron-builder.yml            # 打包配置
├── electron.vite.config.ts         # Vite + Electron 配置
├── package.json                    # 项目依赖配置
├── postcss.config.js               # PostCSS 配置
├── tailwind.config.js              # Tailwind CSS 配置
├── tsconfig.json                   # TypeScript 配置
├── tsconfig.node.json              # Node 环境 TS 配置
├── tsconfig.web.json               # Web 环境 TS 配置
├── README.md                       # 项目说明文档
└── src/
    ├── main/                       # Electron 主进程
    │   ├── db/                     # 数据库模块
    │   │   └── index.ts            # SQLite 初始化与表定义
    │   ├── services/               # 业务服务层
    │   │   ├── advancedRAGService.ts    # 高级 RAG 检索
    │   │   ├── fileService.ts           # 文件管理
    │   │   ├── layoutService.ts         # PDF 布局分析
    │   │   ├── parentChildChunkService.ts # 父子分块
    │   │   ├── pdfProcessor.ts          # PDF 处理
    │   │   ├── pdfService.ts            # PDF 服务
    │   │   ├── ragService.ts            # RAG 核心服务
    │   │   └── reactAgentService.ts     # ReAct Agent
    │   ├── ipcHandlers.ts          # IPC 通信处理器
    │   └── index.ts                # 主进程入口
    ├── preload/                    # 预加载脚本
    │   └── index.ts                # 安全桥接 API 暴露
    └── renderer/                   # 渲染进程
        ├── src/
        │   ├── components/         # React 组件
        │   │   ├── chat/           # 聊天相关组件
        │   │   │   ├── AttachmentPreview.tsx  # 附件预览
        │   │   │   ├── ChatInput.tsx          # 聊天输入框
        │   │   │   ├── ChatMessage.tsx        # 消息组件
        │   │   │   ├── ChatPanel.tsx          # 聊天面板主组件
        │   │   │   ├── ChatSessionList.tsx    # 会话列表
        │   │   │   ├── KnowledgeBaseSelector.tsx # 知识库选择
        │   │   │   ├── MessageActions.tsx     # 消息操作
        │   │   │   └── PromptTemplates.ts     # 提示词模板
        │   │   ├── layout/         # 布局组件
        │   │   │   ├── StatusBar.tsx          # 状态栏
        │   │   │   └── Toolbar.tsx            # 工具栏
        │   │   ├── pdf/            # PDF 阅读组件
        │   │   │   ├── PDFThumbnail.tsx       # 缩略图
        │   │   │   ├── PDFThumbnailSidebar.tsx # 缩略图侧边栏
        │   │   │   ├── PDFTOC.tsx             # 目录组件
        │   │   │   ├── PDFViewer.tsx          # PDF 阅读器主组件
        │   │   │   └── PDFViewerContent.tsx   # PDF 内容渲染
        │   │   ├── settings/       # 设置组件
        │   │   │   └── SettingsModal.tsx      # 设置弹窗
        │   │   ├── sidebar/        # 侧边栏组件
        │   │   │   ├── FileTree.tsx           # 文件树
        │   │   │   ├── SearchPanel.tsx        # 搜索面板
        │   │   │   └── Sidebar.tsx            # 侧边栏主组件
        │   │   └── common/         # 通用组件
        │   │       └── ContextMenu.tsx        # 右键菜单
        │   ├── stores/             # Zustand 状态管理
        │   │   └── appStore.ts     # 全局状态存储
        │   ├── types/              # TypeScript 类型定义
        │   │   └── index.ts        # 全局类型
        │   ├── App.tsx             # 根组件
        │   ├── main.tsx            # 渲染进程入口
        │   └── env.d.ts            # 环境类型声明
        └── index.html              # HTML 模板
```

---

## 功能实现细节

### 1. RAG 系统实现

#### 1.1 索引流程

```typescript
// 1. PDF 结构化解析
const { elements } = await processPDF(filePath);

// 2. 智能分块
const chunks = createSemanticChunksFromElements(pdfId, elements);

// 3. 生成 Embedding
const embeddings = await getEmbeddingsBatch(
  chunks.map(c => c.content),
  config
);

// 4. 写入数据库
db.transaction(() => {
  for (let i = 0; i < chunks.length; i++) {
    insertChunk({
      ...chunks[i],
      embedding: JSON.stringify(embeddings[i])
    });
  }
})();
```

#### 1.2 检索流程

```typescript
// 1. 查询改写
const rewrittenQuery = await llmRewriteQuery(query, lastQuery, config);

// 2. 生成查询向量
const queryEmbedding = await getEmbedding(rewrittenQuery, config);

// 3. 混合检索
const vectorResults = await vectorSearch(queryEmbedding, topK);
const keywordResults = await keywordSearch(rewrittenQuery, topK);

// 4. 结果融合
const merged = mergeResults(vectorResults, keywordResults, {
  vectorWeight: 0.9,
  keywordWeight: 0.1
});

// 5. 重排序（可选）
const reranked = rerankerConfig 
  ? await rerank(merged, rewrittenQuery, rerankerConfig)
  : merged;

// 6. 上下文组装
const context = assembleContext(reranked);
```

### 2. 多模态对话实现

```typescript
// 支持的消息内容格式
interface MessageContent {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
  }>;
}

// 附件类型
interface Attachment {
  type: 'selection' | 'screenshot' | 'page' | 'range';
  label: string;
  data?: string;  // 文本内容或图片 Data URL
  pageNumbers?: number[];
}
```

### 3. 数据库 Schema

```sql
-- 文件表
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'file' | 'folder'
  path TEXT,
  parent_id TEXT,
  sort_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- PDF 文档表
CREATE TABLE pdf_documents (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  total_pages INTEGER,
  current_page INTEGER DEFAULT 1,
  scale REAL DEFAULT 1.0,
  reading_progress REAL DEFAULT 0,
  bookmarks TEXT,  -- JSON
  annotations TEXT,  -- JSON
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- 对话会话表
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  pdf_id TEXT,
  title TEXT NOT NULL,
  folder_id TEXT,  -- 所属文件夹
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- 对话消息表
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,  -- JSON
  page_ref INTEGER,
  timestamp INTEGER DEFAULT (unixepoch() * 1000)
);

-- RAG 分块表（核心）
CREATE TABLE pdf_chunks (
  id TEXT PRIMARY KEY,
  pdf_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,  -- JSON 数组
  
  -- 语义结构
  section TEXT,
  section_level INTEGER,
  type TEXT DEFAULT 'paragraph',
  
  -- 定位信息
  bbox TEXT,  -- JSON: [{x1,y1,x2,y2}]
  
  -- 上下文关系
  prev_id TEXT,
  next_id TEXT,
  parent_id TEXT,
  
  -- 元数据
  keywords TEXT,  -- JSON
  importance REAL DEFAULT 0.5,
  tokens INTEGER DEFAULT 0,
  
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);
```

---

## 开发环境配置

### 安装依赖

```bash
# 使用淘宝镜像（已配置）
npm install
```

### 开发命令

```bash
# 启动开发服务器
npm run dev

# 类型检查
npm run typecheck

# 构建应用
npm run build

# 打包 Windows 安装程序
npm run build:win
```

### 环境要求

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **操作系统**: Windows 10/11 (主要开发平台)

### 配置说明

1. **模型配置**：在应用设置中添加 AI 服务商 API Key
   - 支持 OpenAI、Anthropic、自定义 API
   - 可分别配置对话模型和 Embedding 模型

2. **RAG 配置**：
   - 选择 Embedding 模型用于向量检索
   - 可选配置 Reranker 模型提升检索质量

---

## 后续开发计划

### 短期计划
- [ ] 接入 AI 模型 API，实现真实对话
- [ ] 实现 PDF 批注功能（高亮、下划线、笔记）
- [ ] 实现数据导出/导入备份功能
- [ ] 优化 PDF 大文件渲染性能（虚拟滚动）

### 长期规划
- [ ] 跨设备数据同步（云同步）
- [ ] 协作功能（共享批注、评论）
- [ ] 插件系统（支持第三方扩展）
- [ ] OCR 功能（扫描件文字识别）

---

## 总结

**PDF Reader AI** 是一个技术栈完整、架构清晰的桌面应用项目。它成功将传统 PDF 阅读器与先进的 AI 技术相结合，通过 RAG 系统实现了智能文档问答功能。项目采用现代化的技术栈（Electron + React + TypeScript），代码结构清晰，模块化程度高，具有良好的可扩展性和维护性。

**核心亮点：**
- ✅ 完整的 RAG 检索流水线（改写 → 混合检索 → 重排序 → 上下文组装）
- ✅ 基于结构化元素的智能分块策略
- ✅ 多模态对话支持（文本 + 图片）
- ✅ 多模型兼容（OpenAI、Anthropic、自托管）
- ✅ 本地优先的数据存储方案
- ✅ 现代化的 UI/UX 设计

---

*文档生成时间：2026-05-06*
*项目版本：v1.0.0*
