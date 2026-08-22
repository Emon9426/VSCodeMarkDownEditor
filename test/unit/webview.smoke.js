/**
 * Webview 冒烟测试 — 通过 global DOM stub + 静态 require 执行 main.js 全链路：
 * 构建 UI → init 消息加载文档 → 模式切换（触发序列化）→ 外部变更 → 命令分发
 * 目的：捕获运行时错误（undefined 函数 / typo / 断链），DOM 细节由真实浏览器保证。
 */
'use strict';
const path = require('path');
const assert = require('assert');

// ---------------- 微型 DOM stub（先于模块加载注入 global） ----------------
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    children: [],
    parentNode: null,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
    dataset: {},
    attrs: {},
    _cls: '', _html: '', textContent: '',
    value: '', selectionStart: 0, selectionEnd: 0,
    title: '', spellcheck: false, contentEditable: '',
    set className(v) { this._cls = v; },
    get className() { return this._cls; },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    get childNodes() { return this.children; },
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; },
    classList: null,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    append(c) { this.appendChild(c); },
    insertBefore(n, ref) {
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i === -1) { this.children.push(n); } else { this.children.splice(i, 0, n); }
      n.parentNode = this; return n;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) { this.children.splice(i, 1); } c.parentNode = null; return c; },
    remove() { if (this.parentNode) { this.parentNode.removeChild(this); } },
    replaceChild(n, o) { const i = this.children.indexOf(o); if (i !== -1) { this.children[i] = n; } n.parentNode = this; },
    replaceWith(n) { if (this.parentNode) { this.parentNode.replaceChild(n, this); } },
    after(n) { if (this.parentNode) { this.parentNode.insertBefore(n, this.nextSiblingNode()); } },
    before(n) { if (this.parentNode) { this.parentNode.insertBefore(n, this); } },
    nextSiblingNode() { const sib = this.parentNode.children; return sib[sib.indexOf(this) + 1] || null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    closest() { return null; },
    contains() { return false; },
    focus() {}, click() {},
    dispatchEvent() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    scrollIntoView() {}
  };
  el.classList = {
    add(...cs) { cs.forEach(c => { if (el._cls.split(/\s+/).indexOf(c) === -1) { el._cls = (el._cls + ' ' + c).trim(); } }); },
    remove(...cs) { el._cls = el._cls.split(/\s+/).filter(x => cs.indexOf(x) === -1).join(' '); },
    toggle() {}, contains(c) { return el._cls.split(/\s+/).indexOf(c) !== -1; }
  };
  return el;
}

const winListeners = {};
const postMessages = [];

global.window = global;
global.self = global;
global.document = {
  nodeType: 9,
  createElement: t => makeEl(t),
  createDocumentFragment: () => makeEl('#fragment'),
  createTextNode: t => { const e = makeEl('#text'); e.nodeType = 3; e.textContent = t; return e; },
  createRange: () => ({
    setStart() {}, setEnd() {}, setStartAfter() {}, collapse() {},
    selectNode() {}, selectNodeContents() {},
    deleteContents() {}, insertNode() {},
    extractContents: () => makeEl('#fragment'),
    surroundContents() {},
    getClientRects: () => []
  }),
  querySelector: () => makeEl('div'),
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl('body'),
  activeElement: null,
  getElementById: () => makeEl('div')
};
global.getSelection = () => ({ rangeCount: 0, isCollapsed: true, anchorNode: null, anchorOffset: 0, removeAllRanges() {}, addRange() {} });
global.innerWidth = 1200; global.innerHeight = 800;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText() {} } }, configurable: true });
global.addEventListener = (t, fn) => { winListeners[t] = fn; };
global.removeEventListener = () => {};
global.Event = function () {};
global.acquireVsCodeApi = () => ({
  postMessage: m => postMessages.push(m),
  setState() {}, getState() { return {}; }
});

// ---------------- 静态加载模块（UMD core 先挂 MdCore，再加载 main 执行构建） ----------------
require('../../src/markdown/core.js');
require('../../src/webview/main.js');

let failed = 0;
function step(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); }
}

console.log('== Webview 冒烟（stub DOM） ==');

step('UI 构建完成且发出 ready', () => {
  assert.ok(postMessages.some(m => m.type === 'ready'), '应有 ready 消息');
});

const SAMPLE = '# 项目计划\n\n这是**加粗**与*斜体*和`代码`。\n\n> 引用一行\n\n- [x] 已完成\n- [ ] 待办\n  - 子任务\n\n| A | B |\n|:---:|---:|\n| 1 | 2 |\n\n```plsql\nSELECT 1 FROM dual;\n```\n\n---\n';

step('init 消息：加载混合文档不抛错', () => {
  winListeners.message({ data: { type: 'init', text: SAMPLE, settings: {} } });
});

step('init 消息：带 F16 页面设置（A4 + 护眼绿 + 横线）', () => {
  winListeners.message({ data: { type: 'init', text: SAMPLE, settings: { page: { size: 'a4', customWidth: 794, background: 'green', pattern: 'lines' } } } });
});

step('F16 页面设置命令（面板弹出路径）', () => {
  winListeners.message({ data: { type: 'command', cmd: 'pageSetup' } });
});

step('切换到源码模式（触发 DOM→md 序列化）', () => {
  winListeners.message({ data: { type: 'command', cmd: 'toggleMode' } });
});

step('循环切回所见即所得（触发 md→DOM）', () => {
  winListeners.message({ data: { type: 'command', cmd: 'toggleMode' } }); // source → split
  winListeners.message({ data: { type: 'command', cmd: 'toggleMode' } }); // split → wysiwyg
});

step('外部变更重新加载', () => {
  winListeners.message({ data: { type: 'externalChange', text: '# 新内容\n\n正文段落\n' } });
});

step('imageMap 消息', () => {
  winListeners.message({ data: { type: 'imageMap', map: {} } });
});

step('插入表格命令（grid 弹层路径）', () => {
  winListeners.message({ data: { type: 'command', cmd: 'insertTable' } });
});

step('imageSaved 消息（无挂起图片时静默）', () => {
  winListeners.message({ data: { type: 'imageSaved', id: 'nonexistent', relPath: 'images/x.png' } });
});

step('MdCore 已注入且 DOM 端 API 可用', () => {
  assert.strictEqual(typeof global.window.MdCore.parse, 'function');
  assert.strictEqual(typeof global.window.MdCore.blocksToDom, 'function');
  assert.strictEqual(typeof global.window.MdCore.domToBlocks, 'function');
});

console.log('\n结果: ' + (failed ? failed + ' 项失败' : '全部通过'));
if (failed) { process.exitCode = 1; }
