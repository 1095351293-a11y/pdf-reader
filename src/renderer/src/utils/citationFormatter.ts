import type { Citation, CitationFormat, CitationMetadata } from '../types'

/**
 * 引用格式生成器
 * 支持 GB/T 7714、APA、MLA、Chicago、IEEE 等格式
 */

/**
 * 从 PDF 文件路径或元数据中提取论文信息
 */
export function extractMetadata(filePath: string, citation: Citation): CitationMetadata {
  // 优先使用 citation 中已有的元数据
  if (citation.title || citation.authors) {
    return {
      title: citation.title,
      authors: citation.authors,
      journal: citation.journal,
      year: citation.year,
      doi: citation.doi,
    }
  }

  // 尝试从文件名解析
  const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, '') || ''
  
  // 常见的文件名格式：
  // 1. Author_Year_Title.pdf
  // 2. Title_Journal_Year.pdf
  // 3. Year_Author_Title.pdf
  
  const parts = fileName.split(/[_\-]/)
  
  // 尝试提取年份（4位数字）
  const yearMatch = fileName.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? parseInt(yearMatch[1]) : undefined
  
  // 简单启发式：如果第一部分看起来像作者（短且没有空格）
  const authors: string[] = []
  if (parts.length > 1 && parts[0].length < 50 && !parts[0].includes(' ')) {
    // 可能是作者名，尝试分割多个作者
    const authorStr = parts[0].replace(/and/gi, ',').replace(/&/g, ',')
    authors.push(...authorStr.split(',').map(a => a.trim()).filter(Boolean))
  }
  
  // 标题：取最长的部分或剩余部分
  let title = fileName
  if (parts.length > 2) {
    title = parts.slice(1).join(' ').replace(/_/g, ' ')
  }
  
  return {
    title: title || '未知标题',
    authors: authors.length > 0 ? authors : ['未知作者'],
    year,
  }
}

/**
 * 格式化作者名
 */
function formatAuthors(authors: string[] | undefined, format: 'full' | 'initials' | 'lastOnly' = 'full'): string {
  if (!authors || authors.length === 0) return '未知作者'
  
  if (format === 'full') {
    if (authors.length === 1) return authors[0]
    if (authors.length === 2) return `${authors[0]} 和 ${authors[1]}`
    return `${authors[0]} 等`
  }
  
  if (format === 'initials') {
    // APA 格式：姓, 名首字母.
    const formatInitials = (name: string) => {
      const parts = name.trim().split(/\s+/)
      if (parts.length === 1) return parts[0]
      const lastName = parts[parts.length - 1]
      const initials = parts.slice(0, -1).map(p => p[0]?.toUpperCase() + '.').join(' ')
      return `${lastName}, ${initials}`
    }
    
    if (authors.length === 1) return formatInitials(authors[0])
    if (authors.length === 2) return `${formatInitials(authors[0])}, & ${formatInitials(authors[1])}`
    if (authors.length <= 20) {
      return authors.slice(0, -1).map(formatInitials).join(', ') + ', & ' + formatInitials(authors[authors.length - 1])
    }
    return authors.slice(0, 19).map(formatInitials).join(', ') + ', ... ' + formatInitials(authors[authors.length - 1])
  }
  
  if (format === 'lastOnly') {
    // 只显示姓
    const getLastName = (name: string) => name.trim().split(/\s+/).pop() || name
    if (authors.length === 1) return getLastName(authors[0])
    if (authors.length === 2) return `${getLastName(authors[0])} 和 ${getLastName(authors[1])}`
    return `${getLastName(authors[0])} 等`
  }
  
  return authors.join(', ')
}

/**
 * 生成 GB/T 7714 格式引用
 */
function formatGB7714(metadata: CitationMetadata, citation: Citation): string {
  const authors = formatAuthors(metadata.authors, 'full')
  const year = metadata.year || 'n.d.'
  const title = metadata.title || '未知标题'
  const journal = metadata.journal || ''
  const page = citation.pageIndex + 1
  
  if (journal) {
    return `${authors}. ${title}[J]. ${journal}, ${year}: 第${page}页.`
  }
  return `${authors}. ${title}[M]. ${year}: 第${page}页.`
}

/**
 * 生成 APA 7th 格式引用
 */
function formatAPA(metadata: CitationMetadata, citation: Citation): string {
  const authors = formatAuthors(metadata.authors, 'initials')
  const year = metadata.year || '(n.d.)'
  const title = metadata.title || 'Unknown title'
  const page = citation.pageIndex + 1
  
  return `${authors} (${year}). ${title} (p. ${page}).`
}

/**
 * 生成 MLA 9th 格式引用
 */
function formatMLA(metadata: CitationMetadata, citation: Citation): string {
  const authors = formatAuthors(metadata.authors, 'full')
  const title = metadata.title || 'Unknown Title'
  const year = metadata.year || 'n.d.'
  const page = citation.pageIndex + 1
  
  return `${authors}. "${title}." ${year}, p. ${page}.`
}

/**
 * 生成 Chicago 格式引用
 */
function formatChicago(metadata: CitationMetadata, citation: Citation): string {
  const authors = formatAuthors(metadata.authors, 'full')
  const title = metadata.title || 'Unknown Title'
  const year = metadata.year || 'n.d.'
  const page = citation.pageIndex + 1
  
  return `${authors}, "${title}," ${year}, ${page}.`
}

/**
 * 生成 IEEE 格式引用
 */
function formatIEEE(metadata: CitationMetadata, citation: Citation): string {
  const authors = formatAuthors(metadata.authors, 'initials')
  const title = metadata.title || 'Unknown Title'
  const year = metadata.year || 'n.d.'
  const page = citation.pageIndex + 1
  
  return `[1] ${authors}, "${title}," ${year}, p. ${page}.`
}

/**
 * 主格式化函数
 */
export function formatCitation(citation: Citation, format: CitationFormat, filePath: string): string {
  const metadata = extractMetadata(filePath, citation)
  
  switch (format) {
    case 'gb7714':
      return formatGB7714(metadata, citation)
    case 'apa':
      return formatAPA(metadata, citation)
    case 'mla':
      return formatMLA(metadata, citation)
    case 'chicago':
      return formatChicago(metadata, citation)
    case 'ieee':
      return formatIEEE(metadata, citation)
    case 'custom':
    default:
      // 自定义格式：返回选中的文本
      return `"${citation.selectedText}" (第 ${citation.pageIndex + 1} 页)`
  }
}

/**
 * 生成引用内容（带引号）
 */
export function formatCitationContent(citation: Citation): string {
  const text = citation.selectedText.trim()
  if (text.length > 200) {
    return `"${text.substring(0, 200)}..."`
  }
  return `"${text}"`
}

/**
 * 生成完整的引用段落（用于论文写作）
 */
export function formatCitationParagraph(citation: Citation, format: CitationFormat, filePath: string): string {
  const formattedRef = formatCitation(citation, format, filePath)
  const content = formatCitationContent(citation)
  
  // 根据格式生成不同的引用段落样式
  switch (format) {
    case 'gb7714':
      return `${content}[1]。其中指出...\n\n[1] ${formattedRef}`
    case 'apa':
      return `${content} (${formattedRef.split('(')[1]?.split(')')[0] || ''}, ${citation.pageIndex + 1})`
    case 'mla':
    case 'chicago':
      return `${content} (${formattedRef.split(',')[formattedRef.split(',').length - 1]?.trim() || ''})`
    default:
      return `${content} (${formattedRef})`
  }
}
