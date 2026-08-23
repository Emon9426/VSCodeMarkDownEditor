/**
 * Markdown Word — VS Code 扩展宿主
 * CustomTextEditorProvider：webview 双向同步、图片持久化落盘、命令、设置
 */
'use strict';
const vscode = require('vscode');
const path = require('path');

const VIEW_TYPE = 'wysiwygMarkdownEditor';

/** 大纲视图数据源：由激活面板的 webview 推送标题列表驱动（F14） */
class OutlineProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    this.roots = [];
  }
  update(items) {
    // 扁平标题列表 → 按层级建树
    const nodes = items.map(it => ({ level: it.level, text: it.text, children: [] }));
    const stack = [];
    const roots = [];
    nodes.forEach(n => {
      while (stack.length && stack[stack.length - 1].level >= n.level) { stack.pop(); }
      if (!stack.length) { roots.push(n); } else { stack[stack.length - 1].children.push(n); }
      stack.push(n);
    });
    this.roots = roots;
    this._onDidChange.fire();
  }
  getTreeItem(node) {
    const item = new vscode.TreeItem(node.text);
    item.collapsibleState = node.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    item.command = { command: 'wysiwygMarkdown.gotoHeading', title: '跳转', arguments: [node.text] };
    item.description = 'H' + node.level;
    return item;
  }
  getChildren(node) {
    return node ? node.children : this.roots;
  }
}

class MarkdownWordEditorProvider {
  constructor(context) {
    this.context = context;
    this.activeWebview = null; // 当前激活面板的 webview（供命令转发）
  }

  // ================= F15 AI 通道（GitHub Copilot · Language Model API） =================
  // 复用 VS Code 已登录的 Copilot（vscode.lm，1.95+）；未登录/禁用时优雅降级。
  async handleAi(webview, msg) {
    if (!this.readSettingsAiEnabled()) {
      webview.postMessage({ type: 'aiError', id: msg.id, error: 'disabled' });
      return;
    }
    const lm = vscode.lm;
    if (!lm || typeof lm.selectChatModels !== 'function') {
      webview.postMessage({ type: 'aiError', id: msg.id, error: 'no-lm' });
      return;
    }
    let models = [];
    try { models = await lm.selectChatModels({ vendor: 'copilot' }); } catch (_e) { models = []; }
    if (!models.length) {
      webview.postMessage({ type: 'aiError', id: msg.id, error: 'no-model' });
      return;
    }
    const want = (this.readSettingsAiModel() || '').toLowerCase();
    const model = (want && models.find(m => String(m.id).toLowerCase().indexOf(want) !== -1 || String(m.name).toLowerCase().indexOf(want) !== -1)) || models[0];
    const PROMPTS = {
      rewrite: '改写下述文本，保持原意，表达更清晰自然。仅输出改写结果，不要解释。',
      polish: '润色下述文本：更书面、更流畅、修正语病。仅输出润色结果。',
      expand: '扩写下述文本，补充细节与论证，篇幅约为原文 1.5–2 倍。仅输出扩写结果。',
      shorten: '压缩下述文本至一半左右篇幅，保留全部关键信息。仅输出结果。',
      translate_zh: '将下述文本翻译为简体中文。仅输出译文。',
      translate_en: '将下述文本翻译为英文。仅输出译文。',
      fix: '修正下述文本中的错别字与标点，不改变其他内容。仅输出修正结果。',
      outline: '为下述小节生成 Markdown 大纲：每行一个 "### 标题 · 要点提示" 格式的条目（3-6 条），仅输出大纲行，不要其他解释。',
      continue: '续写下述文本，衔接自然，续写 1-2 段。仅输出续写内容。',
      summarize: '用 3-5 句话总结下述内容。仅输出总结。'
    };
    const system = '你是嵌入在 Markdown 编辑器中的中文写作助手。输出必须是纯 Markdown 正文片段，不使用代码围栏包裹整体，不添加任何解释性前后缀。';
    const userText = PROMPTS[msg.cmd] ? (PROMPTS[msg.cmd] + '\n\n---\n' + (msg.text || '')) : (('指令：' + (msg.instruction || '') + '\n\n---\n') + (msg.text || ''));
    const messages = [
      { role: vscode.LanguageModelChatMessage.Role.System, content: system },
      { role: vscode.LanguageModelChatMessage.Role.User, content: userText }
    ];
    try {
      const resp = await model.sendRequest(messages, {});
      let any = false;
      for await (const chunk of resp.text) {
        any = true;
        webview.postMessage({ type: 'aiChunk', id: msg.id, delta: String(chunk) });
      }
      webview.postMessage({ type: 'aiDone', id: msg.id, empty: !any });
    } catch (err) {
      const m = String(err && err.message || err);
      webview.postMessage({ type: 'aiError', id: msg.id, error: m.indexOf('not signed') !== -1 || m.indexOf('login') !== -1 ? 'no-model' : m });
    }
  }
  readSettingsAiEnabled() {
    try { return vscode.workspace.getConfiguration('markdownWord').get('ai.enabled') !== false; } catch (_e) { return true; }
  }
  readSettingsAiModel() {
    try { return vscode.workspace.getConfiguration('markdownWord').get('ai.model') || ''; } catch (_e) { return ''; }
  }

  resolveCustomTextEditor(document, webviewPanel, _token) {
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    this.activeWebview = webview;
    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) { this.activeWebview = e.webviewPanel.webview; }
    });

    const uris = {
      core: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'markdown', 'core.js')),
      hljs: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'markdown', 'highlight.js')),
      math: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'markdown', 'math.js')),
      mmd: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'markdown', 'mermaid.js')),
      main: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'main.js')),
      style: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'style.css'))
    };

    webview.html = this.buildHtml(webview, uris);

    // ---- 自身写盘引起的变更标记（防回环） ----
    let changePaused = false;

    const updateText = text => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
      changePaused = true;
      return vscode.workspace.applyEdit(edit).then(() => {
        // 延迟复位：onDidChangeTextDocument 事件异步到达，避免自我写盘被误判为外部修改
        setTimeout(() => { changePaused = false; }, 150);
      });
    };

    // ---- 文档变更（外部修改 → 推给 webview） ----
    const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== document.uri.toString()) { return; }
      if (changePaused) { return; }
      webview.postMessage({ type: 'externalChange', text: document.getText() });
    });

    // ---- webview 消息 ----
    webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case 'ready':
          webview.postMessage({
            type: 'init',
            text: document.getText(),
            settings: this.readSettings(document)
          });
          break;
        case 'update':
          updateText(msg.text).then(() => {
            webview.postMessage({ type: 'saved' });
          });
          break;
        case 'saveImage': {
          this.saveImage(document, webview, msg).catch(err => {
            webview.postMessage({ type: 'imageSaved', id: msg.id, error: String(err && err.message || err) });
          });
          break;
        }
        case 'resolveImages': {
          const map = {};
          (msg.paths || []).forEach(rel => {
            try {
              const fileUri = this.resolveRelative(document.uri, rel);
              if (fileUri) { map[rel] = webview.asWebviewUri(fileUri).toString(); }
            } catch (_e) { /* 忽略非法路径 */ }
          });
          webview.postMessage({ type: 'imageMap', map: map });
          break;
        }
        case 'saveSetting': {
          // 视图设置持久化（F16 页面设置等）：优先工作区级，失败回退全局
          const fullKey = (msg.section ? msg.section + '.' : '') + msg.key;
          const target = vscode.workspace.workspaceFolders
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
          vscode.workspace.getConfiguration('markdownWord').update(fullKey, msg.value, target)
            .then(() => { webview.postMessage({ type: 'settingSaved', key: fullKey, value: msg.value }); },
              err => { webview.postMessage({ type: 'info', text: '设置保存失败：' + String(err && err.message || err) }); });
          break;
        }
        case 'saveFile': {
          // 导出等场景：把 webview 组装好的内容写入文档同级目录
          const dir = vscode.Uri.joinPath(document.uri, '..');
          const fileUri = vscode.Uri.joinPath(dir, msg.name);
          vscode.workspace.fs.writeFile(fileUri, Buffer.from(String(msg.content || ''), 'utf8')).then(() => {
            webview.postMessage({ type: 'info', text: '已导出：' + msg.name });
            vscode.window.showInformationMessage('Markdown Word: 已导出 ' + msg.name, '打开所在文件夹').then(choice => {
              if (choice === '打开所在文件夹') { vscode.commands.executeCommand('revealFileInOS', dir); }
            });
          }, err => {
            vscode.window.showWarningMessage('导出失败：' + String(err && err.message || err));
          });
          break;
        }
        case 'ai': {
          this.handleAi(webview, msg).catch(err => {
            webview.postMessage({ type: 'aiError', id: msg.id, error: String(err && err.message || err) });
          });
          break;
        }
        case 'openDrawio': {
          // Draw.io 集成层：以 .drawio.svg/.drawio.png 引用的图，交给 vscode-drawio（或默认编辑器）打开
          const fileUri = this.resolveRelative(document.uri, msg.rel);
          if (fileUri) {
            vscode.commands.executeCommand('vscode.open', fileUri, { viewColumn: vscode.ViewColumn.Beside })
              .then(undefined, () => {
                vscode.window.showInformationMessage(
                  'Markdown Word: 该流程图文件已尝试用默认编辑器打开。建议安装开源扩展 vscode-drawio（hediet.vscode-drawio）以获得完整 Draw.io 编辑体验。');
              });
          }
          break;
        }
        case 'openExternal': {
          try {
            vscode.env.openExternal(vscode.Uri.joinPath(vscode.Uri.joinPath(document.uri, '..'), msg.name));
          } catch (_e) { /* ignore */ }
          break;
        }
        case 'outline': {
          if (this.outlineProvider) { this.outlineProvider.update(msg.items || []); }
          break;
        }
        case 'openNative': {
          // 在 VS Code 原生编辑器中并排打开（语法高亮 / 行号 / 多光标），保留本编辑器便于切回
          vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false })
            .then(undefined, err => {
              vscode.window.showWarningMessage('Markdown Word: 打开原生编辑器失败：' + String(err && err.message || err));
            });
          break;
        }
        case 'info':
          vscode.window.showInformationMessage('Markdown Word: ' + msg.text);
          break;
        default:
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      if (this.activeWebview === webview) { this.activeWebview = null; }
    });
  }

  readSettings(document) {
    const cfg = vscode.workspace.getConfiguration('markdownWord');
    let docName = 'document';
    try { docName = path.basename(document.uri.fsPath).replace(/\.[^.]+$/, ''); } catch (_e) { /* ignore */ }
    return {
      defaultMode: cfg.get('defaultMode') || 'wysiwyg',
      imageFolder: cfg.get('image.saveFolder') || './images',
      fileNamePattern: cfg.get('image.fileNamePattern') || '${docName}-${timestamp}',
      slashMenuEnabled: cfg.get('slashMenu.enabled') !== false,
      tableDefaultHeader: cfg.get('table.defaultHeader') !== false,
      docName: docName,
      page: {
        size: cfg.get('page.size') || 'fit',
        customWidth: cfg.get('page.customWidth') || 794,
        background: cfg.get('page.background') || 'auto',
        pattern: cfg.get('page.pattern') || 'none'
      },
      editor: {
        fontFamilyLatin: cfg.get('editor.fontFamilyLatin') || '',
        fontFamilyCJK: cfg.get('editor.fontFamilyCJK') || ''
      },
      ai: {
        enabled: cfg.get('ai.enabled') !== false,
        model: cfg.get('ai.model') || ''
      },
      ui: {
        language: cfg.get('ui.language') || 'auto'
      }
    };
  }

  resolveRelative(docUri, rel) {
    if (!rel || /^[a-z]+:\/\//i.test(rel)) { return null; } // 外链
    const dir = vscode.Uri.joinPath(docUri, '..');
    const clean = rel.replace(/^\.\//, '');
    return clean.split('/').reduce((u, seg) => {
      let s = seg;
      try { s = decodeURIComponent(seg); } catch (_e) { /* 含 % 的原始文件名保持原样 */ }
      return vscode.Uri.joinPath(u, s);
    }, dir);
  }

  async saveImage(document, webview, msg) {
    const settings = this.readSettings(document);
    const ext = (msg.ext || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const name = settings.fileNamePattern
      .replace(/\$\{docName\}/g, settings.docName)
      .replace(/\$\{timestamp\}/g, String(Date.now())) + '.' + ext;
    const folderRel = settings.imageFolder.replace(/^\.\//, '').replace(/\/$/, '');
    const dirUri = folderRel
      ? folderRel.split('/').reduce((u, seg) => vscode.Uri.joinPath(u, seg), vscode.Uri.joinPath(document.uri, '..'))
      : vscode.Uri.joinPath(document.uri, '..');
    await vscode.workspace.fs.createDirectory(dirUri);
    const fileUri = vscode.Uri.joinPath(dirUri, name);
    const buf = Buffer.from(String(msg.data).split(',').pop() || '', 'base64');
    await vscode.workspace.fs.writeFile(fileUri, buf);
    const relPath = (folderRel ? folderRel + '/' : '') + name;
    webview.postMessage({
      type: 'imageSaved',
      id: msg.id,
      relPath: relPath,
      webSrc: webview.asWebviewUri(fileUri).toString()
    });
  }

  buildHtml(webview, uris) {
    const csp = [
      "default-src 'none'",
      "img-src " + webview.cspSource + " https: data:",
      "style-src " + webview.cspSource + " 'unsafe-inline'",
      "script-src " + webview.cspSource,
      "font-src " + webview.cspSource
    ].join('; ');
    return [
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
      '<link rel="stylesheet" href="' + uris.style + '">',
      '</head><body>',
      '<div id="app"></div>',
      '<script src="' + uris.hljs + '"></script>',
      '<script src="' + uris.math + '"></script>',
      '<script src="' + uris.mmd + '"></script>',
      '<script src="' + uris.core + '"></script>',
      '<script src="' + uris.main + '"></script>',
      '</body></html>'
    ].join('');
  }
}

function activate(context) {
  const provider = new MarkdownWordEditorProvider(context);
  const outlineProvider = new OutlineProvider();
  provider.outlineProvider = outlineProvider;
  const registration = vscode.window.registerCustomEditorProvider(
    VIEW_TYPE,
    provider,
    { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
  );
  const outlineView = vscode.window.createTreeView('markdownWordOutline', { treeDataProvider: outlineProvider });

  const sendToActive = payload => {
    if (provider.activeWebview) { provider.activeWebview.postMessage(payload); }
    else { vscode.window.showWarningMessage('Markdown Word: 请先打开一个 Markdown 文档'); }
  };

  const cmds = [
    vscode.commands.registerCommand('wysiwygMarkdown.toggleMode', () => sendToActive({ type: 'command', cmd: 'toggleMode' })),
    vscode.commands.registerCommand('wysiwygMarkdown.insertTable', () => sendToActive({ type: 'command', cmd: 'insertTable' })),
    vscode.commands.registerCommand('wysiwygMarkdown.insertImage', () => sendToActive({ type: 'command', cmd: 'insertImage' })),
    vscode.commands.registerCommand('wysiwygMarkdown.insertTOC', () => sendToActive({ type: 'command', cmd: 'insertTOC' })),
    vscode.commands.registerCommand('wysiwygMarkdown.pageSetup', () => sendToActive({ type: 'command', cmd: 'pageSetup' })),
    vscode.commands.registerCommand('wysiwygMarkdown.exportHtml', () => sendToActive({ type: 'command', cmd: 'exportHtml' })),
    vscode.commands.registerCommand('wysiwygMarkdown.exportPdf', () => sendToActive({ type: 'command', cmd: 'exportPdf' })),
    vscode.commands.registerCommand('wysiwygMarkdown.gotoHeading', text => sendToActive({ type: 'gotoHeading', text: text }))
  ];

  context.subscriptions.push(registration, outlineView, ...cmds);
}

function deactivate() { /* nothing */ }

module.exports = { activate, deactivate };
