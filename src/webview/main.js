/**
 * Markdown Word — Webview 编辑器主逻辑
 * 覆盖 P0：两行图标化 Ribbon、三模式、行内/块级格式、可视化表格、图片落盘、
 *          Confluence 式斜杠菜单（含 Emoji 直插 + MRU）、代码块（30+ 语言含 PL/SQL）、状态栏
 */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const MD = window.MdCore;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));

  // ================= 状态 =================
  let settings = { defaultMode: 'wysiwyg', imageFolder: './images', slashMenuEnabled: true, tableDefaultHeader: true, docName: 'document', page: { size: 'fit', customWidth: 794, background: 'auto', pattern: 'none' } };
  let mode = 'wysiwyg';
  let saveTimer = null, previewTimer = null;
  let lastLocalEdit = 0;
  let saveState = 'saved';
  let fileSeq = 0; const pendingImages = {};
  let externalStale = false; // 忽略窗口内收到外部修改：下次保存完成后警告（防静默覆盖）

  let editor, editorWrap, srcTextarea, preview, toastEl;
  let slashEl, slashList, tablePicker, emojiPanel, ttBar, dlgMask, pagePanel;
  let zoomSizeDdl = null; // 开始页签「字号」下拉（F17：显示有效字号，点击弹出缩放档位）

  const MODE_NAMES = { wysiwyg: '所见即所得', source: '源码', split: '分屏' };

  // ================= 语言列表（F09：30+ 语言，含 PL/SQL） =================
  const LANGUAGES = [
    ['plaintext', '纯文本'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'],
    ['python', 'Python'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
    ['go', 'Go'], ['rust', 'Rust'], ['php', 'PHP'], ['ruby', 'Ruby'], ['swift', 'Swift'],
    ['kotlin', 'Kotlin'], ['scala', 'Scala'], ['html', 'HTML'], ['css', 'CSS'], ['json', 'JSON'],
    ['yaml', 'YAML'], ['xml', 'XML'], ['markdown', 'Markdown'], ['shell', 'Shell'], ['bat', 'Batch'],
    ['powershell', 'PowerShell'], ['dockerfile', 'Dockerfile'], ['toml', 'TOML'], ['ini', 'INI'],
    ['sql', 'SQL'], ['plsql', 'PL/SQL (Oracle)'], ['tsql', 'T-SQL'], ['diff', 'Diff'], ['graphql', 'GraphQL'],
    ['latex', 'LaTeX'], ['makefile', 'Makefile']
  ];

  // ================= Emoji 集（斜杠直插 + 面板共用，MRU 置顶） =================
  const EMOJIS = [
    ['✅', 'check 完成 对勾 done ok'], ['❌', 'cross 错误 no'], ['🎉', 'party 庆祝 celebrate'],
    ['🚀', 'rocket 火箭 fast ship'], ['📌', 'pin 标记 pin'], ['⚠️', 'warning 警告 warn'],
    ['❤️', 'heart 心 love'], ['🔥', 'fire 火 hot'], ['📅', 'date 日期 calendar'], ['🕐', 'time 时间 clock'],
    ['😀', 'smile 笑脸 happy'], ['😄', 'laugh 大笑 happy'], ['😭', 'cry 哭 sad'], ['👍', 'thumbsup 赞 good'],
    ['👎', 'thumbsdown 踩'], ['🙏', 'thanks 感谢 pray'], ['💡', 'idea 提示 bulb'], ['ℹ️', 'info 信息'],
    ['⭐', 'star 星 star'], ['✨', 'sparkles 闪亮 magic'], ['🔗', 'link 链接'], ['📈', 'chart 涨 up 增'],
    ['📉', 'chart 跌 down'], ['🔧', 'tool 工具 wrench'], ['📝', 'note 笔记 memo'], ['🏁', 'finish 结束 flag'],
    ['🐛', 'bug 虫子'], ['🎯', 'target 目标'], ['🆗', 'ok 好的'], ['🤔', 'think 思考'],
    ['😱', 'scream 惊讶'], ['😴', 'sleep 睡'], ['💪', 'strong 力量'], ['🤝', 'handshake 合作'],
    ['📦', 'package 包 box'], ['🔍', 'search 搜索 find'], ['⚙️', 'gear 设置 settings'],
    ['🧪', 'test 测试 flask'], ['🏷', 'tag 标签 label'], ['🛠', 'build 构建 tools']
  ];

  // ================= F16 页面设置与外观（Word 式 Page Setup） =================
  // 原则：纯视图层（纸张宽度/背景/条纹），按工作区持久化，绝不写入 Markdown。
  const PAGE_SIZE_PX = { a3: 1123, a4: 794, a5: 559, b5: 667, letter: 816, legal: 816 };
  const PAGE_SIZE_LABEL = { fit: '适应屏幕', a3: 'A3', a4: 'A4', a5: 'A5', b5: 'B5', letter: 'Letter', legal: 'Legal', custom: '自定义' };
  const PAGE_BG_PRESETS = {
    white: { light: '#ffffff', dark: '#1e1e1e' },
    green: { light: '#C7EDCC', dark: '#2D423A' },
    parchment: { light: '#F5EFDC', dark: '#3A3226' },
    iceblue: { light: '#E8F4F8', dark: '#22303A' }
  };
  function pageCfg() {
    const p = settings.page || {};
    return {
      size: p.size || 'fit',
      customWidth: Math.min(1600, Math.max(400, +p.customWidth || 794)),
      background: p.background || 'auto',
      pattern: p.pattern || 'none'
    };
  }
  function isDarkTheme() { return document.body && document.body.classList.contains('vscode-dark'); }
  function luma(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) { return 128; }
    const n = parseInt(m[1], 16);
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  }
  function applyPageSettings() {
    const c = pageCfg();
    // 纸张宽度：--page-width 变量设在 #main，所见即所得纸张与源码模式纸张共用，保证两模式尺寸一致
    const host = $('#main') || editor.parentElement;
    if (c.size === 'fit') { host.style.setProperty('--page-width', 'min(100%, 1200px)'); }
    else if (c.size === 'custom') { host.style.setProperty('--page-width', c.customWidth + 'px'); }
    else { host.style.setProperty('--page-width', (PAGE_SIZE_PX[c.size] || 794) + 'px'); }
    // 背景色（含暗色变体）与配套前景色 / 条纹对比色
    let bg = null;
    if (c.background === 'auto') { /* 跟随主题，清内联 */ }
    else if (PAGE_BG_PRESETS[c.background]) {
      bg = isDarkTheme() ? PAGE_BG_PRESETS[c.background].dark : PAGE_BG_PRESETS[c.background].light;
    } else if (/^#?[0-9a-fA-F]{6}$/.test(String(c.background).trim())) {
      bg = String(c.background).trim();
      if (bg.charAt(0) !== '#') { bg = '#' + bg; }
    }
    if (bg) {
      const dark = luma(bg) <= 150;
      editor.style.backgroundColor = bg;
      editor.style.color = dark ? '#e5e7eb' : '#1e293b';
      editor.style.setProperty('--pat-color', dark ? 'rgba(203,213,225,.26)' : 'rgba(71,85,105,.30)');
    } else {
      editor.style.removeProperty('background-color');
      editor.style.removeProperty('color');
      editor.style.removeProperty('--pat-color');
    }
    // 条纹（周期用 em：对齐行高并跟随字号缩放）
    ['pat-lines', 'pat-grid', 'pat-dots'].forEach(cl => editor.classList.remove(cl));
    if (['lines', 'grid', 'dots'].indexOf(c.pattern) !== -1) { editor.classList.add('pat-' + c.pattern); }
    // 状态栏纸张指示
    const sb = $('#sbPage');
    if (sb) {
      sb.textContent = '📄 ' + (PAGE_SIZE_LABEL[c.size] || c.size) +
        (c.size === 'custom' ? ' · ' + c.customWidth + 'px' : '');
    }
  }
  function setPage(key, value) {
    settings.page = settings.page || {};
    settings.page[key] = value;
    applyPageSettings();
    vscode.postMessage({ type: 'saveSetting', section: 'page', key: key, value: value });
    buildPagePanel(); // 刷新面板高亮
  }
  function buildPagePanel() {
    if (!pagePanel) { return; }
    const c = pageCfg();
    pagePanel.innerHTML = '';
    const mkTitle = t => { const d = document.createElement('div'); d.className = 'ptitle'; d.textContent = t; return d; };
    pagePanel.appendChild(mkTitle('纸张尺寸（内容自动重排）'));
    const chips = document.createElement('div'); chips.className = 'pchips';
    [['fit', '适应屏幕'], ['a3', 'A3'], ['a4', 'A4'], ['a5', 'A5'], ['b5', 'B5'], ['letter', 'Letter'], ['legal', 'Legal'], ['custom', '自定义…']].forEach(function (kv) {
      const sp = document.createElement('span');
      sp.textContent = kv[1] + (kv[0] === c.size ? ' ✓' : '');
      if (kv[0] === c.size) { sp.className = 'on'; }
      sp.onclick = () => {
        if (kv[0] === 'custom') {
          hidePagePanel();
          dialog('自定义纸张宽度', '<div class="frow"><label>宽度 (px)</label><input data-field="w" type="number" min="400" max="1600" value="' + c.customWidth + '"></div>', [
            { text: '取消', closeOnly: true },
            { text: '应用', primary: true, validate: v => +v.w >= 400 && +v.w <= 1600 }
          ]).then(v => {
            if (v) { setPage('customWidth', Math.round(+v.w)); setPage('size', 'custom'); }
          });
          return;
        }
        setPage('size', kv[0]);
      };
      chips.appendChild(sp);
    });
    pagePanel.appendChild(chips);
    const cur = document.createElement('div'); cur.className = 'pcurrent';
    cur.textContent = '当前：' + (PAGE_SIZE_LABEL[c.size] || c.size) +
      (c.size === 'custom' ? ' · ' + c.customWidth + 'px' : (c.size !== 'fit' && PAGE_SIZE_PX[c.size] ? ' · ' + PAGE_SIZE_PX[c.size] + 'px @96dpi' : ''));
    pagePanel.appendChild(cur);

    pagePanel.appendChild(mkTitle('页面背景色'));
    const sw = document.createElement('div'); sw.className = 'pswatches';
    [['auto', null, '跟随主题'], ['white', '#ffffff', '纯白'], ['green', '#C7EDCC', '护眼绿'], ['parchment', '#F5EFDC', '羊皮纸'], ['iceblue', '#E8F4F8', '冰蓝']].forEach(function (kv) {
      const sp = document.createElement('span'); sp.title = kv[2];
      if (kv[0] === 'auto') {
        sp.style.background = isDarkTheme()
          ? 'linear-gradient(135deg,#1e293b 50%,#e5e7eb 50%)'
          : 'linear-gradient(135deg,#ffffff 50%,#334155 50%)';
      } else { sp.style.background = kv[1]; }
      if (kv[0] === c.background) { sp.className = 'on'; }
      sp.onclick = () => setPage('background', kv[0]);
      sw.appendChild(sp);
    });
    if (/^#[0-9a-fA-F]{6}$/.test(c.background)) {
      const sp = document.createElement('span');
      sp.style.background = c.background; sp.className = 'on'; sp.title = c.background;
      sp.onclick = () => setPage('background', c.background);
      sw.appendChild(sp);
    }
    const add = document.createElement('span'); add.className = 'custom-add'; add.textContent = '＋'; add.title = '自定义颜色（#RRGGBB）';
    add.onclick = () => {
      hidePagePanel();
      dialog('自定义背景色', '<div class="frow"><label>颜色</label><input data-field="hex" placeholder="#C7EDCC" value="' + (/^#[0-9a-fA-F]{6}$/.test(c.background) ? c.background : '#C7EDCC') + '"></div>', [
        { text: '取消', closeOnly: true },
        { text: '应用', primary: true, validate: v => /^#[0-9a-fA-F]{6}$/.test(String(v.hex).trim()) }
      ]).then(v => { if (v) { setPage('background', String(v.hex).trim()); } });
    };
    sw.appendChild(add);
    pagePanel.appendChild(sw);

    pagePanel.appendChild(mkTitle('条纹'));
    const pats = document.createElement('div'); pats.className = 'ppatterns';
    [['none', '无', 'var(--vscode-editor-background,#fff)'],
     ['lines', '横线（信纸）', 'repeating-linear-gradient(#fff 0 7px,rgba(100,116,139,.35) 7px 8px)'],
     ['grid', '方格', 'repeating-linear-gradient(#fff 0 15px,rgba(100,116,139,.3) 15px 16px),repeating-linear-gradient(90deg,#fff 0 15px,rgba(100,116,139,.3) 15px 16px)'],
     ['dots', '点阵', 'radial-gradient(rgba(100,116,139,.5) 1px,#fff 1px) 0 0/10px 10px']].forEach(function (kv) {
      const sp = document.createElement('span'); sp.title = kv[1]; sp.style.background = kv[2];
      if (kv[0] === c.pattern) { sp.className = 'on'; }
      sp.onclick = () => setPage('pattern', kv[0]);
      pats.appendChild(sp);
    });
    pagePanel.appendChild(pats);

    const note = document.createElement('div'); note.className = 'pnote';
    note.textContent = '仅影响显示 · 不写入 Markdown 源码 · 设置按工作区持久化';
    pagePanel.appendChild(note);
  }
  function showPagePanel(anchor) {
    buildPagePanel();
    pagePanel.style.display = 'block';
    const r = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : { left: window.innerWidth - 320, bottom: 60 };
    pagePanel.style.left = Math.max(8, Math.min(r.left, (window.innerWidth || 1200) - 312)) + 'px';
    pagePanel.style.top = Math.max(8, (r.bottom || 8) + 6) + 'px';
  }
  function hidePagePanel() { if (pagePanel) { pagePanel.style.display = 'none'; } }

  // ================= 构建 UI =================
  function iconBtn(icon, title, cmd, cls) {
    const b = document.createElement('button');
    b.className = 'rbtn' + (cls ? ' ' + cls : '');
    b.innerHTML = icon; b.title = title; b.dataset.cmd = cmd;
    return b;
  }
  function group(label, buttons) {
    const g = document.createElement('div'); g.className = 'rgroup';
    const row = document.createElement('div'); row.className = 'rrow';
    buttons.forEach(b => row.appendChild(b));
    const lab = document.createElement('div'); lab.className = 'rlabel'; lab.textContent = label;
    g.appendChild(row); g.appendChild(lab);
    return g;
  }
  function sep() { const s = document.createElement('span'); s.className = 'rsep'; return s; }
  function fddl(text, title) { const s = document.createElement('span'); s.className = 'fddl'; s.textContent = text; s.title = title || ''; return s; }

  function buildRibbon() {
    const ribbon = document.createElement('div'); ribbon.id = 'ribbon';
    const tabs = document.createElement('div'); tabs.id = 'rtabs';
    [['开始', 'home'], ['插入', 'ins'], ['表格', 'tbl'], ['视图', 'view']].forEach(([name, key], i) => {
      const t = document.createElement('div');
      t.className = 'rtab' + (i === 0 ? ' active' : ''); t.textContent = name; t.dataset.panel = 'rp-' + key;
      t.onclick = () => {
        $$('.rtab').forEach(x => x.classList.remove('active'));
        $$('.rpanel').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        $('#rp-' + key).classList.add('active');
      };
      tabs.appendChild(t);
    });
    ribbon.appendChild(tabs);

    // ---- 开始 ----
    const home = document.createElement('div'); home.className = 'rpanel active'; home.id = 'rp-home';
    home.appendChild(group('剪贴板', [
      iconBtn('📋<small>▾</small>', '粘贴（▾ 内含剪切 / 复制）· Ctrl+V', 'paste')
    ]));
    const sizeDdl = fddl('15 ▾', '字号（随缩放变化）· 点击选择缩放档位（全局记忆，跨文档生效）');
    zoomSizeDdl = sizeDdl;
    const fontRow = [
      fddl('Aa 西文 ▾', '西文字体（拉丁字符与数字）· 默认 Segoe UI，随 VS Code 编辑器字体'),
      fddl('汉 中 ▾', '中文字体（CJK 字符）· 默认微软雅黑'),
      sizeDdl
    ];
    home.appendChild(group('字体（中英分设）', fontRow.concat([
      sep(),
      iconBtn('<b>B</b>', '加粗 · Ctrl+B', 'bold'),
      iconBtn('<i>I</i>', '斜体 · Ctrl+I', 'italic'),
      iconBtn('<span style="text-decoration:underline">U</span>', '下划线（Markdown 无对应语法，保存后不保留）', 'underline'),
      iconBtn('<span style="text-decoration:line-through">S</span>', '删除线 · Ctrl+Shift+S', 'strike'),
      iconBtn('<mark style="padding:0 2px">A</mark>', '高亮 ==文本==', 'highlight'),
      iconBtn('<code>&lt;/&gt;</code>', '行内代码 · Ctrl+`（恒为等宽字体）', 'incode')
    ])));
    home.appendChild(group('段落', [
      iconBtn('•≡', '无序列表 · Ctrl+Shift+8', 'ul'),
      iconBtn('1.≡', '有序列表 · Ctrl+Shift+7', 'ol'),
      iconBtn('☑', '任务列表 · Ctrl+Shift+9', 'task'),
      iconBtn('⇤', '减少缩进 · Shift+Tab', 'outdent'),
      iconBtn('⇥', '增加缩进 · Tab', 'indent'),
      iconBtn('❝', '引用块 · Ctrl+Shift+Q', 'quote')
    ]));
    home.appendChild(group('快速样式', ['H1', 'H2', 'H3', 'H▾'].map((t, i) =>
      iconBtn('<b style="font-size:' + (15 - i * 1.2).toFixed(1) + 'px">' + t + '</b>',
        (i < 3 ? '标题 ' + (i + 1) + ' · Ctrl+' + (i + 1) : '标题 4–6 · Ctrl+4…6'), i < 3 ? 'h' + (i + 1) : 'hmore')
    )));
    home.appendChild(group('编辑', [
      iconBtn('🔍', '查找 · Ctrl+F', 'find'),
      iconBtn('⇄', '替换 · Ctrl+H', 'replace')
    ]));
    ribbon.appendChild(home);

    // ---- 插入 ----
    const ins = document.createElement('div'); ins.className = 'rpanel'; ins.id = 'rp-ins';
    ins.appendChild(group('常用插入', [
      iconBtn('▦<small>▾</small>', '插入表格（网格选择器）· Ctrl+Alt+T', 'table'),
      iconBtn('🖼<small>▾</small>', '插入图片（本地 / 剪贴板 / URL）', 'image'),
      iconBtn('🔗', '插入链接 · Ctrl+K', 'link')
    ]));
    ins.appendChild(group('图表与代码', [
      iconBtn('<code>{ }</code>', '代码块（30+ 语言含 PL/SQL，语法高亮）· Ctrl+Shift+K', 'codeblock'),
      iconBtn('∑', '数学公式（LaTeX：块级 $$ 与行内 $，双击可编辑）', 'math'),
      iconBtn('◈', 'Mermaid 流程图（graph TD/LR，双击可编辑）', 'mermaid'),
      iconBtn('⬡', 'Draw.io 流程图（新建 .drawio.svg 文件并插入引用，右键可用 Draw.io 编辑）', 'drawio')
    ]));
    ins.appendChild(group('其他', [
      iconBtn('――', '分割线', 'hr'),
      iconBtn('⊕', '脚注（上标引用 + 定义追加文末）', 'footnote'),
      iconBtn('☰', '目录 TOC（按当前标题生成）', 'toc'),
      iconBtn('ℹ', '信息面板（提示框）', 'panelInfo'),
      iconBtn('🙂', 'Emoji（最近使用置顶）', 'emoji'),
      iconBtn('📅', '插入当前日期时间', 'datetime')
    ]));
    ribbon.appendChild(ins);

    // ---- 表格（上下文页签） ----
    const tbl = document.createElement('div'); tbl.className = 'rpanel'; tbl.id = 'rp-tbl';
    tbl.appendChild(group('行列增删', [
      iconBtn('↥', '上方插入行', 'rowAbove'), iconBtn('↧', '下方插入行', 'rowBelow'),
      iconBtn('✕≡', '删除行', 'delRow', 'danger'), sep(),
      iconBtn('↤', '左侧插入列', 'colLeft'), iconBtn('↦', '右侧插入列', 'colRight'),
      iconBtn('✕▥', '删除列', 'delCol', 'danger')
    ]));
    tbl.appendChild(group('对齐（按列）', [
      iconBtn('≡', '整列左对齐', 'alLeft'), iconBtn('≣', '整列居中', 'alCenter'), iconBtn('≣', '整列右对齐', 'alRight')
    ]));
    tbl.appendChild(group('结构', [
      iconBtn('☑', '切换表头行', 'toggleHead'),
      iconBtn('⇅', '上移行', 'rowUp'), iconBtn('⇆', '下移行', 'rowDown'),
      iconBtn('⇤', '左移列', 'colMoveL'), iconBtn('⇥', '右移列', 'colMoveR')
    ]));
    tbl.appendChild(group('表格', [iconBtn('🗑', '删除表格', 'delTable', 'danger')]));
    ribbon.appendChild(tbl);

    // ---- 视图 ----
    const view = document.createElement('div'); view.className = 'rpanel'; view.id = 'rp-view';
    view.appendChild(group('编辑模式', [
      iconBtn('🖋', '所见即所得 · Ctrl+Alt+V 循环切换', 'mWysiwyg', 'on'),
      iconBtn('<code>&lt;/&gt;</code>', '源码模式', 'mSource'),
      iconBtn('▤', '分屏模式（左源码右渲染）', 'mSplit')
    ]));
    view.appendChild(group('显示', [
      iconBtn('🗂', '大纲视图：打开侧栏标题树（点击标题跳转正文）', 'outline')
    ]));
    view.appendChild(group('缩放（全局记忆）', (function () {
      const pct = fddl('100%', '缩放比例（全局记忆：跨文档、重启保持）· 点击选择档位');
      pct.style.cursor = 'pointer'; pct.onclick = e => showZoomPanel(e.target);
      return [iconBtn('A⁻', '缩小字号（全局记忆）', 'zoomOut'), pct,
        iconBtn('A⁺', '放大字号（全局记忆）', 'zoomIn')];
    })()));
    view.appendChild(group('页面（F16）', [
      iconBtn('📄<small>▾</small>', '页面设置：纸张尺寸（适应屏幕 / A4 / A3 / A5 / B5 / Letter / Legal / 自定义），切换后内容流式重排', 'pageSetup'),
      iconBtn('🎨', '页面外观：背景色（护眼绿 / 羊皮纸 / 冰蓝 / 自定义）与条纹（横线 / 方格 / 点阵）', 'pageSetup')
    ]));
    view.appendChild(group('语言', [
      iconBtn('🌐', '界面语言：中文 / English（点击切换）', 'cycleLang')
    ]));
    view.appendChild(group('导出', [
      iconBtn('🌐', '导出 HTML（自包含单文件，代码已高亮）', 'exportHtml'),
      iconBtn('📄', T('exportPdfOpen') + '：生成打印页并在浏览器打开', 'exportPdf')
    ]));
    ribbon.appendChild(view);
    return ribbon;
  }

  function buildApp() {
    const app = $('#app');
    app.appendChild(buildRibbon());

    const main = document.createElement('div'); main.id = 'main';
    editorWrap = document.createElement('div'); editorWrap.id = 'editorWrap';
    editor = document.createElement('div'); editor.id = 'editor'; editor.contentEditable = 'true'; editor.spellcheck = false;
    editorWrap.appendChild(editor);
    main.appendChild(editorWrap);

    const sa = document.createElement('div'); sa.id = 'sourceArea';
    const srcCol = document.createElement('div'); srcCol.id = 'srcCol';
    const srcHint = document.createElement('div'); srcHint.id = 'sourceHint';
    srcHint.innerHTML = '<span>📄 源码模式 · 修改实时同步</span><span style="flex:1"></span><a id="openNativeBtn" title="在 VS Code 原生编辑器中打开（语法高亮 / 行号 / 多光标）">在 VS Code 原生编辑器中打开 ↗</a>';
    srcCol.appendChild(srcHint);
    srcTextarea = document.createElement('textarea'); srcTextarea.id = 'srcTextarea'; srcTextarea.spellcheck = false;
    srcCol.appendChild(srcTextarea);
    preview = document.createElement('div'); preview.id = 'preview';
    const pv = document.createElement('div'); pv.className = 'pv-inner'; preview.appendChild(pv);
    sa.appendChild(srcCol); sa.appendChild(preview);
    main.appendChild(sa);
    app.appendChild(main);

    // 状态栏
    const sb = document.createElement('div'); sb.id = 'statusBar';
    sb.innerHTML = [
      '<span class="seg" id="sbSave">已保存</span>',
      '<span class="seg" id="sbPos">行 1，列 1</span>',
      '<span class="seg grow"></span>',
      '<span class="seg clickable" id="sbWords">0 字</span>',
      '<span class="seg clickable" id="sbFont" title="正文字体（中英分设）">🅰 跟随 / 跟随</span>',
      '<span class="seg clickable" id="sbLang" title="界面语言 / UI language">🌐 中文</span>',
      '<span class="seg clickable" id="sbPage" title="页面设置…（纸张尺寸 / 背景色 / 条纹）">📄 适应屏幕</span>',
      '<span class="seg clickable" id="sbMode" title="点击切换模式">所见即所得 ▾</span>',
      '<span class="seg">Markdown Word v1.8.2</span>'
    ].join('');
    app.appendChild(sb);
    $('#sbMode').onclick = () => setMode(mode === 'wysiwyg' ? 'source' : mode === 'source' ? 'split' : 'wysiwyg');
    $('#sbWords').onclick = () => toast('全文字数：' + $('#sbWords').textContent);
    $('#sbPage').onclick = e => showPagePanel(e.target);
    $('#sbLang').onclick = () => cycleLanguage();

    // 浮层
    ttBar = document.createElement('div'); ttBar.id = 'ttBar';
    [['↥', '上方插入行', 'rowAbove'], ['↧', '下方插入行', 'rowBelow'], ['✕≡', '删除行', 'delRow'],
     ['↤', '左插列', 'colLeft'], ['↦', '右插列', 'colRight'], ['✕▥', '删除列', 'delCol'],
     ['≡', '左对齐', 'alLeft'], ['≣', '居中', 'alCenter'], ['≣', '右对齐', 'alRight'],
     ['☑', '表头', 'toggleHead'], ['🗑', '删表', 'delTable']].forEach(function (x) {
      const b = iconBtn(x[0], x[1], x[2], x[1].indexOf('删') === 0 ? 'danger' : '');
      b.style.height = '22px'; b.style.minWidth = '24px';
      ttBar.appendChild(b);
      if (x[2] === 'delRow' || x[2] === 'delCol' || x[2] === 'alRight') { ttBar.appendChild(sep()); }
    });
    app.appendChild(ttBar);

    slashEl = document.createElement('div'); slashEl.id = 'slashMenu';
    slashList = document.createElement('ul'); slashList.id = 'slashList';
    slashEl.appendChild(slashList);
    const hint = document.createElement('div'); hint.id = 'slashHint';
    hint.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> 导航</span><span><kbd>Enter</kbd> 插入</span><span><kbd>Esc</kbd> 关闭</span>';
    slashEl.appendChild(hint);
    app.appendChild(slashEl);

    tablePicker = document.createElement('div'); tablePicker.id = 'tablePicker';
    tablePicker.innerHTML = '<div id="tpLabel">移动鼠标选择行列</div><div id="tpGrid"></div><div id="tpCustom">插入表格…（自定义行列）</div>';
    app.appendChild(tablePicker);

    emojiPanel = document.createElement('div'); emojiPanel.id = 'emojiPanel';
    app.appendChild(emojiPanel);

    dlgMask = document.createElement('div'); dlgMask.className = 'dlgMask';
    app.appendChild(dlgMask);

    pagePanel = document.createElement('div'); pagePanel.id = 'pagePanel';
    app.appendChild(pagePanel);

    toastEl = document.createElement('div'); toastEl.id = 'toast';
    app.appendChild(toastEl);

    buildFindBar();
    buildFloatBar();
    buildCtxMenu();
    buildAiMenu();
    buildCrumb();
    bindFontDdls();
    buildTableGrid();
    bindEvents();
    applyLanguage();
  }

  // ================= 表格网格选择器（UI-02①） =================
  function buildTableGrid() {
    const grid = $('#tpGrid');
    for (let r = 1; r <= 6; r++) {
      for (let c = 1; c <= 8; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.addEventListener('mouseenter', () => {
          $$('#tpGrid .cell').forEach(x => {
            const rc = +x.dataset.r, cc = +x.dataset.c;
            x.classList.toggle('on', rc <= r && cc <= c);
          });
          $('#tpLabel').textContent = c + ' × ' + r + ' 表格';
        });
        cell.dataset.r = r; cell.dataset.c = c;
        cell.onclick = () => { hideTablePicker(); insertTable(r, c); };
        grid.appendChild(cell);
      }
    }
    $('#tpCustom').onclick = () => { hideTablePicker(); openTableDialog(); };
    document.addEventListener('mousedown', e => {
      if (tablePicker.style.display === 'block' && !tablePicker.contains(e.target)) { hideTablePicker(); }
      if (emojiPanel.style.display === 'block' && !emojiPanel.contains(e.target)) { emojiPanel.style.display = 'none'; }
      if (pagePanel && pagePanel.style.display === 'block' && !pagePanel.contains(e.target)) { hidePagePanel(); }
    });
  }
  function showTablePicker(btn) {
    const r = btn.getBoundingClientRect();
    tablePicker.style.display = 'block';
    tablePicker.style.position = 'fixed';
    tablePicker.style.left = Math.min(r.left, window.innerWidth - 260) + 'px';
    tablePicker.style.top = (r.bottom + 6) + 'px';
  }
  function hideTablePicker() { tablePicker.style.display = 'none'; }

  // ================= 对话框（UI-05） =================
  function dialog(title, fieldsHtml, buttons) {
    return new Promise(resolve => {
      dlgMask.innerHTML = '';
      const d = document.createElement('div'); d.className = 'dlg';
      d.innerHTML = '<h3>' + title + '</h3><div class="body">' + fieldsHtml + '</div>';
      const foot = document.createElement('div'); foot.className = 'foot';
      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'btn' + (b.primary ? ' pri' : '');
        btn.textContent = b.text;
        btn.onclick = () => {
          if (b.closeOnly) { dlgMask.style.display = 'none'; resolve(null); return; }
          const values = {};
          $$('.dlg [data-field]').forEach(f => {
            values[f.dataset.field] = f.type === 'checkbox' ? f.checked : f.value;
          });
          if (b.validate && !b.validate(values)) { return; }
          dlgMask.style.display = 'none'; resolve(values);
        };
        foot.appendChild(btn);
      });
      d.appendChild(foot); dlgMask.appendChild(d); dlgMask.style.display = 'flex';
      const first = $('.dlg [data-field]'); if (first) { first.focus(); }
    });
  }

  function openTableDialog() {
    dialog('插入表格', [
      '<div class="frow"><label>行数</label><input data-field="rows" type="number" min="1" max="99" value="3"></div>',
      '<div class="frow"><label>列数</label><input data-field="cols" type="number" min="1" max="20" value="3"></div>',
      '<div class="frow"><label>表头</label><input data-field="header" type="checkbox" checked style="flex:1"></div>'
    ].join(''), [
      { text: '取消', closeOnly: true },
      { text: '插入', primary: true, validate: v => (+v.rows > 0 && +v.cols > 0) }
    ]).then(v => {
      if (v) { insertTable(Math.min(99, +v.rows), Math.min(20, +v.cols), v.header === true || v.header === 'on'); }
    });
  }

  function openLinkDialog() {
    const existing = closestTag('a');
    const selText = String(window.getSelection()).trim();
    const href0 = existing ? existing.getAttribute('href') || '' : '';
    dialog(existing ? '编辑链接' : '插入链接', [
      '<div class="frow"><label>显示文本</label><input data-field="text" value="' + escAttr(selText || (existing ? existing.textContent : '')) + '"></div>',
      '<div class="frow"><label>URL</label><input data-field="url" placeholder="https://…" value="' + escAttr(href0) + '"></div>',
      '<div class="frow"><label>悬停标题</label><input data-field="title" placeholder="title（可选）"></div>'
    ].join(''), [
      { text: '取消', closeOnly: true },
      { text: existing ? '更新' : '确定', primary: true, validate: v => !!v.url }
    ]).then(v => {
      if (!v) { return; }
      if (existing) {
        existing.setAttribute('href', v.url);
        existing.textContent = v.text || v.url;
        if (v.title) { existing.setAttribute('title', v.title); }
      } else {
        const a = document.createElement('a');
        a.setAttribute('href', v.url);
        if (v.title) { a.setAttribute('title', v.title); }
        a.textContent = v.text || v.url;
        insertAtCaret(a);
      }
      scheduleSave();
    });
  }

  function openImageDialog() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (f) { sendImageFile(f); }
    };
    input.click();
  }

  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // ================= 加载 / 序列化 / 保存 =================
  function normalize() {
    // 游离文本包段落
    Array.prototype.slice.call(editor.childNodes).forEach(n => {
      if (n.nodeType === 3 && n.textContent.trim()) {
        const p = document.createElement('p'); p.textContent = n.textContent;
        editor.replaceChild(p, n);
      } else if (n.nodeType === 1 && ['b', 'i', 'u', 'span', 'a', 'code', 'del', 'mark'].indexOf(n.tagName.toLowerCase()) !== -1) {
        const p = document.createElement('p'); p.appendChild(n.cloneNode(true));
        editor.replaceChild(p, n);
      }
    });
    // 任务列表：补齐缺失的勾选框，并保证勾选字符与 data-checked 状态一致（Enter 续项复制结构后可能失配）
    $$('#editor li.md-task').forEach(li => {
      let cb = li.querySelector('.md-check');
      if (!cb) {
        cb = checkSpan(li.getAttribute('data-checked') === 'true');
        li.insertBefore(cb, li.firstChild);
      }
      const on = li.getAttribute('data-checked') === 'true';
      cb.textContent = on ? '☑' : '☐';
    });
  }
  function checkSpan(checked) {
    const s = document.createElement('span');
    s.className = 'md-check'; s.setAttribute('contenteditable', 'false');
    s.textContent = checked ? '☑' : '☐';
    return s;
  }

  function serialize() {
    normalize();
    return MD.domToMarkdown(editor);
  }
  function loadMarkdown(text) {
    editor.innerHTML = '';
    editor.appendChild(MD.blocksToDom(MD.parse(text)));
    resolveImages();
    updateStatus();
  }
  function currentText() {
    if (mode === 'wysiwyg') { return serialize(); }
    return srcTextarea.value;
  }
  function scheduleSave() {
    lastLocalEdit = Date.now();
    setSaveState('pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      setSaveState('saving');
      vscode.postMessage({ type: 'update', text: currentText() });
      sendOutline(); // 大纲联动（防抖后随保存节拍）
    }, 500);
  }
  function setSaveState(s) {
    saveState = s;
    const el = $('#sbSave');
    el.textContent = s === 'saved' ? '✓ 已保存' : s === 'saving' ? '保存中…' : '未保存';
  }

  function resolveImages() {
    const rels = [];
    $$('#editor img').forEach(img => {
      const ds = img.getAttribute('data-src') || '';
      if (ds && !/^(https?:|data:)/.test(ds) && rels.indexOf(ds) === -1) { rels.push(ds); }
    });
    if (rels.length) { vscode.postMessage({ type: 'resolveImages', paths: rels }); }
    else { applyImageMap({}); }
  }
  function applyImageMap(map) {
    $$('#editor img, #preview img').forEach(img => {
      const ds = img.getAttribute('data-src') || '';
      if (/^(https?:|data:)/.test(ds)) { img.src = ds; }
      else if (map[ds]) { img.src = map[ds]; }
      else { img.title = '图片丢失：' + ds + '（可重新定位或编辑链接）'; img.style.outline = '2px dashed #dc2626'; }
    });
  }

  // ================= 光标工具 =================
  function placeCaret(el, atEnd) {
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(!atEnd);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function topBlock() {
    const sel = window.getSelection();
    if (!sel.rangeCount) { return null; }
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) { n = n.parentElement; }
    while (n && n !== editor) {
      if (n.parentElement === editor) { return n; }
      n = n.parentElement;
    }
    return null;
  }
  function closestTag(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount) { return null; }
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) { n = n.parentElement; }
    while (n && n !== editor) {
      if (n.tagName && n.tagName.toLowerCase() === tag) { return n; }
      n = n.parentElement;
    }
    return null;
  }
  function caretContext() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.anchorNode) { return {}; }
    let n = sel.anchorNode;
    return {
      inTable: !!closestTag('table'),
      inPre: !!closestTag('pre'),
      inLi: !!closestTag('li')
    };
  }
  function insertAtCaret(node) {
    editor.focus();
    restoreSelIfNeeded();
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(node);
      r.setStartAfter(node); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    } else { editor.appendChild(node); }
    scheduleSave();
  }

  // ================= 行内命令 =================
  function execSimple(cmd) { document.execCommand(cmd); scheduleSave(); }
  function toggleWrap(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { return; }
    const cur = closestTag(tag);
    if (cur) { // 解包
      const parent = cur.parentNode;
      while (cur.firstChild) { parent.insertBefore(cur.firstChild, cur); }
      parent.removeChild(cur);
    } else {
      const r = sel.getRangeAt(0);
      const el = document.createElement(tag);
      try { r.surroundContents(el); } catch (e) {
        const frag = r.extractContents(); el.appendChild(frag); r.insertNode(el);
      }
    }
    scheduleSave();
  }

  // ================= 光标保持（真实浏览器行为修复） =================
  // 点击按钮/弹层等非编辑区时，Chromium 会把 selection 夺走，导致插入落点失效（表格跳到文档末尾）。
  // 双保险：① 弹层与 Ribbon 的 mousedown 阻止默认（不夺选区）；② 持续记录最后有效编辑区选区，插入前恢复。
  let lastValidRange = null;
  function trackSelection() {
    document.addEventListener('selectionchange', () => {
      const s = window.getSelection();
      if (s.rangeCount && editor.contains(s.anchorNode)) {
        try { lastValidRange = s.getRangeAt(0).cloneRange(); } catch (e) { /* ignore */ }
      }
    });
  }
  function restoreSelIfNeeded() {
    const s = window.getSelection();
    if (s.rangeCount && editor.contains(s.anchorNode)) { return true; }
    if (lastValidRange && editor.contains(lastValidRange.startContainer)) {
      try {
        const r = lastValidRange.cloneRange();
        s.removeAllRanges(); s.addRange(r);
        return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }
  function guardLayersFromStealingSelection() {
    ['#ribbon', '#ttBar', '#tablePicker', '#emojiPanel', '#slashMenu', '#pagePanel'].forEach(id => {
      const el = $(id);
      if (!el) { return; }
      el.addEventListener('mousedown', e => {
        if (!e.target.closest('input,select,textarea')) { e.preventDefault(); }
      });
    });
  }

  // ================= 块级命令 =================
  // 在光标处原位插入块级元素：
  // 空段落 → 原位替换；选区在块间隙（startContainer 为编辑器本身）→ 按 offset 插入对应位置；
  // 兜底追加到末尾。修复：此前块间隙场景表格被 appendChild 到文档末尾，造成"插入无反应 + 尾部堆积空表"。
  function insertBlockAtCaret(node) {
    restoreSelIfNeeded();
    const s = window.getSelection();
    let inserted = false;
    const b = topBlock();
    if (b) {
      if (b.tagName === 'P' && !b.textContent.trim()) {
        b.replaceWith(node); inserted = true; // 空段落 → 原位替换
      } else {
        b.after(node); inserted = true; // 非空段落 / 表格 / 代码块等结构块 → 插到该块之后（绝不嵌进内部）
      }
    } else if (s.rangeCount && editor.contains(s.anchorNode)) {
      try {
        const r = s.getRangeAt(0);
        r.deleteContents();
        r.insertNode(node); // 选区在块间隙（容器为编辑器本身）→ 按光标 offset 原位插入
        inserted = true;
      } catch (e) { /* 异常 → 兜底 */ }
    }
    if (!inserted) { editor.appendChild(node); }
  }
  function requireWysiwyg(what) {
    if (mode === 'wysiwyg') { return true; }
    toast('请先切换到所见即所得模式' + (what ? '再' + what : '') + '（Ctrl+Alt+V）');
    return false;
  }
  function setBlockType(tag) {
    const b = topBlock();
    if (!b) { return; }
    const t = b.tagName.toLowerCase();
    if (['table', 'pre', 'hr', 'ul', 'ol'].indexOf(t) !== -1) {
      if (t === 'ul' || t === 'ol') { listToParas(b); }
      return;
    }
    if (t === tag) { return setBlockType('p'); }
    const el = document.createElement(tag === 'quote' ? 'blockquote' : tag);
    el.innerHTML = b.innerHTML;
    b.replaceWith(el);
    placeCaret(el, true);
    scheduleSave();
  }
  function listToParas(list) {
    const frag = document.createDocumentFragment();
    let firstP = null;
    Array.prototype.slice.call(list.children).forEach(li => {
      const body = li.querySelector('.li-body');
      const p = document.createElement('p');
      if (body) { p.innerHTML = body.innerHTML; }
      else { p.innerHTML = li.innerHTML; }
      if (!firstP) { firstP = p; }
      frag.appendChild(p);
      Array.prototype.slice.call(li.children).forEach(c => {
        if (c.tagName === 'UL' || c.tagName === 'OL') { frag.appendChild(c.cloneNode(true)); }
      });
    });
    list.replaceWith(frag);
    if (firstP) { placeCaret(firstP, false); }
    scheduleSave();
    return firstP;
  }
  function toggleList(ordered, task) {
    const b = topBlock();
    if (!b) { return; }
    const t = b.tagName.toLowerCase();
    if (['table', 'pre', 'hr'].indexOf(t) !== -1) {
      toast('不能在' + (t === 'table' ? '表格' : t === 'pre' ? '代码块' : '分割线') + '上应用列表，请先选中普通文本');
      return;
    }
    if (t === 'ul' || t === 'ol') {
      if ((t === 'ol') === ordered && !task) { return; } // 同类再点：调用方已处理转段落
      // 类型切换：先转段落，再在新段落上建目标列表
      const p = listToParas(b);
      if (p) { buildListAt(p, ordered, task); }
      return;
    }
    buildListAt(b, ordered, task);
  }
  function buildListAt(block, ordered, task) {
    const text = block.textContent.trim();
    if (!text && block.tagName.toLowerCase() !== 'p') { return; }
    const list = document.createElement(ordered ? 'ol' : 'ul');
    const li = document.createElement('li');
    if (task) {
      li.className = 'md-task'; li.setAttribute('data-checked', 'false');
      li.appendChild(checkSpan(false));
    }
    const body = document.createElement('span'); body.className = 'li-body';
    body.innerHTML = block.innerHTML || text;
    li.appendChild(body);
    list.appendChild(li);
    block.replaceWith(list);
    placeCaret(list.querySelector('.li-body'), true);
    scheduleSave();
  }
  function insertHR() {
    if (!requireWysiwyg('插入分割线')) { return; }
    const hr = document.createElement('hr');
    insertBlockAtCaret(hr);
    const p = document.createElement('p'); p.innerHTML = '<br>';
    hr.after(p); placeCaret(p, false);
    scheduleSave();
  }
  function insertDatetime() {
    if (!requireWysiwyg('插入日期时间')) { return; }
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const text = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    insertAtCaret(document.createTextNode(text));
  }

  // ================= 代码块（F09） =================
  // F10：插入块级公式（LaTeX）——插入后立即弹源码编辑对话框
  function insertMathBlock() {
    const init = 'E = mc^2';
    const md = document.createElement('div');
    md.className = 'md-math'; md.setAttribute('data-tex', init);
    md.innerHTML = (typeof MdMath !== 'undefined' && MdMath.render) ? (MdMath.render(init) || '<code>' + init + '</code>') : '<code>' + init + '</code>';
    insertBlockAtCaret(md);
    placeCaret(md, false);
    scheduleSave();
    editSourceDialog(T('editMath'), init, tex => {
      md.setAttribute('data-tex', tex);
      md.innerHTML = (typeof MdMath !== 'undefined' && MdMath.render) ? (MdMath.render(tex) || '<code>' + tex + '</code>') : '<code>' + tex + '</code>';
      scheduleSave();
    });
  }
  // F10：插入 Mermaid 流程图（graph TD 模板）——插入后立即弹源码编辑对话框
  function insertMermaidBlock() {
    const init = 'graph TD\nA[开始] --> B{通过?}\nB -->|是| C[完成]';
    const mm = document.createElement('div');
    mm.className = 'md-mermaid'; mm.setAttribute('data-code', init);
    const svg = typeof MdMm !== 'undefined' && MdMm.render ? MdMm.render(init) : '';
    mm.innerHTML = svg || '<pre>' + init.replace(/</g, '&lt;') + '</pre>';
    insertBlockAtCaret(mm);
    placeCaret(mm, false);
    scheduleSave();
    editSourceDialog(T('editMermaid'), init, code => {
      mm.setAttribute('data-code', code);
      const s2 = typeof MdMm !== 'undefined' && MdMm.render ? MdMm.render(code) : '';
      mm.innerHTML = s2 || '<pre>' + code.replace(/</g, '&lt;') + '</pre>';
      scheduleSave();
    });
  }
  // F10：Draw.io——请求宿主在文档目录创建 .drawio.svg 模板并回传引用
  function insertDrawioRef() {
    vscode.postMessage({ type: 'insertDrawio' });
  }

  function insertCodeBlock() {
    const tools = document.createElement('div');
    tools.className = 'code-tools'; tools.setAttribute('contenteditable', 'false');
    const sel = document.createElement('select');
    LANGUAGES.forEach(l => {
      const o = document.createElement('option');
      o.value = l[0]; o.textContent = l[1];
      sel.appendChild(o);
    });
    sel.value = 'plaintext';
    const copy = document.createElement('button');
    copy.className = 'code-copy'; copy.textContent = '⧉ 复制';
    tools.appendChild(sel); tools.appendChild(copy);

    const pre = document.createElement('pre');
    pre.setAttribute('data-lang', 'plaintext');
    const code = document.createElement('code');
    code.innerHTML = '<br>';
    pre.appendChild(code);
    sel.onchange = () => {
      pre.setAttribute('data-lang', sel.value);
      code.innerHTML = (typeof MdHl !== 'undefined' && code.textContent) ? MdHl.highlight(code.textContent, sel.value) : code.innerHTML;
      scheduleSave();
    };
    copy.onclick = () => {
      try {
        navigator.clipboard.writeText(code.textContent);
        toast('代码已复制');
      } catch (e) { toast('复制失败'); }
    };

    if (!requireWysiwyg('插入代码块')) { return; }
    insertBlockAtCaret(tools);
    tools.after(pre);
    placeCaret(code, false);
    scheduleSave();
  }

  // ================= 表格（F05） =================
  function insertTable(rows, cols, withHeader) {
    if (withHeader === undefined) { withHeader = settings.tableDefaultHeader; }
    const table = document.createElement('table');
    const mk = (tag, align) => {
      const c = document.createElement(tag);
      if (align) { c.setAttribute('data-align', align); }
      return c;
    };
    if (withHeader) {
      const thead = document.createElement('thead'); const tr = document.createElement('tr');
      for (let c = 1; c <= cols; c++) { tr.appendChild(mk('th')); tr.lastChild.textContent = '列' + c; }
      thead.appendChild(tr); table.appendChild(thead);
    }
    const tbody = document.createElement('tbody');
    const bodyRows = withHeader ? rows : rows; // rows 含表头
    for (let r = 0; r < bodyRows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) { tr.appendChild(mk('td')); }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    if (!requireWysiwyg('插入表格')) { return; }
    insertBlockAtCaret(table);
    editor.focus(); // 网格点击路径不经过 runCommand，必须显式夺回焦点，否则打字/Tab 落在按钮上
    const first = table.querySelector('th, td');
    if (first) { placeCaret(first, false); }
    scheduleSave();
  }

  function currentTable() {
    const b = topBlock();
    if (b && b.tagName === 'TABLE') { return b; }
    const sel = window.getSelection();
    if (!sel.rangeCount) { return null; }
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) { n = n.parentElement; }
    while (n && n !== editor) {
      if (n.tagName === 'TABLE') { return n; }
      n = n.parentElement;
    }
    return null;
  }
  function currentCell() {
    const sel = window.getSelection();
    if (!sel.rangeCount) { return null; }
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) { n = n.parentElement; }
    while (n && n !== editor) {
      if (n.tagName === 'TD' || n.tagName === 'TH') { return n; }
      n = n.parentElement;
    }
    return null;
  }
  function cellIndex(cell) {
    return Array.prototype.indexOf.call(cell.parentElement.children, cell);
  }
  function tableOp(op) {
    const table = currentTable();
    if (!table) { toast('光标不在表格内'); return; }
    const cell = currentCell();
    const colIdx = cell ? cellIndex(cell) : 0;
    const rowIdx = cell ? Array.prototype.indexOf.call(table.querySelectorAll('tr'), cell.parentElement) : 0;
    const rows = table.querySelectorAll('tr');
    switch (op) {
      case 'rowAbove': case 'rowBelow': {
        const tr = document.createElement('tr');
        const ref = rows[rowIdx];
        Array.prototype.forEach.call(ref.children, c => {
          const td = document.createElement(c.tagName === 'TH' && op === 'rowAbove' ? 'TH' : 'TD');
          if (c.getAttribute('data-align')) { td.setAttribute('data-align', c.getAttribute('data-align')); }
          tr.appendChild(td);
        });
        ref[op === 'rowAbove' ? 'before' : 'after'](tr);
        placeCaret(tr.children[Math.min(colIdx, tr.children.length - 1)], false);
        break;
      }
      case 'delRow': {
        if (rows.length <= 1) { return tableOp('delTable'); }
        const next = rows[rowIdx + 1] || rows[rowIdx - 1];
        rows[rowIdx].remove();
        if (next) { placeCaret(next.children[Math.min(colIdx, next.children.length - 1)], false); }
        break;
      }
      case 'colLeft': case 'colRight': {
        const at = op === 'colLeft' ? colIdx : colIdx + 1;
        rows.forEach(tr => {
          const td = document.createElement(tr.parentElement.tagName === 'THEAD' ? 'TH' : 'TD');
          tr.insertBefore(td, tr.children[at] || null);
        });
        break;
      }
      case 'delCol': {
        if (rows[0].children.length <= 1) { return tableOp('delTable'); }
        rows.forEach(tr => { if (tr.children[colIdx]) { tr.children[colIdx].remove(); } });
        break;
      }
      case 'alLeft': case 'alCenter': case 'alRight': {
        const a = op === 'alLeft' ? 'left' : op === 'alCenter' ? 'center' : 'right';
        rows.forEach(tr => {
          const c = tr.children[colIdx];
          if (c) { c.setAttribute('data-align', a); }
        });
        break;
      }
      case 'toggleHead': {
        const thead = table.querySelector('thead');
        if (thead) { // 表头 → 数据行：thead 首行 th 转 td 移入 tbody 首位
          const tr = thead.querySelector('tr');
          Array.prototype.forEach.call(tr.children, th => {
            const td = document.createElement('td');
            if (th.getAttribute('data-align')) { td.setAttribute('data-align', th.getAttribute('data-align')); }
            td.innerHTML = th.innerHTML; tr.replaceChild(td, th);
          });
          const tbody = table.querySelector('tbody') || table;
          tbody.insertBefore(tr, tbody.firstChild);
          thead.remove();
        } else { // 数据首行 → 表头
          const tbody = table.querySelector('tbody');
          if (!tbody || !tbody.firstChild) { return; }
          const thead2 = document.createElement('thead');
          const tr = tbody.firstChild;
          Array.prototype.forEach.call(tr.children, td => {
            const th = document.createElement('th');
            if (td.getAttribute('data-align')) { th.setAttribute('data-align', td.getAttribute('data-align')); }
            th.innerHTML = td.innerHTML; tr.replaceChild(th, td);
          });
          thead2.appendChild(tr);
          table.insertBefore(thead2, tbody);
        }
        break;
      }
      case 'delTable': table.remove(); break;
      case 'rowUp': case 'rowDown': {
        const tr = cell ? cell.parentElement : null;
        if (!tr) { break; }
        if (op === 'rowUp') {
          const prev = tr.previousElementSibling;
          if (prev && prev.tagName === 'TR') { tr.parentElement.insertBefore(tr, prev); }
        } else {
          const next = tr.nextElementSibling;
          if (next && next.tagName === 'TR') { tr.parentElement.insertBefore(next, tr); }
        }
        break;
      }
      case 'colMoveL': case 'colMoveR': {
        const at2 = colIdx + (op === 'colMoveL' ? -1 : 1);
        if (at2 < 0 || at2 >= rows[0].children.length) { break; }
        rows.forEach(tr => {
          const c = tr.children[colIdx], t = tr.children[at2];
          if (c && t) { tr.insertBefore(c, op === 'colMoveL' ? t : t.nextSibling); }
        });
        break;
      }
    }
    scheduleSave();
  }

  function updateTableBar() {
    const table = currentTable();
    if (!table || mode !== 'wysiwyg') { ttBar.style.display = 'none'; return; }
    const r = table.getBoundingClientRect();
    ttBar.style.display = 'flex';
    ttBar.style.position = 'fixed';
    ttBar.style.left = Math.max(8, r.left) + 'px';
    ttBar.style.top = Math.max(8, r.top - 34) + 'px';
  }

  // ================= 图片（F06：粘贴/拖拽落盘，持久化） =================
  function sendImageFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const id = 'img' + (++fileSeq);
      pendingImages[id] = true;
      toast('图片保存中…');
      vscode.postMessage({ type: 'saveImage', id: id, data: reader.result, ext: (file.name.split('.').pop() || 'png') });
    };
    reader.readAsDataURL(file);
  }
  function onImageSaved(msg) {
    if (!pendingImages[msg.id]) { return; }
    delete pendingImages[msg.id];
    if (msg.error) { toast('图片保存失败：' + msg.error); return; }
    if (mode !== 'wysiwyg') {
      // 源码/分屏模式：以 Markdown 语法插入源码光标处（避免写入隐藏编辑器被丢弃）
      insertAtTextarea(srcTextarea, '![](' + msg.relPath + ')');
      toast('已保存：' + msg.relPath);
      return;
    }
    const img = document.createElement('img');
    img.setAttribute('data-src', msg.relPath);
    img.src = msg.webSrc;
    img.alt = '';
    insertAtCaret(img);
    toast('已保存：' + msg.relPath);
  }

  // ================= Emoji（MRU 置顶，斜杠与面板共用） =================
  const MRU_KEY = 'mdword.emojiMRU';
  function getMRU() {
    try { return JSON.parse(localStorage.getItem(MRU_KEY) || '[]'); } catch (e) { return []; }
  }
  function pushMRU(ch) {
    let mru = getMRU().filter(x => x !== ch);
    mru.unshift(ch);
    mru = mru.slice(0, 24);
    try { localStorage.setItem(MRU_KEY, JSON.stringify(mru)); } catch (e) { /* ignore */ }
  }
  function insertEmoji(ch) {
    insertAtCaret(document.createTextNode(ch));
    pushMRU(ch);
  }
  let emojiPanelBuilt = false;
  function buildEmojiPanel(search) {
    // 骨架只建一次（搜索框不重建，避免快速输入丢焦点丢键），每次仅刷新网格
    if (!emojiPanelBuilt) {
      emojiPanel.innerHTML = '';
      const s = document.createElement('input');
      s.id = 'emojiSearch'; s.placeholder = '🔍 搜索（中文 = 英文，如 笑脸 = smile）';
      s.addEventListener('input', () => refreshEmojiGrid(s.value));
      emojiPanel.appendChild(s);
      const t1 = document.createElement('div'); t1.className = 'etitle'; t1.textContent = '最近使用';
      const rec = document.createElement('div'); rec.id = 'emojiRecent';
      emojiPanel.appendChild(t1); emojiPanel.appendChild(rec);
      const t2 = document.createElement('div'); t2.className = 'etitle'; t2.textContent = '全部';
      const grid = document.createElement('div'); grid.id = 'emojiGrid';
      emojiPanel.appendChild(t2); emojiPanel.appendChild(grid);
      emojiPanelBuilt = true;
    }
    refreshEmojiGrid(search || '');
  }
  function refreshEmojiGrid(search) {
    const rec = emojiPanel.querySelector('#emojiRecent');
    const grid = emojiPanel.querySelector('#emojiGrid');
    if (!grid) { return; }
    const recent = getMRU();
    if (rec) {
      rec.innerHTML = '';
      recent.forEach(ch => {
        const sp = document.createElement('span'); sp.textContent = ch;
        sp.onclick = () => { insertEmoji(ch); emojiPanel.style.display = 'none'; };
        rec.appendChild(sp);
      });
      rec.previousElementSibling && (rec.previousElementSibling.style.display = recent.length ? '' : 'none');
    }
    const q = (search || '').trim().toLowerCase();
    grid.innerHTML = '';
    EMOJIS.filter(e => !q || e[1].indexOf(q) !== -1 || e[0] === q).forEach(e => {
      const sp = document.createElement('span'); sp.textContent = e[0]; sp.title = e[1];
      sp.onclick = () => { insertEmoji(e[0]); emojiPanel.style.display = 'none'; };
      grid.appendChild(sp);
    });
    if (!grid.children.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;color:#94a3b8;font-size:12px;padding:8px">没有匹配项</div>';
    }
  }
  function showEmojiPanel(btn) {
    buildEmojiPanel('');
    const r = btn.getBoundingClientRect();
    emojiPanel.style.display = 'block'; emojiPanel.style.position = 'fixed';
    emojiPanel.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
    emojiPanel.style.top = (r.bottom + 6) + 'px';
  }

  // ================= 斜杠菜单（F08：Confluence 式） =================
  const SLASH_GROUPS = [
    { name: 'AI', i18n: 'grpAI', items: [
      ['✨', 'aiOutline', 'AI 生成本节大纲', '基于当前节标题与上下文', 'ai outline 大纲 dagang'],
      ['✍', 'aiContinue', 'AI 续写', '从光标处继续写作', 'ai continue 续写 xuxie']
    ]},
    { name: '基础块', i18n: 'grpBasic', items: [
      ['H1', 'h1', '标题 1', '大标题 · 速记 # + 空格', 'h1 heading 标题'],
      ['H2', 'h2', '标题 2', '章节标题', 'h2 heading 标题'],
      ['H3', 'h3', '标题 3', '小节标题', 'h3 heading 标题'],
      ['¶', 'p', '正文', '普通段落', 'text 正文 段落 para'],
      ['❝', 'quote', '引用块', '引用一段文字', 'quote 引用 blockquote yinyong'],
      ['――', 'hr', '分割线', '水平分隔线', 'hr 分割线 fengexian'],
      ['{ }', 'codeblock', '代码块', '30+ 语言（含 PL/SQL）· 等宽', 'code 代码块 daima']
    ]},
    { name: '列表', i18n: 'grpList', items: [
      ['•≡', 'ul', '无序列表', '项目符号列表', 'bullet 无序列表 ul liebiao'],
      ['1.≡', 'ol', '有序列表', '编号列表', 'numbered 有序列表 ol liebiao'],
      ['☑', 'task', '任务列表', '可勾选的待办', 'checkbox task 任务 renwu todo']
    ]},
    { name: '媒体与插入', i18n: 'grpMedia', items: [
      ['▦', 'table', '表格', '网格选择行列', 'table 表格 biaoge'],
      ['🖼', 'image', '图片', '本地 / 剪贴板 / URL', 'image 图片 tupian'],
      ['🔗', 'link', '链接', '插入超链接', 'link 链接 lianjie'],
      ['☰', 'toc', '目录 TOC', '按当前标题生成目录', 'toc 目录 mulu'],
      ['⊕', 'footnote', '脚注', '插入上标引用，定义追加文末', 'footnote 脚注 jiaozhu'],
      ['ℹ', 'panelInfo', '信息面板', '四色提示框（信息/提示/警告/错误）', 'panel 面板 mianban 提示'],
      ['📅', 'datetime', '日期时间', '插入当前日期时间', 'date 日期 datetime riqi']
    ]},
    { name: 'Emoji', i18n: '', items: EMOJIS.slice(0, 16).map(e => [e[0], 'emoji:' + e[0], '插入 ' + e[0], e[1], e[1]]) }
  ];

  let slashState = { open: false, kw: '', active: 0, items: [], anchor: null, anchorOff: 0 };

  function showSlashMenu(kw, node, start) {
    slashState.open = true; slashState.kw = kw;
    slashState.anchor = node; slashState.anchorOff = start;
    renderSlash();
    const rect = caretRect();
    slashEl.style.display = 'flex'; slashEl.style.position = 'fixed';
    if (rect) {
      slashEl.style.left = Math.min(rect.left, window.innerWidth - 360) + 'px';
      slashEl.style.top = Math.min(rect.bottom + 6, window.innerHeight - 380) + 'px';
    }
  }
  function hideSlashMenu() { slashState.open = false; slashEl.style.display = 'none'; }
  function renderSlash() {
    const kw = slashState.kw.trim().toLowerCase();
    slashList.innerHTML = '';
    const score = it => {
      if (!kw) { return 0; }
      const words = String(it[4]).toLowerCase() + ' ' + String(it[2]).toLowerCase();
      return words.split(/[\s]+/).some(w => w.indexOf(kw) === 0) ? 0 : 1;
    };
    const groups = [];
    SLASH_GROUPS.forEach(g => {
      const hit = g.items.filter(it => !kw || it[4].indexOf(kw) !== -1 || it[2].toLowerCase().indexOf(kw) !== -1);
      if (!hit.length) { return; }
      hit.sort((a, b) => score(a) - score(b));
      groups.push({ name: g.i18n ? T(g.i18n) : g.name, items: hit });
    });
    groups.sort((a, b) => (a.items[0] ? score(a.items[0]) : 9) - (b.items[0] ? score(b.items[0]) : 9));
    const items = [];
    groups.forEach(g => {
      const sg = document.createElement('li'); sg.className = 'sgroup'; sg.textContent = g.name;
      slashList.appendChild(sg);
      g.items.forEach(it => {
        const li = document.createElement('li');
        li.className = 'sitem'; li.dataset.cmd = it[1];
        li.innerHTML = '<span class="sic' + (String(it[1]).indexOf('ai') === 0 ? ' ai' : '') + '">' + it[0] +
          '</span><div><div class="sit">' + it[2] + '</div><div class="sid">' + it[3] + '</div></div>';
        li.onclick = () => execSlashItem(it[1]);
        slashList.appendChild(li);
        items.push(li);
      });
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'sgroup';
      li.textContent = kw ? '没有匹配项 —— 继续输入以查找操作…' : '输入关键词过滤（中 / 英 / 拼音）';
      slashList.appendChild(li);
    }
    slashState.items = items;
    slashState.active = 0;
    highlightSlash();
  }
  function highlightSlash() {
    slashState.items.forEach((li, i) => li.classList.toggle('active', i === slashState.active));
    const act = slashState.items[slashState.active];
    if (act && typeof act.scrollIntoView === 'function') { act.scrollIntoView({ block: 'nearest' }); }
  }
  function execSlashItem(cmd) {
    // 删除 "/关键词" 文本
    if (slashState.anchor && slashState.anchor.parentNode) {
      try {
        const r = document.createRange();
        r.setStart(slashState.anchor, slashState.anchorOff - 1 - slashState.kw.length);
        r.setEnd(slashState.anchor, slashState.anchorOff);
        r.deleteContents();
      } catch (e) { /* ignore */ }
    }
    hideSlashMenu();
    if (String(cmd).indexOf('emoji:') === 0) { return insertEmoji(cmd.slice(6)); }
    runCommand(cmd);
  }
  function checkSlashTrigger() {
    if (!settings.slashMenuEnabled || mode !== 'wysiwyg') { return; }
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) { return hideSlashMenuIfStale(); }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) { return hideSlashMenu(); }
    const before = node.textContent.slice(0, sel.anchorOffset);
    const m = before.match(/(?:^|[^\w\/.\:])\/([\w\u4e00-\u9fa5]*)$/); // 排除路径 ./ 、协议 :// 前的斜杠
    if (m) { showSlashMenu(m[1], node, sel.anchorOffset); }
    else { hideSlashMenu(); }
  }
  function hideSlashMenuIfStale() { hideSlashMenu(); }

  function caretRect() {
    const sel = window.getSelection();
    if (!sel.rangeCount) { return null; }
    const r = document.createRange();
    r.setStart(sel.anchorNode, sel.anchorOffset);
    r.collapse(true);
    if (typeof r.getClientRects === 'function') {
      const rects = r.getClientRects();
      if (rects.length) { return rects[0]; }
    }
    const span = document.createElement('span');
    span.textContent = '\u200b';
    r.insertNode(span);
    const rect = typeof span.getBoundingClientRect === 'function' ? span.getBoundingClientRect() : null;
    span.remove();
    return rect;
  }

  // ================= F12 查找替换（CSS Highlight API：零 DOM 污染） =================
  let findState = { matches: [], cur: -1, query: '', regex: false, caseSensitive: false };
  function buildFindBar() {
    const bar = document.createElement('div'); bar.id = 'findBar';
    bar.innerHTML = [
      '<input id="findInput" placeholder="查找（支持正则）">',
      '<span id="findCount">0/0</span>',
      '<button class="fbtn" id="fPrev" title="上一个 (Shift+Enter)">↑</button>',
      '<button class="fbtn" id="fNext" title="下一个 (Enter)">↓</button>',
      '<button class="fbtn" id="fCase" title="区分大小写">Aa</button>',
      '<button class="fbtn" id="fRegex" title="正则表达式">.*</button>',
      '<span class="fsep2"></span>',
      '<input id="replaceInput" placeholder="替换为">',
      '<button class="fbtn" id="fReplace" title="替换当前">替换</button>',
      '<button class="fbtn" id="fReplaceAll" title="全部替换">全部</button>',
      '<button class="fbtn" id="fClose" title="关闭 (Esc)">✕</button>'
    ].join('');
    $('#app').insertBefore(bar, $('#main'));
    bar.addEventListener('mousedown', e => { if (!e.target.closest('input')) { e.preventDefault(); } });
    $('#findInput').addEventListener('input', () => runFind());
    $('#findInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? gotoMatch(-1) : gotoMatch(1); }
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    $('#replaceInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    $('#fPrev').onclick = () => gotoMatch(-1);
    $('#fNext').onclick = () => gotoMatch(1);
    $('#fCase').onclick = () => { findState.caseSensitive = !findState.caseSensitive; $('#fCase').classList.toggle('on', findState.caseSensitive); runFind(); };
    $('#fRegex').onclick = () => { findState.regex = !findState.regex; $('#fRegex').classList.toggle('on', findState.regex); runFind(); };
    $('#fReplace').onclick = () => replaceCurrent();
    $('#fReplaceAll').onclick = () => replaceAll();
    $('#fClose').onclick = () => closeFind();
  }
  function openFind(withReplace) {
    if (mode !== 'wysiwyg') { toast('查找替换请切换到所见即所得模式（源码模式可用 VS Code 原生 Ctrl+F）'); return; }
    const bar = $('#findBar');
    bar.style.display = 'flex';
    bar.classList.toggle('with-replace', !!withReplace);
    const sel = String(window.getSelection());
    if (sel && !$('#findInput').value) { $('#findInput').value = sel; }
    $('#findInput').focus(); $('#findInput').select();
    runFind();
  }
  function closeFind() {
    const bar = $('#findBar');
    if (bar) { bar.style.display = 'none'; }
    findState.matches = []; findState.cur = -1;
    clearFindHighlights();
    editor.focus();
  }
  function clearFindHighlights() {
    try {
      if (typeof CSS !== 'undefined' && CSS.highlights) {
        CSS.highlights.delete('mdword-find');
        CSS.highlights.delete('mdword-cur');
      }
    } catch (e) { /* ignore */ }
  }
  function collectMatches() {
    const matches = [];
    const q = findState.query;
    if (!q) { return matches; }
    let re;
    try {
      const flags = findState.caseSensitive ? 'g' : 'gi';
      re = findState.regex ? new RegExp(q, flags) : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) { return matches; }
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) { nodes.push(walker.currentNode); }
    nodes.forEach(node => {
      if (node.parentElement && node.parentElement.closest('.code-tools, .md-check')) { return; }
      const text = node.textContent;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const r = document.createRange();
        r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        matches.push(r);
      }
    });
    return matches;
  }
  function runFind() {
    findState.query = $('#findInput') ? $('#findInput').value : '';
    findState.matches = collectMatches();
    findState.cur = findState.matches.length ? 0 : -1;
    paintFind();
  }
  function paintFind() {
    const count = findState.matches.length;
    $('#findCount').textContent = (findState.cur + 1) + '/' + count;
    try {
      if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
        clearFindHighlights();
        if (count) {
          CSS.highlights.set('mdword-find', new Highlight(...findState.matches));
          if (findState.cur >= 0) {
            CSS.highlights.set('mdword-cur', new Highlight(findState.matches[findState.cur]));
          }
        }
      }
    } catch (e) { /* 高亮不可用（jsdom/旧内核）：计数与替换仍可用 */ }
    const curRange = findState.matches[findState.cur];
    if (curRange && typeof curRange.startContainer.scrollIntoView === 'function') {
      try { curRange.startContainer.parentElement && curRange.startContainer.parentElement.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    }
  }
  function gotoMatch(dir) {
    const n = findState.matches.length;
    if (!n) { return; }
    findState.cur = (findState.cur + dir + n) % n;
    paintFind();
  }
  function replaceCurrent() {
    const r = findState.matches[findState.cur];
    if (!r) { return; }
    const val = $('#replaceInput').value;
    r.deleteContents();
    r.insertNode(document.createTextNode(val));
    scheduleSave();
    runFind();
    gotoMatch(0);
  }
  function replaceAll() {
    if (!findState.matches.length) { return; }
    const val = $('#replaceInput').value;
    const count = findState.matches.length;
    // 逆序替换，避免前面的替换使后面的 Range 偏移失效
    findState.matches.slice().reverse().forEach(r => {
      r.deleteContents();
      r.insertNode(document.createTextNode(val));
    });
    scheduleSave();
    toast('已替换 ' + count + ' 处');
    runFind();
  }

  // ================= F13 导出 HTML（自包含单文件） =================
  const EXPORT_CSS = [
    'body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#1e293b;line-height:1.75}',
    'h1{border-bottom:1px solid #e2e8f0;padding-bottom:8px}h1,h2,h3{line-height:1.4}',
    'blockquote{border-left:3px solid #4f46e5;background:#eef2ff;margin:12px 0;padding:8px 16px;border-radius:0 8px 8px 0;color:#475569}',
    'code{font-family:Consolas,monospace;font-size:.88em;background:rgba(127,127,127,.12);border-radius:4px;padding:1px 5px}',
    'pre{background:#0f172a;border-radius:8px;overflow-x:auto}pre code{display:block;padding:14px;background:transparent;color:#e2e8f0}',
    'table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:6px 12px}th{background:#f1f5f9}',
    '[data-align=center]{text-align:center}[data-align=right]{text-align:right}',
    'img{max-width:100%}a{color:#4f46e5}',
    'li.md-task{list-style:none;margin-left:-16px}',
    '.hljs-kw{color:#c792ea}.hljs-str{color:#c3e88d}.hljs-num{color:#f78c6c}.hljs-cm{color:#64748b;font-style:italic}.hljs-type{color:#82aaff}.hljs-attr{color:#ffcb6b}.hljs-add{color:#9ece6a}.hljs-del{color:#f7768e}',
    '.md-panel{border-radius:8px;padding:10px 16px;margin:12px 0;border:1px solid transparent}',
    '.note-info{background:#eff6ff;border-color:#bfdbfe;color:#1e40af}.note-tip{background:#f0fdfa;border-color:#99f6e4;color:#115e59}',
    '.note-warning{background:#fffbeb;border-color:#fde68a;color:#92400e}.note-error{background:#fef2f2;border-color:#fecaca;color:#b91c1c}',
    '@media print{body{margin:0}}'
  ].join('\n');
  function exportHtml() {
    const title = (settings.docName || 'document') + '.md';
    const bodyHtml = MD.blocksToHtml(MD.parse(currentText()));
    const html = [
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>' + MD.escapeHtml(title) + '</title>',
      '<style>' + EXPORT_CSS + '</style>',
      '</head><body>', bodyHtml,
      '<footer style="margin-top:48px;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:12px">由 Markdown Word 导出 · ' + new Date().toLocaleString() + '</footer>',
      '</body></html>'
    ].join('\n');
    vscode.postMessage({ type: 'saveFile', name: (settings.docName || 'document') + '.html', content: html });
  }

  // ================= F10：TOC 生成 / 四色提示面板 =================
  function slugify(text) {
    return String(text).trim().toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
      .replace(/\s+/g, '-');
  }
  function insertTOC() {
    if (!requireWysiwyg('插入目录')) { return; }
    const items = [];
    $$('#editor h1, #editor h2, #editor h3, #editor h4, #editor h5, #editor h6').forEach(h => {
      const text = h.textContent.trim();
      if (!text) { return; }
      const indent = '  '.repeat(Math.max(0, +h.tagName[1] - 1));
      items.push(indent + '- [' + text + '](#' + slugify(text) + ')');
    });
    if (!items.length) { toast('文档中尚无标题，无法生成目录'); return; }
    const frag = MD.blocksToDom(MD.parse(items.join('\n')));
    const block = frag.firstChild;
    if (!block) { toast('目录生成失败'); return; }
    insertBlockAtCaret(block);
    placeCaret(block, true);
    scheduleSave();
    toast('已按标题生成目录（' + items.length + ' 项）');
  }
  const PANEL_KINDS = {
    info: ['note-info', 'ℹ 信息'],
    tip: ['note-tip', '💡 提示'],
    warning: ['note-warning', '⚠ 警告'],
    error: ['note-error', '✕ 错误']
  };
  function insertPanel(kind) {
    if (!requireWysiwyg('插入面板')) { return; }
    const k = PANEL_KINDS[kind] ? kind : 'info';
    const div = document.createElement('div');
    div.className = 'md-panel ' + PANEL_KINDS[k][0];
    div.setAttribute('contenteditable', 'true');
    div.textContent = PANEL_KINDS[k][1] + '：';
    insertBlockAtCaret(div);
    placeCaret(div, true);
    scheduleSave();
  }

  // ================= UI-04：选区浮动格式工具条 =================
  function buildFloatBar() {
    const bar = document.createElement('div'); bar.id = 'ftBar';
    [
      ['<b>B</b>', '加粗 Ctrl+B', 'bold'], ['<i>I</i>', '斜体 Ctrl+I', 'italic'],
      ['<s>S</s>', '删除线', 'strike'], ['<code>&lt;/&gt;</code>', '行内代码', 'incode'],
      ['高', '高亮', 'highlight'], ['H2', '标题 2', 'h2'], ['🔗', '插入链接 Ctrl+K', 'link'],
      ['✨', 'AI 助手（改写 / 润色 / 翻译…）', 'aiMenu']
    ].forEach(x => {
      const b = iconBtn(x[0], x[1], x[2]);
      bar.appendChild(b);
    });
    bar.addEventListener('mousedown', e => e.preventDefault()); // 防夺选区
    bar.addEventListener('click', e => {
      const b = e.target.closest('.rbtn');
      if (!b || !b.dataset.cmd) { return; }
      if (b.dataset.cmd === 'aiMenu') { showAiMenu(b); return; }
      runCommand(b.dataset.cmd); updateFloatBar();
    });
    $('#app').appendChild(bar);
  }
  function updateFloatBar() {
    const bar = $('#ftBar');
    if (!bar) { return; }
    if (mode !== 'wysiwyg') { bar.style.display = 'none'; return; }
    const sel = window.getSelection();
    const hasSel = sel && sel.rangeCount && !sel.isCollapsed && editor.contains(sel.anchorNode) && !sel.getRangeAt(0).collapsed;
    const inTable = caretContext().inTable;
    if (!hasSel || inTable) { bar.style.display = 'none'; return; } // 表格内优先表格工具条
    const rg = sel.getRangeAt(0);
    if (typeof rg.getBoundingClientRect !== 'function') { return; } // 环境无几何 API（如 jsdom）
    const rect = rg.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.style.left = Math.max(8, rect.left + rect.width / 2 - 130) + 'px';
    bar.style.top = Math.max(8, rect.top - 38) + 'px';
  }

  // ================= F02 字体中英分设（文档级：CSS 变量 + 设置持久化，零源码污染） =================
  const FONT_LISTS = {
    latin: [['', '跟随 VS Code'], ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Cascadia Code', 'Cascadia Code'], ['Consolas', 'Consolas'], ['Verdana', 'Verdana'], ['Tahoma', 'Tahoma']],
    cjk: [['', '跟随 VS Code'], ['Microsoft YaHei', '微软雅黑'], ['SimSun', '宋体'], ['KaiTi', '楷体'], ['SimHei', '黑体'], ['FangSong', '仿宋'], ['Source Han Sans SC', '思源黑体'], ['LXGW WenKai', '霞鹜文楷']]
  };
  function applyFontVars() {
    const e = settings.editor || {};
    const latin = e.fontFamilyLatin || '';
    const cjk = e.fontFamilyCJK || '';
    const host = $('#main') || editor.parentElement;
    // 组合回退链：西文在前（拉丁字符优先命中），中文在后（CJK 字符回退命中）
    const stack = [latin, cjk].filter(Boolean).map(f => '"' + f + '"');
    stack.push('var(--vscode-editor-font-family, sans-serif)');
    editor.style.fontFamily = stack.join(', ');
    $('#sbFont') && ($('#sbFont').textContent = '🅰 ' + (latin || '跟随') + ' / ' + (cjk || '跟随'));
  }
  function setFont(key, value) {
    settings.editor = settings.editor || {};
    settings.editor[key] = value;
    applyFontVars();
    vscode.postMessage({ type: 'saveSetting', section: 'editor', key: key, value: value });
    hideFontPanel();
  }
  function showFontPanel(anchor, kind) {
    hideFontPanel();
    const list = kind === 'cjk' ? FONT_LISTS.cjk : FONT_LISTS.latin;
    const key = kind === 'cjk' ? 'fontFamilyCJK' : 'fontFamilyLatin';
    const cur = (settings.editor || {})[key] || '';
    const panel = document.createElement('div'); panel.id = 'fontPanel';
    // 有选区时提供"应用于选中文字"（行内 span 持久化，随文档保存）
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && editor.contains(sel.anchorNode)) {
      const applyBtn = document.createElement('div');
      applyBtn.className = 'fitem apply-sel';
      applyBtn.textContent = lang === 'zh' ? '✎ 应用于选中文字（随文档保存）' : '✎ Apply to selection (persisted)';
      applyBtn.style.borderTop = '1px solid rgba(127,127,127,.2)';
      applyBtn.onclick = () => { applyFontToSelection(); hideFontPanel(); };
      panel.appendChild(applyBtn);
      const sep = document.createElement('div'); sep.className = 'fsep2'; sep.style.cssText = 'height:1px;background:rgba(127,127,127,.2);margin:4px 0';
      panel.appendChild(sep);
    }
    list.forEach(function (kv) {
      const item = document.createElement('div');
      item.className = 'fitem' + (kv[0] === cur ? ' on' : '');
      item.textContent = (kv[0] === cur ? '✓ ' : '') + kv[1];
      if (kv[0]) { item.style.fontFamily = '"' + kv[0] + '"' + (kind === 'latin' ? '' : ', sans-serif'); }
      item.onclick = () => setFont(key, kv[0]);
      panel.appendChild(item);
    });
    $('#app').appendChild(panel);
    const r = anchor.getBoundingClientRect();
    panel.style.display = 'block'; panel.style.position = 'fixed';
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 230)) + 'px';
    panel.style.top = (r.bottom + 6) + 'px';
  }
  function hideFontPanel() { const p = $('#fontPanel'); if (p) { p.remove(); } }
  function bindFontDdls() {
    // Ribbon「开始」页签的三个字体下拉（Aa 西文 / 汉 中 / 字号→缩放档位）
    const ddls = $$('#rp-home .fddl');
    if (ddls.length >= 3) {
      ddls[0].style.cursor = 'pointer'; ddls[0].onclick = e => showFontPanel(e.target, 'latin');
      ddls[1].style.cursor = 'pointer'; ddls[1].onclick = e => showFontPanel(e.target, 'cjk');
      ddls[2].style.cursor = 'pointer'; ddls[2].onclick = e => showZoomPanel(e.target);
    }
  }

  // ================= F10 脚注插入 =================
  function insertFootnote() {
    if (!requireWysiwyg('插入脚注')) { return; }
    // 自动编号：取现有最大数字 id
    let max = 0;
    $$('#editor sup.md-fn, #editor .md-fn-def').forEach(n => {
      const id = n.getAttribute('data-fn');
      const num = parseInt(id, 10);
      if (!isNaN(num) && num > max) { max = num; }
    });
    const id = String(max + 1);
    const sup = document.createElement('sup');
    sup.className = 'md-fn'; sup.setAttribute('data-fn', id);
    sup.textContent = id;
    insertAtCaret(sup);
    // 文末追加定义块
    const def = document.createElement('div');
    def.className = 'md-fn-def'; def.setAttribute('data-fn', id);
    def.innerHTML = '<sup contenteditable="false">' + id + '</sup> ';
    editor.appendChild(def);
    placeCaret(def, true);
    scheduleSave();
    toast('脚注 ' + id + ' 已插入，定义已追加到文末');
  }

  // ================= UI-04 右键菜单 =================
  function buildCtxMenu() {
    const menu = document.createElement('div'); menu.id = 'ctxMenu';
    $('#app').appendChild(menu);
    editor.addEventListener('contextmenu', e => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY);
    });
    document.addEventListener('mousedown', e => {
      if (menu.style.display === 'block' && !menu.contains(e.target)) { menu.style.display = 'none'; }
    });
  }
  function openCtxMenu(x, y) {
    const menu = $('#ctxMenu');
    const sel = window.getSelection();
    const hasSel = sel && !sel.isCollapsed;
    const inTable = caretContext().inTable;
    const onImg = !!(closestTag && closestTag('img'));
    const items = [];
    if (hasSel) {
      items.push(['✂', '剪切', () => document.execCommand('cut')]);
      items.push(['⧉', '复制', () => document.execCommand('copy')]);
    }
    items.push(['📋', '粘贴（Ctrl+V）', () => toast('请直接按 Ctrl+V 粘贴')]);
    if (hasSel) { items.push(['📄', '复制为 Markdown 源码', copySelectionAsMd]); }
    items.push(null); // 分隔线
    items.push(['🔗', '插入链接', () => runCommand('link')]);
    items.push(['⊕', '插入脚注', () => insertFootnote()]);
    items.push(['🔍', '查找替换 (Ctrl+H)', () => runCommand('replace')]);
    if (inTable) {
      items.push(null);
      items.push(['↥', '上方插行', () => tableOp('rowAbove')]);
      items.push(['↧', '下方插行', () => tableOp('rowBelow')]);
      items.push(['✕', '删除行', () => tableOp('delRow')]);
    }
    if (onImg) {
      items.push(null);
      const img = closestTag('img');
      const ds = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
      if (/\.drawio\.(svg|png)$/i.test(ds)) {
        items.push(['⬡', lang === 'zh' ? '用 Draw.io 编辑（需 vscode-drawio 插件）' : 'Edit with Draw.io (requires vscode-drawio)', () => {
          vscode.postMessage({ type: 'openDrawio', rel: ds });
          toast(lang === 'zh' ? '已在并排编辑器打开（建议安装 vscode-drawio 扩展）' : 'Opened beside (vscode-drawio recommended)');
        }]);
      } else {
        items.push(['🖼', '图片：编辑链接（替换 src）', () => toast('选中图片后删除重插，或切源码模式修改路径')]);
      }
    }
    menu.innerHTML = '';
    items.forEach(it => {
      if (!it) {
        const sep = document.createElement('div'); sep.className = 'ctx-sep';
        menu.appendChild(sep); return;
      }
      const d = document.createElement('div');
      d.className = 'ctx-item';
      d.innerHTML = '<span class="ci">' + it[0] + '</span>' + it[1];
      d.onclick = () => { menu.style.display = 'none'; it[2](); };
      menu.appendChild(d);
    });
    menu.style.display = 'block'; menu.style.position = 'fixed';
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 40 * items.length - 20) + 'px';
  }
  // F10：公式 / 流程图 源码编辑对话框（textarea）
  function editSourceDialog(title, src, onOk) {
    dialog(title,
      '<div class="frow" style="align-items:stretch"><label style="align-self:flex-start;padding-top:6px">源码</label>' +
      '<textarea data-field="src" style="flex:1;min-height:130px;border:1px solid var(--vscode-input-border,#cbd5e1);border-radius:6px;padding:8px;background:var(--vscode-input-background,#fff);color:var(--vscode-input-foreground,inherit);font-family:Consolas,monospace;font-size:12.5px;outline:none;resize:vertical"></textarea></div>',
      [
        { text: T('cancel'), closeOnly: true },
        { text: T('ok'), primary: true, validate: v => !!String(v.src || '').trim() }
      ]
    ).then(v => {
      if (v && onOk) { onOk(String(v.src).trim()); }
    });
    const ta = $('.dlg [data-field="src"]');
    if (ta) { ta.value = src || ''; ta.focus(); }
  }

  function copySelectionAsMd() {    const b = topBlock();
    if (!b) { return; }
    const holder = document.createElement('div');
    holder.appendChild(b.cloneNode(true));
    const md = MD.blocksToMd(MD.domToBlocks(holder));
    try {
      navigator.clipboard.writeText(md);
      toast('已复制 Markdown 源码');
    } catch (e) { toast('复制失败，请手动选择'); }
  }

  // ================= F14 大纲联动 =================
  function sendOutline() {
    const items = [];
    $$('#editor h1, #editor h2, #editor h3, #editor h4, #editor h5, #editor h6').forEach(h => {
      const text = h.textContent.trim();
      if (text) { items.push({ level: +h.tagName[1], text: text }); }
    });
    vscode.postMessage({ type: 'outline', items: items });
  }
  function gotoHeading(text) {
    const heads = $$('#editor h1, #editor h2, #editor h3, #editor h4, #editor h5, #editor h6');
    const target = heads.find(h => h.textContent.trim() === text);
    if (!target) { return; }
    try { target.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    target.style.transition = 'background .8s';
    const prev = target.style.background;
    target.style.background = 'rgba(250,204,21,.5)';
    setTimeout(() => { target.style.background = prev; }, 900);
    placeCaret(target, true);
  }

  // ================= F14 i18n（界面中英文，v1.3 需求） =================
  const STR = {
    'zh': {
      saved: '✓ 已保存', saving: '保存中…', pending: '未保存',
      cancel: '取消', ok: '确定', insert: '插入', apply: '应用', accept: '✅ 接受替换',
      retry: '🔄 重试', append: '✏️ 追加指令…', discard: '✕ 放弃',
      find: '查找（支持正则）', replaceWith: '替换为', replace: '替换', replaceAllT: '全部',
      aiMenuTitle: '✨ AI 助手', aiDiffTitle: '✨ AI 结果预览', aiStreaming: '生成中…',
      aiAccept: '✅ 接受', aiLogin: '未检测到 GitHub Copilot 登录（或 LM API 不可用）。请在 VS Code 中登录 Copilot 后重试。',
      aiDisabled: 'AI 已在设置中关闭（markdownWord.ai.enabled）',
      words: '字', page: '📄', grpBasic: '基础块', grpList: '列表', grpMedia: '媒体与插入', grpAI: '✨ AI 助手（Copilot）',
      ctxCut: '剪切', ctxCopy: '复制', ctxPaste: '粘贴（Ctrl+V）', ctxCopyMd: '复制为 Markdown 源码',
      ctxLink: '插入链接', ctxFn: '插入脚注', ctxFind: '查找替换 (Ctrl+H)',
      fnSaved: '脚注 {n} 已插入，定义已追加到文末', copied: '已复制 Markdown 源码',
      tocEmpty: '文档中尚无标题，无法生成目录', tocDone: '已按标题生成目录（{n} 项）',
      pdfHint: '已生成打印就绪页面并在浏览器打开：按 Ctrl+P → 目标选择“另存为 PDF”',
      langName: '中文', exportPdfOpen: '导出 PDF（打印）',
      editMath: '编辑公式（LaTeX）', editMermaid: '编辑流程图（Mermaid 子集：graph TD/LR）',
      drawioCreated: '已创建 {f} 并插入引用：右键图片 →「用 Draw.io 编辑」',
      drawioFailed: 'Draw.io 文件创建失败：{e}', openOutline: '已打开侧栏大纲视图（活动栏 🗂）'
    },
    'en': {
      saved: '✓ Saved', saving: 'Saving…', pending: 'Unsaved',
      cancel: 'Cancel', ok: 'OK', insert: 'Insert', apply: 'Apply', accept: '✅ Accept',
      retry: '🔄 Retry', append: '✏️ Follow-up…', discard: '✕ Discard',
      find: 'Find (regex supported)', replaceWith: 'Replace with', replace: 'Replace', replaceAllT: 'All',
      aiMenuTitle: '✨ AI Assistant', aiDiffTitle: '✨ AI Preview', aiStreaming: 'Generating…',
      aiAccept: '✅ Accept', aiLogin: 'GitHub Copilot not signed in (or LM API unavailable). Sign in to Copilot in VS Code and retry.',
      aiDisabled: 'AI is disabled in settings (markdownWord.ai.enabled)',
      words: 'words', page: '📄', grpBasic: 'Basic blocks', grpList: 'Lists', grpMedia: 'Media & Insert', grpAI: '✨ AI (Copilot)',
      ctxCut: 'Cut', ctxCopy: 'Copy', ctxPaste: 'Paste (Ctrl+V)', ctxCopyMd: 'Copy as Markdown source',
      ctxLink: 'Insert link', ctxFn: 'Insert footnote', ctxFind: 'Find & Replace (Ctrl+H)',
      fnSaved: 'Footnote {n} inserted, definition appended at end', copied: 'Markdown copied',
      tocEmpty: 'No headings found to build TOC', tocDone: 'TOC generated ({n} items)',
      pdfHint: 'Print-ready page opened in browser: press Ctrl+P → “Save as PDF”',
      langName: 'English', exportPdfOpen: 'Export PDF (print)',
      editMath: 'Edit formula (LaTeX)', editMermaid: 'Edit diagram (Mermaid subset: graph TD/LR)',
      drawioCreated: 'Created {f} and inserted a reference: right-click the image → "Edit with Draw.io"',
      drawioFailed: 'Failed to create Draw.io file: {e}', openOutline: 'Outline view opened (activity bar 🗂)'
    }
  };
  let lang = 'zh';
  function T(key) {
    const t = STR[lang] || STR.zh;
    return t[key] !== undefined ? t[key] : (STR.zh[key] !== undefined ? STR.zh[key] : key);
  }
  function applyLanguage() {
    const pref = (settings.ui && settings.ui.language) || 'auto';
    if (pref === 'zh-CN') { lang = 'zh'; }
    else if (pref === 'en') { lang = 'en'; }
    else { lang = ((navigator.language || 'zh').toLowerCase().indexOf('en') === 0) ? 'en' : 'zh'; }
    $('#sbLang') && ($('#sbLang').textContent = '🌐 ' + T('langName'));
  }
  function cycleLanguage() {
    const next = lang === 'zh' ? 'en' : 'zh-CN';
    settings.ui = settings.ui || {};
    settings.ui.language = next;
    applyLanguage();
    vscode.postMessage({ type: 'saveSetting', section: 'ui', key: 'language', value: next });
    toast('UI language: ' + T('langName'));
  }

  // ================= F15 AI 助手（GitHub Copilot · 宿主转发） =================
  let aiState = { id: 0, open: false, cmd: '', origText: '', result: '', range: null, mode: '', busy: false, instruction: '' };
  function aiAvailable() { return settings.ai ? settings.ai.enabled !== false : true; }
  function aiRequest(cmd, text, instruction) {
    const id = 'ai' + (++aiState.id);
    aiState = { id: id, open: true, cmd: cmd, origText: text || '', result: '', range: null, mode: cmd === 'outline' || cmd === 'continue' ? 'insert' : 'replace', busy: true, instruction: instruction || '' };
    openAiCard();
    vscode.postMessage({ type: 'ai', id: id, cmd: cmd, text: text || '', instruction: instruction || '' });
  }
  function openAiCard() {
    let card = $('#aiCard');
    if (!card) {
      card = document.createElement('div'); card.id = 'aiCard';
      card.innerHTML = [
        '<div class="ai-h"><span class="ai-title"></span><span class="ai-meta"></span><span style="flex:1"></span><span class="ai-stop" title="关闭">✕</span></div>',
        '<div class="ai-body"><div class="ai-orig"></div><div class="ai-result"></div></div>',
        '<div class="ai-foot">',
        '<input class="ai-instr" placeholder="自定义指令（回车发送 / 追加要求）">',
        '<button class="btn ai-act" data-a="discard"></button>',
        '<button class="btn ai-act" data-a="append"></button>',
        '<button class="btn ai-act" data-a="retry"></button>',
        '<button class="btn pri ai-act" data-a="accept"></button>',
        '</div>'
      ].join('');
      $('#app').appendChild(card);
      card.querySelector('.ai-stop').onclick = () => { card.style.display = 'none'; aiState.open = false; };
      card.querySelectorAll('.ai-act').forEach(b => {
        b.onclick = () => {
          const a = b.dataset.a;
          if (a === 'discard') { card.style.display = 'none'; aiState.open = false; return; }
          if (a === 'retry') { return aiRequest(aiState.cmd, aiState.origText, aiState.instruction); }
          if (a === 'append') {
            const v = card.querySelector('.ai-instr').value.trim();
            if (!v) { return; }
            return aiRequest('custom', aiState.origText, aiState.instruction ? aiState.instruction + '；' + v : v);
          }
          if (a === 'accept') { acceptAi(); }
        };
      });
      card.querySelector('.ai-instr').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = e.target.value.trim();
          if (v) { aiRequest('custom', aiState.origText, aiState.instruction ? aiState.instruction + '；' + v : v); }
        }
      });
      card.addEventListener('mousedown', e => { if (!e.target.closest('input,button')) { e.preventDefault(); } });
    }
    card.style.display = 'block';
    card.querySelector('.ai-title').textContent = T('aiDiffTitle');
    card.querySelector('.ai-meta').textContent = T('aiStreaming');
    card.querySelector('.ai-orig').textContent = aiState.origText || '';
    card.querySelector('.ai-result').textContent = '';
    card.querySelector('.ai-instr').value = aiState.instruction || '';
    const btns = card.querySelectorAll('.ai-act');
    btns.forEach(b => { b.disabled = true; });
    btns[0].textContent = T('discard'); btns[1].textContent = T('append'); btns[2].textContent = T('retry'); btns[3].textContent = T('aiAccept');
  }
  function paintAiChunk() {
    const card = $('#aiCard');
    if (!card) { return; }
    card.querySelector('.ai-result').textContent = aiState.result;
    card.querySelector('.ai-body').scrollTop = 1e6;
  }
  function acceptAi() {
    const card = $('#aiCard');
    card.style.display = 'none';
    aiState.open = false;
    if (aiState.mode === 'insert') {
      // outline / continue：直接插入结果（大纲逐行 ### 解析为块）
      const lines = aiState.result.trim().split('\n').filter(l => l.trim());
      if (aiState.cmd === 'outline') {
        const frag = MD.blocksToDom(MD.parse(lines.join('\n')));
        insertNodesAtCaret(frag);
      } else {
        const frag = MD.blocksToDom(MD.parse(aiState.result.trim()));
        insertNodesAtCaret(frag);
      }
      scheduleSave();
      return;
    }
    // replace：替换保存的选区 range
    const r = aiState.range;
    if (r) {
      try {
        r.deleteContents();
        const frag = MD.blocksToDom(MD.parse(aiState.result.trim()));
        const nodes = [];
        Array.prototype.forEach.call(frag.childNodes, n => nodes.push(n));
        nodes.forEach(n => r.insertNode(n));
      } catch (e) {
        insertNodesAtCaret(MD.blocksToDom(MD.parse(aiState.result.trim())));
      }
      scheduleSave();
    }
  }
  function aiSelectionAction(cmd) {
    if (!aiAvailable()) { toast(T('aiDisabled')); return; }
    if (cmd === 'custom') {
      const v = prompt2(T('aiMenuTitle'), 'instruction');
      return v.then ? v.then(x => { if (x && x.instruction) { startSelAi('custom', x.instruction); } }) : null;
    }
    startSelAi(cmd, '');
  }
  function startSelAi(cmd, instruction) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { toast(lang === 'zh' ? '请先选中要处理的文字' : 'Select text first'); return; }
    const r = sel.getRangeAt(0).cloneRange();
    const text = sel.toString();
    aiRequest(cmd, text, instruction);
    aiState.range = r; // aiRequest 内部会重建 aiState，选区在请求发出后挂回
  }
  function prompt2(title, field) {
    return dialog(title, '<div class="frow"><label>' + (lang === 'zh' ? '指令' : 'Instruction') + '</label><input data-field="' + field + '" placeholder="' + (lang === 'zh' ? '如：更正式一点' : 'e.g. more formal') + '"></div>', [
      { text: T('cancel'), closeOnly: true },
      { text: T('ok'), primary: true, validate: v => !!(v && v[field] && v[field].trim()) }
    ]).then(v => v);
  }
  function buildAiMenu() {
    const bar = document.createElement('div'); bar.id = 'aiMenu';
    [['rewrite', lang === 'zh' ? '✨ 改写' : '✨ Rewrite'],
     ['polish', lang === 'zh' ? '润色' : 'Polish'],
     ['expand', lang === 'zh' ? '扩写' : 'Expand'],
     ['shorten', lang === 'zh' ? '缩写' : 'Shorten'],
     ['translate_zh', lang === 'zh' ? '译为中文' : '→ 中文'],
     ['translate_en', lang === 'zh' ? '译为英文' : '→ English'],
     ['fix', lang === 'zh' ? '修正错别字' : 'Fix typos'],
     ['custom', lang === 'zh' ? '自定义指令…' : 'Custom…']
    ].forEach(function (kv) {
      const d = document.createElement('div'); d.className = 'ctx-item'; d.dataset.ai = kv[0];
      d.textContent = kv[1];
      d.onclick = () => { bar.style.display = 'none'; aiSelectionAction(kv[0]); };
      bar.appendChild(d);
    });
    bar.addEventListener('mousedown', e => e.preventDefault());
    $('#app').appendChild(bar);
    document.addEventListener('mousedown', e => {
      if (bar.style.display === 'block' && !bar.contains(e.target)) { bar.style.display = 'none'; }
    });
  }
  function showAiMenu(anchor) {
    if (!aiAvailable()) { toast(T('aiDisabled')); return; }
    const bar = $('#aiMenu');
    bar.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    bar.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
    bar.style.top = (r.bottom + 6) + 'px';
  }

  // ================= F14 面包屑（标题路径） =================
  function buildCrumb() {
    const c = document.createElement('div'); c.id = 'crumb';
    $('#editorWrap').insertBefore(c, $('#editor'));
  }
  function updateCrumb() {
    const c = $('#crumb');
    if (!c) { return; }
    if (mode !== 'wysiwyg') { c.style.display = 'none'; return; }
    c.style.display = 'flex';
    // 当前块之前（含所在标题）的标题链：遍历块维护层级栈，到达当前块时栈即路径
    const cur = topBlock();
    const stack = [];
    const kids = editor.children || [];
    for (let k = 0; k < kids.length; k++) {
      const el = kids[k];
      if (el.tagName && /^H[1-6]$/.test(el.tagName)) {
        const lv = +el.tagName[1];
        while (stack.length && stack[stack.length - 1].level >= lv) { stack.pop(); }
        stack.push({ level: lv, el: el });
      }
      if (el === cur) { break; }
    }
    if (!stack.length) {
      const h1 = $('#editor h1');
      c.innerHTML = h1 ? '<span class="crumb-item">' + MD.escapeHtml(h1.textContent.trim()) + '</span>' : '';
      return;
    }
    c.innerHTML = '';
    stack.forEach((it, i) => {
      if (i) { const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; c.appendChild(sep); }
      const item = document.createElement('span'); item.className = 'crumb-item'; item.textContent = it.el.textContent.trim();
      item.onclick = () => { placeCaret(it.el, true); try { it.el.scrollIntoView({ block: 'center' }); } catch (e) { /* */ } };
      c.appendChild(item);
    });
  }

  // ================= F13 PDF：打印就绪 HTML + 外部浏览器 =================
  function exportPdf() {
    const bodyHtml = MD.blocksToHtml(MD.parse(currentText()));
    const html = [
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
      '<title>' + MD.escapeHtml((settings.docName || 'document') + '.pdf') + '</title>',
      '<style>@page{margin:18mm 16mm}body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#111;line-height:1.7;font-size:12pt}',
      'h1{border-bottom:1px solid #ccc;padding-bottom:6px}pre{background:#f6f8fa;padding:10px;border-radius:6px;overflow-x:hidden;white-space:pre-wrap}code{font-family:Consolas,monospace;font-size:.9em}',
      'table{border-collapse:collapse}th,td{border:1px solid #999;padding:5px 10px}th{background:#f2f2f2}',
      'blockquote{border-left:3px solid #888;margin:10px 0;padding:4px 12px;color:#444}img{max-width:100%}',
      '.hljs-kw{color:#7c3aed}.hljs-str{color:#15803d}.hljs-num{color:#c2410c}.hljs-cm{color:#888;font-style:italic}.hljs-type{color:#1d4ed8}',
      '</style></head><body>', bodyHtml, '</body></html>'
    ].join('\n');
    vscode.postMessage({ type: 'saveFile', name: (settings.docName || 'document') + '.print.html', content: html });
    setTimeout(() => {
      vscode.postMessage({ type: 'openExternal', name: (settings.docName || 'document') + '.print.html' });
      toast(T('pdfHint'));
    }, 600);
  }

  // ================= F02 选区级字体（行内 span 持久化） =================
  function applyFontToSelection() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { return false; }
    const e = settings.editor || {};
    const stack = [e.fontFamilyLatin, e.fontFamilyCJK].filter(Boolean).map(f => '"' + f + '"');
    if (!stack.length) { toast(lang === 'zh' ? '请先选择字体' : 'Choose a font first'); return false; }
    const span = document.createElement('span');
    span.setAttribute('style', 'font-family:' + stack.join(', '));
    try { sel.getRangeAt(0).surroundContents(span); }
    catch (err) {
      const r = sel.getRangeAt(0);
      const frag = r.extractContents();
      span.appendChild(frag);
      r.insertNode(span);
    }
    scheduleSave();
    toast(lang === 'zh' ? '字体已应用于选中文字（随文档保存）' : 'Font applied to selection (persisted)');
    return true;
  }

  // ================= 命令分发 =================
  function runCommand(cmd) {
    editor.focus();
    switch (cmd) {
      case 'bold': execSimple('bold'); break;
      case 'italic': execSimple('italic'); break;
      case 'underline': execSimple('underline'); break;
      case 'strike': execSimple('strikeThrough'); break;
      case 'highlight': toggleWrap('mark'); break;
      case 'incode': toggleWrap('code'); break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': setBlockType(cmd); break;
      case 'p': setBlockType('p'); break;
      case 'quote': setBlockType('quote'); break;
      case 'hr': insertHR(); break;
      case 'ul': case 'ol': case 'task': {
        const b = topBlock();
        const t = b ? b.tagName.toLowerCase() : '';
        const ordered = cmd === 'ol';
        if ((t === 'ul' && !ordered) || (t === 'ol' && ordered) || (cmd === 'task' && t === 'ul')) {
          // 再点同类型列表 → 转回段落
          if (b) { listToParas(b); }
        } else { toggleList(ordered, cmd === 'task'); }
        break;
      }
      case 'codeblock': insertCodeBlock(); break;
      case 'math': case 'insertMath': insertMathBlock(); break;
      case 'mermaid': case 'insertMermaid': insertMermaidBlock(); break;
      case 'drawio': case 'insertDrawio': insertDrawioRef(); break;
      case 'outline': case 'showOutline': vscode.postMessage({ type: 'showOutline' }); toast(T('openOutline')); break;
      case 'table': {
        const btn = $('.rtab[data-panel="rp-ins"]');
        showTablePicker(btn || editorWrap);
        break;
      }
      case 'image': openImageDialog(); break;
      case 'link': openLinkDialog(); break;
      case 'datetime': insertDatetime(); break;
      case 'emoji': showEmojiPanel($('.rbtn[data-cmd="emoji"]') || editorWrap); break;
      case 'mWysiwyg': setMode('wysiwyg'); break;
      case 'mSource': setMode('source'); break;
      case 'mSplit': setMode('split'); break;
      case 'zoomIn': zoomFont(1); break;
      case 'zoomOut': zoomFont(-1); break;
      case 'pageSetup': showPagePanel($('.rbtn[data-cmd="pageSetup"]') || editorWrap); break;
      case 'cycleLang': cycleLanguage(); break;
      case 'find': openFind(false); break;
      case 'replace': openFind(true); break;
      case 'exportHtml': exportHtml(); break;
      case 'exportPdf': exportPdf(); break;
      case 'toc': case 'insertTOC': insertTOC(); break;
      case 'panelInfo': insertPanel('info'); break;
      case 'panelTip': insertPanel('tip'); break;
      case 'panelWarning': insertPanel('warning'); break;
      case 'panelError': insertPanel('error'); break;
      case 'footnote': case 'insertFootnote': insertFootnote(); break;
      case 'aiOutline': {
        hideSlashMenu();
        if (!aiAvailable()) { toast(T('aiDisabled')); break; }
        const b = topBlock();
        const ctxText = b ? (b.tagName === 'H1' || b.tagName === 'H2' || b.tagName === 'H3' ? b.textContent : '') : '';
        const prevHead = $$('#editor h1,#editor h2,#editor h3').map(h => h.textContent).join(' > ');
        aiState.range = null;
        aiRequest('outline', (ctxText ? '本节标题：' + ctxText + '\n' : '') + '文档标题脉络：' + (prevHead || '（空）') + '\n\n本节现有正文：' + (b ? b.textContent.slice(0, 500) : ''), '');
        break;
      }
      case 'aiContinue': {
        hideSlashMenu();
        if (!aiAvailable()) { toast(T('aiDisabled')); break; }
        const b = topBlock();
        aiState.range = null;
        aiRequest('continue', (b ? b.textContent : '') || '', '');
        break;
      }
      case 'undo': execSimple('undo'); break;
      case 'redo': execSimple('redo'); break;
      case 'toggleMode': setMode(mode === 'wysiwyg' ? 'source' : mode === 'source' ? 'split' : 'wysiwyg'); break;
      case 'paste': toast('请直接使用 Ctrl+V 粘贴（浏览器安全策略不允许程序化粘贴）'); break;
      default:
        if (['rowAbove', 'rowBelow', 'delRow', 'colLeft', 'colRight', 'delCol',
          'alLeft', 'alCenter', 'alRight', 'toggleHead', 'delTable',
          'rowUp', 'rowDown', 'colMoveL', 'colMoveR'].indexOf(cmd) !== -1) { tableOp(cmd); }
        break;
    }
  }

  // ================= F17 缩放全局记忆（issue #2） =================
  // 三模式统一缩放 + 全局用户级持久化（跨文档/跨项目/重启记忆）+ 宿主广播实时跟随
  let zoom = 100;
  const ZOOM_LEVELS = [75, 90, 100, 110, 125, 150, 175, 200];
  function applyZoom(v) {
    zoom = Math.min(200, Math.max(75, Math.round(+v || 100)));
    // 所见即所得与分屏预览 15px 基准、源码 textarea 14px 基准，等比缩放
    editor.style.fontSize = (15 * zoom / 100).toFixed(1) + 'px';
    srcTextarea.style.fontSize = (14 * zoom / 100).toFixed(1) + 'px';
    const pv = $('.pv-inner'); if (pv) { pv.style.fontSize = (15 * zoom / 100).toFixed(1) + 'px'; }
    $$('.fddl').forEach(f => { if (f.textContent.indexOf('%') !== -1) { f.textContent = zoom + '%'; } });
    if (zoomSizeDdl) { zoomSizeDdl.textContent = (15 * zoom / 100).toFixed(1).replace(/\.0$/, '') + ' ▾'; }
  }
  function setZoom(v) {
    const before = zoom;
    applyZoom(v);
    if (zoom !== before) {
      // 全局用户级持久化；宿主经 onDidChangeConfiguration 广播 zoomChanged 到其他已打开文档
      vscode.postMessage({ type: 'saveSetting', section: 'view', key: 'zoom', value: zoom, global: true });
    }
  }
  function zoomFont(d) { setZoom(zoom + d * 10); }
  function showZoomPanel(anchor) {
    hideZoomPanel();
    const panel = document.createElement('div'); panel.id = 'zoomPanel';
    ZOOM_LEVELS.forEach(function (lv) {
      const item = document.createElement('div');
      item.className = 'fitem' + (lv === zoom ? ' on' : '');
      item.textContent = (lv === zoom ? '✓ ' : '') + lv + '%';
      item.onclick = () => { setZoom(lv); hideZoomPanel(); };
      panel.appendChild(item);
    });
    $('#app').appendChild(panel);
    const r = anchor.getBoundingClientRect();
    panel.style.display = 'block'; panel.style.position = 'fixed';
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 230)) + 'px';
    panel.style.top = (r.bottom + 6) + 'px';
  }
  function hideZoomPanel() { const p = $('#zoomPanel'); if (p) { p.remove(); } }

  // ================= 键盘：速记 / Tab / Enter / Backspace / 快捷键 =================
  function onKeydown(e) {
    if (mode !== 'wysiwyg') {
      if (e.key === 'Tab' && document.activeElement === srcTextarea) {
        e.preventDefault();
        insertAtTextarea(srcTextarea, '  ');
      }
      return;
    }
    // 斜杠菜单导航
    if (slashState.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); slashState.active = Math.min(slashState.active + 1, slashState.items.length - 1); highlightSlash(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); slashState.active = Math.max(slashState.active - 1, 0); highlightSlash(); return; }
      if (e.key === 'Enter') { e.preventDefault(); const li = slashState.items[slashState.active]; if (li) { execSlashItem(li.dataset.cmd); } return; }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashMenu(); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const map = { b: 'bold', i: 'italic', k: 'link', z: 'undo', y: 'redo', u: 'underline', f: 'find', h: 'replace' };
      if (map[e.key.toLowerCase()]) { e.preventDefault(); return runCommand(map[e.key.toLowerCase()]); }
      if (/^[1-6]$/.test(e.key)) { e.preventDefault(); return setBlockType('h' + e.key); }
    }
    if (mod && e.shiftKey) {
      // Shift 按下时 e.key 为大写/符号（如 Shift+8 → '*'），字母统一小写匹配，数字用 e.code 兜底
      const k = e.key.toLowerCase();
      const map = { s: 'strike', k: 'codeblock', q: 'quote' };
      const digitCmd = e.code && { Digit7: 'ol', Digit8: 'ul', Digit9: 'task' }[e.code];
      const cmd = map[k] || digitCmd;
      if (cmd) { e.preventDefault(); return runCommand(cmd); }
    }
    if (mod && e.altKey) {
      if (e.key.toLowerCase() === 't') { e.preventDefault(); return runCommand('table'); }
      if (e.key.toLowerCase() === 'v') { e.preventDefault(); return runCommand('toggleMode'); }
    }

    const ctx = caretContext();
    // Tab：表格导航 / 代码缩进 / 列表缩进
    if (e.key === 'Tab') {
      e.preventDefault();
      if (ctx.inTable) { return tableTab(e.shiftKey); }
      if (ctx.inPre) { return insertAtCaret(document.createTextNode('  ')); }
      const li = closestTag('li');
      if (li) { return e.shiftKey ? outdentListItem(li) : indentListItem(li); }
      return;
    }
    // Enter：代码块内统一插入换行符（浏览器默认可能插 <br>，序列化会丢失）
    if (e.key === 'Enter' && ctx.inPre) {
      e.preventDefault();
      return insertAtCaret(document.createTextNode('\n'));
    }
    // Shift+Enter 在标题 / 表格单元格会破坏块结构（br → \n 拆块），拦截为普通空格
    if (e.key === 'Enter' && e.shiftKey) {
      const sb = topBlock();
      const inHeading = sb && /^H[1-6]$/.test(sb.tagName);
      if (ctx.inTable || inHeading) {
        e.preventDefault();
        return insertAtCaret(document.createTextNode(' '));
      }
    }
    // Enter：空任务/列表项退出；表格内跳行
    if (e.key === 'Enter' && !e.shiftKey) {
      if (ctx.inTable) { e.preventDefault(); return tableEnter(); }
      const li = closestTag('li');
      if (li) {
        const body = li.querySelector('.li-body');
        const isEmpty = body ? !body.textContent.trim() : !li.textContent.trim();
        if (isEmpty && !li.querySelector('ul,ol')) {
          e.preventDefault();
          const p = document.createElement('p'); p.innerHTML = '<br>';
          const list = closestTag('ul') || closestTag('ol');
          list.after(p); li.remove();
          if (!list.children.length) { list.remove(); }
          placeCaret(p, false);
          return scheduleSave();
        }
        if (isEmpty && li.querySelector('ul,ol')) { e.preventDefault(); return; }
        // 浏览器默认续项后：任务列表延续勾选框（新 li 不带 md-task 结构）
        setTimeout(() => {
          const cur = closestTag('li');
          if (cur && !cur.classList.contains('md-task')) {
            const prev = cur.previousElementSibling;
            if (prev && prev.tagName === 'LI' && prev.classList.contains('md-task')) {
              cur.classList.add('md-task');
              cur.setAttribute('data-checked', 'false');
              cur.insertBefore(checkSpan(false), cur.firstChild);
            }
          }
        }, 0);
      }
      return; // 默认行为（浏览器在 li 内续项）
    }
    // Backspace：行首空项转段落（嵌套列表内的 p 不能留在 ul 里，否则序列化时被静默丢弃）
    if (e.key === 'Backspace') {
      const li = closestTag('li');
      if (li) {
        const body = li.querySelector('.li-body');
        const isEmpty = body ? !body.textContent.trim() : !li.textContent.trim();
        const caretAtStart = caretAtLiStart();
        if (isEmpty && !li.querySelector('ul,ol')) {
          e.preventDefault();
          const p = document.createElement('p'); p.innerHTML = '<br>';
          const list = li.parentElement;
          if (list.parentElement === editor) {
            li.replaceWith(p);
          } else {
            list.after(p); li.remove();
            if (!list.children.length) { list.remove(); }
          }
          placeCaret(p, false);
          return scheduleSave();
        }
        if (caretAtStart) { e.preventDefault(); return outdentListItem(li); }
      }
      return;
    }
    // 空格：速记输入（# / > / - / 1. / [] / - [ ]）
    if (e.key === ' ' && !mod) {
      const sel = window.getSelection();
      if (sel.rangeCount && sel.isCollapsed && sel.anchorNode && sel.anchorNode.nodeType === 3) {
        const before = sel.anchorNode.textContent.slice(0, sel.anchorOffset);
        const b = topBlock();
        if (b && b.textContent === before) {
          const m = before.match(/^(#{1,6}|>|[-*+]|1\.|\[\]|\[ \]|- \[ \]|- \[x\])$/i);
          if (m) {
            e.preventDefault();
            if (/^#/.test(m[1])) { b.innerHTML = ''; return setBlockType('h' + m[1].length); }
            if (m[1] === '>') { b.innerHTML = ''; return setBlockType('quote'); }
            if (m[1] === '[]' || m[1] === '[ ]' || /^- \[ \]$/i.test(m[1])) { b.innerHTML = ''; return buildListAt(b, false, true); }
            if (/^-/.test(m[1])) { b.innerHTML = ''; return buildListAt(b, false, false); }
            if (m[1] === '1.') { b.innerHTML = ''; return buildListAt(b, true, false); }
          }
        }
      }
    }
  }
  function caretAtLiStart() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) { return false; }
    const node = sel.anchorNode;
    if (node.nodeType !== 3) { return false; }
    return sel.anchorOffset === 0 && !node.previousSibling;
  }
  function insertAtTextarea(ta, text) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function indentListItem(li) {
    const prev = li.previousElementSibling;
    if (!prev || prev.tagName !== 'LI') { return; }
    let sub = prev.querySelector(':scope > ul, :scope > ol');
    if (!sub) {
      sub = document.createElement(li.parentElement.tagName.toLowerCase());
      prev.appendChild(sub);
    }
    sub.appendChild(li);
    scheduleSave();
  }
  function outdentListItem(li) {
    const sub = li.parentElement;
    const outerLi = sub ? sub.parentElement : null;
    if (!outerLi || outerLi.tagName !== 'LI') {
      // 顶层列表 → 转段落
      const p = document.createElement('p');
      const body = li.querySelector('.li-body');
      p.innerHTML = body ? body.innerHTML : li.innerHTML;
      const list = sub;
      if (li.nextElementSibling || li.previousElementSibling) { list.after(p); }
      else { list.replaceWith(p); return scheduleSave(); }
      li.remove();
      if (!list.children.length) { list.remove(); }
      placeCaret(p, true);
      return scheduleSave();
    }
    outerLi.after(li);
    scheduleSave();
  }

  // ================= 表格键盘导航 =================
  function tableTab(shift) {
    const cell = currentCell();
    if (!cell) { return; }
    const table = currentTable();
    const rows = table.querySelectorAll('tr');
    const r = Array.prototype.indexOf.call(rows, cell.parentElement);
    const c = cellIndex(cell);
    let nr = r, nc = c + (shift ? -1 : 1);
    if (nc >= cell.parentElement.children.length) { nc = 0; nr++; }
    if (nc < 0) { nr--; if (nr < 0) { return; } nc = rows[nr].children.length - 1; }
    if (nr >= rows.length) {
      // 末格 Tab：自动追加新行（Word 同款）
      tableOp('rowBelow');
      const rows2 = table.querySelectorAll('tr');
      placeCaret(rows2[rows2.length - 1].children[0], false);
      return;
    }
    placeCaret(rows[nr].children[nc] || rows[nr].children[0], false);
  }
  function tableEnter() {
    const cell = currentCell();
    if (!cell) { return; }
    const table = currentTable();
    const rows = table.querySelectorAll('tr');
    const r = Array.prototype.indexOf.call(rows, cell.parentElement);
    const c = cellIndex(cell);
    const nr = Math.min(r + 1, rows.length - 1);
    placeCaret(rows[nr].children[c] || rows[nr].children[0], false);
  }

  // ================= 图片：点击选中 + 拖拽缩放（F06） =================
  // 有 width 的图片序列化为 <img src width>（GitHub / VS Code 预览原生渲染），无 width 保持 ![alt](src)
  let selImg = null, imgDrag = null;
  const imgHandle = document.createElement('div'); imgHandle.id = 'imgHandle';
  // 对齐工具条：左 / 居中 / 右（段落内相对纸张，单元格内相对该单元格）
  const imgAlignBar = document.createElement('div'); imgAlignBar.id = 'imgAlignBar';
  imgAlignBar.innerHTML =
    '<button data-al="left" title="左对齐">⯇</button>' +
    '<button data-al="center" title="居中">≡</button>' +
    '<button data-al="right" title="右对齐">⯈</button>';

  function imgAlignOf(img) {
    if (img.classList.contains('md-img-l')) { return 'left'; }
    if (img.classList.contains('md-img-c')) { return 'center'; }
    if (img.classList.contains('md-img-r')) { return 'right'; }
    return '';
  }
  function setImgAlign(img, al) {
    img.classList.remove('md-img-l', 'md-img-c', 'md-img-r');
    if (al) { img.classList.add(al === 'left' ? 'md-img-l' : al === 'center' ? 'md-img-c' : 'md-img-r'); }
    img.setAttribute('align', al || ''); // 序列化读 align（空串=清除）
    scheduleSave();
    markAlignBtns();
    setTimeout(placeImgHandle, 0); // 布局变化后手柄/工具条跟随
  }
  function markAlignBtns() {
    const cur = selImg ? imgAlignOf(selImg) : '';
    $$('#imgAlignBar button').forEach(b => { b.classList.toggle('on', b.dataset.al === cur); });
  }
  function placeImgAlignBar() {
    if (!selImg) { imgAlignBar.style.display = 'none'; return; }
    const r = selImg.getBoundingClientRect();
    if (!r.width && !r.height) { imgAlignBar.style.display = 'none'; return; }
    imgAlignBar.style.display = 'flex';
    imgAlignBar.style.left = Math.max(8, Math.min(r.left + r.width / 2 - 53, window.innerWidth - 116)) + 'px';
    imgAlignBar.style.top = Math.max(8, r.top - 36) + 'px';
  }
  const placeImgBoth = () => { placeImgHandle(); placeImgAlignBar(); };

  function hideImgSel() {
    if (selImg) { selImg.classList.remove('md-imgsel'); }
    selImg = null;
    imgHandle.style.display = 'none';
    imgAlignBar.style.display = 'none';
  }
  function placeImgHandle() {
    if (!selImg) { return; }
    const r = selImg.getBoundingClientRect();
    if (!r.width && !r.height) { imgHandle.style.display = 'none'; imgAlignBar.style.display = 'none'; return; } // 隐藏（jsdom / display:none）
    imgHandle.style.display = 'block';
    imgHandle.style.left = (r.right - 5) + 'px';
    imgHandle.style.top = (r.bottom - 5) + 'px';
    placeImgAlignBar();
  }
  function initImageResize() {
    document.body.appendChild(imgHandle);
    document.body.appendChild(imgAlignBar);
    imgAlignBar.addEventListener('mousedown', e => e.preventDefault()); // 防止点击按钮夺走选区/图片选择态
    imgAlignBar.addEventListener('click', e => {
      const b = e.target.closest('button[data-al]');
      if (b && selImg) { setImgAlign(selImg, b.dataset.al); }
    });
    editorWrap.addEventListener('scroll', () => { if (selImg) { placeImgBoth(); } });
    editor.addEventListener('mousedown', e => {
      // 图片选择态不需要光标定位：阻止默认（防拖动时选区闪动）
      if (selImg) { e.preventDefault(); }
    });
    editor.addEventListener('click', e => {
      const img = e.target && e.target.closest ? e.target.closest('img') : null;
      if (img) {
        if (selImg === img) { hideImgSel(); return; } // 再点一次取消
        hideImgSel();
        selImg = img;
        img.classList.add('md-imgsel');
        markAlignBtns();
        placeImgHandle();
      } else if (selImg) {
        hideImgSel();
      }
    });
    imgHandle.addEventListener('mousedown', e => {
      if (!selImg) { return; }
      e.preventDefault(); e.stopPropagation();
      const startW = selImg.getBoundingClientRect().width || parseInt(selImg.getAttribute('width') || '0', 10) || 400;
      imgDrag = { x: e.clientX, w: Math.max(20, startW) };
    });
    document.addEventListener('mousemove', e => {
      if (!imgDrag || !selImg) { return; }
      const dx = e.clientX - imgDrag.x;
      const w = Math.max(40, Math.min(imgDrag.w + dx, 2400));
      selImg.style.width = w + 'px';
      selImg.style.height = 'auto';
      placeImgHandle();
    });
    document.addEventListener('mouseup', () => {
      if (imgDrag && selImg) {
        selImg.setAttribute('width', parseInt(selImg.style.width, 10));
        scheduleSave(); // 序列化：有 width → <img src width>
      }
      imgDrag = null;
    });
  }

  // ================= 粘贴（图片落盘 / md 源码渲染 / HTML 清洗） =================
  // 从剪贴板数据收集图片文件：① items 条目（截图 / 网页复制图像）；② files 列表
  // （文件管理器复制图片文件时 items 的 type 可能为空，须按 files 的 type/扩展名兜底）
  function collectImageFiles(cd) {
    const out = [];
    const items = (cd && cd.items) || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.kind !== 'string' && it.type && it.type.indexOf('image/') === 0) {
        const f = typeof it.getAsFile === 'function' ? it.getAsFile() : null;
        if (f) { out.push(f); }
      }
    }
    if (!out.length) {
      const files = (cd && cd.files) || [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f && (String(f.type || '').indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(String(f.name || '')))) { out.push(f); }
      }
    }
    return out;
  }
  function onPaste(e) {
    if (mode !== 'wysiwyg') { return; }
    const cd = e.clipboardData;
    if (!cd) { return; }
    const ctx = caretContext();
    // 图片（F06）：代码块内不允许（序列化不产生引用，会留下孤儿文件误导用户）
    const imgFiles = collectImageFiles(cd);
    if (imgFiles.length) {
      e.preventDefault();
      if (ctx.inPre) { toast('代码块内不能插入图片，请先移出代码块'); return; }
      imgFiles.forEach(sendImageFile);
      return;
    }
    const text = cd.getData('text/plain');
    const html = cd.getData('text/html');
    const mdLike = /(^|\n)\s*(#{1,6} |```|\|.*\||[-*+] \[|> |- |\d+\. )/.test(text);
    // 结构化上下文（单元格 / 列表项 / 代码块）内：粘贴统一为纯文本（块级 DOM 嵌进行内上下文会丢结构）
    if (ctx.inPre) {
      if (text) { e.preventDefault(); insertAtCaret(document.createTextNode(text)); }
      return;
    }
    if ((ctx.inTable || ctx.inLi) && text) {
      e.preventDefault();
      insertAtCaret(document.createTextNode(text.replace(/\s*\n+\s*/g, ' ')));
      return;
    }
    // Markdown 源码粘贴自动渲染（即使剪贴板同时带 HTML——如从 VS Code 原生编辑器复制）
    if (text && mdLike) {
      e.preventDefault();
      const frag = MD.blocksToDom(MD.parse(text));
      insertNodesAtCaret(frag);
      return;
    }
    if (html && !/^\s*$/.test(html)) {
      e.preventDefault();
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      // 智能粘贴增强（F11）：识别 Word 的 mso-list 段落并还原为列表
      tmp.querySelectorAll('p[style*="mso-list"]').forEach(p => {
        const lm = /mso-list:\s*l(\d+)(?:\s+level(\d+))?/.exec(p.getAttribute('style') || '');
        if (!lm) { return; }
        const level = Math.max(1, Math.min(3, parseInt(lm[2] || '1', 10)));
        const li = document.createElement('li');
        li.innerHTML = p.innerHTML;
        li.setAttribute('data-mdw-level', String(level));
        const ul = document.createElement('ul');
        ul.appendChild(li);
        p.replaceWith(ul);
      });
      // 清洗：去脚本样式与内联样式，去 data: 内嵌图
      tmp.querySelectorAll('script,style,meta,link').forEach(n => n.remove());
      // 合并连续的 Word 列表 ul 为嵌套结构（按 data-mdw-level）
      let listRoot = null; let listStack = [];
      Array.prototype.slice.call(tmp.children).forEach(el => {
        const li = el.tagName === 'UL' ? el.querySelector('li[data-mdw-level]') : null;
        if (!li) { listRoot = null; listStack = []; return; }
        const lvl = Math.max(1, +li.getAttribute('data-mdw-level') || 1);
        if (!listRoot) { listRoot = el; listStack = [{ lvl: 1, ul: el }]; li.removeAttribute('data-mdw-level'); return; }
        while (listStack.length > 1 && listStack[listStack.length - 1].lvl >= lvl) { listStack.pop(); }
        const top = listStack[listStack.length - 1];
        li.removeAttribute('data-mdw-level');
        if (lvl > top.lvl) {
          const sub = document.createElement('ul');
          (top.ul.lastElementChild || top.ul).appendChild(sub);
          sub.appendChild(li);
          listStack.push({ lvl: lvl, ul: sub });
        } else {
          top.ul.appendChild(li);
        }
        el.remove();
      });
      tmp.querySelectorAll('*').forEach(n => {
        n.removeAttribute('style'); n.removeAttribute('class'); n.removeAttribute('id');
        n.removeAttribute('data-mdw-level');
        if (n.tagName === 'IMG' && /^data:/.test(n.getAttribute('src') || '')) { n.replaceWith(document.createTextNode('[图片]')); }
      });
      const blocks = MD.domToBlocks(tmp);
      const frag = MD.blocksToDom(blocks);
      insertNodesAtCaret(frag);
      return;
    }
    if (text) {
      e.preventDefault();
      const lines = text.split(/\r?\n/);
      if (lines.length > 1) {
        insertNodesAtCaret(MD.blocksToDom(MD.parse(text)));
      } else {
        insertAtCaret(document.createTextNode(text.replace(/\s+$/, '')));
      }
    }
  }
  function insertNodesAtCaret(frag) {
    editor.focus();
    restoreSelIfNeeded();
    // 块级 fragment：与 insertBlockAtCaret 同语义（不能 range.insertNode 进段落内部）
    const b = topBlock();
    const sel = window.getSelection();
    if (b && b.tagName === 'P' && !b.textContent.trim()) {
      b.replaceWith(frag); // 空段落原位替换（fragment 展开保序）
    } else if (b) {
      b.after(frag); // 当前块之后（保序）
    } else if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(frag); // 块间隙按光标 offset（fragment 展开保序）
    } else {
      editor.appendChild(frag);
    }
    scheduleSave();
  }
  // 源码/分屏模式：textarea 内粘贴图片同样落盘（onImageSaved 已按模式分流——源码插 ![]() 语法）
  function onTextareaPaste(e) {
    const cd = e.clipboardData;
    if (!cd) { return; }
    const imgFiles = collectImageFiles(cd);
    if (imgFiles.length) {
      e.preventDefault();
      imgFiles.forEach(sendImageFile);
    }
  }

  function onDrop(e) {
    if (mode !== 'wysiwyg') { return; }
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length && files[0].type.indexOf('image/') === 0) {
      e.preventDefault();
      sendImageFile(files[0]);
    } else if (files && files.length && /\.(png|jpe?g|gif|webp|svg)$/i.test(files[0].name)) {
      e.preventDefault();
      sendImageFile(files[0]);
    }
  }

  // ================= 模式（F01） =================
  function setMode(m) {
    if (m === mode) { return; }
    if (mode === 'wysiwyg') { srcTextarea.value = serialize(); }
    else if (m === 'wysiwyg') { loadMarkdown(srcTextarea.value); }
    mode = m;
    // 用 classList 增删模式类：保留 VS Code 注入的主题类（vscode-dark 等），否则暗色主题判断与样式全部失效
    document.body.classList.remove('wysiwyg', 'source', 'split');
    document.body.classList.add(m);
    $('#sbMode').textContent = MODE_NAMES[m] + ' ▾';
    // Ribbon 视图按钮态
    $$('.rbtn').forEach(b => {
      const cmd = b.dataset.cmd;
      if (cmd === 'mWysiwyg' || cmd === 'mSource' || cmd === 'mSplit') {
        b.classList.toggle('on', cmd === 'm' + m.charAt(0).toUpperCase() + m.slice(1));
      }
    });
    if (m === 'split') { updatePreview(); srcTextarea.focus(); }
    if (m === 'source') { srcTextarea.focus(); }
    updateStatus();
  }
  function updatePreview() {
    $('.pv-inner').innerHTML = MD.blocksToHtml(MD.parse(srcTextarea.value));
    resolvePreviewImages();
  }
  function resolvePreviewImages() {
    const rels = [];
    $$('#preview img').forEach(img => {
      const ds = img.getAttribute('data-src');
      if (ds && !/^(https?:|data:)/.test(ds) && rels.indexOf(ds) === -1) { rels.push(ds); }
    });
    if (!rels.length) { return; }
    // 借用 imageMap：宿主不区分，直接复用 resolveImages
    vscode.postMessage({ type: 'resolveImages', paths: rels });
  }

  // ================= 状态栏 =================
  function updateStatus() {
    // 位置
    const b = mode === 'wysiwyg' ? topBlock() : null;
    if (b) {
      const idx = Array.prototype.indexOf.call(editor.children, b) + 1;
      const sel2 = window.getSelection();
      const col = (sel2 && sel2.anchorNode && sel2.anchorNode.nodeType === 3) ? sel2.anchorOffset + 1 : 1;
      $('#sbPos').textContent = '块 ' + idx + ' · 列 ' + col;
    } else {
      const ta = srcTextarea;
      const upto = ta.value.slice(0, ta.selectionStart).split('\n');
      $('#sbPos').textContent = '行 ' + upto.length + '，列 ' + (upto[upto.length - 1].length + 1);
    }
    // 字数
    let words;
    if (mode === 'wysiwyg') { words = editor.textContent.replace(/\s/g, '').length; }
    else { words = srcTextarea.value.replace(/\s/g, '').length; }
    $('#sbWords').textContent = words + ' 字';
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 2200);
  }

  // ================= 事件绑定 =================
  function bindEvents() {
    // Ribbon 命令（#ttBar 内按钮有独立监听，此处跳过避免双执行）
    document.addEventListener('click', e => {
      const btn = e.target.closest('.rbtn');
      if (!btn || !btn.dataset.cmd) { return; }
      if (btn.closest('#ttBar')) { return; }
      const cmd = btn.dataset.cmd;
      if (cmd === 'table') { showTablePicker(btn); return; }
      runCommand(cmd);
    });
    // 表格浮动工具条
    ttBar.addEventListener('click', e => {
      const btn = e.target.closest('.rbtn');
      if (btn && btn.dataset.cmd) { tableOp(btn.dataset.cmd); }
    });
    editor.addEventListener('input', () => {
      scheduleSave();
      setTimeout(checkSlashTrigger, 0);
    });
    editor.addEventListener('keydown', onKeydown);
    editor.addEventListener('paste', onPaste);
    editor.addEventListener('drop', onDrop);
    initImageResize(); // 图片点击选中 + 拖拽缩放（F06）
    editor.addEventListener('click', e => {
      const check = e.target.closest('.md-check');
      if (check) {
        e.preventDefault();
        const li = check.closest('li');
        const on = li.getAttribute('data-checked') !== 'true';
        li.setAttribute('data-checked', String(on));
        check.textContent = on ? '☑' : '☐';
        scheduleSave();
      }
      updateTableBar(); updateStatus();
    });
    // F10：双击公式 / 流程图 → 源码编辑对话框
    editor.addEventListener('dblclick', e => {
      const math = e.target.closest('.md-math');
      const mm = e.target.closest('.md-mermaid');
      if (math) {
        editSourceDialog(lang === 'zh' ? '编辑公式（LaTeX）' : 'Edit formula (LaTeX)', math.getAttribute('data-tex'), tex => {
          math.setAttribute('data-tex', tex);
          math.innerHTML = (typeof MdMath !== 'undefined') ? MdMath.render(tex) : MD.escapeHtml(tex);
          scheduleSave();
        });
      } else if (mm) {
        editSourceDialog(lang === 'zh' ? '编辑流程图（Mermaid 子集：graph TD/LR）' : 'Edit diagram (Mermaid subset)', mm.getAttribute('data-code'), code => {
          mm.setAttribute('data-code', code);
          const svg = (typeof MdMm !== 'undefined') ? MdMm.render(code) : null;
          mm.innerHTML = svg || ('<pre style="padding:10px;color:#b91c1c">无法渲染（不支持语法或格式错误），已保留源码</pre>');
          scheduleSave();
        });
      }
    });
    editor.addEventListener('keyup', updateStatus);
    document.addEventListener('selectionchange', () => {
      if (mode === 'wysiwyg') { updateTableBar(); updateFloatBar(); updateCrumb(); }
    });
    // 源码 / 分屏
    srcTextarea.addEventListener('paste', onTextareaPaste);
    srcTextarea.addEventListener('input', () => {
      scheduleSave();
      if (mode === 'split') {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(updatePreview, 300);
      }
    });
    srcTextarea.addEventListener('keyup', updateStatus);
    // 滚动同步（分屏）
    srcTextarea.addEventListener('scroll', () => {
      if (mode === 'split') { preview.scrollTop = srcTextarea.scrollTop; }
    });
    dlgMask.addEventListener('mousedown', e => { if (e.target === dlgMask) { dlgMask.style.display = 'none'; } });

    // 光标保持：记录编辑区选区 + 防止 Ribbon/弹层夺走选区（真实浏览器行为）
    trackSelection();
    guardLayersFromStealingSelection();

    // 源码模式：在 VS Code 原生编辑器中打开（Beside 并排，不替换本编辑器）
    const nativeBtn = $('#openNativeBtn');
    if (nativeBtn) { nativeBtn.onclick = () => vscode.postMessage({ type: 'openNative' }); }
  }

  // ================= 宿主消息 =================
  window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.type) {
      case 'init':
        settings = Object.assign(settings, msg.settings || {});
        if (!settings.page) { settings.page = { size: 'fit', customWidth: 794, background: 'auto', pattern: 'none' }; }
        if (!settings.editor) { settings.editor = {}; }
        applyLanguage();
        applyPageSettings();
        applyFontVars();
        applyZoom((settings.view && settings.view.zoom) || 100); // F17：应用全局记忆的缩放（不回写）
        loadMarkdown(msg.text || '');
        sendOutline();
        setMode(settings.defaultMode === 'source' || settings.defaultMode === 'split' ? settings.defaultMode : 'wysiwyg');
        if (settings.defaultMode === 'wysiwyg') { placeCaret(editor, false); }
        setSaveState('saved');
        break;
      case 'saved':
        setSaveState('saved');
        if (externalStale) {
          externalStale = false;
          toast('⚠ 文件曾在外部被修改，本次保存以本地内容为准（如需找回外部改动请用源码模式查看历史）');
        }
        break;
      case 'externalChange':
        if (Date.now() - lastLocalEdit < 2500) {
          // 本端刚有编辑：不能立即重载（会打断输入并丢本地改动），但必须记住——
          // 否则下一次全量保存会静默覆盖外部修改
          externalStale = true;
          return;
        }
        if (mode === 'wysiwyg') { loadMarkdown(msg.text || ''); }
        else { srcTextarea.value = msg.text || ''; if (mode === 'split') { updatePreview(); } }
        toast('文档已在外部修改，已重新加载');
        setSaveState('saved');
        break;
      case 'imageSaved': onImageSaved(msg); break;
      case 'drawioInserted': {
        // 宿主已创建 .drawio.svg 模板 → 与粘贴图片同路径插入（源码模式写 textarea，页面模式插入 img）
        if (msg.error) { toast(T('drawioFailed').replace('{e}', msg.error)); break; }
        if (mode !== 'wysiwyg') {
          insertAtTextarea(srcTextarea, '![' + 'Draw.io 流程图' + '](' + msg.rel + ')');
        } else {
          const img = document.createElement('img');
          img.setAttribute('data-src', msg.rel);
          img.src = msg.src;
          img.alt = 'Draw.io 流程图';
          insertAtCaret(img);
        }
        scheduleSave();
        toast(T('drawioCreated').replace('{f}', msg.rel));
        break;
      }
      case 'imageMap': applyImageMap(msg.map || {}); break;
      case 'zoomChanged': applyZoom(msg.zoom); break; // 其他文档调整缩放 → 本文档实时跟随（只应用不回写，防循环）
      case 'gotoHeading': gotoHeading(msg.text); break;
      case 'aiChunk':
        if (msg.id === aiState.id) { aiState.result += msg.delta || ''; paintAiChunk(); }
        break;
      case 'aiDone':
        if (msg.id === aiState.id) {
          aiState.busy = false;
          const card = $('#aiCard');
          if (card) {
            card.querySelector('.ai-meta').textContent = aiState.result.length + ' chars';
            card.querySelectorAll('.ai-act').forEach(b => { b.disabled = false; });
          }
          if (msg.empty) { card.style.display = 'none'; toast('AI 未返回内容'); }
        }
        break;
      case 'aiError':
        if (msg.id === aiState.id) {
          aiState.busy = false;
          const card = $('#aiCard');
          if (card) { card.style.display = 'none'; }
          if (msg.error === 'no-model' || msg.error === 'no-lm') { toast(T('aiLogin')); }
          else if (msg.error === 'disabled') { toast(T('aiDisabled')); }
          else { toast('AI 出错：' + msg.error); }
        }
        break;
      case 'command':
        if (msg.cmd === 'insertTable') { showTablePicker(editorWrap); }
        else if (msg.cmd === 'insertImage') { openImageDialog(); }
        else if (msg.cmd) { runCommand(msg.cmd); } // toggleMode/pageSetup/exportHtml/toc/panelInfo 等统一分发
        break;
      case 'info':
        toast(msg.text || '');
        break;
      default: break;
    }
  });

  // ================= 启动 =================
  buildApp();
  vscode.postMessage({ type: 'ready' });
})();
