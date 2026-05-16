import { net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * OCR 请求参数
 */
interface OCRequest {
  imageBase64: string
  prompt?: string
  type: 'text' | 'table' | 'chart' | 'formula'
}

/**
 * OCR 响应结果
 */
interface OCRResponse {
  text: string
  confidence?: number
  structure?: any  // 表格结构数据
}

/**
 * 模型配置接口（与前端 ModelConfig 对应）
 */
interface ModelConfig {
  id: string
  folderId: string
  name: string
  provider: 'openai' | 'deepseek' | 'siliconflow' | 'zhipu' | 'kimi' | 'qwen' | 'gemini' | 'anthropic' | 'custom' | 'local'
  apiKey: string
  baseUrl: string
  model: string
  temperature?: number
  maxTokens?: number
  isDefault?: boolean
}

// 默认视觉模型配置
const DEFAULT_VISION_CONFIG: ModelConfig = {
  id: 'default-vision',
  folderId: 'folder-vision',
  name: '默认视觉模型',
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
}

// 全局视觉模型配置
let visionConfig: ModelConfig = { ...DEFAULT_VISION_CONFIG }

/**
 * 设置视觉模型配置
 */
export function setVisionConfig(config: Partial<ModelConfig>) {
  visionConfig = { ...visionConfig, ...config }
}

/**
 * 获取当前视觉模型配置
 */
export function getVisionConfig(): ModelConfig {
  return { ...visionConfig }
}

/**
 * 将图片转换为 Base64
 * @param imagePath 图片路径
 */
function imageToBase64(imagePath: string): string {
  const imageBuffer = fs.readFileSync(imagePath)
  return imageBuffer.toString('base64')
}

/**
 * 调用视觉模型 API 进行 OCR
 * @param request OCR 请求
 */
async function callVisionAPI(request: OCRequest): Promise<OCRResponse> {
  if (!visionConfig.apiKey) {
    throw new Error('视觉模型 API key 未配置')
  }

  const prompts: Record<string, string> = {
    text: '请识别图片中的文字内容，保持原有格式，只返回识别的文字。',
    table: '请识别图片中的表格内容，以 Markdown 表格格式返回，同时描述表格内容。',
    chart: '请识别图片中的图表内容，描述图表展示的数据和趋势。',
    formula: '请识别图片中的数学公式，以 LaTeX 格式返回。',
  }

  // 构建请求体
  const body: any = {
    model: visionConfig.model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: request.prompt || prompts[request.type] || prompts.text,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${request.imageBase64}`,
            },
          },
        ],
      },
    ],
  }

  // 根据提供商调整请求格式
  if (visionConfig.provider === 'zhipu') {
    // 智谱AI (GLM) 不需要 temperature
    delete body.temperature
  } else {
    body.temperature = 0.1
  }

  try {
    const response = await net.fetch(`${visionConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${visionConfig.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`视觉模型 API 错误: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    return {
      text: content,
      confidence: data.choices?.[0]?.finish_reason === 'stop' ? 1.0 : 0.8,
    }
  } catch (error) {
    console.error('[PDFImageRecognition] API 调用失败:', error)
    throw error
  }
}

/**
 * 识别图片中的文字
 * @param imagePath 图片路径
 * @param type 内容类型
 */
export async function recognizeImage(
  imagePath: string,
  type: 'text' | 'table' | 'chart' | 'formula' = 'text'
): Promise<OCRResponse> {
  console.log(`[PDFImageRecognition] 识别图片: ${path.basename(imagePath)} (类型: ${type}, 模型: ${visionConfig.model})`)

  const base64 = imageToBase64(imagePath)
  return await callVisionAPI({
    imageBase64: base64,
    type,
  })
}

/**
 * 批量识别图片
 * @param imagePaths 图片路径列表
 * @param type 内容类型
 */
export async function recognizeImages(
  imagePaths: string[],
  type: 'text' | 'table' | 'chart' | 'formula' = 'text'
): Promise<Map<string, OCRResponse>> {
  const results = new Map<string, OCRResponse>()

  console.log(`[PDFImageRecognition] 批量识别 ${imagePaths.length} 张图片`)

  for (let i = 0; i < imagePaths.length; i++) {
    const imagePath = imagePaths[i]
    console.log(`[PDFImageRecognition] 处理第 ${i + 1}/${imagePaths.length} 张: ${path.basename(imagePath)}`)

    try {
      const result = await recognizeImage(imagePath, type)
      results.set(imagePath, result)

      // 添加延迟避免 API 限流
      if (i < imagePaths.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    } catch (error) {
      console.error(`[PDFImageRecognition] 识别失败: ${imagePath}`, error)
      results.set(imagePath, { text: '[识别失败]' })
    }
  }

  return results
}

/**
 * 识别 PDF 页面（整页 OCR）
 * @param pdfPath PDF 路径
 * @param page 页码
 */
export async function recognizePDFPage(
  pdfPath: string,
  page: number
): Promise<OCRResponse> {
  console.log(`[PDFImageRecognition] 识别 PDF 页面: ${path.basename(pdfPath)} 第 ${page} 页`)

  // TODO: 实现 PDF 转图片功能
  throw new Error('PDF 页面识别尚未实现。请使用 recognizeImage 识别图片文件。')
}

/**
 * 验证视觉模型配置是否有效
 */
export async function validateConfig(): Promise<boolean> {
  if (!visionConfig.apiKey) {
    return false
  }

  try {
    const response = await net.fetch(`${visionConfig.baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${visionConfig.apiKey}`,
      },
    })

    return response.ok
  } catch {
    return false
  }
}

/**
 * 从应用配置加载视觉模型
 * 这个函数应该由主进程在应用启动时调用
 */
export function loadVisionModelFromAppConfig(modelConfigs: ModelConfig[]) {
  // 查找 vision 文件夹中的默认模型
  const visionModels = modelConfigs.filter(
    config => config.folderId === 'folder-vision' || config.folderId.includes('vision')
  )

  // 优先使用默认模型
  const defaultModel = visionModels.find(m => m.isDefault) || visionModels[0]

  if (defaultModel) {
    setVisionConfig(defaultModel)
    console.log('[PDFImageRecognition] 已加载视觉模型:', defaultModel.name, `(提供商: ${defaultModel.provider})`)
  } else {
    console.warn('[PDFImageRecognition] 未找到视觉模型配置')
  }
}

/**
 * 从配置文件加载（兼容旧版配置）
 */
export function loadConfigFromFile(configPath: string) {
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      // 兼容旧版 deepSeek 配置
      if (config.deepSeekApiKey) {
        setVisionConfig({
          id: 'legacy-deepseek',
          folderId: 'folder-vision',
          name: 'DeepSeek (Legacy)',
          provider: 'deepseek',
          apiKey: config.deepSeekApiKey,
          baseUrl: config.deepSeekBaseUrl || 'https://api.deepseek.com/v1',
          model: config.deepSeekModel || 'deepseek-chat',
        })
        console.log('[PDFImageRecognition] 已从旧版配置加载')
      }
    } catch (error) {
      console.error('[PDFImageRecognition] 加载配置失败:', error)
    }
  }
}

/**
 * 保存配置到文件（兼容旧版）
 */
export function saveConfigToFile(configPath: string) {
  try {
    const config = {
      deepSeekApiKey: visionConfig.apiKey,
      deepSeekBaseUrl: visionConfig.baseUrl,
      deepSeekModel: visionConfig.model,
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    console.log('[PDFImageRecognition] 配置已保存')
  } catch (error) {
    console.error('[PDFImageRecognition] 保存配置失败:', error)
  }
}

// 为了向后兼容，保留旧的函数名
export const setDeepSeekConfig = setVisionConfig
export const getDeepSeekConfig = getVisionConfig
