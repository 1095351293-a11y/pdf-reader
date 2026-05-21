import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { getDatabase } from '../db'
import { advancedRAGSearch, advancedRAGSearchMulti } from './advancedRAGService'
import path from 'path'
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import axios from 'axios'

export interface AgentConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  webSearchApiKey?: string
}

export interface AgentResult {
  success: boolean
  output?: string
  steps?: AgentStep[]
  error?: string
}

export interface AgentStep {
  step: number
  tool: string
  input: string
  output?: string
}

function getAxiosFromElectronNet() {
  return {
    get: async (url: string, opts?: any) => {
      try { return await axios.get(url, { timeout: opts?.timeout || 15000 }) } 
      catch (e) { throw e }
    },
    post: async (url: string, data?: any, opts?: any) => {
      try { return await axios.post(url, data, { timeout: opts?.timeout || 15000 }) }
      catch (e) { throw e }
    }
  }
}

function createTools(pdfId: string, config: AgentConfig) {
  const http = getAxiosFromElectronNet()

  const searchDocsTool = tool(
    async ({ query }: any) => {
      try {
        const result: any = await advancedRAGSearch(pdfId, query, config as any, {
          topK: 5,
          expandQueries: false,
          enableCompression: false,
          vectorWeight: 0.6,
          keywordWeight: 0.4
        })
        if (!result || !result.chunks || result.chunks.length === 0) return 'No relevant content found.'
        return result.chunks.map((chunk: any) =>
          `[page ${chunk.pageNumber}]\n${chunk.content}`
        ).join('\n\n---\n\n')
      } catch (err: any) {
        return `Search failed: ${err?.message || String(err)}`
      }
    },
    {
      name: 'search_docs',
      description: 'Semantic search inside the currently opened PDF document.',
      schema: z.object({ query: z.string().describe('Search keywords') })
    }
  )

  const summarizeDocumentTool = tool(
    async () => {
      const db = getDatabase()
      const allChunks = db.prepare(
        `SELECT content FROM pdf_chunks WHERE pdf_id = ? ORDER BY chunk_index LIMIT 10`
      ).all(pdfId) as any[]
      return allChunks.map((c: any) => c.content).join('\n\n').substring(0, 4000)
    },
    {
      name: 'summarize_document',
      description: 'Get full text summary material from the current PDF.',
      schema: z.object({})
    }
  )

  const getPageTool = tool(
    async ({ pageNumber }) => {
      const db = getDatabase()
      const rows = db.prepare(
        `SELECT content FROM pdf_chunks WHERE pdf_id = ? AND page_number = ? ORDER BY chunk_index`
      ).all(pdfId, pageNumber) as any[]
      if (!rows || rows.length === 0) return `Page ${pageNumber} is empty or not found.`
      return rows.map((c: any) => c.content).join('\n').substring(0, 3000)
    },
    {
      name: 'get_page',
      description: 'Get full content of a specific page number in current PDF.',
      schema: z.object({ pageNumber: z.coerce.number().int().min(1).describe('page number starting at 1') })
    }
  )

  const webSearchTool = tool(
    async ({ query }) => {
      try {
        const searchUrl = `https://search.tinyfish.ai/api/search?query=${encodeURIComponent(query)}&lang=zh-CN`
        const res = await http.get(searchUrl)
        const results = res.data?.value || []
        if (!results.length) return `No search results found for query: ${query}`
        return results.map((r: any, i: number) =>
          `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet || ''}`
        ).join('\n\n').substring(0, 4000)
      } catch (e) {
        return `Web search failed: ${(e as any).code || 'network error'}`
      }
    },
    {
      name: 'web_search',
      description: 'Search online for real-time/live information or news.',
      schema: z.object({ query: z.string().describe('Search query') })
    }
  )

  const searchArxivTool = tool(
    async ({ query }) => {
      try {
        const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3`
        const res = await http.get(url)
        return String(res.data).substring(0, 2500)
      } catch (e) {
        return `arXiv API failed: ${(e as any).response?.status || e}`
      }
    },
    {
      name: 'search_arxiv',
      description: 'Search academic research papers.',
      schema: z.object({
        query: z.string().describe('English keywords preferred'),
        max_results: z.number().optional()
      })
    }
  )

  return [searchDocsTool, summarizeDocumentTool, getPageTool, webSearchTool, searchArxivTool]
}

export async function runReActAgentWithHistoryLangGraph(
  query: string,
  pdfId: string,
  config: AgentConfig,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  images?: string[],
): Promise<AgentResult> {
  const steps: AgentStep[] = []
  const stepTimes: number[] = []

  try {
    const db = getDatabase()
    const indexStatus = db.prepare(
      'SELECT COUNT(*) as total FROM pdf_chunks WHERE pdf_id = ?'
    ).get(pdfId) as { total: number }

    if (indexStatus.total === 0) {
      return { success: false, error: '该 PDF 尚未建立索引，请先打开 PDF 等待自动索引' }
    }

    const pdfInfo = db.prepare(
      'SELECT DISTINCT file_path FROM pdf_chunks WHERE pdf_id = ? LIMIT 1'
    ).get(pdfId) as { file_path: string } | undefined

    const pdfFileName = pdfInfo?.file_path ? path.basename(pdfInfo.file_path) : '当前文档'

    const hasImages = images && images.length > 0
    const screenshotGuidance = hasImages
      ? '\n\n## Screenshot\nA screenshot is attached. Use your vision to analyze it directly. Then use search_docs to find related document content for additional context.'
      : ''

    const tools = createTools(pdfId, config)
    const toolNode = new ToolNode(tools as any)

    // 1. 创建两个模型实例：一个带工具绑定，一个不带
    const modelWithTools = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0.05,
      configuration: { baseURL: config.baseUrl },
      timeout: 120000,
    }).bindTools(tools)

    const modelWithoutTools = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0.05,
      configuration: { baseURL: config.baseUrl },
      timeout: 120000,
    })

    // 2. 从消息历史实时统计已执行的工具调用次数（避免并发计数错误）
    function countToolCallsFromHistory(state: typeof MessagesAnnotation.State): number {
      let count = 0
      for (const msg of state.messages) {
        const m = msg as any
        // 统计 AI 消息中实际发出的 tool_calls 数量
        if (m.tool_calls && Array.isArray(m.tool_calls)) {
          count += m.tool_calls.length
        }
      }
      return count
    }

    // 3. 动态控制节点调用哪个模型
    async function callModel(state: typeof MessagesAnnotation.State) {
      const executedToolCalls = countToolCallsFromHistory(state)
      // 如果已经达到了 2 次工具调用上限，这一次坚决不再绑定工具，逼迫模型必须总结陈词
      const activeModel = executedToolCalls >= 2 ? modelWithoutTools : modelWithTools
      const response = await activeModel.invoke(state.messages)

      if ('tool_calls' in response && response.tool_calls?.length) {
        for (const tc of (response as any).tool_calls) {
          steps.push({
            step: steps.length + 1,
            tool: tc.name,
            input: JSON.stringify(tc.args),
          })
        }
      } else {
        steps.push({
          step: steps.length + 1,
          tool: '(final answer)',
          input: '',
          output: String(response.content || '').substring(0, 200)
        })
      }
      return { messages: [response] }
    }

    // 4. 干净纯粹的路由条件（从 state 实时统计，不依赖外部计数器）
    function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | '__end__' {
      const lastMessage: any = state.messages[state.messages.length - 1]
      
      // 如果模型没有调用工具，正常退出
      if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
        return '__end__'
      }
      
      // 实时统计已执行的工具调用总数
      const executedToolCalls = countToolCallsFromHistory(state)
      
      // 如果已经达到或超过 2 次工具调用，强制结束
      if (executedToolCalls >= 2) {
        return '__end__'
      }

      return 'tools'
    }

    const workflow = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNode as any)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent')

    const app = workflow.compile()

    const SYSTEM_PROMPT = `You are a precise, helpful document assistant. Current document: ${pdfFileName}

## Tool Usage Guidelines
- search_docs / get_page / summarize_document → work on the currently opened PDF (always try these first!)
- web_search → ONLY if user explicitly requires real-time/live news/data from internet
- search_arxiv → ONLY for explicit academic paper lookup requests

## Execution Rules (Hard Limits)
1. **ONE tool call MAX per turn**
2. **MAX 2 tool calls TOTAL per user query**
3. **DO NOT retry the same tool after any failure/empty result**
4. **If you get useful results from tools, synthesize the final answer immediately**
5. Established common knowledge before year 2023 → you may answer directly without tools.${screenshotGuidance}`

    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }]
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content })
    }
    if (hasImages) {
      const contentParts: any[] = [{ type: 'text', text: query }]
      for (const img of images!) {
        contentParts.push({ type: 'image_url', image_url: { url: img } })
      }
      messages.push({ role: 'user', content: contentParts })
    } else {
      messages.push({ role: 'user', content: query })
    }

    // 4. 放大 recursionLimit 确保 2 次工具流顺畅闭环
    const finalState = await app.invoke({ messages }, { recursionLimit: 10 })

    // 5. 过滤掉只有 tool_calls 却没有文本的中间过程消息，精准提取最终文本
    let finalOutput = ''
    for (let i = finalState.messages.length - 1; i >= 0; i--) {
      const msg: any = finalState.messages[i]
      // 只取 AI 消息且有实际文本内容的
      if (msg._getType && msg._getType() === 'ai' && msg.content && String(msg.content).trim()) {
        finalOutput = String(msg.content)
        break
      }
      // 兼容处理：有些消息可能没有 _getType 方法
      if (!msg._getType && msg.content && String(msg.content).trim() && !msg.tool_calls) {
        finalOutput = String(msg.content)
        break
      }
    }

    return {
      success: true,
      output: finalOutput || '(Agent did not produce a valid output)',
      steps
    }
  } catch (e) {
    return {
      success: false,
      error: `LangGraph Agent: ${(e as any).message || String(e)}`,
      steps
    }
  }
}

// ========== 多文档 Agent 支持 ==========

function createMultiDocTools(pdfIds: string[], config: AgentConfig) {
  const http = getAxiosFromElectronNet()

  const searchDocsTool = tool(
    async ({ query }: any) => {
      try {
        const result: any = await advancedRAGSearchMulti(pdfIds, query, config as any, {
          topK: 5,
          expandQueries: false,
          enableCompression: false,
          vectorWeight: 0.6,
          keywordWeight: 0.4
        })
        if (!result || !result.chunks || result.chunks.length === 0) return 'No relevant content found.'

        // 按文档分组输出
        const docGroups: Record<string, string[]> = {}
        for (const chunk of result.chunks) {
          const docName = chunk.fileName || 'Document'
          if (!docGroups[docName]) docGroups[docName] = []
          docGroups[docName].push(`[page ${chunk.pageNumber}]\n${chunk.content}`)
        }

        return Object.entries(docGroups).map(([docName, chunks]) =>
          `## ${docName}\n${chunks.join('\n\n---\n\n')}`
        ).join('\n\n')
      } catch (err: any) {
        return `Search failed: ${err?.message || String(err)}`
      }
    },
    {
      name: 'search_docs',
      description: 'Semantic search across ALL selected PDF documents. Results are grouped by document.',
      schema: z.object({ query: z.string().describe('Search keywords') })
    }
  )

  const summarizeDocumentsTool = tool(
    async () => {
      const db = getDatabase()
      const results: string[] = []

      for (const pdfId of pdfIds) {
        const chunks = db.prepare(
          `SELECT content FROM pdf_chunks WHERE pdf_id = ? ORDER BY chunk_index LIMIT 10`
        ).all(pdfId) as any[]

        const pdfInfo = db.prepare(
          'SELECT DISTINCT file_path FROM pdf_chunks WHERE pdf_id = ? LIMIT 1'
        ).get(pdfId) as { file_path: string } | undefined
        const fileName = pdfInfo?.file_path ? path.basename(pdfInfo.file_path) : 'Document'

        if (chunks.length > 0) {
          results.push(`[${fileName}]\n${chunks.map((c: any) => c.content).join('\n\n').substring(0, 3000)}`)
        } else {
          results.push(`[${fileName}]\n(No indexed content available.)`)
        }
      }

      return results.join('\n\n---\n\n')
    },
    {
      name: 'summarize_documents',
      description: 'Get summary material from ALL selected PDF documents. Returns up to 10 chunks per document for comprehensive understanding.',
      schema: z.object({})
    }
  )

  const getPageTool = tool(
    async ({ pageNumber, documentIndex }: any) => {
      const db = getDatabase()
      const pdfId = pdfIds[documentIndex - 1] // 1-based index
      if (!pdfId) return `Invalid document index: ${documentIndex}`
      
      const rows = db.prepare(
        `SELECT content FROM pdf_chunks WHERE pdf_id = ? AND page_number = ? ORDER BY chunk_index`
      ).all(pdfId, pageNumber) as any[]
      if (!rows || rows.length === 0) return `Page ${pageNumber} is empty or not found.`
      
      const pdfInfo = db.prepare('SELECT DISTINCT file_path FROM pdf_chunks WHERE pdf_id = ? LIMIT 1').get(pdfId) as { file_path: string } | undefined
      const fileName = pdfInfo?.file_path ? path.basename(pdfInfo.file_path) : 'Document'
      
      return `[${fileName} - Page ${pageNumber}]\n${rows.map((c: any) => c.content).join('\n').substring(0, 3000)}`
    },
    {
      name: 'get_page',
      description: 'Get full content of a specific page from a specific document.',
      schema: z.object({
        pageNumber: z.coerce.number().int().min(1).describe('page number starting at 1'),
        documentIndex: z.coerce.number().int().min(1).describe('document index (1 for first document, 2 for second, etc.)')
      })
    }
  )

  const webSearchTool = tool(
    async ({ query }) => {
      try {
        const searchUrl = `https://search.tinyfish.ai/api/search?query=${encodeURIComponent(query)}&lang=zh-CN`
        const res = await http.get(searchUrl)
        const results = res.data?.value || []
        if (!results.length) return `No search results found for query: ${query}`
        return results.map((r: any, i: number) =>
          `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet || ''}`
        ).join('\n\n').substring(0, 4000)
      } catch (e) {
        return `Web search failed: ${(e as any).code || 'network error'}`
      }
    },
    {
      name: 'web_search',
      description: 'Search online for real-time/live information or news.',
      schema: z.object({ query: z.string().describe('Search query') })
    }
  )

  const searchArxivTool = tool(
    async ({ query }) => {
      try {
        const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3`
        const res = await http.get(url)
        return String(res.data).substring(0, 2500)
      } catch (e) {
        return `arXiv API failed: ${(e as any).response?.status || e}`
      }
    },
    {
      name: 'search_arxiv',
      description: 'Search academic research papers.',
      schema: z.object({
        query: z.string().describe('English keywords preferred'),
        max_results: z.number().optional()
      })
    }
  )

  return [searchDocsTool, summarizeDocumentsTool, getPageTool, webSearchTool, searchArxivTool]
}

export async function runReActAgentMultiWithHistoryLangGraph(
  query: string,
  pdfIds: string[],
  config: AgentConfig,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  images?: string[],
): Promise<AgentResult> {
  const steps: AgentStep[] = []

  try {
    const db = getDatabase()
    
    // 检查所有文档的索引状态
    const placeholders = pdfIds.map(() => '?').join(',')
    const indexStatus = db.prepare(
      `SELECT pdf_id, COUNT(*) as total FROM pdf_chunks WHERE pdf_id IN (${placeholders}) GROUP BY pdf_id`
    ).all(...pdfIds) as { pdf_id: string; total: number }[]

    if (indexStatus.length === 0) {
      return { success: false, error: '所有 PDF 尚未建立索引，请先打开 PDF 等待自动索引' }
    }

    const indexedPdfIds = indexStatus.map(s => s.pdf_id)
    const missingPdfIds = pdfIds.filter(id => !indexedPdfIds.includes(id))
    
    if (missingPdfIds.length > 0) {
      console.warn(`[Agent Multi] 以下 PDF 未索引: ${missingPdfIds.join(', ')}`)
    }

    // 动态工具调用限额：基础 2 次 + 每文档 1 次，上限 8 次
    const maxToolCalls = Math.min(2 + indexedPdfIds.length, 8)

    // 获取所有文档的文件名
    const pdfFileNames = indexedPdfIds.map(pdfId => {
      const pdfInfo = db.prepare(
        'SELECT DISTINCT file_path FROM pdf_chunks WHERE pdf_id = ? LIMIT 1'
      ).get(pdfId) as { file_path: string } | undefined
      return pdfInfo?.file_path ? path.basename(pdfInfo.file_path) : '文档'
    })

    const hasImages = images && images.length > 0
    const screenshotGuidance = hasImages
      ? '\n\n## Screenshot\nA screenshot is attached. Use your vision to analyze it directly. Then use search_docs to find related document content for additional context.'
      : ''

    const tools = createMultiDocTools(indexedPdfIds, config)
    const toolNode = new ToolNode(tools as any)

    // 1. 创建两个模型实例
    const modelWithTools = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0.05,
      configuration: { baseURL: config.baseUrl },
      timeout: 120000,
    }).bindTools(tools)

    const modelWithoutTools = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0.05,
      configuration: { baseURL: config.baseUrl },
      timeout: 120000,
    })

    // 2. 工具调用计数（累加所有 tool_calls 的 length，与单文档版本一致）
    function countToolCallsFromHistory(state: typeof MessagesAnnotation.State): number {
      let count = 0
      for (const msg of state.messages) {
        const m = msg as any
        if (m.tool_calls && Array.isArray(m.tool_calls)) {
          count += m.tool_calls.length
        }
      }
      return count
    }

    // 3. Agent 节点
    async function callModel(state: typeof MessagesAnnotation.State): Promise<any> {
      const executedToolCalls = countToolCallsFromHistory(state)

      // 如果已经达到工具调用上限，使用无工具模型生成最终答案
      if (executedToolCalls >= maxToolCalls) {
        const response = await modelWithoutTools.invoke(state.messages)
        steps.push({
          step: steps.length + 1,
          tool: '(final answer)',
          input: '',
          output: String(response.content || '').substring(0, 200)
        })
        return { messages: [response] }
      }

      const response = await modelWithTools.invoke(state.messages)

      if ('tool_calls' in response && response.tool_calls?.length) {
        for (const tc of (response as any).tool_calls) {
          steps.push({
            step: steps.length + 1,
            tool: tc.name,
            input: JSON.stringify(tc.args),
          })
        }
      }

      return { messages: [response] }
    }

    // 4. 路由条件
    function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | '__end__' {
      const lastMessage: any = state.messages[state.messages.length - 1]

      if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
        return '__end__'
      }

      const executedToolCalls = countToolCallsFromHistory(state)

      if (executedToolCalls >= maxToolCalls) {
        return '__end__'
      }

      return 'tools'
    }

    const workflow = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNode as any)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent')

    const app = workflow.compile()

    const docListStr = pdfFileNames.map(name => `- ${name}`).join('\n')

    const SYSTEM_PROMPT = `You are a precise, helpful document assistant. You have access to ${pdfFileNames.length} documents:
${docListStr}

## Tool Usage Guidelines
- search_docs → Search across ALL selected documents (results are grouped by document)
- summarize_documents → Get summary from ALL selected documents (returns up to 10 chunks per document)
- get_page → Get specific page from a specific document (use documentIndex: 1, 2, 3...)
- web_search → ONLY if user explicitly requires real-time/live news/data from internet
- search_arxiv → ONLY for explicit academic paper lookup requests

## Execution Rules
1. **ONE tool call per turn**
2. **If you get useful results from tools, synthesize the final answer immediately**
3. **When summarizing multiple documents, use summarize_documents tool**
4. Established common knowledge before year 2023 → you may answer directly without tools.${screenshotGuidance}`

    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }]
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content })
    }
    if (hasImages) {
      const contentParts: any[] = [{ type: 'text', text: query }]
      for (const img of images!) {
        contentParts.push({ type: 'image_url', image_url: { url: img } })
      }
      messages.push({ role: 'user', content: contentParts })
    } else {
      messages.push({ role: 'user', content: query })
    }

    const finalState = await app.invoke({ messages }, { recursionLimit: maxToolCalls * 2 + 2 })

    // 提取最终文本
    let finalOutput = ''
    for (let i = finalState.messages.length - 1; i >= 0; i--) {
      const msg: any = finalState.messages[i]
      if (msg._getType && msg._getType() === 'ai' && msg.content && String(msg.content).trim()) {
        finalOutput = String(msg.content)
        break
      }
      if (!msg._getType && msg.content && String(msg.content).trim() && !msg.tool_calls) {
        finalOutput = String(msg.content)
        break
      }
    }

    return {
      success: true,
      output: finalOutput || '(Agent did not produce a valid output)',
      steps
    }
  } catch (e) {
    return {
      success: false,
      error: `LangGraph Agent Multi: ${(e as any).message || String(e)}`,
      steps
    }
  }
}
