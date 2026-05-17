const path = require('path')
const os = require('os')
const Module = require('module')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') {
            return path.join(os.tmpdir(), 'pdf-reader-test')
          }
          return os.tmpdir()
        }
      },
      net: {
        fetch: (input, init) => {
          const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))
          return fetch(input, init)
        }
      }
    }
  }
  if (request.match(/better-sqlite3/)) {
    throw new Error('Do not load better-sqlite3')
  }
  return originalLoad.apply(this, arguments)
}

async function main() {
  require('dotenv').config()

  const SINGLE_TURN_TESTS = [
    {
      category: '【纯常识类 - 不应调用工具】',
      tests: [
        { query: '水的沸点是多少摄氏度？', hint: '常识' },
        { query: '太阳系有几大行星？', hint: '常识' },
        { query: '李白是哪个朝代的诗人？', hint: '常识' },
      ]
    },
    {
      category: '【明确的实时信息 - 应调用 web_search】',
      tests: [
        { query: '今天比特币的价格是多少美元？', hint: '实时' },
        { query: '现在纳斯达克指数多少点？', hint: '实时' },
        { query: '今年春节是哪一天？', hint: '日历/实时' },
      ]
    },
    {
      category: '【学术搜索意图 - 应调用 search_arxiv】',
      tests: [
        { query: '找几篇最新的关于多模态大模型的论文', hint: '学术论文' },
        { query: '我想了解 Transformer 架构的原始论文', hint: '学术论文' },
        { query: '推荐几篇引用量高的强化学习论文', hint: '学术论文' },
      ]
    },
    {
      category: '【模糊问题 - 看模型自主判断】',
      tests: [
        { query: '人工智能未来发展前景怎么样？', hint: '开放问题' },
        { query: '给我推荐几本值得读的技术书籍', hint: '推荐' },
      ]
    },
  ]

  const MULTI_TURN_TESTS = [
    {
      name: '多轮对话场景 A：先问事实后追问',
      turns: [
        { role: 'user', content: '光速在真空中是多少？' },
        { role: '_expected_', action: 'answer', hint: '常识，直接回答' },
        { role: 'user', content: '那它在水中呢？' },
        { role: '_expected_', action: 'answer', hint: '"它"指代光速，继续回答常识' },
        { role: 'user', content: '这个速度是怎么测出来的？' },
        { role: '_expected_', action: 'answer', hint: '"这个"还是指代光速测量方法' },
      ]
    },
    {
      name: '多轮对话场景 B：先调用工具后基于结果追问',
      turns: [
        { role: 'user', content: '现在苹果的股价是多少？' },
        { role: '_expected_', action: 'tool', tool: 'web_search', hint: '实时股价' },
        { role: 'user', content: '那微软呢？' },
        { role: '_expected_', action: 'tool', tool: 'web_search', hint: '"呢"指代同样搜股价' },
        { role: 'user', content: '这两家公司今天市值分别是多少？' },
        { role: '_expected_', action: 'tool', tool: 'web_search', hint: '"这两家公司"指代上文苹果+微软' },
      ]
    },
    {
      name: '多轮对话场景 C：学术论文连续搜索',
      turns: [
        { role: 'user', content: '帮我找几篇关于 agent 的论文' },
        { role: '_expected_', action: 'tool', tool: 'search_arxiv', hint: '学术' },
        { role: 'user', content: '换个关键词，搜一下 multi-agent 相关的' },
        { role: '_expected_', action: 'tool', tool: 'search_arxiv', hint: '"换个关键词"上下文继续学术搜索' },
        { role: 'user', content: 'multi-agent 主要应用在哪些领域？' },
        { role: '_expected_', action: 'answer', hint: '可基于常识总结，不需再搜' },
      ]
    },
  ]

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    PDF 阅读器 Agent 全面测试                    ║')
  console.log('║                                                              ║')
  console.log('║   包含: 单轮决策 + 多轮上下文理解 + 指代消解 + 连续追问        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log()

  const config = {
    provider: process.env.AI_PROVIDER || 'openai',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  }

  console.log(`配置:`)
  console.log(`  - Provider: ${config.provider}`)
  console.log(`  - Base URL: ${config.baseUrl}`)
  console.log(`  - Model: ${config.model}`)
  console.log()

  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  const TOOLS_DEFINITION = [
    {
      type: 'function',
      function: {
        name: 'search_arxiv',
        description: '从 arXiv 学术库搜索论文。可以按标题(ti)、作者(au)或全文(all)搜索。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索并获取网页内容。当用户询问实时信息（如股价、天气、新闻等）时使用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['query'],
        },
      },
    },
  ]

  const SYSTEM_PROMPT = `你是一个专业的 PDF 文档阅读助手。

你可以使用以下工具来回答用户问题：
- search_docs: 搜索 PDF 文档内容
- search_arxiv: 搜索 arXiv 学术论文
- web_search: 联网搜索（实时信息，如股价、天气、新闻等）

重要规则：
1. 如果需要外部信息，必须调用工具
2. 如果是常识直接回答即可，不需要工具
3. 优先选用最合适的工具来回答问题
4. 结合上下文理解用户的指代（如"它"、"这个"、"这两家公司"等）`

  const axios = require('axios')
  const allResults = []

  async function callWithChatHistory(messages) {
    const t0 = Date.now()
    try {
      const res = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: config.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages,
          ],
          tools: TOOLS_DEFINITION,
          tool_choice: 'auto',
          temperature: 0.1,
        },
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000,
        }
      )
      const msg = res.data.choices?.[0]?.message
      const duration = Date.now() - t0
      return { success: true, msg, duration, toolCalls: msg?.tool_calls || [] }
    } catch (err) {
      return { success: false, error: err.message, duration: Date.now() - t0, toolCalls: [] }
    }
  }

  // ========== 第一部分：单轮决策测试 ============
  console.log('\n' + '═'.repeat(70))
  console.log('PART 1: 单轮决策测试（验证"什么时候调用什么工具"的判断）')
  console.log('═'.repeat(70))

  for (const group of SINGLE_TURN_TESTS) {
    console.log(`\n${group.category}\n`)
    for (const tc of group.tests) {
      const r = await callWithChatHistory([{ role: 'user', content: tc.query }])
      const action = r.toolCalls.length > 0
        ? `🔧 tool: [${r.toolCalls.map(x => x.function.name).join(', ')}]`
        : '💬 直接回答'
      const preview = r.msg?.content?.replace(/\n/g, ' ').substring(0, 40) || ''
      console.log(`  ${r.duration}ms | ${action.padEnd(35)} | Q: "${tc.query.substring(0,32)}${tc.query.length>32?'...':''}"`)
      if (r.toolCalls.length === 0 && preview) {
        console.log(`     >>> 回答预览: "${preview}..."`)
      }
      allResults.push({ type: 'single', query: tc.query, duration: r.duration, hasTool: r.toolCalls.length > 0 })
    }
  }

  // ========== 第二部分：多轮对话 + 指代消解测试 ============
  console.log('\n\n' + '═'.repeat(70))
  console.log('PART 2: 多轮对话与上下文理解 / 指代消解测试')
  console.log('═'.repeat(70))

  for (const scenario of MULTI_TURN_TESTS) {
    console.log(`\n📋 场景: ${scenario.name}`)
    console.log('─'.repeat(60))
    const messages = []
    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i]
      if (turn.role === 'user') {
        console.log(`  👤 User${i+1}: "${turn.content}"`)
        messages.push({ role: 'user', content: turn.content })
        const r = await callWithChatHistory(messages)
        if (r.success) {
          const action = r.toolCalls.length > 0
            ? `🔧 调用: [${r.toolCalls.map(x => x.function.name).join(', ')}]`
            : '💬 回答'
          console.log(`     🤖 Model${i+1}: ${action} (${r.duration}ms)`)
          if (r.toolCalls.length > 0) {
            r.toolCalls.forEach(tc => {
              console.log(`        args: ${tc.function.arguments}`)
            })
            messages.push({ role: 'assistant', content: 'I called tools.' })
          } else {
            const short = (r.msg.content || '').replace(/\n/g,' ').substring(0,50)
            console.log(`        ${short}...`)
            messages.push({ role: 'assistant', content: r.msg.content })
          }
          allResults.push({ type: 'multi-turn', query: turn.content, duration: r.duration, hasTool: r.toolCalls.length > 0 })
        } else {
          console.log(`     ❌ 失败: ${r.error}`)
        }
      }
    }
  }

  // ========== 汇总统计 ============
  console.log('\n\n')
  console.log('┌──────────────────────────────────────────────────────────────┐')
  console.log('│ 📊                         最终汇总                              │')
  console.log('└────────────────────────────────────────────────────────────────┘')
  console.log()
  const valid = allResults.filter(x => x.duration > 0)
  const totalTime = valid.reduce((s, x) => s + x.duration, 0)
  const avg = Math.round(totalTime / (valid.length || 1))
  const toolCallCount = valid.filter(x => x.hasTool).length

  console.log(`  总计提问: ${valid.length} 轮`)
  console.log(`  模型选择调用工具: ${toolCallCount} 轮 (${Math.round(toolCallCount/valid.length*100)}%)`)
  console.log(`  模型选择直接回答: ${valid.length - toolCallCount} 轮 (${Math.round((valid.length-toolCallCount)/valid.length*100)}%)`)
  console.log()
  console.log(`  ═════════════════════════════════`)
  console.log(`  平均响应时间: ${avg}ms`)
  console.log(`  全部测试总耗时: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`)
  console.log(`  ═════════════════════════════════`)
  console.log()
  console.log('(注：以上响应时间仅包含模型决策/首次token生成，不包含工具实际执行时间)')
  console.log()
}

main().catch((err) => {
  console.error('❌ 运行失败:', err)
  process.exit(1)
})
