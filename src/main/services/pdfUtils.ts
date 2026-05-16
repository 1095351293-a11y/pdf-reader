import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

// 动态导入 iconv-lite（避免打包问题）
let iconv: any = null
try {
  iconv = require('iconv-lite')
  console.log('[PDFUtils] iconv-lite 加载成功')
} catch (err) {
  console.warn('[PDFUtils] iconv-lite 未安装，使用默认编码:', err)
}

// 测试解码
const testBuffer = Buffer.from([0xb9, 0xa4, 0xbe, 0xdf]) // "工具" 的 GB2312 编码
const testDecoded = iconv ? iconv.decode(testBuffer, 'gb2312') : testBuffer.toString()
console.log('[PDFUtils] 解码测试 - Buffer:', testBuffer)
console.log('[PDFUtils] 解码测试 - 结果:', testDecoded)
console.log('[PDFUtils] 解码测试 - 是否正确:', testDecoded === '工具')

/**
 * PDF 工具函数
 */

// 缓存 pdftoppm 路径
let pdftoppmPath: string | null = null

// 使用 Buffer 存储路径，避免中文编码问题
// D:\工具\poppler-25.12.0\Library\bin\pdftoppm.exe 的 GB2312 编码
const PDFTOPPM_PATH_BUFFER = Buffer.from([
  0x44, 0x3a, 0x5c, 0xb9, 0xa4, 0xbe, 0xdf, 0x5c, 0x70, 0x6f, 0x70, 0x70,
  0x6c, 0x65, 0x72, 0x2d, 0x32, 0x35, 0x2e, 0x31, 0x32, 0x2e, 0x30, 0x5c,
  0x4c, 0x69, 0x62, 0x72, 0x61, 0x72, 0x79, 0x5c, 0x62, 0x69, 0x6e, 0x5c,
  0x70, 0x64, 0x66, 0x74, 0x6f, 0x70, 0x70, 0x6d, 0x2e, 0x65, 0x78, 0x65
])

// D:\工具\poppler-25.12.0\share 的 GB2312 编码
const POPPLER_DATA_DIR_BUFFER = Buffer.from([
  0x44, 0x3a, 0x5c, 0xb9, 0xa4, 0xbe, 0xdf, 0x5c, 0x70, 0x6f, 0x70, 0x70,
  0x6c, 0x65, 0x72, 0x2d, 0x32, 0x35, 0x2e, 0x31, 0x32, 0x2e, 0x30, 0x5c,
  0x73, 0x68, 0x61, 0x72, 0x65
])

// 解码路径（使用 GB2312）
function decodePath(buffer: Buffer): string {
  if (iconv) {
    return iconv.decode(buffer, 'gb2312')
  }
  // 回退到默认编码
  return buffer.toString()
}

const PDFTOPPM_PATH = decodePath(PDFTOPPM_PATH_BUFFER)
const POPPLER_DATA_DIR = decodePath(POPPLER_DATA_DIR_BUFFER)

/**
 * 获取 pdftoppm 可执行文件路径
 */
function getPdftoppmPath(): string {
  if (pdftoppmPath) return pdftoppmPath
  pdftoppmPath = PDFTOPPM_PATH
  console.log('[PDFUtils] pdftoppm 路径:', pdftoppmPath)
  return pdftoppmPath
}

/**
 * 将 PDF 页面转换为图片
 * @param pdfPath PDF 文件路径
 * @param page 页码
 * @param outputDir 输出目录
 * @returns 生成的图片路径
 */
export async function pdfPageToImage(
  pdfPath: string,
  page: number,
  outputDir: string = 'temp-images'
): Promise<string> {
  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const outputFileName = `page_${page}.png`
  const outputPath = path.join(outputDir, outputFileName)

  try {
    const pdftoppm = getPdftoppmPath()
    
    // 设置环境变量
    const env = {
      ...process.env,
      POPPLER_DATADIR: POPPLER_DATA_DIR
    }
    
    console.log(`[PDFUtils] 转换第 ${page} 页`)
    
    // 使用 spawn 避免编码问题
    const { spawn } = require('child_process')
    const args = [
      '-png',
      '-f', String(page),
      '-l', String(page),
      pdfPath,
      path.join(outputDir, 'page')
    ]
    
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pdftoppm, args, {
        stdio: 'pipe',
        windowsHide: true,
        env
      })
      
      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      
      child.on('close', (code: number) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`pdftoppm exited with code ${code}: ${stderr}`))
        }
      })
      
      child.on('error', (err: Error) => {
        reject(err)
      })
    })
    
    // pdftoppm 生成的文件名格式为 page-01.png
    const pdftoppmOutput = path.join(outputDir, `page-${String(page).padStart(2, '0')}.png`)
    if (fs.existsSync(pdftoppmOutput)) {
      fs.renameSync(pdftoppmOutput, outputPath)
      console.log('[PDFUtils] 成功:', outputPath)
      return outputPath
    }
    
    throw new Error('Output file not found')
  } catch (error) {
    console.error(`[PDFUtils] 转换失败: ${pdfPath} 第 ${page} 页`, error)
    throw error
  }
}

/**
 * 将 PDF 所有页面转换为图片
 * @param pdfPath PDF 文件路径
 * @param outputDir 输出目录
 * @returns 图片路径列表
 */
export async function pdfToImages(
  pdfPath: string,
  outputDir: string = 'temp-images'
): Promise<string[]> {
  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const baseName = path.basename(pdfPath, '.pdf')

  try {
    const pdftoppm = getPdftoppmPath()
    
    // 设置环境变量
    const env = {
      ...process.env,
      POPPLER_DATADIR: POPPLER_DATA_DIR
    }
    
    // 使用 spawn 避免编码问题
    const { spawn } = require('child_process')
    const args = [
      '-png',
      pdfPath,
      path.join(outputDir, baseName)
    ]
    
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pdftoppm, args, {
        stdio: 'pipe',
        windowsHide: true,
        env
      })
      
      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      
      child.on('close', (code: number) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`pdftoppm exited with code ${code}: ${stderr}`))
        }
      })
      
      child.on('error', (err: Error) => {
        reject(err)
      })
    })

    // 获取生成的所有图片
    const files = fs.readdirSync(outputDir)
    const images = files
      .filter(f => f.startsWith(baseName) && f.endsWith('.png'))
      .map(f => path.join(outputDir, f))
      .sort()

    return images
  } catch (error) {
    console.error('[PDFUtils] PDF 转图片失败:', error)
    throw error
  }
}

/**
 * 裁剪图片的指定区域
 * @param imagePath 图片路径
 * @param bbox 边界框 [x1, y1, x2, y2]
 * @param outputPath 输出路径
 */
export async function cropImage(
  imagePath: string,
  bbox: [number, number, number, number],
  outputPath: string
): Promise<string> {
  const [x1, y1, x2, y2] = bbox
  const width = x2 - x1
  const height = y2 - y1

  try {
    // 使用 ImageMagick 裁剪
    execSync(
      `convert "${imagePath}" -crop ${width}x${height}+${x1}+${y1} "${outputPath}"`,
      { stdio: 'ignore' }
    )

    if (fs.existsSync(outputPath)) {
      return outputPath
    }

    throw new Error('Image crop failed')
  } catch (error) {
    console.error(`[PDFUtils] 裁剪失败: ${imagePath}`, error)
    throw error
  }
}

/**
 * 清理临时文件
 * @param dir 目录路径
 */
export function cleanupTempFiles(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log(`[PDFUtils] 清理临时文件: ${dir}`)
  }
}

/**
 * 检查系统是否安装了必要的工具
 */
export function checkSystemDependencies(): {
  pdftoppm: boolean
  imagemagick: boolean
} {
  const result = {
    pdftoppm: false,
    imagemagick: false,
  }

  try {
    const pdftoppm = getPdftoppmPath()
    execSync(`"${pdftoppm}" -v`, { stdio: 'ignore' })
    result.pdftoppm = true
  } catch {
    // pdftoppm 未安装
  }

  try {
    execSync('convert -version', { stdio: 'ignore' })
    result.imagemagick = true
  } catch {
    // ImageMagick 未安装
  }

  return result
}
