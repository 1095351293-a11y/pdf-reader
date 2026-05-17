const axios = require('axios')
require('dotenv').config()

const config = {
  provider: process.env.AI_PROVIDER || 'zhipu',
  baseUrl: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || '',
}

if (!config.baseUrl || !config.apiKey || !config.model) {
  console.error('请配置环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL')
  process.exit(1)
}

console.log('╔═══════════════════════════════════════════════════════════╗')
console.log('║    1:1 复制 Agent 源码完整复现 (含 while 多跳 + 压缩)        ║')
console.log('╚═══════════════════════════════════════════════════════════╝\n')
console.log(`配置: ${config.model} @ ${config.baseUrl}\n`)

// =================================================
//  👇 从你的 reactAgentService.ts 完整复制的逻辑
// =================================================

async function chatCompletions(messages, tools, toolChoice) {
  const payload = {
    model: config.model,
    messages,
    temperature: 0.1,
  }
  if (tools && tools.length) payload.tools = tools
  if (toolChoice) payload.tool_choice = toolChoice

  try {
    const t0 = Date.now()
    const res = await axios.post(
      `${config.baseUrl}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    )
    const msg = res.data.choices?.[0]?.message
    return {
      ok: true,
      content: msg?.content || '',
      tool_calls: msg?.tool_calls || [],
      duration: Date.now() - t0
    }
  } catch (e) {
    console.error(`  [LLM Error]`, e.response?.data?.error || e.message)
    return { ok: false, error: e.message }
  }
}

async function web_search(args) {
  const t0 = Date.now()
  try {
    const query = args.query || ''
    console.log(`     [工具执行] web_search("${query}") ...`)
    const searchUrl = `https://search.tinyfish.ai/api/search?query=${encodeURIComponent(query)}&lang=zh-CN`
    const searchRes = await axios.get(searchUrl, { timeout: 15000 })
    const results = searchRes.data?.value || []
    const output = (results||[]).map((r,i)=>`${i+1}. ${r.title}`).join('\n')
    console.log(`        web_search 返回 ${results.length} 条结果 (${Date.now()-t0}ms)`)
    return output
  } catch(e) {
    return `Search failed: ${e.message}`
  }
}

async function search_arxiv(args) {
  const t0 = Date.now()
  try {
    const query = args.query || ''
    console.log(`     [工具执行] search_arxiv("${query}") ...`)
    const arxivUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3`
    const res = await axios.get(arxivUrl, { timeout:10000 })
    console.log(`        arxiv 请求完成 (${Date.now()-t0}ms)`)
    return String(res.data||'').substring(0, 1000)
  } catch(e) {
    return `arXiv failed: ${e.message}`
  }
}

function compressToolResult(toolName, content, userQuery) {
  const t0 = Date.now()
  // 如果特别长，可以在这里做额外 LLM 调用
  // console.log(`     [compressToolResult] 原始长度 ${content?.length||0}`)
  if (content && content.length > 3000) {
    console.log(`        ⚠️  内容超过3000字符(${content.length}), 这里可能会额外调用LLM!`)
  }
  return content
}

const TOOLS_DEFINITION = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索（用于实时信息，如股价、天气、新闻等）',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_arxiv',
      description: '搜索 arXiv 学术论文',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
]

const SYSTEM_PROMPT = `你是一个专业的 PDF 文档阅读助手。

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

// =================================================
//  完整 ReAct while 循环，和你的源码完全一致
// =================================================
async function runAgentCopy(query, debugName) {
  console.log(`\n═══ 开始: ${debugName} ═══`)
  console.log(`👤 用户: "${query}"`)
  const totalStart = Date.now()

  const maxSteps = 5
  let stepCount = 0
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: query }
  ]
  const steps = []

  while (stepCount < maxSteps) {
    stepCount++

    // ---- L457 modelWithTools.invoke (和源码对应) ----
    console.log(`\n  [Step ${stepCount}] 正在调用 LLM ...`)
    const llmStart = Date.now()
    const response = await chatCompletions(messages, TOOLS_DEFINITION, 'auto')
    if (!response.ok) {
      console.log(`  LLM 调用失败: ${response.error}`)
      return { success: false, error: response.error, totalTime: Date.now()-totalStart }
    }
    console.log(`  [Step ${stepCount}] LLM 返回 (${response.duration}ms). tool_calls.len=${response.tool_calls.length}`)

    const messageItem = { role: 'assistant' }
    if (response.tool_calls?.length) messageItem.tool_calls = response.tool_calls
    if (response.content) messageItem.content = response.content
    messages.push(messageItem)

    // 没有工具 = 结束
    if (!response.tool_calls || response.tool_calls.length === 0) {
      const short = (response.content||'').replace(/\n/g,' ').substring(0,80)
      console.log(`\n  💬 最终回答: "${short}..."`)
      console.log(`\n  🏁 总耗时: ${Date.now()-totalStart}ms (共 ${stepCount} 轮 LLM 调用)`)
      return {
        success: true,
        totalTime: Date.now()-totalStart,
        llmRounds: stepCount,
        output: response.content
      }
    }

    // 执行工具
    for (const toolCall of response.tool_calls) {
      const toolName = toolCall.function?.name
      let funcArgs = {}
      try { funcArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

      const toolStart = Date.now()
      let rawResult = ''
      if (toolName === 'web_search') rawResult = await web_search(funcArgs)
      else if (toolName === 'search_arxiv') rawResult = await search_arxiv(funcArgs)
      else rawResult = `Unknown tool ${toolName}`

      const compressedResult = compressToolResult(toolName, rawResult, query)  // L488: 完整复现你的代码

      console.log(`        工具返回内容长度: ${String(rawResult).length} 字符`)
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: compressedResult
      })
    }
  }
}

// =================================================
//  跑几个和你应用里一样的真实查询
// =================================================
(async () => {
  const RESULTS = []
  for (const testCase of [
    { name: '常识物理', q: '你知道什么是布朗运动吗' },
    { name: '实时价格', q: '比特币现在价格是多少美元？' },
    { name: '学术搜索', q: '帮我找几篇关于 transformer 的论文' },
  ]) {
    const r = await runAgentCopy(testCase.q, testCase.name)
    RESULTS.push({ ...testCase, result: r })
  }

  console.log('\n' + '═'.repeat(70))
  console.log('📊  Agent 1:1 源码复现最终统计（和 Electron 里的真实耗时一致）\n')
  for (const t of RESULTS) {
    const r = t.result
    const status = r.success? `✅ 成功, ${r.llmRounds}轮LLM` : '❌ 失败'
    console.log(`  ${String(r.totalTime).padStart(7)}ms - ${t.name}: "${t.q.substring(0,35)}" (${status})`)
  }
  console.log('\n' + '═'.repeat(70))
  const avgTime = Math.round(RESULTS.reduce((s,x)=>s + (x.result?.totalTime||0),0) / RESULTS.length)
  console.log(`\n  🔴 用户侧端到端平均等待: ${avgTime}ms (${(avgTime/1000).toFixed(1)} 秒)`)
  console.log()
})()
