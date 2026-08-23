/**
 * 宿主侧（extension.js）大纲视图全链路测试（jsdom 内联注入 + vscode stub，与 webview.jsdom.test.js 同模式）
 * 验证：activate 注册 → resolveCustomEditor 挂消息 → outline 消息建树 → 树项/命令 → gotoHeading 转发回 webview
 * （F14 大纲视图属宿主功能，webview 测试覆盖不到，2026-08-23 用户报"大纲视图没实现"后补齐）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const extCode = fs.readFileSync(path.join(__dirname, '../../src/extension.js'), 'utf8');

// vscode stub（自包含函数体，经 toString() 内联进 jsdom HTML——stub 不可引用外部闭包）
function stubVscodeFactory() {
  const calls = { commands: [], treeViews: [], providers: [] };
  class Disposable { constructor(fn) { this._fn = fn; } dispose() { this._fn && this._fn(); } }
  class EventEmitter { constructor() { this.listeners = []; } get event() { return l => { this.listeners.push(l); return new Disposable(); }; } fire(v) { this.listeners.forEach(l => l(v)); } }
  class TreeItem { constructor(label) { this.label = label; } }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  class Range { constructor(a, b, c, d) { this.args = [a, b, c, d]; } }
  class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } }
  const configStore = {};
  const api = {
    _calls: calls,
    EventEmitter: EventEmitter, TreeItem: TreeItem, TreeItemCollapsibleState: TreeItemCollapsibleState,
    Range: Range, WorkspaceEdit: WorkspaceEdit, Disposable: Disposable,
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    ViewColumn: { Beside: -2 },
    Uri: { joinPath: (base, ...segs) => ({ scheme: base.scheme, path: base.path + '/' + segs.join('/') }) },
    LanguageModelChatMessage: { Role: { User: 'user', Assistant: 'assistant' } },
    lm: undefined,
    commands: {
      registerCommand: (id, cb) => { calls.commands.push({ id: id, cb: cb }); return new Disposable(); },
      executeCommand: async () => undefined
    },
    window: {
      registerCustomEditorProvider: (viewType, provider) => { calls.providers.push({ viewType: viewType, provider: provider }); return new Disposable(); },
      createTreeView: (id, opt) => { calls.treeViews.push({ id: id, opt: opt }); return new Disposable(); },
      showInformationMessage: () => undefined, showWarningMessage: () => undefined,
      showTextDocument: async () => undefined
    },
    workspace: {
      workspaceFolders: null,
      getConfiguration: section => ({
        get: (key, def) => (configStore[section + '.' + key] !== undefined ? configStore[section + '.' + key] : def),
        update: (key, value) => { configStore[section + '.' + key] = value; return Promise.resolve(); }
      }),
      applyEdit: async () => true,
      onDidChangeTextDocument: () => new Disposable(),
      fs: { writeFile: async () => undefined, readFile: async () => Buffer.from(''), createDirectory: async () => undefined, stat: async () => ({ type: 1 }) }
    },
    env: { openExternal: async () => undefined }
  };
  return api;
}

const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
  '<script>window.vscode = (' + stubVscodeFactory.toString() + ')();' +
  'window.__pathStub = null;' +
  'window.module = { exports: {} };' +
  'window.exports = window.module.exports;' +
  'window.require = function (n) { if (n === "vscode") { return window.vscode; } if (n === "path") { return window.__pathStub; } throw new Error("stub require: " + n); };' +
  '</scr' + 'ipt>' +
  // extension.js 字符串字面量中的闭合标签需转义（JS 字符串内 "\/" 与 "/" 等价，不改变语义）
  '<script>' + extCode.replace(/<\/script/g, '<\\/script') + '</scr' + 'ipt>' +
  '</body></html>';
const dom = new JSDOM(html, { runScripts: 'dangerously' });
dom.window.__pathStub = path;
const vscode = dom.window.vscode;
const ext = dom.window.module.exports;

const results = [];
function test(name, fn) { try { fn(); results.push('✓ ' + name); console.log('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message); console.log('✗ ' + name + ' — ' + e.message); process.exitCode = 1; } }

// ---- 测试 ----
const context = { subscriptions: [], extensionUri: { scheme: 'file', path: '/ext' }, asAbsolutePath: p => p };
let listeners = [], posted = [];

test('activate：注册 custom editor + TreeView（markdownWordOutline）+ 全部命令', () => {
  ext.activate(context);
  assert.strictEqual(vscode._calls.providers.length, 1);
  assert.strictEqual(vscode._calls.providers[0].viewType, 'wysiwygMarkdownEditor');
  assert.strictEqual(vscode._calls.treeViews.length, 1);
  assert.strictEqual(vscode._calls.treeViews[0].id, 'markdownWordOutline', '大纲 TreeView id 与 package.json views 一致');
  const cmdIds = vscode._calls.commands.map(c => c.id);
  ['wysiwygMarkdown.toggleMode', 'wysiwygMarkdown.gotoHeading'].forEach(id => assert.ok(cmdIds.indexOf(id) !== -1, '命令 ' + id));
});

test('package.json：大纲视图有独立活动栏容器 + 空状态欢迎语 + 图标文件存在', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  const vc = pkg.contributes.viewsContainers && pkg.contributes.viewsContainers.activitybar;
  assert.ok(Array.isArray(vc) && vc.length, '活动栏视图容器');
  assert.strictEqual(vc[0].id, 'markdownWord');
  assert.ok(vc[0].icon, '容器有图标');
  const view = pkg.contributes.views.markdownWord && pkg.contributes.views.markdownWord[0];
  assert.ok(view && view.id === 'markdownWordOutline', '大纲视图挂在专用容器下');
  assert.ok(!pkg.contributes.views.explorer, '已从资源管理器迁移（避免折叠区不可见）');
  const welcome = (pkg.contributes.viewsWelcome || []).find(w => w.view === 'markdownWordOutline');
  assert.ok(welcome && welcome.contents, '空树时显示欢迎引导');
  assert.ok(fs.existsSync(path.join(__dirname, '../../media/outline-icon.svg')), '活动栏图标文件存在');
});

function makePanel(docText) {
  posted = []; listeners = [];
  const webview = {
    asWebviewUri: uri => ({ toString: () => 'webview://' + uri.path }),
    postMessage: m => { posted.push(m); return Promise.resolve(); },
    onDidReceiveMessage: l => { listeners.push(l); return { dispose() {} }; }
  };
  const panel = { webview: webview, onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: cb => { panel._dispose = cb; return { dispose() {} }; } };
  const doc = { uri: { toString: () => 'file:///a.md' }, getText: () => docText, lineCount: docText.split('\n').length, fileName: 'a.md' };
  return { panel: panel, doc: doc };
}

test('resolveCustomEditor：ready 消息回发 init（webview 收到后才会 sendOutline）', () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('# 标题\n\n正文');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  listeners[0]({ type: 'ready' });
  const init = posted.find(m => m.type === 'init');
  assert.ok(init, 'ready → init 回发');
  assert.strictEqual(init.text, '# 标题\n\n正文');
});

test('outline 消息 → OutlineProvider 建树（层级正确）', () => {
  const td = vscode._calls.treeViews[0].opt.treeDataProvider;
  listeners[0]({ type: 'outline', items: [
    { level: 1, text: '第一章' }, { level: 2, text: '1.1 节' }, { level: 2, text: '1.2 节' },
    { level: 1, text: '第二章' }, { level: 3, text: '深级' }
  ] });
  const roots = td.getChildren(null);
  assert.strictEqual(roots.length, 2, '两个 H1 根');
  assert.strictEqual(roots[0].text, '第一章');
  assert.strictEqual(roots[0].children.length, 2, '第一章下两个 H2');
  const deep = td.getChildren(roots[1]);
  assert.strictEqual(deep.length, 1);
  assert.strictEqual(deep[0].text, '深级', 'H3 挂到最近的祖先节点下');
});

test('树项：label/description/跳转命令参数', () => {
  const td = vscode._calls.treeViews[0].opt.treeDataProvider;
  const roots = td.getChildren(null);
  const item = td.getTreeItem(roots[0]);
  assert.strictEqual(item.label, '第一章');
  assert.strictEqual(item.description, 'H1');
  assert.strictEqual(item.command.command, 'wysiwygMarkdown.gotoHeading');
  assert.strictEqual(item.command.arguments[0], '第一章');
  assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded, '有子节点默认展开');
});

test('点击大纲 → gotoHeading 命令 → 转发到激活 webview', () => {
  const goto = vscode._calls.commands.find(c => c.id === 'wysiwygMarkdown.gotoHeading');
  assert.ok(goto, 'gotoHeading 命令已注册');
  posted.length = 0;
  goto.cb('第一章');
  const fwd = posted.find(m => m.type === 'gotoHeading');
  assert.ok(fwd, '转发到 webview');
  assert.strictEqual(fwd.text, '第一章');
});

test('面板销毁 → activeWebview 清空（无面板时命令给提示不静默）', () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  assert.strictEqual(typeof mk.panel._dispose, 'function', '注册了 onDidDispose');
  mk.panel._dispose();
  const goto = vscode._calls.commands.find(c => c.id === 'wysiwygMarkdown.gotoHeading');
  posted.length = 0;
  let warned = false;
  const origWarn = vscode.window.showWarningMessage;
  vscode.window.showWarningMessage = () => { warned = true; };
  goto.cb('某标题');
  vscode.window.showWarningMessage = origWarn;
  assert.ok(warned, '无激活面板时给出提示而非静默');
});

console.log('宿主大纲链路: ' + (process.exitCode ? '存在失败' : '全部通过'));
