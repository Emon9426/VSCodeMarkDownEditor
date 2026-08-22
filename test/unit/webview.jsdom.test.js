/**
 * Webview 集成测试（jsdom）— 真实浏览器级 DOM / 事件 / 选区驱动完整交互链路：
 * 点击页签 → 点击工具按钮 → 网格选择 → 插入表格 → 输入 → Tab 跳格 → 行操作 → 序列化 → 重载
 * jsdom 不覆盖：contenteditable 原生打字、CSS 渲染视觉、真实焦点（仍需真机抽检）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const coreCode = fs.readFileSync(path.join(__dirname, '../../src/markdown/core.js'), 'utf8');
const mainCode = fs.readFileSync(path.join(__dirname, '../../src/webview/main.js'), 'utf8');

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
  '<script>' + coreCode + '</script>',
  '<script>' + mainCode + '</script>',
  '</body></html>'
].join('\n');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;
const postMessages = () => win.__posted;

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, chain = Promise.resolve();
function test(name, fn) {
  chain = chain.then(() => {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') {
        return r.then(
          () => console.log('  ✓ ' + name),
          e => { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); });
      }
      console.log('  ✓ ' + name);
    } catch (e) {
      failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e));
    }
  });
}
function q(sel) { return doc.querySelector(sel); }
function qa(sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); }
function click(el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }
function key(k, opts) {
  const e = new win.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}));
  q('#editor').dispatchEvent(e); // 编辑器键盘统一派发到 #editor（产品绑定处）
  return e;
}
function sel() { return win.getSelection(); }
function caretIn(el, atEnd) {
  const r = doc.createRange();
  r.selectNodeContents(el); r.collapse(!atEnd);
  sel().removeAllRanges(); sel().addRange(r);
  doc.dispatchEvent(new win.Event('selectionchange')); // 真实浏览器在选区变化时自动派发
}
function nodeIn(node, ancestor) {
  let cur = node;
  while (cur) { if (cur === ancestor) { return true; } cur = cur.parentNode; }
  return false;
}

console.log('== Webview 集成（jsdom 真实 DOM/事件/选区） ==');

test('启动：ready 消息 + UI 骨架', () => {
  assert.ok(postMessages().some(m => m.type === 'ready'));
  assert.ok(q('#rtabs') && q('#editor') && q('#statusBar'));
});

test('init：文档渲染为块（h1 + p）', () => {
  win.__onMessage({ data: { type: 'init', text: '# 标题\n\n正文段落。\n', settings: {} } });
  assert.strictEqual(q('#editor > h1').textContent, '标题');
  assert.ok(q('#editor > p'));
});

// ================= 表格全链路 =================
test('点击「插入」页签 → 插入面板激活', () => {
  click(qa('.rtab').find(t => t.dataset.panel === 'rp-ins'));
  assert.ok(q('#rp-ins').classList.contains('active'));
});

test('点击表格按钮 → 网格选择器弹出', () => {
  const btn = q('#rp-ins .rbtn[data-cmd="table"]');
  assert.ok(btn, '插入页签有表格按钮');
  click(btn);
  assert.strictEqual(q('#tablePicker').style.display, 'block');
  assert.ok(q('#tpGrid .cell'));
});

test('网格 hover 高亮与标签（3×2 → “3 × 2 表格”）', () => {
  const target = qa('#tpGrid .cell').find(c => +c.dataset.r === 2 && +c.dataset.c === 3);
  target.dispatchEvent(new win.MouseEvent('mouseenter'));
  assert.strictEqual(qa('#tpGrid .cell.on').length, 6);
  assert.strictEqual(q('#tpLabel').textContent, '3 × 2 表格');
});

test('网格 click → 插入表格（表头 3 列 + 数据 2 行）', () => {
  click(qa('#tpGrid .cell').find(c => +c.dataset.r === 2 && +c.dataset.c === 3));
  const table = q('#editor > table');
  assert.ok(table, '表格已进入编辑区');
  assert.strictEqual(table.querySelectorAll('thead th').length, 3);
  assert.strictEqual(table.querySelectorAll('tbody tr').length, 2);
  assert.strictEqual(table.querySelector('th').textContent, '列1');
});

test('插入后光标落在首个单元格', () => {
  assert.ok(nodeIn(sel().anchorNode, q('#editor th')) || sel().anchorNode === q('#editor th'));
});

test('在单元格输入文本（DOM 变化 + input 事件）', () => {
  const td = q('#editor tbody tr td');
  td.textContent = '数据A';
  q('#editor').dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.strictEqual(q('#editor tbody tr td').textContent, '数据A');
});

test('表格内 Tab → 光标跳到下一格（修复验证：焦点/拦截）', () => {
  const tds = qa('#editor tbody tr td');
  caretIn(tds[0], true);
  const e = key('Tab');
  assert.strictEqual(e.defaultPrevented, true, 'Tab 被拦截');
  assert.ok(nodeIn(sel().anchorNode, tds[1]), '光标跳到第二个 td');
});

test('表格内 Enter → 光标跳到下一行同列', () => {
  const rows = qa('#editor tbody tr');
  caretIn(rows[0].children[0], true);
  key('Enter');
  assert.ok(nodeIn(sel().anchorNode, rows[1].children[0]), '光标跳到第二行第一格');
});

test('表格内 Shift+Tab → 光标回退一格', () => {
  const tds = qa('#editor tbody tr td');
  caretIn(tds[1], true);
  key('Tab', { shiftKey: true });
  assert.ok(nodeIn(sel().anchorNode, tds[0]));
});

test('工具条操作：下方插行恰好 +1（修复验证：双执行 bug）', () => {
  caretIn(q('#editor tbody tr td'), true);
  doc.dispatchEvent(new win.Event('selectionchange'));
  assert.ok(q('#ttBar').style.display !== 'none', '工具条显示');
  const before = qa('#editor tbody tr').length;
  click(qa('#ttBar .rbtn').find(b => b.dataset.cmd === 'rowBelow'));
  assert.strictEqual(qa('#editor tbody tr').length, before + 1, '只加一行（此前 bug 为 +2）');
});

test('Ribbon 表格页签：删除列恰好 -1（修复验证：双执行 bug）', () => {
  click(qa('.rtab').find(t => t.dataset.panel === 'rp-tbl'));
  const row = q('#editor tbody tr');
  caretIn(row.children[row.children.length - 1], true); // 光标放最后一列，保留前列供后续断言
  const before = qa('#editor thead th').length;
  click(q('#rp-tbl .rbtn[data-cmd="delCol"]'));
  assert.strictEqual(qa('#editor thead th').length, before - 1, '只删一列（此前 bug 为 -2）');
});

test('按列对齐：居中写入 data-align 并随序列化', async () => {
  caretIn(q('#editor tbody tr td'), true);
  click(q('#rp-tbl .rbtn[data-cmd="alCenter"]'));
  assert.ok(q('#editor thead th[data-align="center"]'), '表头列带居中标记');
  await wait(650); // 等 500ms 防抖保存
  const update = postMessages().filter(m => m.type === 'update').pop();
  assert.ok(update, '应有 update 消息');
  assert.ok(/\| 列1 \| 列2 \|/.test(update.text), '含表头行');
  assert.ok(/:---:/.test(update.text), '分隔行含居中对齐');
  assert.ok(/\| 数据A \|/.test(update.text), '含数据');
});

test('外部变更重载 → 表格往返无损', () => {
  const md = postMessages().filter(m => m.type === 'update').pop().text;
  win.__onMessage({ data: { type: 'externalChange', text: md } });
  assert.ok(q('#editor > table'), '表格重建');
  assert.ok(q('#editor tbody tr td').textContent.indexOf('数据A') === 0, '数据保留');
});

// ================= 其他链路 =================
test('斜杠菜单：/表 过滤出「表格」，Enter → 网格选择器', async () => {
  const p = q('#editor > p') || (() => { const np = doc.createElement('p'); q('#editor').appendChild(np); return np; })();
  p.innerHTML = '';
  p.appendChild(doc.createTextNode('前缀/表'));
  const r = doc.createRange();
  r.setStart(p.firstChild, 4); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  q('#editor').dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(30); // checkSlashTrigger 经 setTimeout(0)
  const items = qa('#slashList .sitem');
  assert.ok(items.length >= 1, '过滤出菜单项');
  assert.ok(items.find(i => i.dataset.cmd === 'table'), '含表格项');
  const active = qa('#slashList .sitem.active')[0];
  assert.strictEqual(active && active.dataset.cmd, 'table', '“表格”应为首个高亮项');
  key('Enter');
  assert.strictEqual(q('#tablePicker').style.display, 'block', 'Enter → 网格选择器弹出');
  // 收尾：插入并清场
  click(qa('#tpGrid .cell').find(c => +c.dataset.r === 2 && +c.dataset.c === 2));
});

test('速记输入：“## ” + 空格 → 二级标题', () => {
  const p = doc.createElement('p');
  p.textContent = '##';
  q('#editor').appendChild(p);
  const r = doc.createRange();
  r.setStart(p.firstChild, 2); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  key(' ');
  const h2 = qa('#editor h2').pop();
  assert.ok(h2, '应生成 h2');
});

test('页面设置（F16）：A4 + 护眼绿 + 横线应用', () => {
  win.__onMessage({ data: { type: 'init', text: '正文\n', settings: { page: { size: 'a4', background: 'green', pattern: 'lines' } } } });
  assert.ok(/794px/.test(q('#main').style.getPropertyValue('--page-width')), 'A4 宽度变量：' + q('#main').style.getPropertyValue('--page-width'));
  assert.ok(/rgb\(199, ?237, ?204\)|#c7edcc/i.test(q('#editor').style.backgroundColor), '护眼绿：' + q('#editor').style.backgroundColor);
  assert.ok(q('#editor').classList.contains('pat-lines'));
});

test('页面设置：saveSetting 消息持久化', async () => {
  const before = postMessages().filter(m => m.type === 'saveSetting').length;
  click(qa('.rtab').find(t => t.dataset.panel === 'rp-view'));
  click(q('#rp-view .rbtn[data-cmd="pageSetup"]'));
  await wait(30);
  const chips = qa('#pagePanel .pchips span');
  click(chips.find(c => c.textContent.indexOf('A5') === 0));
  const saved = postMessages().filter(m => m.type === 'saveSetting');
  assert.strictEqual(saved.length, before + 1, '发出持久化消息');
  assert.strictEqual(JSON.stringify(saved.pop()), JSON.stringify({ type: 'saveSetting', section: 'page', key: 'size', value: 'a5' }));
  assert.ok(/559px/.test(q('#main').style.getPropertyValue('--page-width')), 'A5 宽度变量应用');
});

// ================= 回归：源码模式与页面尺寸一致 =================
test('源码模式：textarea 内容同步 + 纸张宽度变量共用 + 原生编辑器入口', () => {
  win.__onMessage({ data: { type: 'init', text: '# 源码测试\n\n段落。\n', settings: { page: { size: 'a4' } } } });
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // → source
  assert.ok(doc.body.classList.contains('source'), 'body 进入 source 态');
  assert.ok(q('#srcTextarea').value.indexOf('# 源码测试') === 0, '源码内容同步：' + q('#srcTextarea').value.slice(0, 20));
  assert.ok(/794px/.test(q('#main').style.getPropertyValue('--page-width')), '源码纸张宽度与页面设置共用同一变量');
  assert.ok(q('#openNativeBtn'), '提示条含原生编辑器入口');
  const before = postMessages().filter(m => m.type === 'openNative').length;
  click(q('#openNativeBtn'));
  assert.strictEqual(postMessages().filter(m => m.type === 'openNative').length, before + 1, '发出 openNative 消息');
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // → split
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // → wysiwyg
});

// ================= 回归：空行/块间隙插入表格（用户报告 cursor_sync_test.md） =================
const USER_DOC = [
  '# 光标同步功能测试文档', '',
  '## 功能描述', 'v1.4.0 新增功能：当用户在代码文件中点击某一行时，大纲视图会自动选中对应的部分。', '',
  '### 1. 光标位置监听', '- 监听事件', '- 获取当前光标位置（行号）', '- 仅对PL/SQL文件生效', '',
  '```json', '{', '  "plsql-outline.view.autoSelectOnCursor": {', '    "type": "boolean"', '  }', '}', '```', '',
  '## 预期行为', '- ✅ 光标移动时，大纲视图自动选中对应节点', '- ✅ 选中的节点会自动展开显示', '',
  '## 版本信息', '- 功能版本：v1.4.0', '  - `src/extension.ts` - 主要逻辑实现', '  - `src/treeView.ts` - 树视图同步方法', ''
].join('\n');

function resetWithUserDoc() {
  win.__onMessage({ data: { type: 'init', text: USER_DOC, settings: {} } });
}
function insertTableViaGrid() {
  const cells = qa('#tpGrid .cell');
  const target = cells.find(c => +c.dataset.r === 2 && +c.dataset.c === 2); // 2×2
  // 模拟真实浏览器（Chromium）：点击非编辑区元素时 selection 被夺走到该元素
  const r = doc.createRange();
  r.selectNodeContents(target); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  click(target);
}

test('场景1：空段落上插入表格 → 原位替换（不再跳末尾）', () => {
  resetWithUserDoc();
  const paras = qa('#editor > p');
  const emptyP = doc.createElement('p'); emptyP.innerHTML = '<br>';
  paras[0].after(emptyP); // 在首段后造一个空行
  const idxBefore = qa('#editor > *').indexOf(emptyP);
  caretIn(emptyP, false);
  insertTableViaGrid();
  const kids = qa('#editor > *');
  const table = q('#editor > table');
  assert.ok(table, '表格已插入');
  assert.strictEqual(kids.indexOf(table), idxBefore, '表格应原位替换空段落（此前 bug：跳到文档末尾）');
  assert.strictEqual(qa('#editor > table').length, 1, '只插入一个表格');
});

test('场景2：块间隙光标插入表格 → 按光标 offset 原位插入', () => {
  resetWithUserDoc();
  // 光标在编辑器容器本身（第 2 与第 3 个块之间）——"点击空行无反应"的复现场景
  const kidsBefore = qa('#editor > *');
  const r = doc.createRange();
  r.setStart(q('#editor'), 2); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  doc.dispatchEvent(new win.Event('selectionchange')); // 记录块间隙选区
  insertTableViaGrid();
  const kidsAfter = qa('#editor > *');
  const table = q('#editor > table');
  assert.ok(table);
  assert.strictEqual(kidsAfter.indexOf(table), 2, '表格应插在原第 2 块之后（光标处）');
  assert.strictEqual(kidsAfter[3], kidsBefore[2], '原有块顺序不被打乱');
});

test('场景3：文档末尾空白光标 → 表格追加末尾且不重复', () => {
  resetWithUserDoc();
  const r = doc.createRange();
  r.setStart(q('#editor'), q('#editor').childNodes.length); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  doc.dispatchEvent(new win.Event('selectionchange')); // 记录末尾光标
  const before = qa('#editor > *').length;
  insertTableViaGrid();
  insertTableViaGrid(); // 连续两次（用户"多尝试几次"）
  const tables = qa('#editor > table');
  assert.strictEqual(tables.length, 2, '两次操作两个表（不再堆积异常）');
  assert.strictEqual(qa('#editor > *').length, before + 2);
  assert.strictEqual(qa('#editor > *').indexOf(tables[0]), before, '两个表均在文档末尾');
});

test('场景4：多次插入后序列化往返不乱', async () => {
  await wait(650);
  const md0 = postMessages().filter(m => m.type === 'update').pop().text;
  assert.ok(md0.indexOf('# 光标同步功能测试文档') === 0, '标题仍在开头');
  assert.ok(md0.indexOf('## 功能描述') > 0);
  assert.ok(md0.indexOf('```json') > 0, 'JSON 代码块保留');
  assert.ok(/\| 列1 \| 列2 \|/.test(md0), '表格已写入文档');
  win.__onMessage({ data: { type: 'externalChange', text: md0 } });
  assert.strictEqual(q('#editor > h1').textContent, '光标同步功能测试文档', '往返后结构完好');
});

test('场景5：源码模式点击插入 → 拒绝并提示，不污染文档', () => {
  resetWithUserDoc();
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // → source
  insertTableViaGrid();
  assert.ok(!q('#editor > table'), '未插入任何表格');
  assert.strictEqual(q('#toast').style.display, 'block', '给出模式提示');
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // → split
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // → wysiwyg
});

test('场景6（真实浏览器回归）：光标在第二段 → 点击网格时选区被夺走 → 表格仍插在光标处而非末尾', () => {
  resetWithUserDoc();
  // 光标放到第二个段落（"v1.4.0 新增功能…"）
  const paras = qa('#editor > p');
  const targetP = paras.find(p => p.textContent.indexOf('v1.4.0') === 0);
  caretIn(targetP, true);
  doc.dispatchEvent(new win.Event('selectionchange')); // 触发 lastValidRange 记录
  const idxP = qa('#editor > *').indexOf(targetP);
  insertTableViaGrid(); // 内部已模拟选区被夺走到网格 cell
  const table = q('#editor > table');
  assert.ok(table, '表格已插入');
  const idxT = qa('#editor > *').indexOf(table);
  assert.strictEqual(idxT, idxP + 1, '表格应在光标段落之后（此前 bug：跳到文档末尾），实际位置 ' + idxT + ' / 段落 ' + idxP);
});

// ================= 排查复现：斜杠菜单误触发 =================
test('复现：正文输入路径 ./images 不应触发斜杠菜单', async () => {
  win.__onMessage({ data: { type: 'init', text: '段落一\n\n段落二\n', settings: {} } });
  const p = qa('#editor > p')[0];
  p.innerHTML = '';
  p.appendChild(doc.createTextNode('图片在 ./ima'));
  const r = doc.createRange();
  r.setStart(p.firstChild, p.firstChild.textContent.length); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  doc.dispatchEvent(new win.Event('selectionchange'));
  q('#editor').dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(30);
  const menu = q('#slashMenu');
  assert.strictEqual(menu.style.display, 'none', '路径中的 / 不应唤出斜杠菜单（当前为误触发）');
});

test('复现：正文输入 URL https:// 不应触发斜杠菜单', async () => {
  const p = qa('#editor > p')[0];
  p.innerHTML = '';
  p.appendChild(doc.createTextNode('见 https:/'));
  const r = doc.createRange();
  r.setStart(p.firstChild, p.firstChild.textContent.length); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  q('#editor').dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(30);
  assert.strictEqual(q('#slashMenu').style.display, 'none', '协议斜杠不应唤出菜单');
});

test('对照：行中独立 / 仍正常触发斜杠菜单', async () => {
  const p = qa('#editor > p')[0];
  p.innerHTML = '';
  p.appendChild(doc.createTextNode('内容 /'));
  const r = doc.createRange();
  r.setStart(p.firstChild, p.firstChild.textContent.length); r.collapse(true);
  sel().removeAllRanges(); sel().addRange(r);
  q('#editor').dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(30);
  assert.strictEqual(q('#slashMenu').style.display, 'flex', '独立 / 应唤出菜单');
  key('Escape');
});

function runCmdByPanel(panelId, cmd) {
  click(qa('.rtab').find(t => t.dataset.panel === panelId));
  click(q('#' + panelId + ' .rbtn[data-cmd="' + cmd + '"]'));
}

// ================= 审查修复回归 =================
test('H1：光标在表格内点列表按钮 → 表格结构保留并提示', () => {
  resetWithUserDoc();
  const cells = qa('#tpGrid .cell');
  click(cells.find(c => +c.dataset.r === 2 && +c.dataset.c === 2));
  const table = q('#editor > table');
  assert.ok(table);
  caretIn(q('#editor tbody tr td'), true);
  doc.dispatchEvent(new win.Event('selectionchange'));
  runCmdByPanel('rp-home', 'ul'); // 点「开始」页的无序列表按钮
  assert.ok(q('#editor > table'), '表格未被销毁（此前 bug：整块变成文字）');
  assert.strictEqual(q('#toast').style.display, 'block', '给出提示');
});
test('H4：粘贴多块 Markdown 顺序保持（fragment 一次插入）', () => {
  resetWithUserDoc();
  const p = qa('#editor > p')[0];
  caretIn(p, true);
  doc.dispatchEvent(new win.Event('selectionchange'));
  const TEXT = '# 新标题\n\n新段落文字\n';
  const ev = new win.Event('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = { items: [], getData: t => (t === 'text/plain' ? TEXT : '') };
  q('#editor').dispatchEvent(ev);
  const h1 = qa('#editor h1').find(h => h.textContent === '新标题');
  const para = qa('#editor p').find(x => x.textContent === '新段落文字');
  assert.ok(h1 && para, '两个块都已插入');
  const kids = qa('#editor > *');
  assert.ok(kids.indexOf(h1) < kids.indexOf(para), '标题在段落之前（此前 bug：反序）');
});
test('H3：代码块内 br 序列化为换行', () => {
  resetWithUserDoc();
  const pre = doc.createElement('pre');
  pre.setAttribute('data-lang', '');
  const code = doc.createElement('code');
  code.appendChild(doc.createTextNode('a'));
  code.appendChild(doc.createElement('br'));
  code.appendChild(doc.createTextNode('b'));
  pre.appendChild(code);
  q('#editor').appendChild(pre);
  const md = win.MdCore.domToMarkdown(q('#editor'));
  assert.ok(md.indexOf('a\nb') !== -1, 'br 应变换行（此前 bug：并成 ab）：' + JSON.stringify(md.slice(-20)));
});
test('M2：模式切换保留 VS Code 主题类', () => {
  doc.body.classList.add('vscode-dark');
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // → source
  assert.ok(doc.body.classList.contains('vscode-dark'), '主题类保留');
  assert.ok(doc.body.classList.contains('source'), '模式类正确');
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } });
  win.__onMessage({ data: { type: 'command', cmd: 'toggleMode' } }); // 回 wysiwyg
  assert.ok(doc.body.classList.contains('vscode-dark'), '多次切换后主题类仍在');
});
test('M3：Ctrl+Shift+8 触发无序列表（shift 符号键兜底）', () => {
  resetWithUserDoc();
  const p = qa('#editor > p')[0];
  caretIn(p, true);
  doc.dispatchEvent(new win.Event('selectionchange'));
  key('*', { ctrlKey: true, shiftKey: true, code: 'Digit8' }); // Shift+8 在多数布局产生 *
  assert.ok(q('#editor > ul'), '应生成无序列表');
});

chain.then(() => {
  console.log('\n结果: ' + (failed ? failed + ' 项失败' : '全部通过'));
  if (failed) { process.exitCode = 1; }
});
