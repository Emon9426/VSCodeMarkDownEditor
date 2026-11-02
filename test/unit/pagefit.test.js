/**
 * 纸张宽度自适应内容（宽表格撑破页面背景修复）测试：
 * 1) 静态审计：CSS 规则（--page-width 封顶 + overflow-wrap 例外 + 面包屑跟随）与 main.js 挂载点齐全
 * 2) jsdom 布局模拟：stub clientWidth/scrollWidth 驱动 fitPaperWidth 真实执行链
 *    （init → loadMarkdown → rAF → 量测 → min-width 撑宽 / 回落 / --page-need 同步 / 分屏预览）
 * jsdom 不覆盖：真实排版宽度（表格 min-content 计算），由浏览器真机验证补充。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

let failed = 0, passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.message || e)); }
}

// ================= 1. 静态审计 =================
console.log('== 纸张自适应：静态审计 ==');
const css = fs.readFileSync(path.join(__dirname, '../../src/webview/style.css'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/webview/main.js'), 'utf8');

check('CSS：纸张由 --page-width 封顶（max-width）', () => {
  assert.ok(/#editor\s*\{[^}]*max-width:\s*var\(--page-width,\s*760px\)/.test(css), '缺少 #editor max-width 规则');
});
check('CSS：段落长 token 可断行（overflow-wrap:anywhere，防超长 URL 撑宽纸张）', () => {
  assert.ok(/#editor,\s*#preview \.pv-inner\s*\{\s*overflow-wrap:\s*anywhere/.test(css), '缺少 anywhere 规则');
});
check('CSS：表格单元格保持 normal（宽表靠撑宽纸张而非压扁列）', () => {
  assert.ok(/#editor th,\s*#editor td,\s*#preview th,\s*#preview td\s*\{\s*overflow-wrap:\s*normal/.test(css), '缺少 td/th normal 例外');
});
check('CSS：面包屑宽度跟随纸张实际宽（max(--page-width, --page-need)）', () => {
  assert.ok(/max-width:\s*max\(var\(--page-width,\s*760px\),\s*var\(--page-need,\s*0px\)\)/.test(css), 'crumb 未跟随 --page-need');
});
check('main.js：fitHostPaper 以 min-width 撑宽（min-width 优先于 max-width）', () => {
  assert.ok(mainSrc.indexOf('el.style.minWidth = Math.ceil(need)') !== -1, '未写入内联 min-width');
  assert.ok(mainSrc.indexOf("host.style.setProperty('--page-need'") !== -1, '未同步 --page-need');
});
check('main.js：量测前先清 min-width 回到设定纸张宽（才能发现内容收窄）', () => {
  assert.ok(/if \(had\)\s*\{\s*el\.style\.minWidth = '';\s*\}/.test(mainSrc), '缺少先清后量逻辑');
});
check('main.js：内容/样式/模式触发点齐全（load/zoom/font/page/preview/mode）', () => {
  ['loadMarkdown', 'applyZoom', 'applyFontVars', 'applyPageSettings', 'updatePreview'].forEach(fn => {
    const i = mainSrc.indexOf('function ' + fn);
    const seg = mainSrc.slice(i, mainSrc.indexOf('\n  function', i + 10));
    assert.ok(seg.indexOf('schedulePaperFit()') !== -1, fn + ' 缺少 schedulePaperFit 挂载');
  });
});
check('main.js：MutationObserver 观察内容变更且写样式期间断开（防自触发循环）', () => {
  assert.ok(mainSrc.indexOf('paperMo = new MutationObserver(schedulePaperFit)') !== -1, '未挂内容观察器');
  assert.ok(mainSrc.indexOf('paperMo.disconnect()') !== -1, '量测期间未断开观察器');
});
check('main.js：视口/面板尺寸变化经 ResizeObserver 重算（带存在性守卫）', () => {
  assert.ok(/typeof ResizeObserver !== 'undefined'/.test(mainSrc) && /new ResizeObserver\(schedulePaperFit\)/.test(mainSrc), 'ResizeObserver 挂载缺失');
});

// ================= 2. jsdom 布局模拟（真实执行链） =================
console.log('== 纸张自适应：jsdom 布局模拟 ==');
const coreCode = fs.readFileSync(path.join(__dirname, '../../src/markdown/core.js'), 'utf8');
const mathCode = fs.readFileSync(path.join(__dirname, '../../src/markdown/math.js'), 'utf8');
const mmCode = fs.readFileSync(path.join(__dirname, '../../src/markdown/mermaid.js'), 'utf8');
const hlCode = fs.readFileSync(path.join(__dirname, '../../src/markdown/highlight.js'), 'utf8');

const html = [
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>',
  '<div id="app"></div>',
  '<script>',
  'window.__posted = [];',
  'window.acquireVsCodeApi = function () {',
  '  return { postMessage: function (m) { window.__posted.push(m); }, setState: function(){}, getState: function(){ return {}; } };',
  '};',
  'window.__onMessage = null;',
  'window.addEventListener = function (t, fn) { if (t === "message") { window.__onMessage = fn; } else { EventTarget.prototype.addEventListener.call(window, t, fn); } };',
  '</script>',
  '<script>' + hlCode + '</script>',
  '<script>' + mathCode + '</script>',
  '<script>' + mmCode + '</script>',
  '<script>' + coreCode + '</script>',
  '<script>' + mainSrc + '</script>',
  '</body></html>'
].join('\n');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
const wait = ms => new Promise(r => setTimeout(r, ms));
// jsdom 无排版：clientWidth/scrollWidth 恒 0 → 用实例级 stub 模拟浏览器量测值
function stubMetrics(el, client, scroll) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: client });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scroll });
}

const WIDE_MD = [
  '# 宽表文档', '',
  '| 列一 | 列二 | 列三 | 列四 | 列五 | 列六 | 列七 | 列八 | 列九 | 列十 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 数据 | 数据 | 数据 | 数据 | 数据 | 数据 | 数据 | 数据 | 数据 | 数据 |'
].join('\n');

let chain = Promise.resolve();
function itest(name, fn) {
  chain = chain.then(() => fn())
    .then(() => { passed++; console.log('  ✓ ' + name); },
      e => { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); });
}

itest('init 加载宽表格 → 纸张以内联 min-width 撑宽到内容需要（1200px）', async () => {
  const editor = doc.querySelector('#editor');
  stubMetrics(editor, 794, 1200); // 设定纸张 794 / 内容需要 1200
  win.__onMessage({ data: { type: 'init', text: WIDE_MD, settings: {} } });
  await wait(80); // rAF 节拍（jsdom ~16ms/帧）
  assert.strictEqual(editor.style.minWidth, '1200px', 'min-width 应为 1200px，实际: ' + editor.style.minWidth);
});
itest('撑宽同时把 --page-need 同步到 #main（面包屑跟随）', async () => {
  const main = doc.querySelector('#main');
  assert.strictEqual(main.style.getPropertyValue('--page-need'), '1200px', '--page-need 未同步');
});
itest('内容收窄（重发 init 模拟删列后重排）→ min-width 回落清除', async () => {
  const editor = doc.querySelector('#editor');
  stubMetrics(editor, 794, 794); // 内容不再超出
  win.__onMessage({ data: { type: 'init', text: '# 窄文档\n\n短段落。\n', settings: {} } });
  await wait(80);
  assert.strictEqual(editor.style.minWidth, '', 'min-width 应回落清除，实际: ' + editor.style.minWidth);
  assert.strictEqual(doc.querySelector('#main').style.getPropertyValue('--page-need'), '', '--page-need 应移除');
});
itest('普通文档无溢出 → 不撑宽（min-width 保持空）', async () => {
  const editor = doc.querySelector('#editor');
  stubMetrics(editor, 794, 794);
  win.__onMessage({ data: { type: 'init', text: '# 普通\n\n正文段落。\n\n| a | b |\n| - | - |\n| 1 | 2 |\n', settings: {} } });
  await wait(80);
  assert.strictEqual(editor.style.minWidth, '', '无溢出不应设置 min-width');
});
itest('分屏模式：预览 .pv-inner 同步自适应宽表格', async () => {
  const pv = doc.querySelector('.pv-inner');
  stubMetrics(doc.querySelector('#editor'), 794, 794);
  stubMetrics(pv, 700, 980);
  win.__onMessage({ data: { type: 'init', text: WIDE_MD, settings: { defaultMode: 'split' } } });
  await wait(80);
  assert.strictEqual(pv.style.minWidth, '980px', '预览区 min-width 应为 980px，实际: ' + pv.style.minWidth);
});
itest('jsdom 无布局环境（clientWidth=0）→ 跳过量测不误写（防御性）', async () => {
  const editor = doc.querySelector('#editor');
  stubMetrics(editor, 0, 0);
  win.__onMessage({ data: { type: 'init', text: WIDE_MD, settings: {} } });
  await wait(80);
  assert.strictEqual(editor.style.minWidth, '', '无布局时不应写入 min-width');
});

chain.then(() => {
  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  if (failed) { process.exitCode = 1; }
});
