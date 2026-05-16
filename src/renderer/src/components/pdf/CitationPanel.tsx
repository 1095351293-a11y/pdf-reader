import { useState, useMemo, useCallback } from 'react'
import { Quote, X, Trash2, Copy, ExternalLink, FileText, Tag, Check, Edit3, BookOpen, FolderOpen, Download } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { formatCitation, formatCitationParagraph } from '../../utils/citationFormatter'
import type { Citation, CitationFormat } from '../../types'

interface CitationPanelProps {
  onClose: () => void
  width?: number
}

const formatLabels: Record<CitationFormat, string> = {
  gb7714: 'GB/T 7714',
  apa: 'APA 7th',
  mla: 'MLA 9th',
  chicago: 'Chicago',
  ieee: 'IEEE',
  custom: '自定义',
}

export default function CitationPanel({ onClose, width = 320 }: CitationPanelProps) {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabs = useAppStore((s) => s.tabs)
  const citations = useAppStore((s) => s.citations)
  const removeCitation = useAppStore((s) => s.removeCitation)
  const updateCitation = useAppStore((s) => s.updateCitation)
  const defaultCitationFormat = useAppStore((s) => s.defaultCitationFormat)
  const setDefaultCitationFormat = useAppStore((s) => s.setDefaultCitationFormat)

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')

  // 获取当前文档的文件路径
  const currentFilePath = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    return activeTab?.filePath || ''
  }, [tabs, activeTabId])

  // 获取当前文档的引用（并自动格式化）
  const currentCitations = useMemo(() => {
    if (!activeTabId) return []
    return citations
      .filter((c) => c.pdfId === activeTabId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({
        ...c,
        // 自动格式化引用
        formattedCitation: formatCitation(c, c.format || defaultCitationFormat, currentFilePath),
      }))
  }, [citations, activeTabId, defaultCitationFormat, currentFilePath])

  // 复制引用到剪贴板
  const handleCopyCitation = async (citation: Citation, withFormat: boolean = true) => {
    const textToCopy = withFormat
      ? formatCitation(citation, citation.format || defaultCitationFormat, currentFilePath)
      : citation.selectedText
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedId(citation.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      console.error('复制失败')
    }
  }

  // 复制完整引用段落（带上下文）
  const handleCopyParagraph = async (citation: Citation) => {
    const textToCopy = formatCitationParagraph(citation, citation.format || defaultCitationFormat, currentFilePath)
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedId(citation.id + '-para')
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      console.error('复制失败')
    }
  }

  // 跳转到原文位置
  const handleJumpToSource = (citation: Citation) => {
    // TODO: 实现跳转到原文位置
    console.log('跳转到引用位置:', citation.pageIndex + 1)
  }

  // 删除引用
  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个引用吗？')) {
      removeCitation(id)
    }
  }

  // 切换引用格式
  const handleFormatChange = (format: CitationFormat) => {
    setDefaultCitationFormat(format)
    // 更新所有引用的格式
    currentCitations.forEach((c) => {
      if (c.format !== format) {
        updateCitation(c.id, { format })
      }
    })
  }

  // 开始编辑笔记
  const startEditNote = (citation: Citation) => {
    setEditingId(citation.id)
    setEditNote(citation.note || '')
  }

  // 保存笔记
  const saveNote = (id: string) => {
    updateCitation(id, { note: editNote })
    setEditingId(null)
    setEditNote('')
  }

  // 导出引用到文件
  const handleExportToFile = useCallback(() => {
    const content = currentCitations
      .map((c, i) => {
        const formatted = formatCitation(c, c.format || defaultCitationFormat, currentFilePath)
        return `[${i + 1}] ${formatted}\n\n原文："${c.selectedText}"\n页码：第 ${c.pageIndex + 1} 页${c.note ? '\n笔记：' + c.note : ''}\n`
      })
      .join('\n---\n\n')

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `引用列表_${new Date().toLocaleDateString()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [currentCitations, defaultCitationFormat, currentFilePath])

  // 保存引用到PDF所在文件夹
  const handleSaveToFolder = useCallback(async () => {
    if (!currentFilePath) {
      alert('无法获取PDF文件路径')
      return
    }

    // 获取PDF文件名（不含扩展名）
    const pdfFileName = currentFilePath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, '') || '引用'
    const citationsFileName = `${pdfFileName}_引用笔记.txt`

    const content = currentCitations
      .map((c, i) => {
        const formatted = formatCitation(c, c.format || defaultCitationFormat, currentFilePath)
        return `[${i + 1}] ${formatted}\n\n原文："${c.selectedText}"\n页码：第 ${c.pageIndex + 1} 页${c.note ? '\n笔记：' + c.note : ''}\n`
      })
      .join('\n---\n\n')

    // 添加文件头信息
    const fullContent = `论文引用笔记\n================\n来源：${pdfFileName}.pdf\n生成时间：${new Date().toLocaleString()}\n引用数量：${currentCitations.length}\n引用格式：${formatLabels[defaultCitationFormat]}\n\n================\n\n${content}`

    try {
      // 使用 Electron 的 dialog API 保存文件
      if (window.api?.saveFile) {
        const result = await window.api.saveFile({
          defaultPath: citationsFileName,
          filters: [
            { name: '文本文件', extensions: ['txt'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })
        if (result && result.filePath) {
          await window.api.writeFile(result.filePath, fullContent)
          alert(`引用笔记已保存到：\n${result.filePath}`)
        }
      } else {
        // 降级方案：使用浏览器下载
        const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = citationsFileName
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error('保存失败:', err)
      alert('保存失败，请重试')
    }
  }, [currentCitations, currentFilePath, defaultCitationFormat])

  return (
    <div
      className="flex flex-col h-full bg-dark-800 border-l border-dark-500"
      style={{ width: `${width}px` }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-500">
        <div className="flex items-center gap-2">
          <Quote className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-dark-100">引用管理</span>
          <span className="text-xs text-dark-400">({currentCitations.length})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-dark-600 text-dark-300 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 格式选择器 */}
      <div className="px-4 py-2 border-b border-dark-500/50">
        <label className="text-xs text-dark-400 mb-1.5 block">引用格式</label>
        <select
          value={defaultCitationFormat}
          onChange={(e) => handleFormatChange(e.target.value as CitationFormat)}
          className="w-full text-xs bg-dark-700 border border-dark-500 rounded px-2 py-1.5 text-dark-100 focus:outline-none focus:border-accent/50"
        >
          {Object.entries(formatLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* 引用列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {currentCitations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-dark-700/50 flex items-center justify-center mb-3">
              <Quote className="w-5 h-5 text-dark-400" />
            </div>
            <div className="text-dark-300 text-xs mb-1">暂无引用</div>
            <div className="text-dark-500 text-[10px]">
              选中文本后右键点击"添加到引用"
            </div>
          </div>
        ) : (
          currentCitations.map((citation) => (
            <CitationCard
              key={citation.id}
              citation={citation}
              onCopy={() => handleCopyCitation(citation, true)}
              onCopyText={() => handleCopyCitation(citation, false)}
              onCopyParagraph={() => handleCopyParagraph(citation)}
              onJump={() => handleJumpToSource(citation)}
              onDelete={() => handleDelete(citation.id)}
              onEditNote={() => startEditNote(citation)}
              onSaveNote={() => saveNote(citation.id)}
              isCopied={copiedId === citation.id}
              isCopiedPara={copiedId === citation.id + '-para'}
              isEditing={editingId === citation.id}
              editNote={editNote}
              setEditNote={setEditNote}
            />
          ))
        )}
      </div>

      {/* 底部操作栏 */}
      {currentCitations.length > 0 && (
        <div className="px-4 py-3 border-t border-dark-500 space-y-2">
          <button
            onClick={handleExportToFile}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent text-xs rounded transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            导出到文件
          </button>
          <button
            onClick={handleSaveToFolder}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-dark-600 hover:bg-dark-500 text-dark-200 text-xs rounded transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            保存到PDF文件夹
          </button>
        </div>
      )}
    </div>
  )
}

// 引用卡片组件
interface CitationCardProps {
  citation: Citation
  onCopy: () => void
  onCopyText: () => void
  onCopyParagraph: () => void
  onJump: () => void
  onDelete: () => void
  onEditNote: () => void
  onSaveNote: () => void
  isCopied: boolean
  isCopiedPara: boolean
  isEditing: boolean
  editNote: string
  setEditNote: (note: string) => void
}

function CitationCard({
  citation,
  onCopy,
  onCopyText,
  onCopyParagraph,
  onJump,
  onDelete,
  onEditNote,
  onSaveNote,
  isCopied,
  isCopiedPara,
  isEditing,
  editNote,
  setEditNote,
}: CitationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="bg-dark-700/50 rounded-lg p-3 hover:bg-dark-700 transition-colors group">
      {/* 引用文本预览 */}
      <div
        className="text-xs text-dark-200 leading-relaxed mb-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="text-dark-400">"</span>
        {isExpanded
          ? citation.selectedText
          : citation.selectedText.substring(0, 80) +
            (citation.selectedText.length > 80 ? '...' : '')}
        <span className="text-dark-400">"</span>
      </div>

      {/* 元信息 */}
      <div className="flex items-center gap-2 text-[10px] text-dark-400 mb-2">
        <span>第 {citation.pageIndex + 1} 页</span>
        <span>·</span>
        <span>{formatLabels[citation.format]}</span>
        {citation.tags.length > 0 && (
          <>
            <span>·</span>
            <div className="flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {citation.tags.length}
            </div>
          </>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={onCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-accent/20 hover:bg-accent/30 text-accent transition-colors"
          title="复制格式化引用"
        >
          {isCopied ? (
            <Check className="w-3 h-3" />
          ) : (
            <BookOpen className="w-3 h-3" />
          )}
          {isCopied ? '已复制' : '引用'}
        </button>
        <button
          onClick={onCopyText}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-dark-200 transition-colors"
          title="复制原文"
        >
          <Copy className="w-3 h-3" />
          原文
        </button>
        <button
          onClick={onCopyParagraph}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-dark-200 transition-colors"
          title="复制完整段落（带引用）"
        >
          {isCopiedPara ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <FileText className="w-3 h-3" />
          )}
          {isCopiedPara ? '已复制' : '段落'}
        </button>
        <button
          onClick={onJump}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-dark-200 transition-colors"
          title="跳转到原文"
        >
          <ExternalLink className="w-3 h-3" />
          定位
        </button>
        <button
          onClick={onEditNote}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-dark-200 transition-colors"
          title="添加笔记"
        >
          <Edit3 className="w-3 h-3" />
          笔记
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-red-400/20 text-dark-200 hover:text-red-400 transition-colors ml-auto"
          title="删除"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* 格式化后的引用 */}
      {citation.formattedCitation && (
        <div className="mt-2 pt-2 border-t border-dark-600/50">
          <div className="text-[10px] text-dark-300 leading-relaxed font-mono bg-dark-800/50 p-2 rounded">
            {citation.formattedCitation}
          </div>
        </div>
      )}

      {/* 笔记编辑区 */}
      {isEditing ? (
        <div className="mt-2 pt-2 border-t border-dark-600/50">
          <textarea
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="输入笔记..."
            className="w-full text-[10px] bg-dark-800 border border-dark-500 rounded px-2 py-1.5 text-dark-100 focus:outline-none focus:border-accent/50 resize-none"
            rows={3}
          />
          <div className="flex justify-end gap-1 mt-1">
            <button
              onClick={() => setEditNote('')}
              className="px-2 py-1 rounded text-[10px] bg-dark-600 hover:bg-dark-500 text-dark-200"
            >
              取消
            </button>
            <button
              onClick={onSaveNote}
              className="px-2 py-1 rounded text-[10px] bg-accent hover:bg-accent/80 text-dark-900"
            >
              保存
            </button>
          </div>
        </div>
      ) : citation.note ? (
        <div className="mt-2 pt-2 border-t border-dark-600/50">
          <div className="text-[10px] text-dark-400 italic bg-dark-800/30 p-2 rounded">
            笔记: {citation.note}
          </div>
        </div>
      ) : null}
    </div>
  )
}
