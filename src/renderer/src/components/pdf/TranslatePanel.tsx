import { useState, useEffect, useRef, useCallback } from 'react'
import { Languages, Copy, Check, ChevronUp, ChevronDown, Loader2, RefreshCw, Settings, Bot, X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import type { ModelConfig } from '../../types'

// 翻译用 system prompt
const TRANSLATE_SYSTEM_PROMPT =
  '你是一个专业的翻译助手。请将用户提供的文本翻译为中文。如果文本已经是中文，则翻译为英文。直接输出翻译结果，不要添加任何解释、注释或额外内容。保持原文的格式（如段落、换行等）。'

export default function TranslatePanel(): JSX.Element | null {
  const {
    translatePanelVisible,
    translateExpanded,
    translateSourceText,
    translateResult,
    translateLoading,
    translateRealtime,
    translateModelId,
    _translateRequestId,
    modelConfigs,
    setTranslateExpanded,
    setTranslateSourceText,
    setTranslateResult,
    setTranslateLoading,
    setTranslateRealtime,
    setTranslateModelId,
    startTranslate,
  } = useAppStore()

  const [copied, setCopied] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const lastRequestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  // 获取文本生成类型的模型（用于翻译）
  const textModels = modelConfigs.filter((m) => {
    // 获取模型所在的文件夹
    const folder = useAppStore.getState().modelConfigs.find((f) => f.id === m.folderId)
    // 如果是文本生成文件夹或者是默认的文本模型
    return m.folderId === 'folder-text' || !m.folderId
  })

  // 当前选中的翻译模型
  const translateModel = textModels.find((m) => m.id === translateModelId) || 
    textModels.find((m) => m.isDefault) || 
    modelConfigs.find((m) => m.isDefault) ||
    modelConfigs[0]

  // 关闭模型菜单（点击外部）
  useEffect(() => {
    if (!showModelMenu) return
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelMenu])

  // 取消当前翻译请求
  const cancelCurrentTranslate = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  // 翻译核心逻辑
  const doTranslate = useCallback(async (text: string, model: ModelConfig) => {
    // 取消之前的翻译请求
    cancelCurrentTranslate()

    if (!window.api?.ai?.chat) {
      setTranslateResult('未配置 AI 模型')
      setTranslateLoading(false)
      return
    }
    setTranslateLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await window.api.ai.chat({
        provider: model.provider,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        model: model.model,
        messages: [
          { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      })
      // 如果请求已被取消，不更新结果
      if (controller.signal.aborted) return
      setTranslateResult(result.success ? result.content! : `翻译失败: ${result.message || '未知错误'}`)
    } catch (err: any) {
      if (controller.signal.aborted) return
      setTranslateResult(`翻译出错: ${err.message || '未知错误'}`)
    } finally {
      if (!controller.signal.aborted) {
        setTranslateLoading(false)
      }
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }, [setTranslateResult, setTranslateLoading, cancelCurrentTranslate])

  // 当有新的翻译请求时执行
  useEffect(() => {
    if (!_translateRequestId || !translateSourceText || !translateModel?.apiKey) return
    if (_translateRequestId === lastRequestIdRef.current) return

    lastRequestIdRef.current = _translateRequestId
    doTranslate(translateSourceText, translateModel)
  }, [_translateRequestId, translateSourceText, translateModel, doTranslate])

  // 实时翻译：监听 PDF 中的文本选择变化
  useEffect(() => {
    if (!translateRealtime || !translateModel?.apiKey) return

    const handleMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection()
        const text = selection?.toString().trim()
        if (text && text.length > 0 && text.length < 5000) {
          const anchorNode = selection?.anchorNode
          const parentEl = anchorNode?.parentElement
          if (parentEl && parentEl.closest('.textLayer')) {
            startTranslate(text)
          }
        } else {
          // 用户点击空白处，选区消失，取消当前翻译
          cancelCurrentTranslate()
          setTranslateLoading(false)
          setTranslateResult('')
          setTranslateSourceText('')
        }
      }, 100)
    }

    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [translateRealtime, translateModel, startTranslate, cancelCurrentTranslate, setTranslateLoading, setTranslateResult, setTranslateSourceText])

  if (!translatePanelVisible) return null

  const handleCopy = () => {
    if (translateResult) {
      navigator.clipboard.writeText(translateResult).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleRetry = () => {
    if (!translateSourceText || !translateModel?.apiKey) return
    setTranslateResult('')
    doTranslate(translateSourceText, translateModel)
  }

  return (
    <div className="border-t border-dark-500 bg-dark-800 flex flex-col shrink-0 transition-all duration-200" style={{ height: translateExpanded ? 200 : 36 }}>
      {/* 底部提示条 / 标题栏 */}
      <div
        className="h-9 flex items-center justify-between px-3 shrink-0 hover:bg-dark-700/30 transition-colors"
      >
        <div
          className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
          onClick={() => setTranslateExpanded(!translateExpanded)}
        >
          <Languages className="w-4 h-4 text-accent shrink-0 select-none" />
          <span className="text-xs text-dark-200 font-medium shrink-0 select-none">翻译</span>
          {/* 折叠时显示简要译文 */}
          {!translateExpanded && translateResult && (
            <span className="text-[10px] text-dark-300 truncate max-w-[300px] ml-1">
              {translateResult.substring(0, 50)}{translateResult.length > 50 ? '...' : ''}
            </span>
          )}
          {!translateExpanded && translateLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-accent/60 ml-1 shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* 实时翻译开关 - 始终可见 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-dark-100">实时翻译</span>
            <button
              onClick={(e) => { e.stopPropagation(); setTranslateRealtime(!translateRealtime) }}
              className={`relative w-7 h-3.5 rounded-full transition-colors duration-200 ${
                translateRealtime ? 'bg-accent' : 'bg-dark-500'
              }`}
            >
              <span
                className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform duration-200 ${
                  translateRealtime ? 'left-3.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* 大模型选择图标 - 始终可见 */}
          <div className="relative" ref={modelMenuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowModelMenu(!showModelMenu) }}
              className="p-1.5 rounded hover:bg-dark-600 text-dark-100 hover:text-white transition-colors"
              title="翻译模型"
            >
              <Bot className="w-3.5 h-3.5" />
            </button>
            {showModelMenu && (
              <div
                className={`absolute right-0 w-52 bg-dark-700 border border-dark-500 rounded-lg shadow-xl z-30 py-1 ${
                  translateExpanded ? 'top-full mt-1' : 'bottom-full mb-1'
                }`}
              >
                <div className="px-3 py-1.5 text-[10px] text-dark-400 border-b border-dark-500/50">
                  翻译模型
                </div>
                {modelConfigs.length === 0 ? (
                  <div className="px-3 py-2 text-[10px] text-dark-400">暂无模型配置</div>
                ) : (
                  modelConfigs.map((model) => (
                    <button
                      key={model.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        setTranslateModelId(model.id)
                        setShowModelMenu(false)
                      }}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-dark-100 hover:bg-dark-600 transition-colors"
                    >
                      <span className="truncate">{model.name || model.model}</span>
                      {model.id === (translateModelId || translateModel?.id) && (
                        <Check className="w-3 h-3 text-accent shrink-0" />
                      )}
                    </button>
                  ))
                )}
                <div className="border-t border-dark-500 mt-1 pt-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowModelMenu(false)
                      window.dispatchEvent(new CustomEvent('open-settings'))
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
                  >
                    <Settings className="w-3 h-3" />
                    管理模型配置...
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 展开/折叠箭头 */}
          <button
            onClick={() => setTranslateExpanded(!translateExpanded)}
            className="p-1.5 rounded hover:bg-dark-600 text-dark-100 hover:text-white transition-colors"
          >
            {translateExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* 展开后的内容区 */}
      {translateExpanded && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* 工具栏 */}
          <div className="flex items-center justify-end px-3 py-1 border-b border-dark-500/30 shrink-0">
            <div className="flex items-center gap-1">
              {translateLoading && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    cancelCurrentTranslate()
                    setTranslateLoading(false)
                    setTranslateResult('')
                    setTranslateSourceText('')
                    window.getSelection()?.removeAllRanges()
                  }}
                  className="p-1 rounded hover:bg-dark-600 text-dark-300 hover:text-white transition-colors"
                  title="取消翻译"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              {translateResult && !translateLoading && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRetry() }}
                    className="p-1 rounded hover:bg-dark-600 text-dark-400 hover:text-white transition-colors"
                    title="重新翻译"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopy() }}
                    className="p-1 rounded hover:bg-dark-600 text-dark-400 hover:text-white transition-colors"
                    title="复制译文"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 译文内容 */}
          <div className="flex-1 overflow-y-auto px-3 py-2 text-xs text-dark-100 leading-relaxed whitespace-pre-wrap break-words">
            {translateLoading ? (
              <div className="flex items-center gap-2 text-dark-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>翻译中...</span>
              </div>
            ) : translateResult ? (
              translateResult
            ) : translateRealtime ? (
              <span className="text-dark-300">选中 PDF 中的文字将自动翻译</span>
            ) : (
              <span className="text-dark-300">选中文本后右键点击"翻译"，或开启实时翻译</span>
            )}
          </div>

          {/* 原文提示（折叠在底部，可hover查看） */}
          {translateSourceText && !translateLoading && (
            <div className="px-3 py-1 border-t border-dark-500/30 shrink-0">
              <div className="text-[10px] text-dark-500 truncate" title={translateSourceText}>
                原文：{translateSourceText.substring(0, 80)}{translateSourceText.length > 80 ? '...' : ''}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
