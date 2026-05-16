export function compressToolResult(
  toolName: string,
  result: string,
  query?: string
): string {
  if (!result) return ''

  let compressed = result

  compressed = compressed.replace(/\n{3,}/g, '\n\n')

  compressed = compressed.replace(
    /cookie|privacy policy|terms of service/gi,
    ''
  )

  if (toolName === 'web_search') {
    if (compressed.length > 2000) {
      compressed = compressed.slice(0, 2000) + '\n...[已压缩]'
    }
  }

  if (toolName === 'search_docs') {
    if (compressed.length > 3000) {
      compressed = compressed.slice(0, 3000) + '\n...[已压缩]'
    }
  }

  if (compressed.length > 4000) {
    compressed = compressed.slice(0, 4000) + '\n...[全局截断]'
  }

  return compressed.trim()
}