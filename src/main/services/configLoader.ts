import * as fs from 'fs'
import * as path from 'path'
import { setPDFProcessorConfig, PDFProcessorConfig } from './pdfProcessor'

/**
 * 配置文件路径 - 使用用户目录，避免上传到 Git
 */
const CONFIG_FILE = 'pdf-reader-config.json'
const USER_CONFIG_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '', '.pdf-reader')
const USER_CONFIG_PATH = path.join(USER_CONFIG_DIR, CONFIG_FILE)

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PDFProcessorConfig = {
  deepSeekApiKey: '',
  useDeepSeekOCR: false,
  enableTableRecognition: true,
  enableImageDescription: false,
}

/**
 * 加载配置文件
 * 优先从用户目录加载，避免 API Key 暴露在项目代码中
 */
export function loadConfig(): PDFProcessorConfig {
  try {
    // 优先从用户目录加载（安全，不会上传到 Git）
    if (fs.existsSync(USER_CONFIG_PATH)) {
      console.log(`[ConfigLoader] 从用户目录加载配置: ${USER_CONFIG_PATH}`)
      const content = fs.readFileSync(USER_CONFIG_PATH, 'utf-8')
      const config = JSON.parse(content)
      
      // 合并默认配置
      const mergedConfig = { ...DEFAULT_CONFIG, ...config }
      
      // 应用到处理器
      setPDFProcessorConfig(mergedConfig)
      
      console.log('[ConfigLoader] 配置加载成功')
      console.log(`  - useDeepSeekOCR: ${mergedConfig.useDeepSeekOCR}`)
      console.log(`  - enableTableRecognition: ${mergedConfig.enableTableRecognition}`)
      
      return mergedConfig
    }
    
    // 回退：从项目目录加载（不推荐，仅用于开发）
    const projectConfigPath = path.join(process.cwd(), 'config.json')
    if (fs.existsSync(projectConfigPath)) {
      console.warn(`[ConfigLoader] 警告: 从项目目录加载配置，建议移到用户目录: ${USER_CONFIG_PATH}`)
      const content = fs.readFileSync(projectConfigPath, 'utf-8')
      const config = JSON.parse(content)
      const mergedConfig = { ...DEFAULT_CONFIG, ...config }
      setPDFProcessorConfig(mergedConfig)
      return mergedConfig
    }
    
    console.log('[ConfigLoader] 未找到配置文件，使用默认配置')
    console.log(`[ConfigLoader] 建议创建配置文件: ${USER_CONFIG_PATH}`)
    return DEFAULT_CONFIG
    
  } catch (error) {
    console.error('[ConfigLoader] 加载配置失败:', error)
    return DEFAULT_CONFIG
  }
}

/**
 * 保存配置到文件
 * 默认保存到用户目录，避免 API Key 暴露在项目代码中
 */
export function saveConfig(config: Partial<PDFProcessorConfig>) {
  try {
    // 确保用户配置目录存在
    if (!fs.existsSync(USER_CONFIG_DIR)) {
      fs.mkdirSync(USER_CONFIG_DIR, { recursive: true })
    }
    
    const existingConfig = loadConfig()
    const newConfig = { ...existingConfig, ...config }
    
    // 保存到用户目录
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf-8')
    console.log('[ConfigLoader] 配置已保存到用户目录')
    console.log(`[ConfigLoader] 路径: ${USER_CONFIG_PATH}`)
    
    // 重新加载
    setPDFProcessorConfig(newConfig)
    
  } catch (error) {
    console.error('[ConfigLoader] 保存配置失败:', error)
  }
}

/**
 * 检查是否配置了 API Key
 */
export function hasApiKey(): boolean {
  const config = loadConfig()
  return !!config.deepSeekApiKey && config.deepSeekApiKey.length > 0
}
