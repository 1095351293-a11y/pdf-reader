import { ipcMain, dialog, shell, app, net } from 'electron'
import { readFile } from 'fs/promises'
import { registerFileService } from './services/fileService'
import { registerPDFService } from './services/pdfService'
import { registerRAGService } from './services/ragService'
import { initDatabase, getDatabase } from './db'

export function registerIPCHandlers(): void {
  // 先初始化数据库
  initDatabase()

  // 文件对话框：打开 PDF
  ipcMain.handle('dialog:openFile', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF 文件', extensions: ['pdf'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    return filePaths || []
  })

  // 文件对话框：选择文件夹
  ipcMain.handle('dialog:openDirectory', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    return filePaths[0] || null
  })

  // 打开外部链接
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url)
  })

  // 在文件管理器中显示文件
  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    shell.showItemInFolder(path)
  })

  // 获取应用数据路径
  ipcMain.handle('app:getPath', async (_, name: string) => {
    return app.getPath(name as any)
  })

  // 读取 PDF 文件为 ArrayBuffer（用于渲染进程无 Worker 模式加载）
  ipcMain.handle('fs:readFileBuffer', async (_, filePath: string) => {
    try {
      const buffer = await readFile(filePath)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    } catch (err: any) {
      console.error('读取文件失败:', err)
      throw new Error(err.message || '读取文件失败')
    }
  })

  // 注册业务服务
  registerFileService()
  registerPDFService()
  registerRAGService()

  // ========== 通用应用设置（KV 存储） ==========
  ipcMain.handle('appSettings:get', async (_, key: string) => {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
  })

  ipcMain.handle('appSettings:set', async (_, key: string, value: string) => {
    const db = getDatabase()
    const row = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(key)
    if (row) {
      db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(value, key)
    } else {
      db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(key, value)
    }
    return true
  })

  // ========== 服务商配置（参照 PageMind） ==========
  const PROVIDERS: Record<string, { name: string; models: string[]; embeddingModels: string[]; defaultBaseUrl: string }> = {
    openai: {
      name: 'OpenAI',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
      defaultBaseUrl: 'https://api.openai.com/v1',
    },
    deepseek: {
      name: 'DeepSeek',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      embeddingModels: [],
      defaultBaseUrl: 'https://api.deepseek.com/v1',
    },
    zhipu: {
      name: '智谱 (GLM)',
      models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-4'],
      embeddingModels: ['embedding-3'],
      defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    },
    kimi: {
      name: 'Kimi (Moonshot)',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      embeddingModels: ['moonshot-v1-8k'],
      defaultBaseUrl: 'https://api.moonshot.cn/v1',
    },
    qwen: {
      name: '通义千问',
      models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
      embeddingModels: ['text-embedding-v3'],
      defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    gemini: {
      name: 'Gemini (Google)',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
      embeddingModels: [],
      defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    anthropic: {
      name: 'Anthropic',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
      embeddingModels: [],
      defaultBaseUrl: 'https://api.anthropic.com/v1',
    },
    custom: {
      name: '自定义',
      models: [],
      embeddingModels: [],
      defaultBaseUrl: '',
    },
  }

  // ========== URL 构建工具 ==========
  function normalizeBaseUrl(url: string): string {
    return (url || '').replace(/\/+$/, '')
  }

  function buildChatUrl(_provider: string, baseUrl: string): string {
    const base = normalizeBaseUrl(baseUrl)
    if (!base) throw new Error('未填写 API 地址')
    if (base.endsWith('/chat/completions')) return base
    return `${base}/chat/completions`
  }

  // ========== AI 连接测试 ==========
  ipcMain.handle('ai:testConnection', async (_, config: { provider: string; baseUrl: string; apiKey: string; model: string }) => {
    try {
      const providerInfo = PROVIDERS[config.provider]
      const effectiveBaseUrl = config.baseUrl || providerInfo?.defaultBaseUrl || ''

      switch (config.provider) {
        case 'anthropic': {
          // Anthropic 使用不同的 API 格式
          const url = 'https://api.anthropic.com/v1/messages'
          const response = await net.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: 5,
              messages: [{ role: 'user', content: 'Hi' }],
            }),
          })
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            return { success: false, message: `Anthropic HTTP ${response.status}: ${text.substring(0, 200)}` }
          }
          await response.json()
          return { success: true, message: `连接成功！模型: ${config.model}` }
        }
        case 'gemini': {
          // Gemini 使用 Google 原生格式（如果用户没走 OpenAI 兼容接口）
          if (effectiveBaseUrl.includes('generativelanguage.googleapis.com') && !effectiveBaseUrl.includes('/openai')) {
            const url = `https://generativelanguage.googleapis.com/v1/models/${config.model}:generateContent?key=${config.apiKey}`
            const response = await net.fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                generationConfig: { maxOutputTokens: 5 },
              }),
            })
            if (!response.ok) {
              const text = await response.text().catch(() => '')
              return { success: false, message: `Gemini HTTP ${response.status}: ${text.substring(0, 200)}` }
            }
            return { success: true, message: `连接成功！模型: ${config.model}` }
          }
          // 走 OpenAI 兼容接口，fall through
        }
        default: {
          // OpenAI 兼容接口（openai, deepseek, zhipu, kimi, qwen, custom 等）
          const url = buildChatUrl(config.provider, effectiveBaseUrl)
          const response = await net.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages: [{ role: 'user', content: 'Hi' }],
              max_tokens: 5,
            }),
          })
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            let message = `HTTP ${response.status}: ${text.substring(0, 200)}`
            if (response.status === 401) message = 'API Key 无效或已过期'
            else if (response.status === 403) message = '无权访问该 API，请检查账户权限'
            else if (response.status === 404) message = 'API 地址或模型不存在，请检查 Base URL 和模型名称'
            else if (response.status === 429) message = 'API 调用频率超限，请稍后重试'
            return { success: false, message }
          }
          const data = await response.json()
          return { success: true, message: `连接成功！模型: ${data.model || config.model}` }
        }
      }
    } catch (err: any) {
      let message = `连接失败: ${err.message || '未知错误'}`
      if (err.name === 'AbortError' || err.code === 'ECONNREFUSED') message = '连接被拒绝，请检查网络和 API 地址'
      return { success: false, message }
    }
  })

  // ========== AI 聊天 ==========
  ipcMain.handle('ai:chat', async (_, config: { provider: string; baseUrl: string; apiKey: string; model: string; messages: { role: string; content: string }[] }) => {
    try {
      const providerInfo = PROVIDERS[config.provider]
      const effectiveBaseUrl = config.baseUrl || providerInfo?.defaultBaseUrl || ''

      switch (config.provider) {
        case 'anthropic': {
          const url = 'https://api.anthropic.com/v1/messages'
          const response = await net.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: 4096,
              messages: config.messages.map((m) => ({ role: m.role, content: m.content })),
            }),
          })
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            return { success: false, message: `Anthropic HTTP ${response.status}: ${text.substring(0, 200)}` }
          }
          const data = await response.json()
          const content = data.content?.[0]?.text || ''
          return { success: true, content }
        }
        case 'gemini': {
          if (effectiveBaseUrl.includes('generativelanguage.googleapis.com') && !effectiveBaseUrl.includes('/openai')) {
            const url = `https://generativelanguage.googleapis.com/v1/models/${config.model}:generateContent?key=${config.apiKey}`
            const contents = config.messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            }))
            const response = await net.fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents,
                generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
              }),
            })
            if (!response.ok) {
              const text = await response.text().catch(() => '')
              return { success: false, message: `Gemini HTTP ${response.status}: ${text.substring(0, 200)}` }
            }
            const data = await response.json()
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
            return { success: true, content }
          }
          // fall through
        }
        default: {
          const url = buildChatUrl(config.provider, effectiveBaseUrl)
          const response = await net.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages: config.messages,
              temperature: 0.7,
              max_tokens: 4096,
            }),
          })
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            let message = `HTTP ${response.status}: ${text.substring(0, 200)}`
            if (response.status === 401) message = 'API Key 无效或已过期'
            else if (response.status === 404) message = 'API 地址或模型不存在'
            return { success: false, message }
          }
          const data = await response.json()
          const content = data.choices?.[0]?.message?.content || ''
          return { success: true, content }
        }
      }
    } catch (err: any) {
      return { success: false, message: `请求失败: ${err.message || '未知错误'}` }
    }
  })

  // ========== AI 生成目录 ==========
  ipcMain.handle('ai:generateTableOfContents', async (_, params: {
    config: { provider: string; baseUrl: string; apiKey: string; model: string }
    pageImages: { pageNumber: number; base64: string }[]
  }) => {
    try {
      const { config, pageImages } = params
      const providerInfo = PROVIDERS[config.provider]
      const effectiveBaseUrl = config.baseUrl || providerInfo?.defaultBaseUrl || ''

      // 构建提示词 - 让AI返回Markdown表格，更符合 DeepSeek-OCR 的风格
      const prompt = `分析这些PDF页面，提取目录。

返回以下格式的Markdown表格：

| title | pageNumber | level |
|-------|------------|-------|
| 第一章   | 1    | 0    |

说明：
- level是标题层级，0表示最大的标题
- pageNumber从1开始
- 只返回表格，不要其他文字。`

      // 构建多模态消息
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { 
          type: 'text', 
          text: prompt + '\n\n注意：以下是PDF的前10页截图，按顺序排列，第1张是第1页，第2张是第2页，以此类推。' 
        }
      ]
      // 添加前 10 张图片
      pageImages.slice(0, 10).forEach((pi) => {
        content.push({
          type: 'image_url',
          image_url: { url: pi.base64 }
        })
      })
      const messages = [{ role: 'user', content }]
      
      console.log('发送给 AI 的图片数量:', pageImages.slice(0, 10).length)

      // 调用 AI
      let result
      switch (config.provider) {
        case 'anthropic': {
          const url = 'https://api.anthropic.com/v1/messages'
          const response = await net.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: 4096,
              messages: messages.map((m) => ({ 
                role: m.role, 
                content: JSON.stringify(m.content)
              })),
            }),
          })
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            return { success: false, message: `Anthropic HTTP ${response.status}: ${text.substring(0, 200)}` }
          }
          const data = await response.json()
          result = data.content?.[0]?.text || ''
          break
        }
        case 'gemini': {
          if (effectiveBaseUrl.includes('generativelanguage.googleapis.com') && !effectiveBaseUrl.includes('/openai')) {
            const url = `https://generativelanguage.googleapis.com/v1/models/${config.model}:generateContent?key=${config.apiKey}`
            const contents = messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: m.content,
            }))
            const response = await net.fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents,
                generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
              }),
            })
            if (!response.ok) {
              const text = await response.text().catch(() => '')
              return { success: false, message: `Gemini HTTP ${response.status}: ${text.substring(0, 200)}` }
            }
            const data = await response.json()
            result = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
            break
          }
          // fall through
        }
        default: {
          const url = buildChatUrl(config.provider, effectiveBaseUrl)
          const response = await net.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages: messages,
              temperature: 0.3,
              max_tokens: 4096,
            }),
          })
          if (!response.ok) {
            const text = await response.text().catch(() => '')
            let message = `HTTP ${response.status}: ${text.substring(0, 200)}`
            if (response.status === 401) message = 'API Key 无效或已过期'
            else if (response.status === 404) message = 'API 地址或模型不存在'
            return { success: false, message }
          }
          const data = await response.json()
          result = data.choices?.[0]?.message?.content || ''
        }
      }

      console.log('AI 完整返回内容:', result)
      
      // 解析 Markdown 表格
      const toc: Array<{ title: string; pageNumber: number; level: number }> = []
      
      // 找表格行
      const lines = result.split('\n')
      
      for (const line of lines) {
        const trimmed = line.trim()
        
        // 跳过分隔线（|---|...|）和表头
        if (trimmed.includes('|---') || trimmed.includes('| ---') || 
            trimmed.includes('| title |') || trimmed.includes('| pageNumber |')) {
          continue
        }
        
        // 找表格行（以 | 开头）
        if (trimmed.startsWith('|')) {
          const cells = trimmed.split('|').map(c => c.trim()).filter(c => c)
          if (cells.length >= 3) {
            // 格式：| title | pageNumber | level |
            const title = cells[0]
            const pageNumber = parseInt(cells[1])
            const level = parseInt(cells[2]) || 0
            
            if (title && !isNaN(pageNumber)) {
              toc.push({ title, pageNumber, level })
            }
          }
        }
      }
      
      // 如果表格解析失败，尝试解析简单的文本格式
      if (toc.length === 0) {
        // 尝试匹配 "章节标题 - 页码" 格式
        const chapterPattern = /([^\d]+?)\s*[-–—]\s*(\d+)/g
        let match
        while ((match = chapterPattern.exec(result)) !== null) {
          const title = match[1].trim()
          const pageNumber = parseInt(match[2])
          if (title && !isNaN(pageNumber)) {
            toc.push({ title, pageNumber, level: 0 })
          }
        }
      }
      
      console.log('解析出的目录:', toc)
      
      if (toc.length === 0) {
        return { success: false, message: `无法解析目录\n\n返回内容:\n${result.substring(0, 500)}` }
      }

      return { success: true, toc }
    } catch (err: any) {
      console.error('生成目录失败:', err)
      return { success: false, message: `生成目录失败: ${err.message || '未知错误'}` }
    }
  })

  // ========== PDF 页面转图片（直接使用 pdfUtils.ts） ==========
  ipcMain.handle('pdf:toImages', async (_, params: { filePath: string; pages: number[] }) => {
    try {
      const { filePath, pages } = params
      console.log(`[PDF ToImages] 转换 PDF 页面: ${filePath}, 页码: ${pages.join(',')}`)

      // 直接导入 pdfUtils.ts
      const { pdfPageToImage, cleanupTempFiles } = await import('./services/pdfUtils')

      const tempDir = `temp-toc-images-${Date.now()}`
      const images: { pageNumber: number; base64: string }[] = []

      for (const page of pages) {
        try {
          const imagePath = await pdfPageToImage(filePath, page, tempDir)
          // 读取图片并转为 base64
          const fs = await import('fs')
          const imageBuffer = fs.readFileSync(imagePath)
          const base64 = `data:image/png;base64,${imageBuffer.toString('base64')}`
          images.push({ pageNumber: page, base64 })
        } catch (err) {
          console.warn(`[PDF ToImages] 第 ${page} 页转换失败:`, err)
        }
      }

      // 清理临时文件
      cleanupTempFiles(tempDir)

      console.log(`[PDF ToImages] 成功转换 ${images.length} 页`)

      return {
        success: images.length > 0,
        images,
        message: images.length > 0 ? `成功转换 ${images.length} 页` : '转换失败',
      }
    } catch (err: any) {
      console.error('[PDF ToImages] 失败:', err)
      return {
        success: false,
        images: [],
        message: `转换失败: ${err.message}`,
      }
    }
  })

  // ========== 目录保存/读取 ==========
  ipcMain.handle('toc:save', async (_, params: { filePath: string; toc: Array<{ title: string; pageNumber: number; level: number }>; source: string }) => {
    try {
      const db = getDatabase()
      const { filePath, toc, source } = params
      
      // 使用文件路径的 hash 作为 key
      const fileKey = `toc_${Buffer.from(filePath).toString('base64')}`
      const value = JSON.stringify({ toc, source, savedAt: Date.now() })
      
      const row = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(fileKey)
      if (row) {
        db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(value, fileKey)
      } else {
        db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(fileKey, value)
      }
      
      console.log(`[TOC Save] 已保存目录: ${filePath}, ${toc.length} 个章节`)
      return { success: true }
    } catch (err: any) {
      console.error('[TOC Save] 失败:', err)
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('toc:load', async (_, filePath: string) => {
    try {
      const db = getDatabase()
      const fileKey = `toc_${Buffer.from(filePath).toString('base64')}`
      
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(fileKey) as { value: string } | undefined
      
      if (row) {
        const data = JSON.parse(row.value)
        console.log(`[TOC Load] 已加载保存的目录: ${filePath}, ${data.toc?.length || 0} 个章节`)
        return { success: true, toc: data.toc, source: data.source, savedAt: data.savedAt }
      }
      
      return { success: false, message: '未找到保存的目录' }
    } catch (err: any) {
      console.error('[TOC Load] 失败:', err)
      return { success: false, message: err.message }
    }
  })

  // ========== OCR 模型配置 ==========
  ipcMain.handle('ocr:setModel', async (_, modelId: string) => {
    try {
      const db = getDatabase()
      
      // 从数据库获取模型配置
      const modelRow = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(modelId) as any
      
      if (!modelRow) {
        return { success: false, message: '模型配置不存在' }
      }
      
      const config = JSON.parse(modelRow.config)
      
      // 更新 OCR 服务配置
      const { setVisionConfig } = await import('./services/pdfImageRecognitionService')
      setVisionConfig({
        id: modelRow.id,
        folderId: modelRow.folder_id,
        name: config.name,
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      })
      
      // 保存到设置
      const row = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get('ocrModelId')
      if (row) {
        db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(modelId, 'ocrModelId')
      } else {
        db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('ocrModelId', modelId)
      }
      
      console.log(`[OCR] 已设置识别模型: ${config.name} (${config.model})`)
      return { success: true, message: `已设置 OCR 模型: ${config.name}` }
    } catch (err: any) {
      console.error('[OCR] 设置模型失败:', err)
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('ocr:getModel', async () => {
    try {
      const db = getDatabase()
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('ocrModelId') as { value: string } | undefined
      return { modelId: row ? row.value : null }
    } catch (err: any) {
      console.error('[OCR] 获取模型失败:', err)
      return { modelId: null }
    }
  })

  // 应用启动时加载 OCR 配置
  ;(async () => {
    try {
      const db = getDatabase()
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('ocrModelId') as { value: string } | undefined
      
      if (row?.value) {
        const modelRow = db.prepare('SELECT * FROM model_configs WHERE id = ?').get(row.value) as any
        if (modelRow) {
          const config = JSON.parse(modelRow.config)
          const { setVisionConfig } = await import('./services/pdfImageRecognitionService')
          setVisionConfig({
            id: modelRow.id,
            folderId: modelRow.folder_id,
            name: config.name,
            provider: config.provider,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            model: config.model,
          })
          console.log(`[OCR] 已加载识别模型: ${config.name} (${config.model})`)
        }
      }
    } catch (err) {
      console.error('[OCR] 启动加载配置失败:', err)
    }
  })()
}
