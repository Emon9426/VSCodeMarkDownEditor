<div align="center">

<img src="media/icon.png" width="128" height="128" alt="Markdown Word 图标" />

# Markdown Word

**Word 式所见即所得 Markdown 编辑器 · VS Code 扩展**

像用 Word 一样写 Markdown——两行图标化 Ribbon、可视化表格、斜杠命令菜单、
Copilot AI 助手、公式 / 流程图 / 代码高亮、页面设置、中英双语界面。

[![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A51.95-007ACC?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Tests](https://img.shields.io/badge/tests-201%20passed-brightgreen)](#开发与测试)
[![License](https://img.shields.io/badge/license-MIT-blue)](#许可证)
[![Version](https://img.shields.io/badge/version-1.7.1-8A2BE2)](CHANGELOG.md)

**磁盘上永远是标准 Markdown** —— 可视化编辑零语法妥协，往返保真。

</div>

---

![所见即所得编辑总览](docs/images/overview-wysiwyg.png)

打开任意 `.md` 文件即是 Word 式编辑体验：纸张居中、实时渲染、自动保存。
中英文自动分设字体（Segoe UI × 微软雅黑），正文与代码各用其字体。

## 目录

- [安装](#安装)
- [功能巡礼](#功能巡礼)
  - [三模式编辑](#1-三模式编辑)
  - [两行图标化 Ribbon](#2-两行图标化-ribbon)
  - [可视化表格](#3-可视化表格)
  - [斜杠命令菜单](#4-斜杠命令菜单)
  - [代码高亮（含 PL/SQL）](#5-代码高亮含-plsql)
  - [数学公式](#6-数学公式)
  - [Mermaid 流程图](#7-mermaid-流程图)
  - [Draw.io 集成](#8-drawio-集成)
  - [AI 助手（GitHub Copilot）](#9-ai-助手github-copilot)
  - [查找替换](#10-查找替换)
  - [大纲视图与面包屑](#11-大纲视图与面包屑)
  - [页面设置与外观](#12-页面设置与外观)
  - [图片粘贴持久化](#13-图片粘贴持久化)
  - [智能粘贴](#14-智能粘贴)
  - [脚注 · 目录 · 提示面板](#15-脚注--目录--提示面板)
  - [Emoji 面板与最近使用](#16-emoji-面板与最近使用)
  - [界面中英文](#17-界面中英文)
  - [导出 HTML / PDF](#18-导出-html--pdf)
  - [暗色主题](#19-暗色主题)
- [快捷键](#快捷键)
- [设置项](#设置项)
- [已知限制](#已知限制)
- [开发与测试](#开发与测试)
- [许可证](#许可证)

## 安装

**方式一：VSIX 安装（推荐）**

```bash
code --install-extension wysiwyg-markdown-editor-1.7.1.vsix
```

或在扩展面板 → `···` → **从 VSIX 安装...**。

**方式二：源码运行**

```bash
git clone https://github.com/Emon9426/VSCodeMarkDownEditor.git
code VSCodeMarkDownEditor   # 打开后按 F5 启动扩展开发主机
```

安装后首次打开 `.md` 文件即进入 Word 式编辑器（若仍以文本编辑器打开：
文件标签页右键 → **重新打开编辑器方式...** → 选择 *Markdown Word 编辑器* 并设为默认）。

## 功能巡礼

### 1. 三模式编辑

**所见即所得 / 源码 / 分屏** 三种模式随时切换（状态栏一键循环，或 Ribbon「视图」页签）。
源码与分屏模式的纸张宽度与页面模式严格一致——切换无跳变。

| 模式 | 说明 |
|---|---|
| 所见即所得 | 直接编辑渲染后的文档，所有格式即时生效 |
| 源码 | 等宽字体编辑 Markdown 源码，可与原生编辑器并排（提示条链接） |
| 分屏 | 左源码右渲染，滚动同步 |

![源码模式](docs/images/mode-source.png)

![分屏模式](docs/images/mode-split.png)

### 2. 两行图标化 Ribbon

页签行（开始 / 插入 / 表格 / 表格工具 / 视图）+ 单行工具组，恒定两行不折行，
全部图标化并带中文 tooltip 与快捷键提示。

![插入页签](docs/images/ribbon-insert.png)

### 3. 可视化表格

- **网格选择器**：像 Word 一样拖选行列即插入；
- **表格上下文工具条**：光标进入表格自动出现——增删行列、合并、对齐、移动行列；
- 单元格内支持 `\|` 转义、`Tab` / `Enter` 跳格（末格自动续行）。

![表格网格选择器](docs/images/table-picker.png)

![表格工具条](docs/images/table-toolbar.png)

### 4. 斜杠命令菜单

Confluence 习惯：正文任意位置输入 `/` 唤出分组菜单（AI / 基础块 / 列表 / 媒体与插入 / Emoji），
关键词过滤 + 拼音速记（如 `/biaoge` → 表格），回车插入。

![斜杠菜单](docs/images/slash-menu.png)

### 5. 代码高亮（含 PL/SQL）

自研零依赖高亮器，30+ 语言：关键字 / 类型 / 字符串 / 注释 / 数字着色，
**PL/SQL 与 T-SQL 专项支持**（大小写不敏感关键字、`CREATE PROCEDURE` 等）。
代码块与行内代码恒为等宽字体（Consolas，可配置），语言可随时切换重高亮。

```text
支持语言（节选）：plsql tsql javascript typescript python java c cpp csharp
go rust php ruby swift kotlin scala sql xml yaml json html css bash powershell diff …
```

### 6. 数学公式

自研 LaTeX 子集渲染器（零外部依赖）：

- 块级 `$$...$$` 与行内 `$...$`；
- 分数 `\frac`、根号 `\sqrt`（含 n 次方根）、上下标（含 `{}` 组）、
  60+ 符号（∑ ∫ ≤ ≠ → α β γ …）、`\text`、`\overline / \vec / \hat`；
- **双击公式** 弹出 LaTeX 源码编辑对话框，实时重渲染；
- 行内公式仅渲染无空格内容——写 `$100` 不会被误当成公式。

![数学公式](docs/images/math-block.png)

### 7. Mermaid 流程图

自研 `graph TD / LR` 子集渲染为 SVG：方框 `[]` / 圆角 `()` / 菱形 `{}` 节点、
四种边型、边标签；拓扑分层 + 折线布局。**双击图表编辑源码**；
不支持的语法（如时序图）自动降级为源码显示，不会破坏文档。
Ribbon「插入 → ◈」即插入模板并弹出编辑对话框。

![Mermaid 流程图](docs/images/mermaid-diagram.png)

### 8. Draw.io 集成

Ribbon「插入 → ⬡」在文档目录 `diagrams/` 下创建 `.drawio.svg` 模板并插入引用；
右键图片 → **用 Draw.io 编辑**（需安装 [vscode-drawio](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio)）
并排打开编辑，保存即更新。`.drawio.svg` 为标准图片语法，GitHub 原生渲染。

### 9. AI 助手（GitHub Copilot）

复用 VS Code 已登录的 Copilot（官方 `vscode.lm` API），**零二次登录、零密钥配置**：

- **选区 AI**：选中文字出现 ✨ 浮动条——改写 / 润色 / 扩写 / 缩写 / 中英互译 / 修正错别字 / 自定义指令；
  结果卡显示原文删除线与流式新文，可接受替换 / 重试 / 追加指令 / 放弃；
- **斜杠 AI**：`/AI大纲`（基于标题脉络生成本节大纲）、`/AI续写`（光标处续写）；
- 未登录或 API 不可用时优雅提示；`markdownWord.ai.enabled` 可整体关闭，`ai.model` 可选模型。

### 10. 查找替换

`Ctrl+F` / `Ctrl+H`：大小写、正则开关，命中计数，Enter / Shift+Enter 上下导航，
替换当前 / 全部替换。高亮基于 **CSS Custom Highlight API**——零 DOM 污染，
不影响序列化与保存。

![查找替换](docs/images/find-replace.png)

### 11. 大纲视图与面包屑

- **活动栏独立入口**（🗂 图标）：标题层级树（H1–H6）随编辑实时刷新，
  点击任意标题跳转正文并闪烁高亮；
- **面包屑**：编辑区顶部粘性标题路径，光标在正文段落也正确显示所属章节链，点击层级跳转。

### 12. 页面设置与外观

状态栏 📄 或 Ribbon「视图 → 页面」：

- **纸张尺寸**：适应屏幕（默认，最宽 1200px）/ A3 / A4 / A5 / B5 / Letter / Legal / 自定义，
  切换后内容**纯 CSS 流式重排**（换行、表格收缩、代码块横滚）；
- **页面背景**：跟随主题 / 护眼绿 / 羊皮纸 / 冰蓝 / 自定义色（各含暗色变体）；
- **条纹**：无 / 横线 / 方格 / 点阵（间距对齐行高）；
- 全部为视图层设置、工作区持久化、**零写入 Markdown 源文件**。

![页面设置](docs/images/page-setup.png)

### 13. 图片粘贴持久化

`Ctrl+V` 直接粘贴截图——自动保存为磁盘文件（默认 `./images/文档名-时间戳.png`，
可配置目录与命名），文档中引用相对路径。**临时 blob 永不写入**，换机器不丢图。
本地图片在编辑器与预览中自动解析为可显示资源，也支持本地文件拖拽插入。

### 14. 智能粘贴

从 **Word**（含 `mso-list` 嵌套列表）、**Excel**、**网页** 复制的内容自动转换为 Markdown
（保留标题、粗斜体、表格、列表层级）；从其他 Markdown 源复制时自动渲染。
表格 / 列表 / 代码块内部粘贴纯文本，避免格式爆炸。

### 15. 脚注 · 目录 · 提示面板

- **脚注**：`[^1]` 引用渲染为可点击上标，定义块自动追加文末；Ribbon 一键插入自动编号；
- **目录 TOC**：按当前标题层级一键生成；
- **提示面板**：四色（信息 / 提示 / 警告 / 错误）面板，序列化还原为 Markdown 语法。

### 16. Emoji 面板与最近使用

Ribbon 与斜杠菜单共用 Emoji 面板（分类 + 搜索），
**最近使用的 Emoji 自动置顶**（最多 24 个，工作区持久化，两入口同步）。

![Emoji 面板](docs/images/emoji-panel.png)

### 17. 界面中英文

`markdownWord.ui.language`（`auto` / `zh-CN` / `en`）或状态栏 🌐 一键切换，即时生效。
覆盖 Ribbon tooltip、菜单、对话框、查找条、AI 卡、右键菜单等核心字符串。

### 18. 导出 HTML / PDF

- **导出 HTML**：自包含单文件（样式 + 高亮内联），可直接分发；
- **导出 PDF**：生成 `@page` 打印就绪页面并在浏览器打开（Ctrl+P → 另存为 PDF），
  采用当前页面设置中的纸张尺寸。

### 19. 暗色主题

完整跟随 VS Code 主题（CSS 变量），暗色下页面背景 / 面板 / 高亮均有专属配色。

![暗色主题](docs/images/dark-theme.png)

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换 |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | 粗体 / 斜体 / 下划线 |
| `Ctrl+1` … `Ctrl+6` | 标题 1–6 |
| `Ctrl+Shift+K` | 代码块 |
| `Ctrl+K` | 插入链接 |
| `Ctrl+Alt+T` | 插入表格（网格选择器） |
| `Ctrl+Alt+V` | 循环切换编辑模式 |
| `Ctrl+Shift+7 / 8 / 9` | 有序 / 无序 / 任务列表 |
| `Ctrl+Shift+Q` | 引用块 |
| `Tab` / `Shift+Tab` | 增 / 减缩进（表格内跳格） |
| `/` | 斜杠命令菜单 |
| `Esc` | 关闭浮层 |

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| `markdownWord.defaultMode` | `wysiwyg` | 打开文档的默认模式（`wysiwyg` / `source` / `split`） |
| `markdownWord.editor.fontFamilyLatin` | 跟随 | 西文字体 |
| `markdownWord.editor.fontFamilyCJK` | 跟随 | 中文字体（微软雅黑 / 宋体 / 楷体 / 思源黑体 / 霞鹜文楷…） |
| `markdownWord.editor.fontSize` | `15` | 正文字号 |
| `markdownWord.editor.codeFontFamily` | `Consolas` | 代码块 / 行内代码等宽字体 |
| `markdownWord.image.saveFolder` | `./images` | 粘贴图片保存目录 |
| `markdownWord.image.fileNamePattern` | `${docName}-${timestamp}` | 图片命名模式 |
| `markdownWord.slashMenu.enabled` | `true` | 斜杠菜单开关 |
| `markdownWord.table.defaultHeader` | `true` | 新表默认表头行 |
| `markdownWord.page.size` | `fit` | 纸张尺寸（`fit` / `a3` / `a4` / `a5` / `b5` / `letter` / `legal` / `custom`） |
| `markdownWord.page.background` | `auto` | 页面背景（预设名或 `#RRGGBB`） |
| `markdownWord.page.pattern` | `none` | 条纹（`lines` / `grid` / `dots`） |
| `markdownWord.ai.enabled` | `true` | AI 助手总开关 |
| `markdownWord.ai.model` | 自动 | 指定 Copilot 模型 |
| `markdownWord.ui.language` | `auto` | 界面语言 |

字体、页面等文档级设置同时持久化到**工作区**（同一项目自动恢复），不写入 Markdown 源文件。

## 已知限制

- 原生 PDF 生成暂以「打印路径」交付（浏览器打印对话框），字体内嵌待后续；
- 代码块暂无行号；
- 上标 / 下标 / 清除格式按钮待实现（实现前不放占位按钮）；
- Mermaid 支持子集（`graph TD/LR`），时序图等暂降级为源码显示；
- AI 需 VS Code ≥ 1.95 且已登录 GitHub Copilot。

## 开发与测试

```bash
npm test            # 201 项自动化测试
npm run package     # 打包 vsix
```

测试体系：stub 冒烟 → 核心引擎单测 → jsdom 真实 DOM 集成 → 宿主侧（vscode stub）链路 →
多视口 UI 稳定性（320–1920px 浮层钳制 / 压力 / 恶意输入）→ CDP 真实 Chromium 视口断言 →
性能基准（50/200KB parse/roundtrip 防回退）。

README 截图由流水线自动生成：`node scripts/build-shots.js` 生成演示页，
配合 Edge headless（CDP 端口 9333）运行 `node scripts/take-shots.js` 批量截图。

需求规格、UI 设计与实现进度跟踪见 [需求与UI设计文档.html](需求与UI设计文档.html)（浏览器打开评审），
版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT
