# PDF Reader AI

AI 赋能的现代化 PDF 阅读器，基于 Electron + React + TypeScript + Tailwind CSS 构建。

## 功能特性

### 一、文件管理与资料库
- [x] 本地文件系统：树形文件夹结构管理 PDF
- [x] 标准文件操作：导入文件、新建文件夹、重命名、删除、回收站
- [x] 拖拽导入：支持拖拽 PDF 文件到侧边栏导入
- [x] 全局文件搜索：实时搜索文件名和文件夹名
- [x] 自定义排序：文件和文件夹支持手动调整排列顺序（Store 层已支持）

### 二、PDF 基础阅读
- [x] 阅读渲染：基于 pdf.js 的真实 PDF 页面渲染
- [x] 多标签页：同时打开多个 PDF，标签页切换和关闭
- [x] 缩放与滚动：支持页面缩放、键盘翻页（←/→、PageUp/PageDown）
- [x] 极简阅读模式：沉浸模式一键隐藏所有面板
- [x] 页面缩略图：左侧缩略图面板快速导航
- [x] 目录书签：层级目录展示和点击跳转

### 三、AI 赋能的阅读功能（UI 框架完成，API 待对接）
- [x] 多页附加提问：支持附加当前页、页码范围、截图到对话
- [x] 区域框选提问：UI 框架预留
- [x] 基于目录的章节讲解：UI 框架预留
- [x] 自由接入 AI 模型：设置页面支持配置多服务商 API
- [x] 对话记录与 PDF 绑定：每个 PDF 独立对话仓库（Store 层）
- [x] 快捷截图提问：工具栏按钮
- [ ] 一键导出对话长图（待实现）

### 四、跨设备数据同步与迁移
- [ ] 配置数据导出/导入（待实现）

### 五、独立的聊天模式
- [x] 侧边栏提供聊天模式入口和分组管理
- [ ] 独立纯聊天视图（待实现）

### 六、UI 自适应细节
- [x] 深色主题现代暗色风格
- [x] 响应式工具栏按钮（带文字/仅图标自适应）
- [x] 平滑过渡动画
- [x] 自定义滚动条

## 技术栈

- **桌面框架**: Electron 31 + electron-vite
- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **样式方案**: Tailwind CSS 3
- **状态管理**: Zustand
- **PDF 渲染**: pdf.js
- **数据库**: better-sqlite3 (SQLite)
- **图标库**: Lucide React

## 开发环境

```bash
# 安装依赖（已配置淘宝镜像）
npm install

# 启动开发服务器
npm run dev

# 类型检查
npm run typecheck

# 构建应用
npm run build

# 打包 Windows 安装程序
npm run build:win
```

## 项目结构

```
src/
  main/              # Electron 主进程
    db/              # SQLite 数据库初始化
    services/        # 业务服务层（文件、PDF）
    ipcHandlers.ts   # IPC 通信处理器
    index.ts         # 主进程入口
  preload/           # 预加载脚本（安全桥接）
  renderer/          # 渲染进程
    src/
      components/    # 组件
        sidebar/     # 左侧文件管理
        pdf/         # PDF 阅读器
        chat/        # AI 对话面板
        layout/      # 布局组件（工具栏、状态栏）
        settings/    # 设置弹窗
        common/      # 通用组件（右键菜单）
      stores/        # Zustand 状态管理
      types/         # TypeScript 类型定义
      App.tsx        # 根组件
      main.tsx       # 渲染入口
```

## 注意事项

1. **Windows 开发**: 已配置 npm 使用淘宝镜像（https://registry.npmmirror.com）
2. **原生模块**: `better-sqlite3` 为原生 C++ 模块，首次安装后会自动编译
3. **PDF.js Worker**: 在 Vite 环境中通过 `new URL()` 动态加载 worker 文件
4. **深色主题**: 全局使用 `dark` 类，所有颜色通过 Tailwind 自定义配置

## 后续开发计划

1. 接入 AI 模型 API，实现真实对话
2. 实现 PDF 批注功能（高亮、下划线、笔记）
3. 实现数据导出/导入备份功能
4. 优化 PDF 大文件渲染性能（虚拟滚动）
