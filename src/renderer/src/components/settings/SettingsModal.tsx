import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Check, Key, Globe, Bot, Loader2, Save, Wifi, WifiOff, Eye, ChevronRight, MessageSquare, FileText, Star, Database, ArrowUpDown, Sparkles, Languages, ListTree } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import type { ModelConfig } from '../../types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

// 功能列表
const APP_FEATURES = [
  { id: 'rag', name: 'RAG 检索', description: '基于文档的智能检索', icon: Database },
  { id: 'rerank', name: '重排序', description: '对检索结果进行重排序', icon: ArrowUpDown },
  { id: 'ocr', name: 'OCR 识别', description: '识别 PDF 中的图片和文字', icon: Eye },
  { id: 'websearch', name: '联网搜索', description: '通过 TinyFish 进行网页搜索和内容提取，建议去 https://tinyfish.ai 获取 API Key', icon: Globe },
  { id: 'agent', name: 'Agent 模式', description: '智能代理自动处理任务', icon: Sparkles },
  { id: 'translate', name: 'PDF 翻译', description: '翻译 PDF 文档内容', icon: Languages },
  { id: 'toc', name: '目录生成', description: '自动生成 PDF 目录', icon: ListTree },
]

// 服务商 → 默认 Base URL 和模型列表
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; models: string[]; embeddingModels: string[] }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    embeddingModels: [],
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-14B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'THUDM/glm-4-9b-chat', 'Pro/Qwen/Qwen2-72B-Instruct'],
    embeddingModels: ['BAAI/bge-m3', 'Pro/Embedding/V2'],
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-4', 'glm-4v-plus', 'glm-4v-flash'],
    embeddingModels: ['embedding-3'],
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    embeddingModels: ['moonshot-v1-8k'],
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max'],
    embeddingModels: ['text-embedding-v3'],
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    embeddingModels: [],
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    embeddingModels: [],
  },
  custom: {
    baseUrl: '',
    models: [],
    embeddingModels: [],
  },
}

// 转换 ModelConfig 为表单使用的格式
function modelConfigToFormData(config: ModelConfig): FormModelConfig {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    isDefault: config.isDefault,
  }
}

// 转换表单数据为 ModelConfig
function formDataToModelConfig(formData: FormModelConfig): Omit<ModelConfig, 'folderId' | 'createdAt' | 'updatedAt'> {
  return {
    id: formData.id,
    name: formData.name || formData.model,
    provider: formData.provider as ModelConfig['provider'],
    apiKey: formData.apiKey,
    baseUrl: formData.baseUrl,
    model: formData.model,
    isDefault: formData.isDefault,
  }
}

interface FormModelConfig {
  id: string
  name: string
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  embeddingModel?: string
  isDefault?: boolean
}

// 功能模型绑定配置
interface FeatureModelBinding {
  featureId: string
  modelId: string | null
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps): JSX.Element | null {
  const [activeCategory, setActiveCategory] = useState<'ai' | 'features'>('ai')
  const [activeFeature, setActiveFeature] = useState<string | null>(null)
  const [configs, setConfigs] = useState<FormModelConfig[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null)

  // 功能模型绑定
  const [featureBindings, setFeatureBindings] = useState<FeatureModelBinding[]>(() => {
    try {
      const saved = localStorage.getItem('featureModelBindings')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // 从 appStore 获取模型配置管理方法
  const modelConfigs = useAppStore((state) => state.modelConfigs)
  const addModelConfig = useAppStore((state) => state.addModelConfig)
  const updateModelConfig = useAppStore((state) => state.updateModelConfig)
  const removeModelConfig = useAppStore((state) => state.removeModelConfig)
  const setDefaultModelConfig = useAppStore((state) => state.setDefaultModelConfig)
  const ragModelId = useAppStore((state) => state.ragModelId)
  const setRagModelId = useAppStore((state) => state.setRagModelId)
  const rerankerModelId = useAppStore((state) => state.rerankerModelId)
  const setRerankerModelId = useAppStore((state) => state.setRerankerModelId)
  const ocrModelId = useAppStore((state) => state.ocrModelId)
  const setOcrModelId = useAppStore((state) => state.setOcrModelId)
  const translateModelId = useAppStore((state) => state.translateModelId)
  const setTranslateModelId = useAppStore((state) => state.setTranslateModelId)
  const tocModelId = useAppStore((state) => state.tocModelId)
  const setTocModelId = useAppStore((state) => state.setTocModelId)
  const webSearchApiKey = useAppStore((state) => state.webSearchApiKey)
  const setWebSearchApiKey = useAppStore((state) => state.setWebSearchApiKey)

  // 加载已保存的配置
  useEffect(() => {
    if (isOpen) {
      // 从 store 加载配置
      const formConfigs = modelConfigs.map(modelConfigToFormData)
      if (formConfigs.length > 0) {
        setConfigs(formConfigs)
        setEditingId(formConfigs[0]?.id || null)
      } else {
        // 如果没有配置，添加一个默认空配置
        const defaultConfig: FormModelConfig = {
          id: `config-${Date.now()}`,
          name: '新配置',
          provider: 'custom',
          apiKey: '',
          baseUrl: '',
          model: '',
        }
        setConfigs([defaultConfig])
        setEditingId(defaultConfig.id)
      }
      setTestResult(null)
      setSaveResult(null)
    }
  }, [isOpen, modelConfigs])

  if (!isOpen) return null

  const addConfig = () => {
    const newConfig: FormModelConfig = {
      id: `config-${Date.now()}`,
      name: '新配置',
      provider: 'custom',
      apiKey: '',
      baseUrl: '',
      model: '',
    }
    setConfigs([...configs, newConfig])
    setEditingId(newConfig.id)
  }

  const updateConfig = (id: string, patch: Partial<FormModelConfig>) => {
    setConfigs(configs.map((c) => {
      if (c.id !== id) return c
      const updated = { ...c, ...patch }
      // 服务商变更时自动填充默认 Base URL 和模型
      if (patch.provider && patch.provider !== c.provider) {
        const defaults = PROVIDER_DEFAULTS[patch.provider]
        if (defaults) {
          updated.baseUrl = defaults.baseUrl
          if (defaults.models.length > 0 && !defaults.models.includes(updated.model)) {
            updated.model = defaults.models[0]
            updated.name = defaults.models[0]
          }
        }
      }
      // 模型变更时同步 name
      if (patch.model) {
        updated.name = patch.model
      }
      return updated
    }))
  }

  const removeConfig = (id: string) => {
    const configToRemove = configs.find((c) => c.id === id)
    if (configToRemove) {
      // 从 store 中删除
      removeModelConfig(id)
    }
    setConfigs(configs.filter((c) => c.id !== id))
    if (editingId === id) {
      const remaining = configs.filter((c) => c.id !== id)
      setEditingId(remaining[0]?.id || null)
    }
  }

  const setDefault = (id: string) => {
    setConfigs(configs.map((c) => ({ ...c, isDefault: c.id === id })))
    // 同步到 store
    setDefaultModelConfig(id)
  }

  // 设置功能绑定的模型
  const setFeatureModel = (featureId: string, modelId: string | null) => {
    const newBindings = featureBindings.filter((b) => b.featureId !== featureId)
    if (modelId) {
      newBindings.push({ featureId, modelId })
    }
    setFeatureBindings(newBindings)
    localStorage.setItem('featureModelBindings', JSON.stringify(newBindings))
  }

  // 获取功能绑定的模型
  const getFeatureModel = (featureId: string): string | null => {
    const binding = featureBindings.find((b) => b.featureId === featureId)
    return binding?.modelId || null
  }

  const editingConfig = configs.find((c) => c.id === editingId)

  // 连接测试
  const handleTestConnection = async () => {
    if (!editingConfig) return
    if (!editingConfig.apiKey || !editingConfig.model) {
      setTestResult({ success: false, message: '请先填写 API Key 和模型名称' })
      return
    }
    const effectiveBaseUrl = editingConfig.baseUrl || PROVIDER_DEFAULTS[editingConfig.provider]?.baseUrl || ''
    if (!effectiveBaseUrl && editingConfig.provider !== 'anthropic') {
      setTestResult({ success: false, message: '请先填写 Base URL' })
      return
    }
    if (!window.api?.ai?.testConnection) {
      setTestResult({ success: false, message: 'API 不可用，请重启应用后再试' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.ai.testConnection({
        provider: editingConfig.provider,
        baseUrl: effectiveBaseUrl,
        apiKey: editingConfig.apiKey,
        model: editingConfig.model,
      })
      setTestResult(result)
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || '测试失败' })
    } finally {
      setTesting(false)
    }
  }

  // 保存设置
  const handleSave = async () => {
    setSaving(true)
    setSaveResult(null)
    try {
      // 将表单数据保存到 store
      for (const formConfig of configs) {
        const existingConfig = modelConfigs.find((c) => c.id === formConfig.id)
        const configData = formDataToModelConfig(formConfig)

        if (existingConfig) {
          // 更新现有配置
          updateModelConfig(formConfig.id, {
            ...configData,
            folderId: existingConfig.folderId,
            createdAt: existingConfig.createdAt,
            updatedAt: Date.now(),
          })
        } else {
          // 添加新配置
          addModelConfig({
            ...configData,
            folderId: 'folder-text',
          })
        }
      }

      setSaveResult({ success: true, message: '设置已保存' })
      // 通知其他组件刷新
      localStorage.setItem('modelConfigsUpdatedAt', Date.now().toString())
      setTimeout(() => setSaveResult(null), 2000)
    } catch (err: any) {
      setSaveResult({ success: false, message: err.message || '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-dark-800 border border-dark-500 rounded-xl w-[800px] max-w-[95vw] h-[600px] flex shadow-2xl animate-slide-in">
        {/* 左侧导航 */}
        <div className="w-48 border-r border-dark-500 flex flex-col bg-dark-800/50">
          <div className="h-14 flex items-center px-4 border-b border-dark-500">
            <h2 className="text-base font-semibold text-white">设置</h2>
          </div>
          
          <div className="flex-1 py-2">
            {/* AI 设置 */}
            <button
              onClick={() => {
                setActiveCategory('ai')
                setActiveFeature(null)
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left ${
                activeCategory === 'ai' && !activeFeature
                  ? 'bg-accent/10 text-accent border-r-2 border-accent'
                  : 'text-dark-200 hover:bg-dark-700 hover:text-white'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>AI 设置</span>
            </button>

            {/* 功能设置 */}
            <div className="mt-2">
              <div className="px-4 py-2 text-[10px] font-medium text-dark-400 uppercase tracking-wider">
                功能设置
              </div>
              {APP_FEATURES.map((feature) => (
                <button
                  key={feature.id}
                  onClick={() => {
                    setActiveCategory('features')
                    setActiveFeature(feature.id)
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left ${
                    activeFeature === feature.id
                      ? 'bg-accent/10 text-accent border-r-2 border-accent'
                      : 'text-dark-200 hover:bg-dark-700 hover:text-white'
                  }`}
                >
                  <feature.icon className="w-4 h-4" />
                  <span>{feature.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 底部保存按钮 */}
          <div className="p-3 border-t border-dark-500">
            {saveResult && (
              <div
                className={`text-xs px-2 py-1 rounded mb-2 ${
                  saveResult.success ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {saveResult.message}
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-accent hover:bg-accent/80 text-dark-900 font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>

        {/* 右侧内容区 */}
        <div className="flex-1 flex flex-col bg-dark-800">
          {/* 头部 */}
          <div className="h-14 flex items-center justify-between px-5 border-b border-dark-500 shrink-0">
            <h3 className="text-sm font-medium text-white">
              {activeFeature
                ? APP_FEATURES.find((f) => f.id === activeFeature)?.name
                : 'AI 模型管理'}
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-dark-200 hover:bg-dark-700 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 内容 */}
          <div className="flex-1 overflow-hidden">
            {activeCategory === 'ai' && !activeFeature ? (
              // AI 设置 - 大模型配置
              <div className="h-full flex">
                {/* 配置列表 */}
                <div className="w-52 border-r border-dark-500 flex flex-col">
                  <div className="p-3 border-b border-dark-500 flex justify-between items-center">
                    <span className="text-xs font-medium text-dark-200 uppercase">模型配置</span>
                    <button
                      onClick={addConfig}
                      className="p-1 rounded hover:bg-dark-700 text-dark-200 hover:text-white transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {configs.map((config) => (
                      <div
                        key={config.id}
                        onClick={() => setEditingId(config.id)}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-all ${
                          editingId === config.id
                            ? 'bg-accent/10 text-accent'
                            : 'text-dark-100 hover:bg-dark-700'
                        }`}
                      >
                        <span className="truncate">{config.model || config.name}</span>
                        {config.isDefault && (
                          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded">默认</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 配置详情 */}
                <div className="flex-1 p-5 overflow-y-auto">
                  {editingConfig ? (
                    <div className="space-y-4">
                      <div className="flex justify-between items-start">
                        <h3 className="text-sm font-medium text-white">{editingConfig.model || editingConfig.name}</h3>
                        <div className="flex gap-1">
                          {!editingConfig.isDefault && (
                            <button
                              onClick={() => setDefault(editingConfig.id)}
                              className="text-xs text-dark-200 hover:text-accent transition-colors px-2 py-1 rounded hover:bg-dark-700"
                            >
                              设为默认
                            </button>
                          )}
                          <button
                            onClick={() => removeConfig(editingConfig.id)}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
                          >
                            <Trash2 className="w-3.5 h-3.5 inline" />
                          </button>
                        </div>
                      </div>

                      <FormField label="服务商">
                        <select
                          value={editingConfig.provider}
                          onChange={(e) => updateConfig(editingConfig.id, { provider: e.target.value as any })}
                          className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-dark-100 outline-none focus:border-accent transition-colors"
                        >
                          <option value="openai">OpenAI</option>
                          <option value="deepseek">DeepSeek</option>
                          <option value="siliconflow">硅基流动</option>
                          <option value="zhipu">智谱 (GLM)</option>
                          <option value="kimi">Kimi (Moonshot)</option>
                          <option value="qwen">通义千问</option>
                          <option value="gemini">Gemini (Google)</option>
                          <option value="anthropic">Anthropic (Claude)</option>
                          <option value="custom">自定义 / 第三方中转</option>
                        </select>
                      </FormField>

                      <FormField label="API Key">
                        <div className="relative">
                          <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-300" />
                          <input
                            type="password"
                            value={editingConfig.apiKey}
                            onChange={(e) => updateConfig(editingConfig.id, { apiKey: e.target.value })}
                            placeholder="sk-..."
                            className="w-full bg-dark-700 border border-dark-500 rounded-lg pl-9 pr-3 py-2 text-sm text-dark-100 placeholder-dark-300 outline-none focus:border-accent transition-colors"
                          />
                        </div>
                      </FormField>

                      <FormField label="Base URL">
                        <div className="relative">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-300" />
                          <input
                            value={editingConfig.baseUrl}
                            onChange={(e) => updateConfig(editingConfig.id, { baseUrl: e.target.value })}
                            placeholder="https://api.example.com/v1"
                            className="w-full bg-dark-700 border border-dark-500 rounded-lg pl-9 pr-3 py-2 text-sm text-dark-100 placeholder-dark-300 outline-none focus:border-accent transition-colors"
                          />
                        </div>
                      </FormField>

                      <FormField label="模型名称">
                        <input
                          value={editingConfig.model}
                          onChange={(e) => updateConfig(editingConfig.id, { model: e.target.value })}
                          placeholder="gpt-4o / deepseek-chat / glm-4-flash"
                          className="w-full bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm text-dark-100 placeholder-dark-300 outline-none focus:border-accent transition-colors"
                        />
                      </FormField>

                      {/* 连接测试 */}
                      <div className="pt-2 space-y-2">
                        <button
                          onClick={handleTestConnection}
                          disabled={testing}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg border border-dark-500 bg-dark-700/50 hover:bg-dark-600 text-dark-100 transition-colors disabled:opacity-50"
                        >
                          {testing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : testResult?.success ? (
                            <Wifi className="w-4 h-4 text-green-400" />
                          ) : testResult ? (
                            <WifiOff className="w-4 h-4 text-red-400" />
                          ) : (
                            <Wifi className="w-4 h-4" />
                          )}
                          {testing ? '测试中...' : '连接测试'}
                        </button>
                        {testResult && (
                          <div
                            className={`text-xs px-3 py-2 rounded-lg ${
                              testResult.success
                                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {testResult.message}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-dark-300 text-sm">
                      选择一个配置进行编辑，或点击 + 添加新配置
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // 功能设置
              <div className="h-full p-6 overflow-y-auto">
                {activeFeature && (
                  <div className="space-y-6">
                    {/* 功能说明 */}
                    <div className="p-4 bg-dark-700/30 rounded-lg border border-dark-500/50">
                      <div className="flex items-center gap-3 mb-2">
                        {(() => {
                          const feature = APP_FEATURES.find((f) => f.id === activeFeature)
                          const Icon = feature?.icon || Bot
                          return <Icon className="w-5 h-5 text-accent" />
                        })()}
                        <h4 className="text-sm font-medium text-white">
                          {APP_FEATURES.find((f) => f.id === activeFeature)?.name}
                        </h4>
                      </div>
                      <p className="text-xs text-dark-300">
                        {APP_FEATURES.find((f) => f.id === activeFeature)?.description}
                      </p>
                    </div>

                    {/* 联网搜索特殊配置 */}
                    {activeFeature === 'websearch' ? (
                      <div>
                        <h4 className="text-sm font-medium text-white mb-3">TinyFish API Key</h4>
                        <div className="relative">
                          <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-300" />
                          <input
                            type="password"
                            value={webSearchApiKey}
                            onChange={(e) => setWebSearchApiKey(e.target.value)}
                            placeholder="sk-tinyfish-..."
                            className="w-full bg-dark-700 border border-dark-500 rounded-lg pl-9 pr-3 py-2 text-sm text-dark-100 placeholder-dark-300 outline-none focus:border-accent transition-colors"
                          />
                        </div>
                        <p className="text-xs text-dark-400 mt-2">
                          请访问 <a href="https://tinyfish.ai" target="_blank" className="text-accent hover:underline">https://tinyfish.ai</a> 获取 API Key
                        </p>
                      </div>
                    ) : (
                      /* 模型选择 */
                      <div>
                        <h4 className="text-sm font-medium text-white mb-3">选择使用的模型</h4>
                        <div className="space-y-2">
                          {/* 已配置的模型列表 */}
                          {modelConfigs.map((config) => {
                            // 判断当前功能是否选中此模型
                            let isSelected = false
                            if (activeFeature === 'rag') {
                              isSelected = ragModelId === config.id
                            } else if (activeFeature === 'rerank') {
                              isSelected = rerankerModelId === config.id
                            } else if (activeFeature === 'ocr') {
                              isSelected = ocrModelId === config.id
                            } else if (activeFeature === 'translate') {
                              isSelected = translateModelId === config.id
                            } else if (activeFeature === 'toc') {
                              isSelected = tocModelId === config.id
                            } else {
                              isSelected = getFeatureModel(activeFeature) === config.id
                            }
                            
                            return (
                              <button
                                key={config.id}
                                onClick={() => {
                                  if (activeFeature === 'rag') {
                                    setRagModelId(config.id)
                                  } else if (activeFeature === 'rerank') {
                                    setRerankerModelId(config.id)
                                  } else if (activeFeature === 'ocr') {
                                    setOcrModelId(config.id)
                                  } else if (activeFeature === 'translate') {
                                    setTranslateModelId(config.id)
                                  } else if (activeFeature === 'toc') {
                                    setTocModelId(config.id)
                                  } else {
                                    setFeatureModel(activeFeature, config.id)
                                  }
                                }}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${
                                  isSelected
                                    ? 'border-accent bg-accent/10'
                                    : 'border-dark-500 hover:border-dark-400'
                                }`}
                              >
                                <Bot className={`w-5 h-5 ${isSelected ? 'text-accent' : 'text-dark-300'}`} />
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm font-medium truncate ${isSelected ? 'text-accent' : 'text-dark-100'}`}>
                                    {config.name || config.model}
                                  </div>
                                  <div className="text-xs text-dark-400">
                                    {config.provider} · {config.model}
                                  </div>
                                </div>
                                {isSelected && <Check className="w-4 h-4 text-accent shrink-0" />}
                              </button>
                            )
                          })}

                          {modelConfigs.length === 0 && (
                            <div className="text-center py-8 text-dark-400 text-sm">
                              暂无配置的模型
                              <br />
                              请先在左侧"AI 设置"中添加模型
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-dark-200">{label}</label>
      {children}
    </div>
  )
}
