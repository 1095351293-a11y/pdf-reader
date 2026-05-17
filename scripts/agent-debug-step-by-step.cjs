const axios = require('axios')
require('dotenv').config()

const config = {
  baseUrl: (process.env.AI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, ''),
  apiKey: process.env.AI_API_KEY || '0aa014847c2f4ac49e11b0f1fef2c163.p7mYggmMWYEXjs5U',
  model: process.env.AI_MODEL || 'GLM-4.6v',
}

const TEST_QUERY = process.argv[2] || '你知道什么是布朗运动吗'
console.log('╔═══════════════════════════════════════════════════════════╗')
console.log('║      Agent 全链路 Debug 模式 - 打印每轮完整收发内容          ║')
console.log('╚═══════════════════════════════════════════════════════════╝\n')
console.log(`用户问题: "${TEST_QUERY}"\n`)

async function web_search(args) {
  const query = args.query || ''
  console.log(`\n  >>> [工具调用] web_search: query="${query}"`)
  try {
    const searchUrl = `https://search.tinyfish.ai/api/search?query=${encodeURIComponent(query)}&lang=zh-CN`
    console.log(`  >>> GET ${searchUrl.substring(0,100)}...`)
    const searchRes = await axios.get(searchUrl, { timeout: 15000 })
    const results = searchRes.data?.value || []
    const fullText = (results||[]).map((r,i)=>{
      return `#${i+1} ${r.title}\n${r.url}\n${r.snippet||''}`
    }).join('\n---\n')
    console.log(`  >>> [工具返回] ${results.length} 条结果, 总长度 ${String(fullText).length} 字符`)
    if (fullText) console.log(`  >>> 前 300 字符:\n${fullText.substring(0,300)}\n`)
    return fullText || `No results for ${query}`
  } catch(e) {
    console.log(`  >>> [工具异常] ${e.message}`)
    return `Search failed: ${e.message}`
  }
}

async function search_arxiv(args) {
  const query = args.query || ''
  console.log(`\n  >>> [工具调用] search_arxiv: query="${query}"`)
  try {
    const arxivUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3`
    console.log(`  >>> GET ${arxivUrl}`)
    const res = await axios.get(arxivUrl, { timeout:10000 })
    const text = String(res.data||'')
    console.log(`  >>> [工具返回] arxiv, 长度 ${text.length} 字符`)
    console.log(`  >>> 前 200 字符:\n${text.substring(0,200)}\n`)
    return text.substring(0, 2000)
  } catch(e) {
    console.log(`  >>> [工具异常] ${e.message}`)
    return `arXiv failed: ${e.message}`
  }
}

const TOOLS_DEFINITION = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Get real-time info from web search.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_arxiv',
      description: 'Search arXiv academic papers.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
]

const SYSTEM_PROMPT = `You are a helpful and precise document assistant, specialized in answering questions based on provided context and tools.

You have access to the following tools:
- web_search: For real-time information, news, live data (e.g., current prices, weather, today's statistics) or recent events.
- search_arxiv: Only for searching academic research papers from arXiv.

## Core Instructions

1. **Tool Calling Policy**
   - 👍 DO use tools for: live/real-time data, specific facts you are uncertain about, recent events, academic paper lookups, numbers that change over time.
   - 👎 DO NOT use tools for: common general knowledge that is widely accepted as established facts (e.g., basic physics definitions, historical facts before 2020, mathematical constants, standard formulas).

2. **When to Respond Directly**
   - If the question is about established, common knowledge concepts (e.g., "what is Brownian motion", "water chemical formula", "Einstein's theory of relativity").
   - Simply provide the answer directly, clearly and concisely without attempting to call any tool.

3. **Stopping Conditions & Guardrails**
   - If tool result already sufficiently answers the user's question, stop iterating and synthesize final answer.
   - **Maximum 2 tool calls total per query**.
   - **If a tool call fails (e.g., network error, empty result) DO NOT retry the same tool more than once**. Give a polite fallback explanation instead of loop retrying.

Always think: "Am I 100% confident this is common knowledge?" If yes, answer directly. If no, choose the single best tool (max 2 tools total).`

async function debugAgent() {
  const maxSteps = 5
  let stepCount = 0
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: TEST_QUERY }
  ]
  const globalStart = Date.now()

  console.log('\n' + '═'.repeat(70))
  console.log('System Prompt:')
  console.log(SYSTEM_PROMPT)
  console.log('═'.repeat(70))

  while (stepCount < maxSteps) {
    stepCount++
    console.log(`\n\n┌──────────────────────────────────────────────────────────────┐`)
    console.log(`│  🛜   SENDING STEP ${stepCount} / ${maxSteps}  ...`)
    console.log(`└──────────────────────────────────────────────────────────────┘`)

    const payload = {
      model: config.model,
      messages: messages.map(x=> ({...x})),
      tools: TOOLS_DEFINITION,
      tool_choice: 'auto',
      temperature: 0.1
    }

    // 打印发送的完整 messages
    for (let i=0; i<payload.messages.length; i++) {
      const m = payload.messages[i]
      if (m.role === 'tool') {
        console.log(`[Msg${i}] 🛠️  tool(${m.tool_call_id}): ${String(m.content).substring(0,80)} ... (len=${String(m.content).length})`)
      } else if (m.tool_calls) {
        console.log(`[Msg${i}] 🤖 ASSISTANT tool_calls: ${m.tool_calls.map(x=>x.function.name).join(',')}`)
      } else {
        const short = String(m.content||'').replace(/\n/g,'\\n').substring(0,70)
        console.log(`[Msg${i}] ${m.role.toUpperCase()}: "${short}${short.length>69?'...':''}"`)
      }
    }

    const stepT0 = Date.now()
    try {
      console.log(`\n  🚀 POST ${config.baseUrl}/chat/completions ...`)
      const res = await axios.post(
        `${config.baseUrl}/chat/completions`,
        payload,
        { headers: { Authorization: `Bearer ${config.apiKey}` }, timeout: 120000 }
      )
      const msg = res.data.choices?.[0]?.message
      const stepTook = Date.now() - stepT0
      console.log(`  ✅  HTTP 回来 (${stepTook}ms). 现在看 response:`)

      const hasTool = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0

      if (hasTool) {
        console.log(`\n  ⚠️  模型选择调用工具 (tool_choice NOT none)`)
        for (const tc of msg.tool_calls) {
          console.log(`      - ${tc.id}: ${tc.function.name}(${tc.function.arguments})`)
        }
        const nextMsg = { role: 'assistant' }
        nextMsg.tool_calls = msg.tool_calls
        messages.push(nextMsg)

        // 执行工具
        for (const tc of msg.tool_calls) {
          let funcArgs = {}
          try { funcArgs = JSON.parse(tc.function.arguments || '{}') } catch {}
          let resultContent = ''
          if (tc.function.name === 'web_search') resultContent = await web_search(funcArgs)
          else if (tc.function.name === 'search_arxiv') resultContent = await search_arxiv(funcArgs)
          else resultContent = `Unknown tool ${tc.function.name}`

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: resultContent
          })
        }
      } else {
        console.log(`\n  🎉 模型输出最终答案 (no tool_calls). 回答:\n`)
        const final = msg?.content || ''
        console.log(final.substring(0, 600))
        if (final.length > 600) console.log(`... (total ${final.length} chars)`)
        console.log(`\n\n┌──────────────────────────────────────────────────────────────┐`)
        console.log(`│  🏁  完成! 总步骤: ${stepCount} / 总耗时: ${Date.now()-globalStart}ms  `)
        console.log(`└──────────────────────────────────────────────────────────────┘\n`)
        return
      }
    } catch (e) {
      console.error(`  ❌  HTTP 失败:`, e.response?.data?.error || e.message)
      return
    }
  }

  console.log(`\n  ⏰ 超过最大步数 ${maxSteps}, 停止`)
}

debugAgent()
