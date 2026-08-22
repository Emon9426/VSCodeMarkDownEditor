# Markdown Word — WYSIWYG Markdown Editor

Word 式所见即所得 Markdown 编辑器（VS Code 插件）。打开任意 `.md` 文件即进入可视化编辑：**磁盘上永远是标准 Markdown**。

## 功能（M1 · P0 范围）

- **Word 式两行图标化 Ribbon**：开始 / 插入 / 表格（上下文）/ 视图 四页签，图标悬停显示中文名 + 快捷键
- **三模式编辑**：所见即所得 / 源码 / 分屏（左源码右预览，同步滚动），`Ctrl+Alt+V` 循环切换
- **可视化表格**：8×6 悬停网格选择器 / 自定义行列对话框；插行、插列、删行、删列、按列对齐、表头切换；表格内 `Tab` 跳格（末格自动续行）、`Enter` 跳行；光标进入表格浮现浮动工具条
- **图片持久化**：直接 `Ctrl+V` 粘贴或拖拽图片，自动落盘到 `./images/文档名-时间戳.png`（目录可配置），以相对路径引用——任何时间重开文档，所见即所存
- **Confluence 式斜杠菜单**：任意位置输入 `/` 唤出，分类分组、中英关键词实时过滤、`↑↓`/`Enter`/`Esc` 键盘导航
- **Emoji 快速插入**：斜杠菜单输入 `/笑脸`、`/smile` 直接插入；Ribbon 与斜杠菜单共用面板与最近使用（MRU 置顶）
- **列表**：无序 / 有序 / 任务（勾选）列表，`Tab`/`Shift+Tab` 嵌套缩进，空项 `Enter` 退出
- **代码块**：30+ 语言下拉（**含 PL/SQL**）、独立等宽字体（Consolas）、一键复制、行内代码
- **速记输入**：`# `→标题、`> `→引用、`- `→列表、`1. `→有序、`[] `→任务；粘贴 Markdown 源码自动渲染
- **智能粘贴**：粘贴 HTML 自动清洗转换为 Markdown 结构
- **行内格式**：粗体、斜体、删除线、下划线、高亮（`==`）、行内代码
- **链接**：`Ctrl+K` 对话框（文本 / URL / 悬停标题）
- **自动保存**：500ms 防抖写盘，脏状态即时同步；外部修改自动重载
- **状态栏**：保存状态、位置、全文字数、模式切换
- **主题跟随**：完全采用 VS Code 主题变量，明暗自动适配

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 加粗 / 斜体 / 下划线 | `Ctrl+B` / `Ctrl+I` / `Ctrl+U` |
| 删除线 / 行内代码 / 链接 | `Ctrl+Shift+S` / `Ctrl+\`` / `Ctrl+K` |
| 标题 1–6 | `Ctrl+1` … `Ctrl+6` |
| 无序 / 有序 / 任务列表 | `Ctrl+Shift+8` / `Ctrl+Shift+7` / `Ctrl+Shift+9` |
| 引用 / 代码块 | `Ctrl+Shift+Q` / `Ctrl+Shift+K` |
| 插入表格 | `Ctrl+Alt+T` |
| 切换编辑模式 | `Ctrl+Alt+V` |
| 斜杠菜单 | `/`（任意位置） |

## 设置（`markdownWord.*`）

| 设置 | 默认 | 说明 |
|---|---|---|
| `defaultMode` | `wysiwyg` | 打开文档的默认模式：wysiwyg / source / split |
| `image.saveFolder` | `./images` | 粘贴图片保存目录（相对文档） |
| `image.fileNamePattern` | `${docName}-${timestamp}` | 图片文件名模板 |
| `slashMenu.enabled` | `true` | 斜杠菜单开关 |
| `table.defaultHeader` | `true` | 新建表格默认含表头 |

## 测试

```bash
npm test   # 36 项核心引擎单元测试（解析/序列化/往返保真/防注入） + 9 项 Webview 冒烟
```

## 开发

```bash
npm install
# VS Code 中按 F5 启动扩展开发宿主，打开 .md 文件体验
# 打包
npx vsce package --allow-missing-repository
```

## 后续版本（见《需求与UI设计文档》第 10 节跟踪表）

AI 助手（GitHub Copilot）、Draw.io 嵌入、智能 Word/Excel 粘贴、导出 HTML/PDF、公式 / Mermaid、界面中英文（i18n）、字体中英分设等。

## License

MIT
