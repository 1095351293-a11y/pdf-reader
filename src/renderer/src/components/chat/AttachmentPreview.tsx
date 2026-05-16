import { X, FileText, Image, Scissors, Eye } from 'lucide-react'
import { useState } from 'react'

export interface AttachmentItem {
  id: string
  type: 'page' | 'range' | 'screenshot' | 'selection'
  label: string
  pageNumbers?: number[]
  data?: string // base64 dataUrl（截图时存储图片数据）
}

interface AttachmentPreviewProps {
  attachments: AttachmentItem[]
  onRemove: (id: string) => void
  onPreview: (id: string) => void
}

export default function AttachmentPreview({
  attachments,
  onRemove,
  onPreview,
}: AttachmentPreviewProps): JSX.Element | null {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-dark-500">
      {attachments.map((att) => (
        <AttachmentChip
          key={att.id}
          attachment={att}
          onRemove={() => onRemove(att.id)}
          onPreview={() => onPreview(att.id)}
        />
      ))}
    </div>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
  onPreview,
}: {
  attachment: AttachmentItem
  onRemove: () => void
  onPreview: () => void
}): JSX.Element {
  const [showActions, setShowActions] = useState(false)

  const iconMap = {
    page: <FileText className="w-3 h-3" />,
    range: <FileText className="w-3 h-3" />,
    screenshot: <Image className="w-3 h-3" />,
    selection: <Scissors className="w-3 h-3" />,
  }

  return (
    <div
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className="flex items-center gap-1.5 bg-dark-700 hover:bg-dark-600 border border-dark-500 rounded-lg pl-2 pr-1 py-1 text-xs text-dark-100 transition-colors cursor-pointer group"
      onClick={() => {
        if (attachment.data && (attachment.type === 'screenshot' || attachment.type === 'selection')) {
          onPreview()
        }
      }}
    >
      {attachment.type === 'screenshot' && attachment.data ? (
        <img
          src={attachment.data}
          alt="截图"
          className="w-5 h-5 object-cover rounded border border-dark-500"
        />
      ) : (
        <span className="text-accent">{iconMap[attachment.type]}</span>
      )}
      <span className="max-w-[120px] truncate">{attachment.label}</span>

      {showActions && (
        <div className="flex items-center gap-0.5 ml-1">
          {attachment.data && (attachment.type === 'screenshot' || attachment.type === 'selection') && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPreview()
              }}
              className="p-0.5 rounded hover:bg-dark-500 text-dark-300 hover:text-white transition-colors"
              title={attachment.type === 'selection' ? '预览文本' : '预览'}
            >
              <Eye className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="p-0.5 rounded hover:bg-red-400/10 text-dark-300 hover:text-red-400 transition-colors"
            title="移除"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}
