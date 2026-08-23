/**
 * 生成 README 截图专用演示页（docs/demo.html）：
 * 内联全部 webview 资源 + 精心设计的演示文档（覆盖所有渲染能力）
 * 与 test/e2e 区分：本页面向展示，内容为排版干净的中文演示文档
 */
'use strict';
const fs = require('fs');
const path = require('path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const DEMO = [
  '# Markdown Word 功能演示', '',
  '这是一篇 **所见即所得** 演示文档：*斜体*、~~删除线~~、==高亮==、`行内代码`、[链接](https://github.com/Emon9426/VSCodeMarkDownEditor) 与上下标文本混排，中英文字体自动分设（Segoe UI × 微软雅黑）。', '',
  '## 里程碑计划', '',
  '| 阶段 | 时间 | 状态 | 负责人 |', '|:---|:---:|:---:|---:|', '| 需求评审 | 08-25 | ✅ 完成 | 张伟 |', '| UI 设计 | 09-02 | 🚀 进行中 | 李娜 |', '| 灰度发布 | 09-20 | ⏳ 计划 | 王强 |', '',
  '- [x] 冻结需求', '- [ ] 灰度发布', '  - [ ] 回滚预案', '',
  '> **发布窗口**：9 月 28 日 22:00 — 次日 02:00，期间暂停合并。', '',
  '## PL/SQL 代码高亮', '',
  '```plsql', 'CREATE OR REPLACE PROCEDURE audit_publish(p_id NUMBER) IS', '  v_status VARCHAR2(20);', 'BEGIN', '  SELECT status INTO v_status FROM releases WHERE id = p_id;', '  IF v_status = \'DRAFT\' THEN', '    UPDATE releases SET status = \'AUDITED\' WHERE id = p_id;', '    COMMIT;', '  END IF;', 'END audit_publish;', '```', '',
  '## 数学公式', '',
  '$$E = mc^2 \\quad \\frac{a}{b} + \\sqrt{x+1} + \\sum_{i=1}^{n}x_i \\quad \\alpha\\beta\\gamma$$', '',
  '质能方程 $E = mc^2$ 中的能量与质量$^2$成正比。', '',
  '## Mermaid 流程图', '',
  '```mermaid', 'graph TD', 'A[需求评审] --> B{通过?}', 'B -->|是| C[UI 设计]', 'B -->|否| D[修改需求]', 'D --> A', 'C --> E[灰度发布]', '```', '',
  '## 脚注与提示面板', '',
  'Markdown Word 完整支持脚注[^1]与四色提示面板。', '',
  ':::info 信息面板', '提示内容以彩色面板呈现，序列化时还原为 Markdown 语法。', ':::', '',
  '[^1]: 脚注定义自动追加到文末，引用处渲染为可点击上标。', ''
].join('\n');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<style>${read('src/webview/style.css')}</style>
</head><body><div id="app"></div>
<script>
window.__posted = [];
window.__onMessage = null;
window.acquireVsCodeApi = function () {
  return { postMessage: function (m) { window.__posted.push(m); }, setState: function(){}, getState: function(){ return {}; } };
};
const __nativeAdd = window.addEventListener.bind(window);
window.addEventListener = function (t, fn, o) { if (t === 'message') { window.__onMessage = fn; } __nativeAdd(t, fn, o); };
</script>
<script>${read('src/markdown/highlight.js')}</script>
<script>${read('src/markdown/math.js')}</script>
<script>${read('src/markdown/mermaid.js')}</script>
<script>${read('src/markdown/core.js')}</script>
<script>${read('src/webview/main.js')}</script>
<script>
setTimeout(function () {
  window.__onMessage({ data: { type: 'init', text: ${JSON.stringify(DEMO)}, settings: { ui: { language: 'zh-CN' }, page: { size: 'fit' } } } });
  window.__demoReady = true;
}, 50);
</script>
</body></html>`;

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'demo.html'), html);
fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
console.log('docs/demo.html generated:', (html.length / 1024).toFixed(1) + 'KB');
