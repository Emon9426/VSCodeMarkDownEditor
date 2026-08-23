/**
 * 生成端到端测试页（真实 Chromium 用）：
 * 内联全部 webview 资源 + acquireVsCodeApi stub + 自动加载示例文档
 * 输出：test/e2e/e2e.html（file:// 直接打开）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SAMPLE = [
  '# 产品发布计划', '',
  '本计划覆盖 **核心目标**、`里程碑` 与 [风险](#risk)。', '',
  '> 发布窗口：9 月 28 日。', '',
  '## 里程碑计划', '',
  '| 阶段 | 时间 | 状态 |', '|:---|:---:|---:|', '| 需求评审 | 08-25 | ✅ |', '| UI 设计 | 09-02 | 🚀 |', '',
  '- [x] 冻结需求', '- [ ] 灰度发布', '  - 子任务', '',
  '```plsql', 'CREATE PROCEDURE audit_publish(p_id NUMBER) IS', 'BEGIN', '  SELECT status INTO v FROM releases WHERE id = p_id;', 'END;', '```', '',
  '$$E = mc^2 \\quad \\frac{a}{b} + \\sqrt{x+1} + \\sum_{i=1}^{n}x_i$$', '',
  '值 $x^2$ 与 $\\alpha\\beta$。', '',
  '```mermaid', 'graph TD', 'A[开始] --> B{通过?}', 'B -->|是| C[发布]', 'B -->|否| D[修改]', 'D --> B', '```', '',
  '---', ''
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
// 包装而非覆盖：钩住 message 供测试注入，同时保留原生监听（resize/selectionchange 等行为不失真）
const __nativeAdd = window.addEventListener.bind(window);
window.addEventListener = function (t, fn, o) { if (t === 'message') { window.__onMessage = fn; } __nativeAdd(t, fn, o); };
</script>
<script>${read('src/markdown/highlight.js')}</script>
<script>${read('src/markdown/math.js')}</script>
<script>${read('src/markdown/mermaid.js')}</script>
<script>${read('src/markdown/core.js')}</script>
<script>${read('src/webview/main.js')}</script>
<script>
// 自动初始化（Playwright 打开后无需交互）
setTimeout(function () {
  window.__onMessage({ data: { type: 'init', text: ${JSON.stringify(SAMPLE)}, settings: { ui: { language: 'zh-CN' }, page: { size: 'fit' } } } });
  window.__e2eReady = true;
}, 50);
</script>
</body></html>`;

const outDir = path.join(__dirname, '..', 'test', 'e2e');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'e2e.html'), html);
console.log('e2e.html generated:', (html.length / 1024).toFixed(1) + 'KB');
