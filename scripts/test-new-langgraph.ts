import 'dotenv/config'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

process.env.ELECTRON_RUN_AS_NODE = '1'

function initTestPDF() {
  const pdfId = 'test-pdf-id-12345'
  const tmpDb = path.join(os.tmpdir(), 'pdf-langgraph-test.db')
  console.log('📦 初始化测试数据库:', tmpDb)
  const db = new Database(tmpDb)
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS pdf_chunks (
      pdf_id TEXT, chunk_no INTEGER, text TEXT, file_path TEXT, page_no INTEGER DEFAULT 1, embedding BLOB
    );
    DELETE FROM pdf_chunks WHERE pdf_id = '${pdfId}';
    INSERT INTO pdf_chunks(pdf_id, chunk_no, text, file_path, page_no) VALUES
    ('${pdfId}', 0, 'Machine learning (ML) is a field of study in artificial intelligence. ML algorithms build a model based on sample data, known as training data, in order to make predictions or decisions without being explicitly programmed to do so. Supervised learning, unsupervised learning and reinforcement learning are three main categories.', 'test-AI-ml.pdf', 1),
    ('${pdfId}', 1, 'Page 2 discusses deep learning. Deep learning is a subset of machine learning based on artificial neural networks with representation learning. Deep learning models such as deep neural networks, convolutional neural networks, recurrent neural networks and transformers.', 'test-AI-ml.pdf', 2),  
    ('${pdfId}', 2, 'Page 3: Transformers (from Attention Is All You Need, Vaswani et al 2017) use multi-head attention mechanisms, positional encoding, residual connections. BERT, GPT, T5 and Vision Transformer are transformer architectures.', 'test-AI-ml.pdf', 3);
    CREATE INDEX IF NOT EXISTS idx_pdf_chunks_pdf_id ON pdf_chunks(pdf_id);
  `)
  db.close()
  return pdfId
}

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('              🦜🕸️  新版 LangGraph Agent 现场测试                       ')
  console.log('='.repeat(80) + '\n')

  const pdfId = initTestPDF()
  process.env.DATABASE_PATH = path.join(os.tmpdir(), 'pdf-langgraph-test.db')
  
  const { runReActAgentWithHistoryLangGraph } = require('../src/main/services/langGraphAgentService')
  
  const baseUrl = (process.env.AI_BASE_URL || '').replace(/\/+$/, '') || 'https://open.bigmodel.cn/api/paas/v4'
  const config = {
    provider: 'openai' as const,
    baseUrl: baseUrl,
    apiKey: process.env.AI_API_KEY || '0aa014847c2f4ac49e11b0f1fef2c163.p7mYggmMWYEXjs5U',
    model: process.env.AI_MODEL || 'GLM-4.6v',
    webSearchApiKey: process.env.WEB_SEARCH_API_KEY || '',
  }

  console.log('配置:', config.model, '@', config.baseUrl, '\n')

  const TEST_CASES = [
    { q: '水的化学式是什么？', hint: '公认常识应该直接回答，不调用工具' },
    { q: '这份文档讲了什么主题？', hint: '应该调用 summarize_document 或 search_docs 搜当前 PDF' },
    { q: '第 3 页关于 transformer 说了什么？', hint: '应该 get_page 取第3页内容' },
  ]

  let total = 0, ok = 0
  for (let i=0; i<TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]
    console.log('\n' + '-'.repeat(80))
    console.log(`[Test ${i+1}/${TEST_CASES.length}] Q: "${tc.q}"`)
    console.log('期望:', tc.hint)
    console.log('-'.repeat(80))
    const t0 = Date.now()

    try {
      const result = await runReActAgentWithHistoryLangGraph(tc.q, pdfId, config, [])
      const elapsed = Date.now() - t0
      total++

      console.log('\n  ✅ LangGraph 返回成功 (' + elapsed + 'ms)')
      if (result.steps && result.steps.length > 0) {
        console.log('  📋 Steps 详情:')
        for (let s=0; s<result.steps.length; s++) {
          const step = result.steps[s]
          let short = step.input
          if (short.length > 60) short = short.substring(0,60) + '...'
          console.log('     Step' + step.step + ': ' + step.tool + ' ' + (short||''))
        }
      }
      if (result.output) {
        let shortOut = result.output.replace(/[\r\n]/g, ' ').substring(0, 140)
        if (shortOut.length > 139) shortOut += '...'
        console.log('  💬 输出预览: "' + shortOut + '"')
      }
      ok++
    } catch (e: any) {
      console.log('  ❌ 测试失败:', e?.message || String(e))
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('  新版 LangGraph Agent 测试结束: ' + ok + '/' + total + ' 成功')
  console.log('='.repeat(80) + '\n')
}
main().catch(e => { console.error('\n💥 FATAL:', e); process.exit(1) })
