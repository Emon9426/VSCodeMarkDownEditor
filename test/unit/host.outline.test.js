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
const fontListCode = fs.readFileSync(path.join(__dirname, '../../src/fontList.js'), 'utf8');

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
  const configListeners = [];
  const api = {
    _calls: calls,
    _configListeners: configListeners,
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
      onDidChangeConfiguration: l => { configListeners.push(l); return new Disposable(); },
      readdirSync: () => [], // F18：fontList 扫描走空目录（真实扫描在本机/真机验证）
      fs: {
        written: {},
        writeFile: async (uri, buf) => { api.workspace.fs.written[uri.path] = buf; },
        readFile: async () => Buffer.from(''),
        createDirectory: async () => undefined,
        stat: async uri => { if (api.workspace.fs.written[uri.path]) { return { type: 1 }; } throw new Error('FileNotFound'); }
      }
    },
    env: { openExternal: async () => undefined }
  };
  return api;
}

const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
  '<script>window.vscode = (' + stubVscodeFactory.toString() + ')();' +
  'window.__pathStub = null;' +
  // require stub 需先于 fontList 注入（其顶层 require fs/path/os）；'fs' 返回空目录形态（fontList 全程守卫）
  'window.require = function (n) { if (n === "vscode") { return window.vscode; } if (n === "path") { return window.__pathStub; } if (n === "os") { return { homedir: function () { return "/home/u"; } }; } if (n === "fs") { return { readdirSync: function () { return []; }, existsSync: function () { return false; } }; } if (n === "./fontList") { return window.__flMod.exports; } throw new Error("stub require: " + n); };</script>' +
  // F18：fontList.js 以 IIFE + 局部 module 求值（避免与 extension.js 的顶层 const 冲突），exports 存入 __flMod
  '<script>(function () { var module = { exports: {} };' + fontListCode.replace(/<\/script/g, '<\\/script') + ';window.__flMod = module; })();</scr' + 'ipt>' +
  '<script>window.module = { exports: {} };' +
  'window.exports = window.module.exports;</script>' +
  // extension.js 字符串字面量中的闭合标签需转义（JS 字符串内 "\/" 与 "/" 等价，不改变语义）
  '<script>' + extCode.replace(/<\/script/g, '<\\/script') + '</scr' + 'ipt>' +
  '</body></html>';
const dom = new JSDOM(html, { runScripts: 'dangerously' });
dom.window.__pathStub = path;
dom.window.Buffer = Buffer; // 扩展宿主是 Node 环境，jsdom window 缺 Buffer 全局（saveImage/drawio 模板用到）
const vscode = dom.window.vscode;
const ext = dom.window.module.exports;

const results = [];
const pending = [];
function record(name, e) {
  if (e) { results.push('✗ ' + name + ' — ' + e.message); console.log('✗ ' + name + ' — ' + e.message); process.exitCode = 1; }
  else { results.push('✓ ' + name); console.log('✓ ' + name); }
}
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { pending.push(r.then(() => record(name, null), e => record(name, e))); return; }
    record(name, null);
  } catch (e) { record(name, e); }
}

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
  const doc = { uri: { toString: () => 'file:///a.md', scheme: 'file', path: '/a.md' }, getText: () => docText, lineCount: docText.split('\n').length, fileName: 'a.md' };
  return { panel: panel, doc: doc };
}

test('webview 资源根包含文档目录（localResourceRoots——缺失会导致图片全部不显示）', () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('# 文档\n');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  const opts = mk.panel.webview.options;
  assert.ok(opts && opts.enableScripts, 'enableScripts');
  const paths = ((opts && opts.localResourceRoots) || []).map(r => String(r.path || ''));
  // 文档目录必须在白名单（stub Uri.joinPath 拼接为 /a.md/..，真实 VS Code 归一化为 /）
  assert.ok(paths.indexOf('/a.md/..') !== -1 || paths.some(p => p === '/' || p === ''),
    'localResourceRoots 含文档所在目录: ' + JSON.stringify(paths));
});

test('resolveImages：相对路径 → imageMap 回传（asWebviewUri）', async () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('# 文档\n');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  // async 测试共享外层 posted/listeners 会被后续测试的同步段重置——先捕获局部引用
  const p = posted, fire = listeners[0];
  fire({ type: 'resolveImages', paths: ['images/a.png', './images/b.JPG', 'https://x/c.png'] });
  await new Promise(r => setTimeout(r, 10));
  const msg = p.find(m => m.type === 'imageMap');
  assert.ok(msg, '回传 imageMap');
  const map = msg.map || {};
  assert.ok(map['images/a.png'] && /^webview:\/\//.test(map['images/a.png']), '相对路径映射为 webviewUri');
  assert.ok(map['./images/b.JPG'], './ 前缀路径命中（键保持原样）');
  assert.ok(!map['https://x/c.png'], '外链不进 map（webview 端直接 src）');
});

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

test('insertDrawio：创建 .drawio.svg 模板并回传引用（v1.7.1）', async () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('# 文档\n');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  listeners[0]({ type: 'insertDrawio' });
  await new Promise(r => setTimeout(r, 20)); // 异步完成
  const msg = posted.find(m => m.type === 'drawioInserted');
  assert.ok(msg && !msg.error, '回传 drawioInserted');
  assert.ok(/diagrams\/diagram-\d+\.drawio\.svg$/.test(msg.rel), '相对路径正确: ' + msg.rel);
  assert.ok(/^webview:\/\//.test(msg.src), 'webviewUri 回传');
  const written = Object.keys(vscode.workspace.fs.written).filter(p => p.indexOf('/diagrams/') !== -1);
  assert.strictEqual(written.length, 1, '写入一个文件');
  const content = String(vscode.workspace.fs.written[written[0]]);
  assert.ok(content.indexOf('<svg') === 0 && content.indexOf('mxGraphModel') !== -1, 'SVG 内嵌 mxGraphModel（vscode-drawio 可编辑）');
});

test('showOutline：转发执行 workbench.viewExtension.markdownWord 聚焦大纲侧栏', async () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('# 文档\n');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  const executed = [];
  const orig = vscode.commands.executeCommand;
  vscode.commands.executeCommand = async cmd => { executed.push(cmd); };
  listeners[0]({ type: 'showOutline' });
  await new Promise(r => setTimeout(r, 10));
  vscode.commands.executeCommand = orig;
  assert.ok(executed.indexOf('workbench.viewExtension.markdownWord') !== -1, '聚焦 Markdown Word 容器');
});

test('saveImage：粘贴图片 → 写盘 images/ + 回传 relPath/webSrc（F06 全链路）', async () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('# 文档\n');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  listeners[0]({ type: 'saveImage', id: 'img9', data: 'data:image/png;base64,aGVsbG8=', ext: 'png' });
  await new Promise(r => setTimeout(r, 30));
  const written = Object.keys(vscode.workspace.fs.written).filter(p => p.indexOf('/images/') !== -1);
  assert.strictEqual(written.length, 1, '写入一个图片文件');
  assert.ok(written[0].indexOf('/images/') !== -1 && /\.png$/.test(written[0]), '落在 images/ 且扩展名 png: ' + written[0]);
  const buf = vscode.workspace.fs.written[written[0]];
  assert.ok(Buffer.isBuffer(buf) && buf.toString() === 'hello', 'base64 正确解码写盘');
  const msg = posted.find(m => m.type === 'imageSaved' && m.id === 'img9');
  assert.ok(msg && !msg.error, '回传 imageSaved');
  assert.ok(/images\/[^/]+\.png$/.test(msg.relPath), 'relPath 相对路径: ' + msg.relPath);
  assert.ok(/^webview:\/\//.test(msg.webSrc), 'webviewUri 可显示');
});

test('F17 缩放全局联动：saveSetting(global) → 写用户级配置 → 广播 zoomChanged 到所有已打开 webview', async () => {
  const provider = vscode._calls.providers[0].provider;
  // 两个文档（各自独立 webview + 独立消息捕获），模拟已打开的 A/B 两份文档
  const mkPanel = () => {
    const box = { posted: [], listeners: [] };
    const webview = {
      asWebviewUri: uri => ({ toString: () => 'webview://' + uri.path }),
      postMessage: m => { box.posted.push(m); return Promise.resolve(); },
      onDidReceiveMessage: l => { box.listeners.push(l); return { dispose() {} }; }
    };
    const panel = { webview: webview, onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }) };
    const doc = { uri: { toString: () => 'file:///' + Math.random().toString(36).slice(2) + '.md', scheme: 'file', path: '/x.md' }, getText: () => 'x', lineCount: 1 };
    provider.resolveCustomTextEditor(doc, panel, {});
    return box;
  };
  const a = mkPanel(), b = mkPanel();
  // 文档 A 调整缩放 → saveSetting（global: true，issue #2 全局用户级）
  a.listeners[0]({ type: 'saveSetting', section: 'view', key: 'zoom', value: 150, global: true });
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(vscode.workspace.getConfiguration('markdownWord').get('view.zoom'), 150, '配置已写入');
  // 配置变更事件（saveSetting 写入或手改 settings.json 均触发）→ 广播两个 webview
  vscode._configListeners.forEach(l => l({ affectsConfiguration: key => key === 'markdownWord.view.zoom' }));
  [a, b].forEach((box, i) => {
    const zc = box.posted.filter(m => m.type === 'zoomChanged');
    assert.strictEqual(zc.length, 1, 'webview ' + i + ' 收到一次广播');
    assert.strictEqual(zc[0].zoom, 150, '广播值为 150');
  });
  // 无关配置变更不广播
  vscode._configListeners.forEach(l => l({ affectsConfiguration: key => key === 'markdownWord.page.size' }));
  assert.strictEqual(a.posted.filter(m => m.type === 'zoomChanged').length, 1, '无关变更不广播');
  // 面板销毁后不再接收（webview 集合移除）
});

test('F18 listFonts：webview 请求 → 宿主扫描（stub 空目录）→ fonts 数组回传，缓存复用', async () => {
  const provider = vscode._calls.providers[0].provider;
  const mk = makePanel('# 文档\n');
  provider.resolveCustomTextEditor(mk.doc, mk.panel, {});
  listeners[0]({ type: 'listFonts' });
  await new Promise(r => setTimeout(r, 60));
  const msgs = posted.filter(m => m.type === 'fonts');
  assert.ok(msgs.length === 1 && Array.isArray(msgs[0].fonts), '回传 fonts 数组（空目录兜底 []）');
  listeners[0]({ type: 'listFonts' });
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(posted.filter(m => m.type === 'fonts').length, 2, '第二次走缓存同样回复');
});

Promise.all(pending).then(() => {
  console.log('宿主链路: ' + (process.exitCode ? '存在失败' : '全部通过'));
});
