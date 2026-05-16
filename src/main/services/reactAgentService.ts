import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { getDatabase } from '../db'
import { advancedRAGSearch } from './advancedRAGService'
import path from 'path'
import { net } from 'electron'
import { AIMessage } from '@langchain/core/messages'
import { XMLParser } from 'fast-xml-parser'
import { compressToolResult } from './compressToolResult'
import axios from 'axios'
import { Readable } from 'stream'

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

async function fetchWithBrowser(url: string, goal: string, apiKey?: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (apiKey) {
        headers['X-API-Key'] = apiKey
      }
      
      const response = await axios.post(
        'https://agent.tinyfish.ai/v1/automation/run-sse',
        { url, goal },
        {
          headers,
          responseType: 'stream',
          timeout: 90000
        }
      )

      let resultData = ''
      let hasResult = false

      const stream = response.data as Readable

      stream.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n')

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataStr = line.substring(5).trim()
            if (!dataStr || dataStr === '[DONE]') continue

            try {
              const data = JSON.parse(dataStr)

              if (data.type === 'COMPLETE' && data.result) {
                hasResult = true
                if (typeof data.result === 'object') {
                  resultData = JSON.stringify(data.result, null, 2)
                } else {
                  resultData = String(data.result)
                }
              }
            } catch (e) {}
          }
        }
      })

      stream.on('end', () => {
        if (hasResult) {
          resolve(resultData)
        } else {
          resolve('无法获取网页内容')
        }
      })

      stream.on('error', (err: Error) => {
        reject(err)
      })

    } catch (err) {
      reject(err)
    }
  })
}

function createTools(pdfId: string, config: AgentConfig) {
  const db = getDatabase()
  let lastArxivRequestTime = 0

  const searchDocsTool = tool(
    async ({ query }: { query: string }) => {
      try {
        const result = await advancedRAGSearch(pdfId, query, config, {
          topK: 5,
          expandQueries: true,
          enableCompression: true,
          vectorWeight: 0.6,
          keywordWeight: 0.4
        })

        if (result.chunks.length === 0) {
          return '未找到相关内容'
        }

        return result.chunks.map(chunk =>
          `[第 ${chunk.pageNumber} 页${chunk.section ? ` - ${chunk.section}` : ''}]\n${chunk.content}`
        ).join('\n\n---\n\n')
      } catch (err: any) {
        return `搜索失败: ${err.message}`
      }
    },
    {
      name: 'search_docs',
      description: '搜索当前 PDF 文档中与问题相关的内容段落。适用于回答关于文档内容的问题。',
      schema: z.object({
        query: z.string().describe('用户的搜索问题')
      })
    }
  )

  const summarizeDocumentTool = tool(
    async (_: object) => {
      try {
        const allRows = db.prepare(`
          SELECT page_number, chunk_index, content, type, section
          FROM pdf_chunks WHERE pdf_id = ?
          ORDER BY page_number, chunk_index
        `).all(pdfId) as any[]

        if (allRows.length === 0) {
          return '没有找到文档内容'
        }

        const selectedChunks: string[] = []
        const priorityTypes = ['heading', 'abstract', 'conclusion']

        const importantChunks = allRows.filter(row => priorityTypes.includes(row.type))
        importantChunks.forEach(row => {
          selectedChunks.push(`[第 ${row.page_number} 页 - ${row.section || row.type}]\n${row.content}`)
        })

        const paragraphs = allRows.filter(row => row.type === 'paragraph' || !row.type)
        const maxParagraphs = Math.min(8, paragraphs.length)

        if (maxParagraphs > 0) {
          const step = Math.max(1, Math.floor(paragraphs.length / maxParagraphs))
          for (let i = 0; i < paragraphs.length && selectedChunks.length < 15; i += step) {
            selectedChunks.push(`[第 ${paragraphs[i].page_number} 页]\n${paragraphs[i].content}`)
          }
        }

        const captions = allRows.filter(row => row.type === 'caption')
        if (captions.length > 0 && selectedChunks.length < 18) {
          captions.slice(0, Math.min(3, 18 - selectedChunks.length)).forEach(row => {
            selectedChunks.push(`[第 ${row.page_number} 页 - 图表说明]\n${row.content}`)
          })
        }

        const model = new ChatOpenAI({
          apiKey: config.apiKey,
          model: config.model,
          temperature: 0.3,
          configuration: { baseURL: config.baseUrl }
        })

        const contextContent = selectedChunks.join('\n\n---\n\n')
        const prompt = `请帮我总结以下文档内容：

${contextContent}

要求：
1. 总结应包括：研究背景、主要方法、关键发现、结论
2. 语言简洁清晰，不要超过 500 字
3. 如果内容不足以全面总结，请说明局限性`

        const response = await model.invoke([
          { role: 'system', content: '你是一个专业的学术论文总结助手，擅长总结研究论文的核心内容。' },
          { role: 'user', content: prompt }
        ])

        return response.content as string

      } catch (err: any) {
        return `总结失败: ${err.message}`
      }
    },
    {
      name: 'summarize_document',
      description: '总结整个 PDF 文档的主要内容。适用于用户询问文档整体内容、摘要等泛化问题。',
      schema: z.object({})
    }
  )

  const getPageTool = tool(
    async ({ page }: { page: number }) => {
      try {
        if (isNaN(page) || page < 1) {
          return '请输入有效的页码（正整数）'
        }

        const chunks = db.prepare(`
          SELECT content, type, section
          FROM pdf_chunks
          WHERE pdf_id = ? AND page_number = ?
          ORDER BY chunk_index ASC
        `).all(pdfId, page) as any[]

        if (chunks.length === 0) {
          return `未找到第 ${page} 页的内容`
        }

        const pageContent = chunks.map(c => {
          let prefix = ''
          if (c.section) prefix = `[${c.section}] `
          if (c.type && c.type !== 'paragraph') prefix += `(${c.type}) `
          return prefix + c.content
        }).join('\n\n')

        return `[第 ${page} 页完整内容]\n${pageContent}`
      } catch (err: any) {
        return `获取页面失败: ${err.message}`
      }
    },
    {
      name: 'get_page',
      description: '获取指定页码的完整内容。',
      schema: z.object({
        page: z.number().describe('页码数字')
      })
    }
  )

  const webSearchTool = tool(
    async ({ query }: { query: string }) => {
      try {
        const searchUrl = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`
        
        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        if (config.webSearchApiKey) {
          headers['X-API-Key'] = config.webSearchApiKey
        }
        
        const searchResponse = await net.fetch(searchUrl, {
          method: 'GET',
          headers
        })

        if (!searchResponse.ok) {
          return `搜索服务暂时不可用 (HTTP ${searchResponse.status})`
        }

        const searchData = await searchResponse.json()

        if (!searchData.results || searchData.results.length === 0) {
          return `未找到关于 "${query}" 的网络信息`
        }

        const topResults = searchData.results.slice(0, 3)
        const results: Array<{ title: string; url: string; content: string }> = []

        for (const result of topResults) {
          try {
            const browserResult = await fetchWithBrowser(
              result.url,
              `Extract the key information related to "${query}". Return the most relevant data in a structured format.`,
              config.webSearchApiKey
            )
            results.push({
              title: result.title,
              url: result.url,
              content: browserResult || result.snippet || '无法提取内容'
            })
          } catch (err) {
            results.push({
              title: result.title,
              url: result.url,
              content: result.snippet || '抓取失败'
            })
          }
        }

        const formattedResults = results.map((r, idx) => {
          const content = r.content.length > 2000 ? r.content.substring(0, 2000) + '...' : r.content
          return `[${idx + 1}] ${r.title}\n来源: ${r.url}\n\n内容:\n${content}`
        })

        return `【网络搜索结果】\n\n${formattedResults.join('\n\n---\n\n')}`

      } catch (err: any) {
        return `网络搜索失败: ${err.message}`
      }
    },
    {
      name: 'web_search',
      description: '联网搜索并获取网页完整内容。当用户询问实时信息（股价、天气、新闻、汇率等）时使用。',
      schema: z.object({
        query: z.string().describe('搜索关键词')
      })
    }
  )

  const searchArxivTool = tool(
    async ({ query, max_results }: { query: string; max_results?: number }) => {
      const now = Date.now()
      const waitTime = Math.max(0, 3000 - (now - lastArxivRequestTime))
      if (waitTime > 0) await new Promise(resolve => setTimeout(resolve, waitTime))
      lastArxivRequestTime = Date.now()

      try {
        const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=${max_results || 3}`
        const response = await net.fetch(url, { method: 'GET' })
        const text = await response.text()

        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
        const jsonObj = parser.parse(text)
        const entries = jsonObj.feed.entry

        if (!entries) return '未找到相关论文。'

        const results = (Array.isArray(entries) ? entries : [entries]).map((entry: any) => {
          const authors = Array.isArray(entry.author)
            ? entry.author.map((a: any) => a.name).join(', ')
            : entry.author.name

          return `### ${entry.title.replace(/\n/g, ' ')}
- **作者**: ${authors}
- **发布日期**: ${entry.published}
- **ID**: ${entry.id.split('/abs/')[1]}
- **摘要**: ${entry.summary.replace(/\n/g, ' ').substring(0, 500)}...
- **PDF链接**: ${entry.id.replace('/abs/', '/pdf/')}.pdf
---`
        }).join('\n')

        return results
      } catch (error: any) {
        return '搜索 arXiv 时出错，请稍后重试。'
      }
    },
    {
      name: 'search_arxiv',
      description: '从 arXiv 学术库搜索论文。可以按标题(ti)、作者(au)或全文(all)搜索。返回论文摘要、作者和PDF链接。',
      schema: z.object({
        query: z.string().describe('搜索关键词，例如 "ti:Attention is all you need" 或 "all:transformer"'),
        max_results: z.number().optional().describe('返回结果数量，默认3，最大10')
      })
    }
  )

  return [searchDocsTool, summarizeDocumentTool, getPageTool, webSearchTool, searchArxivTool]
}

export async function runReActAgentWithHistory(
  query: string,
  pdfId: string,
  config: AgentConfig,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  images?: string[]
): Promise<AgentResult> {
  const steps: AgentStep[] = []

  try {
    const db = getDatabase()
    const indexStatus = db.prepare(
      'SELECT COUNT(*) as total FROM pdf_chunks WHERE pdf_id = ?'
    ).get(pdfId) as { total: number }

    if (indexStatus.total === 0) {
      return {
        success: false,
        error: '该 PDF 尚未建立索引，请先打开 PDF 等待自动索引'
      }
    }

    const pdfInfo = db.prepare(
      'SELECT DISTINCT file_path FROM pdf_chunks WHERE pdf_id = ? LIMIT 1'
    ).get(pdfId) as { file_path: string } | undefined

    const pdfFileName = pdfInfo?.file_path ? path.basename(pdfInfo.file_path) : '当前文档'

    const tools = createTools(pdfId, config)
    const toolsMap = Object.fromEntries(tools.map(t => [t.name, t]))

    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      configuration: {
        baseURL: config.baseUrl
      }
    })

    const modelWithTools = model.bindTools(tools)

    const systemPrompt = `你是一个专业的 PDF 文档阅读助手。

当前正在查看的文档：${pdfFileName}

你可以使用以下工具来回答用户问题：
- search_docs: 搜索 PDF 文档内容
- summarize_document: 总结整个文档
- get_page: 获取指定页码内容
- web_search: 联网搜索（用于实时信息，如股价、天气、新闻等，支持 JavaScript 渲染的动态网页）
- search_arxiv: 搜索 arXiv 学术论文

**重要规则**：
1. 如果需要信息，必须调用工具
2. 禁止编造数据，必须基于工具返回的真实结果回答
3. 先调用工具获取信息，再回答用户问题`

    const messages: any[] = [
      { role: 'system', content: systemPrompt }
    ]

    for (const msg of history) {
      messages.push({
        role: msg.role,
        content: msg.content
      })
    }

    if (images && images.length > 0) {
      const contentParts: any[] = [
        { type: 'text', text: query }
      ]
      for (const imageUrl of images) {
        contentParts.push({ type: 'image_url', image_url: { url: imageUrl } })
      }
      messages.push({ role: 'user', content: contentParts })
    } else {
      messages.push({ role: 'user', content: query })
    }

    const maxSteps = 5
    let stepCount = 0

    while (stepCount < maxSteps) {
      stepCount++
      const response = await modelWithTools.invoke(messages) as AIMessage

      messages.push(response)

      if (!response.tool_calls || response.tool_calls.length === 0) {
        return {
          success: true,
          output: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
          steps
        }
      }

      for (const toolCall of response.tool_calls) {
        const selectedTool = toolsMap[toolCall.name]

        if (!selectedTool) {
          return {
            success: false,
            error: `未知工具: ${toolCall.name}`,
            steps
          }
        }

        steps.push({
          step: stepCount,
          tool: toolCall.name,
          input: JSON.stringify(toolCall.args)
        })

        // 使用类型断言来解决类型不兼容问题
        const rawResult = await (selectedTool as any).invoke(toolCall.args)
        const compressedResult = compressToolResult(toolCall.name, rawResult as string, query)

        steps[steps.length - 1].output = compressedResult.substring(0, 200)

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: compressedResult
        })
      }
    }

    return {
      success: false,
      error: '超过最大推理步数（5步）',
      steps
    }

  } catch (err: any) {
    return {
      success: false,
      error: `Agent 执行失败: ${err.message}`,
      steps
    }
  }
}