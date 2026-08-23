/**
 * Markdown Word — Markdown 核心引擎（UMD：Node 与 Webview 双端复用）
 * 架构：md --parse()--> blocks --blocksToMd()--> md
 *                 |--blocksToDom()--> 编辑 DOM   (webview)
 *       编辑 DOM --domToBlocks()--> blocks      (webview)
 * blocks 为纯数据中间层，parse/blocksToMd 可在 Node 中完整单元测试（往返保真）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.MdCore = api; // webview（无 CommonJS）与 Node stub 环境均通过全局访问
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ============================ 工具 ============================
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // DOM 文本 → md 文本（破坏潜在标记组合，保证往返保真）
  function escapeMd(t) {
    return String(t)
      .replace(/([\\`])/g, '\\$1')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\*\*/g, '*\\*')
      .replace(/~~/g, '~\\~')
      .replace(/==/g, '=\\=');
  }

  // ============================ 行内解析（md → html 字符串） ============================
  // 公式渲染：若同环境加载了 MdMath 则着色，否则保留原文（安全退化）
  function mathInline(s) {
    if (typeof MdMath === 'undefined' || !MdMath) { return null; }
    // 仅渲染内容不含空白的 $...$（避免误伤货币 "$100 and $200"）；\$ 可转义
    return s.replace(/([^\\$]|^)\$([^$\s]+?)\$/g, function (m, pre, body) {
      return pre + '<span class="md-imath" data-tex="' + escapeHtml(body) + '">' + MdMath.render(body) + '</span>';
    });
  }
  var PH = '\u0000';

  function emph(s) {
    var prev;
    do {
      prev = s;
      s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<b><i>$1</i></b>');
      s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
      s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<i>$2</i>');
      s = s.replace(/(^|[^\w_])__([\s\S]+?)__(?![\w_])/g, '$1<b>$2</b>');
      s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
      s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    } while (s !== prev);
    return s;
  }

  function inlineHtml(src) {
    var slots = [];
    function put(html) { slots.push(html); return PH + (slots.length - 1) + PH; }

    var s = String(src == null ? '' : src);
    // 1) 反斜杠转义 → 原文字符
    s = s.replace(/\\([\\`*_~=\[\]()#+\-.!>|])/g, function (m, c) { return put(escapeHtml(c)); });
    // 2) 行内代码（先双反引号后单）
    s = s.replace(/``([^`]+)``/g, function (m, c) { return put('<code>' + escapeHtml(c) + '</code>'); });
    s = s.replace(/`([^`\n]+)`/g, function (m, c) { return put('<code>' + escapeHtml(c) + '</code>'); });
    // 3) 脚注引用 [^id] → 上标（先于链接，避免误判）
    s = s.replace(/\[\^([^\]\s]+)\]/g, function (m, id) {
      return put('<sup class="md-fn" data-fn="' + escapeHtml(id) + '">' + escapeHtml(id) + '</sup>');
    });
    // 3.5) 行内公式 $...$（有 MdMath 时；结果进占位避免后续标记干扰）
    var im = (typeof MdMath !== 'undefined') ? mathInline(s) : null;
    if (im !== null && im !== s) {
      // 把公式 span 保护为占位，其余文本继续按普通流程处理
      s = im.replace(/<span class="md-imath"[^>]*>[\s\S]*?<\/span>/g, function (m2) {
        return put(m2);
      });
    }
    // 4) 图片 ![alt](src "title")
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (m, alt, srcUrl, title) {
      var t = title ? ' title="' + escapeHtml(title) + '"' : '';
      return put('<img alt="' + escapeHtml(alt) + '" data-src="' + escapeHtml(srcUrl) + '"' + t + '>');
    });
    // 4) 链接 [text](href "title")（文本递归做强调）
    s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (m, txt, href, title) {
      var t = title ? ' title="' + escapeHtml(title) + '"' : '';
      return put('<a href="' + escapeHtml(href) + '"' + t + '>' + emph(escapeHtml(txt)) + '</a>');
    });
    // 5) 裸 URL 自动链接（已有链接/图片已占位，安全）
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>)"']+)/g, function (m, pre, url) {
      return pre + put('<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a>');
    });
    // 5.5) 剩余纯文本 HTML 转义（此时真实 HTML 均已进入占位符，不会误伤）
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // 5.6) 白名单行内样式 span 还原（选区级字体持久化，F02）：&lt;span style="font-family:..."&gt; → 真实标签
    s = s.replace(/&lt;(\/?)span style=&quot;font-family:[^&]*&gt;/g, function (m0, slash) {
      var m2 = /font-family:([^&]*)&gt;/.exec(m0);
      return '<' + slash + 'span style="font-family:' + (m2 ? m2[1] : '') + '">';
    });
    // 6) 强调标记
    s = emph(s);
    // 7) 恢复占位（slot 内可能嵌套占位，循环到干净）
    var guard = 0;
    while (s.indexOf(PH) !== -1 && guard++ < 20) {
      s = s.replace(new RegExp(PH + '(\\d+)' + PH, 'g'), function (m, i) { return slots[+i]; });
    }
    // 8) 换行 → <br>
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  // ============================ 块级解析（md → blocks） ============================
  var RE_HEADING = /^(#{1,6})\s+(.*)$/;
  var RE_FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:\s*(.*)$/;
  var RE_HR = /^ {0,3}((?:- *){3,}|(?:\* *){3,}|(?:_ *){3,})$/;
  var RE_UL = /^(\s*)[-*+]\s+(.*)$/;
  var RE_OL = /^(\s*)(\d+)[.)]\s+(.*)$/;
  var RE_TASK = /^\[([ xX])\]\s+(.*)$/;
  var RE_QUOTE = /^ {0,3}>\s?(.*)$/;
  var RE_TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  var RE_HTML_START = /^<[A-Za-z][^>]*>/;

  function splitRow(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') { t = t.slice(1); }
    if (t.charAt(t.length - 1) === '|') { t = t.slice(0, -1); }
    // 单元格内转义管道 \| 先保护再拆列，还原为普通 | 字符（GFM 语义）
    return t.replace(/\\\|/g, '\u0001').split('|').map(function (c) {
      return c.replace(/\u0001/g, '|').trim();
    });
  }
  function alignOf(cell) {
    var l = cell.charAt(0) === ':';
    var r = cell.charAt(cell.length - 1) === ':';
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
  }

  function parseLines(lines) {
    var blocks = [];
    var i = 0, n = lines.length;
    while (i < n) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }

      // 代码块
      var fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*(\S*)\s*$/);
      if (fence) {
        var mark = fence[1], lang = fence[2] || '';
        var buf = []; i++;
        while (i < n && !new RegExp('^ {0,3}' + mark + '+\\s*$').test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过闭合
        blocks.push({ type: 'code', lang: lang, code: buf.join('\n') });
        continue;
      }
      // 块级公式 $$...$$（单行或跨行）
      if (/^\s*\$\$/.test(line)) {
        var single = line.match(/^\s*\$\$(.+)\$\$\s*$/);
        if (single) {
          blocks.push({ type: 'math', tex: single[1].trim() });
          i++; continue;
        }
        var mbuf = [line.replace(/^\s*\$\$/, '')];
        i++;
        while (i < n && !/^\s*\$\$\s*$/.test(lines[i])) { mbuf.push(lines[i]); i++; }
        i++;
        blocks.push({ type: 'math', tex: mbuf.join('\n').trim() });
        continue;
      }
      // 标题
      var h = line.match(RE_HEADING);
      if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }
      // 脚注定义 [^id]: text
      var fn = line.match(RE_FOOTNOTE_DEF);
      if (fn) { blocks.push({ type: 'footnote', id: fn[1], text: fn[2].trim() }); i++; continue; }
      // 分割线
      if (RE_HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
      // 引用块
      if (RE_QUOTE.test(line)) {
        var qbuf = [];
        while (i < n && RE_QUOTE.test(lines[i])) {
          qbuf.push(lines[i].match(RE_QUOTE)[1]); i++;
          // 引用续行（非 > 开头但非空且上一行为引用内容）简化：仅收集 > 行
        }
        blocks.push({ type: 'quote', blocks: parseLines(qbuf) });
        continue;
      }
      // 表格
      if (line.indexOf('|') !== -1 && i + 1 < n && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        var header = splitRow(line);
        var align = splitRow(lines[i + 1]).map(alignOf);
        i += 2;
        var rows = [];
        while (i < n && lines[i].trim() && lines[i].indexOf('|') !== -1 && !RE_UL.test(lines[i]) && !RE_OL.test(lines[i])) {
          rows.push(splitRow(lines[i])); i++;
        }
        blocks.push({ type: 'table', align: align, header: header, rows: rows });
        continue;
      }
      // 列表
      var isUl = RE_UL.test(line), isOl = !isUl && RE_OL.test(line);
      if (isUl || isOl) {
        var res = parseList(lines, i, isUl);
        blocks.push(res.list); i = res.next;
        continue;
      }
      // HTML 块（到空行）
      if (RE_HTML_START.test(line.trim()) || /^ {0,3}<!--/.test(line)) {
        var hbuf = [];
        while (i < n && lines[i].trim()) { hbuf.push(lines[i]); i++; }
        blocks.push({ type: 'html', raw: hbuf.join('\n') });
        continue;
      }
      // 段落：连续普通行
      var pbuf = [line.trim()];
      i++;
      while (i < n && lines[i].trim() && !RE_HEADING.test(lines[i]) && !RE_HR.test(lines[i]) &&
        !RE_QUOTE.test(lines[i]) && !/^ {0,3}(`{3,}|~{3,})/.test(lines[i]) &&
        !RE_UL.test(lines[i]) && !RE_OL.test(lines[i]) && !RE_HTML_START.test(lines[i].trim()) &&
        !(lines[i].indexOf('|') !== -1 && i + 1 < n && RE_TABLE_SEP.test(lines[i + 1]))) {
        pbuf.push(lines[i].trim()); i++;
      }
      blocks.push({ type: 'paragraph', text: pbuf.join('\n') });
    }
    return blocks;
  }

  function parseList(lines, i) {
    var ordered = RE_OL.test(lines[i]);
    var first = lines[i].match(ordered ? RE_OL : RE_UL);
    var baseIndent = first[1].length;
    var items = [];
    var n = lines.length;
    var start = ordered ? parseInt(first[2], 10) : 1;

    while (i < n) {
      var line = lines[i];
      if (!line.trim()) {
        // 空行：向后看还有没有更深的列表内容
        var j = i + 1;
        while (j < n && !lines[j].trim()) { j++; }
        if (j < n && (RE_UL.test(lines[j]) || RE_OL.test(lines[j])) && indentOf(lines[j]) >= baseIndent) {
          i = j; continue;
        }
        break;
      }
      var m = line.match(ordered ? RE_OL : RE_UL);
      var ind = indentOf(line);
      if (!m) {
        if (ind >= baseIndent + 2 && items.length) {
          // 列表项续行
          var last = items[items.length - 1];
          last.text += '\n' + line.trim();
          i++; continue;
        }
        break;
      }
      if (m[1].length < baseIndent) { break; }
      var content = ordered ? m[3] : m[2];
      var checked = null;
      var tm = content.match(RE_TASK);
      if (tm) { checked = tm[1] !== ' '; content = tm[2]; }
      // 收集该项的嵌套内容（更深缩进的行）
      var itemIndent = m[1].length;
      i++;
      var subLines = [];
      while (i < n && lines[i].trim() && indentOf(lines[i]) > itemIndent) {
        subLines.push(lines[i].replace(/^\s{1,99}/, function (s) { return s.slice(Math.min(itemIndent + 2, s.length)); }));
        i++;
      }
      var sub = [];
      if (subLines.length) {
        subLines.unshift('');
        sub = parseLines(subLines);
      }
      items.push({ text: content, checked: checked, sub: sub });
    }
    return { list: { type: 'list', ordered: ordered, start: start, items: items }, next: i };
  }

  function indentOf(line) {
    var m = line.match(/^ */);
    return m[0].length;
  }

  function parse(mdText) {
    var lines = String(mdText == null ? '' : mdText).replace(/\r\n?/g, '\n').split('\n');
    return parseLines(lines);
  }

  // ============================ blocks → md ============================
  function blocksToMd(blocks) {
    var out = [];
    blocks.forEach(function (b) { blockToMd(b, out, ''); });
    return out.join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '\n');
  }

  function blockToMd(b, out, prefix) {
    switch (b.type) {
      case 'heading':
        out.push(prefix + new Array(b.level + 1).join('#') + ' ' + b.text + '\n\n'); break;
      case 'footnote':
        out.push(prefix + '[^' + b.id + ']: ' + b.text + '\n\n'); break;
      case 'math':
        out.push('$$' + b.tex + '$$\n\n'); break;
      case 'paragraph':
        out.push(indentLines(b.text, prefix) + '\n\n'); break;
      case 'code': {
        // 围栏长度自适应：内容里最长反引号连续串 +3（CommonMark 规则），防止内容含 ``` 时提前闭合
        var runs = (b.code.match(/`+/g) || []);
        var maxRun = 0;
        runs.forEach(function (r) { maxRun = Math.max(maxRun, r.length); });
        var fence = new Array(maxRun + 3).join('`') + '`'; // ≥3 个
        out.push(prefix + fence + (b.lang || '') + '\n' + b.code.split('\n').map(function (l) { return prefix + l; }).join('\n') + '\n' + prefix + fence + '\n\n'); break;
      }
      case 'hr':
        out.push(prefix + '---\n\n'); break;
      case 'quote':
        var q = [];
        b.blocks.forEach(function (c) { blockToMd(c, q, ''); });
        q.join('').split('\n').forEach(function (l) {
          if (l.trim()) { out.push(prefix + '> ' + l + '\n'); } else if (prefix) { out.push(prefix + '>\n'); }
        });
        out.push('\n'); break;
      case 'list':
        var s = b.ordered ? (b.start || 1) : 0;
        b.items.forEach(function (it) {
          var mark = b.ordered ? (s + '. ') : '- ';
          var head = it.checked === null || it.checked === undefined ? '' : (it.checked ? '[x] ' : '[ ] ');
          var first = true;
          // 项文本（可能多行）
          it.text.split('\n').forEach(function (l) {
            out.push(prefix + (first ? mark + head : '  ') + l + '\n'); first = false;
          });
          if (it.sub && it.sub.length) {
            it.sub.forEach(function (c) { blockToMd(c, out, prefix + '  '); });
          }
          if (b.ordered) { s++; }
        });
        out.push('\n'); break;
      case 'table':
        // 单元格输出：裸 | 转义为 \|，防止破坏表格结构（与 splitRow 的还原闭环）
        var escCell = function (s) { return String(s).replace(/\\\|/g, '|').replace(/\|/g, '\\|'); };
        var cols = Math.max(b.header.length, 1);
        var align = [];
        for (var k = 0; k < cols; k++) { align.push(null); }
        b.align.forEach(function (a, idx) { align[idx] = a; });
        out.push(prefix + '| ' + b.header.map(escCell).join(' | ') + ' |\n');
        var sep = [];
        for (var c2 = 0; c2 < cols; c2++) {
          var a = align[c2];
          sep.push(a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---');
        }
        out.push(prefix + '| ' + sep.join(' | ') + ' |\n');
        b.rows.forEach(function (r) { out.push(prefix + '| ' + r.map(escCell).join(' | ') + ' |\n'); });
        out.push('\n'); break;
      case 'html':
        out.push(b.raw.split('\n').map(function (l) { return prefix + l; }).join('\n') + '\n\n'); break;
    }
  }

  function indentLines(text, prefix) {
    if (!prefix) { return text; }
    return text.split('\n').map(function (l) { return prefix + l; }).join('\n');
  }

  // ============================ blocks → html（预览） ============================
  // 代码块高亮：若同环境加载了 MdHl（src/markdown/highlight.js）则着色，否则纯文本（安全退化）
  function hlCode(code, lang) {
    if (typeof MdHl !== 'undefined' && MdHl && typeof MdHl.highlight === 'function') {
      return MdHl.highlight(code, lang);
    }
    return escapeHtml(code);
  }
  function blocksToHtml(blocks) {
    return blocks.map(function (b) { return blockToHtml(b); }).join('');
  }
  function blockToHtml(b) {
    switch (b.type) {
      case 'heading': return '<h' + b.level + '>' + inlineHtml(b.text) + '</h' + b.level + '>';
      case 'footnote': return '<div class="md-fn-def" data-fn="' + escapeHtml(b.id) + '"><sup>' + escapeHtml(b.id) + '</sup> ' + inlineHtml(b.text) + '</div>';
      case 'math': return (typeof MdMath !== 'undefined')
        ? '<div class="md-math" data-tex="' + escapeHtml(b.tex) + '">' + MdMath.render(b.tex) + '</div>'
        : '<div class="md-math" data-tex="' + escapeHtml(b.tex) + '"><code>' + escapeHtml(b.tex) + '</code></div>';
      case 'paragraph': return '<p>' + inlineHtml(b.text) + '</p>';
        case 'code': {
          // mermaid 代码块 → 流程图 SVG（预览/导出同渲染）；失败降级源码
          if (String(b.lang || '').toLowerCase() === 'mermaid' && typeof MdMm !== 'undefined') {
            var svg = MdMm.render(b.code);
            if (svg) { return '<div class="md-mermaid" data-code="' + escapeHtml(b.code) + '">' + svg + '</div>'; }
          }
          return '<pre data-lang="' + escapeHtml(b.lang || '') + '"><code>' + hlCode(b.code, b.lang) + '</code></pre>'; }
      case 'hr': return '<hr>';
      case 'quote': return '<blockquote>' + blocksToHtml(b.blocks) + '</blockquote>';
      case 'list':
        var tag = b.ordered ? 'ol' : 'ul';
        var lis = b.items.map(function (it) {
          var cls = it.checked === null || it.checked === undefined ? '' : ' class="md-task' + (it.checked ? ' done' : '') + '"';
          var cb = it.checked === null || it.checked === undefined ? '' : '<span class="md-check" data-checked="' + !!it.checked + '">' + (it.checked ? '☑' : '☐') + '</span>';
          var sub = (it.sub && it.sub.length) ? blocksToHtml(it.sub) : '';
          return '<li' + cls + ' data-checked="' + (it.checked === null || it.checked === undefined ? '' : !!it.checked) + '">' + cb + inlineHtml(it.text) + sub + '</li>';
        }).join('');
        return '<' + tag + (b.ordered && b.start !== 1 ? ' start="' + b.start + '"' : '') + '>' + lis + '</' + tag + '>';
      case 'table':
        var th = b.header.map(function (c, i2) {
          var a = b.align[i2];
          return '<th' + (a ? ' data-align="' + a + '"' : '') + '>' + inlineHtml(c) + '</th>';
        }).join('');
        var trs = b.rows.map(function (r) {
          return '<tr>' + r.map(function (c, i2) {
            var a = b.align[i2];
            return '<td' + (a ? ' data-align="' + a + '"' : '') + '>' + inlineHtml(c) + '</td>';
          }).join('') + '</tr>';
        }).join('');
        return '<table><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table>';
      case 'html': return '<div class="md-raw-html">' + b.raw + '</div>';
    }
    return '';
  }

  // ============================ 导出（Node 可测部分） ============================
  var api = {
    parse: parse,
    blocksToMd: blocksToMd,
    blocksToHtml: blocksToHtml,
    inlineHtml: inlineHtml,
    escapeHtml: escapeHtml,
    escapeMd: escapeMd,
    roundtrip: function (md) { return blocksToMd(parse(md)); }
  };

  // ============================ DOM 部分（仅 webview 使用） ============================
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {

    // blocks → DOM 片段（编辑区结构）
    api.blocksToDom = function (blocks, doc) {
      doc = doc || document;
      var frag = doc.createDocumentFragment();
      blocks.forEach(function (b) { frag.appendChild(blockToDom(b, doc)); });
      return frag;
    };
    function blockToDom(b, doc) {
      switch (b.type) {
        case 'heading': {
          var h = doc.createElement('h' + b.level);
          h.innerHTML = inlineHtml(b.text); return h;
        }
        case 'footnote': {
          var fd = doc.createElement('div');
          fd.className = 'md-fn-def'; fd.setAttribute('data-fn', b.id);
          fd.innerHTML = '<sup contenteditable="false">' + b.id + '</sup> ' + inlineHtml(b.text);
          return fd;
        }
        case 'paragraph': {
          var p = doc.createElement('p'); p.innerHTML = inlineHtml(b.text); return p;
        }
        case 'code': {
          // mermaid 代码块 → 流程图 SVG（有 MdMm 且解析成功时）；否则源码
          if (String(b.lang || '').toLowerCase() === 'mermaid' && typeof MdMm !== 'undefined') {
            var svg = MdMm.render(b.code);
            if (svg) {
              var mmDiv = doc.createElement('div');
              mmDiv.className = 'md-mermaid'; mmDiv.setAttribute('data-code', b.code);
              mmDiv.setAttribute('contenteditable', 'false');
              mmDiv.innerHTML = svg; return mmDiv;
            }
          }
          var pre = doc.createElement('pre'); pre.setAttribute('data-lang', b.lang || '');
          var code = doc.createElement('code');
          code.innerHTML = hlCode(b.code, b.lang); // 高亮 span；序列化走 codeText() 递归取文本，不受影响
          pre.appendChild(code); return pre;
        }
        case 'math': {
          var md = doc.createElement('div');
          md.className = 'md-math'; md.setAttribute('data-tex', b.tex);
          md.setAttribute('contenteditable', 'false');
          md.innerHTML = (typeof MdMath !== 'undefined') ? MdMath.render(b.tex) : escapeHtml(b.tex);
          return md;
        }
        case 'hr': return doc.createElement('hr');
        case 'quote': {
          var q = doc.createElement('blockquote');
          b.blocks.forEach(function (c) { q.appendChild(blockToDom(c, doc)); }); return q;
        }
        case 'list': {
          var ul = doc.createElement(b.ordered ? 'ol' : 'ul');
          if (b.ordered && b.start !== 1) { ul.setAttribute('start', b.start); }
          b.items.forEach(function (it) {
            var li = doc.createElement('li');
            if (it.checked !== null && it.checked !== undefined) {
              li.className = 'md-task';
              li.setAttribute('data-checked', String(!!it.checked));
              var cb = doc.createElement('span');
              cb.className = 'md-check'; cb.setAttribute('contenteditable', 'false');
              cb.textContent = it.checked ? '☑' : '☐';
              li.appendChild(cb);
            }
            var span = doc.createElement('span');
            span.className = 'li-body'; span.innerHTML = inlineHtml(it.text);
            li.appendChild(span);
            (it.sub || []).forEach(function (c) { li.appendChild(blockToDom(c, doc)); });
            ul.appendChild(li);
          });
          return ul;
        }
        case 'table': {
          var tb = doc.createElement('table');
          var thead = doc.createElement('thead'); var trh = doc.createElement('tr');
          b.header.forEach(function (c, i2) {
            var th = doc.createElement('th'); th.innerHTML = inlineHtml(c);
            var a = b.align[i2]; if (a) { th.setAttribute('data-align', a); }
            trh.appendChild(th);
          });
          thead.appendChild(trh); tb.appendChild(thead);
          var tbody = doc.createElement('tbody');
          b.rows.forEach(function (r) {
            var tr = doc.createElement('tr');
            r.forEach(function (c, i2) {
              var td = doc.createElement('td'); td.innerHTML = inlineHtml(c);
              var a = b.align[i2]; if (a) { td.setAttribute('data-align', a); }
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });
          tb.appendChild(tbody); return tb;
        }
        case 'html': {
          var d = doc.createElement('div'); d.className = 'md-raw-html';
          d.innerHTML = b.raw; return d; // 保持可编辑（面板等 HTML 块内容可直接修改）
        }
      }
      var p2 = doc.createElement('p'); return p2;
    }

    // DOM → blocks（编辑区序列化入口）
    api.domToBlocks = function (rootEl) {
      var blocks = [];
      var kids = Array.prototype.slice.call(rootEl.childNodes);
      kids.forEach(function (el) { domToBlock(el, blocks); });
      return blocks;
    };
    // 代码块内容提取：<br> 视为换行（contenteditable 中 Enter/Shift+Enter 会产生 br，textContent 会丢失）
    function codeText(el) {
      var out = [];
      Array.prototype.forEach.call(el.childNodes, function (n) {
        if (n.nodeType === 3) { out.push(n.textContent); }
        else if (n.nodeType === 1) {
          out.push(n.tagName.toLowerCase() === 'br' ? '\n' : codeText(n));
        }
      });
      return out.join('');
    }
    function domToBlock(el, blocks) {      if (el.nodeType === 3) { // 游离文本 → 段落
        var t = el.textContent;
        if (t.trim()) { blocks.push({ type: 'paragraph', text: t }); }
        return;
      }
      if (el.nodeType !== 1) { return; }
      var tag = el.tagName.toLowerCase();
      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          blocks.push({ type: 'heading', level: +tag[1], text: serInline(el) }); break;
        case 'p':
          blocks.push({ type: 'paragraph', text: serInline(el) }); break;
        case 'pre': {
          var codeEl = el.querySelector('code') || el;
          blocks.push({ type: 'code', lang: el.getAttribute('data-lang') || '', code: codeText(codeEl).replace(/\n$/, '') });
          break;
        }
        case 'hr': blocks.push({ type: 'hr' }); break;
        case 'blockquote': {
          var inner = document.createElement('div');
          Array.prototype.slice.call(el.childNodes).forEach(function (c) { inner.appendChild(c.cloneNode(true)); });
          blocks.push({ type: 'quote', blocks: api.domToBlocks(inner) });
          break;
        }
        case 'ul': case 'ol': blocks.push(domListToBlock(el)); break;
        case 'table': blocks.push(domTableToBlock(el)); break;
        case 'div':
          if (el.classList.contains('md-math')) {
            blocks.push({ type: 'math', tex: el.getAttribute('data-tex') || el.textContent.trim() });
          } else if (el.classList.contains('md-mermaid')) {
            blocks.push({ type: 'code', lang: 'mermaid', code: el.getAttribute('data-code') || '' });
          } else if (el.classList.contains('md-fn-def')) {
            var clone = el.cloneNode(true);
            Array.prototype.forEach.call(clone.querySelectorAll('sup'), function (s0) { s0.remove(); });
            blocks.push({ type: 'footnote', id: el.getAttribute('data-fn') || '1', text: serInline(clone) });
          } else if (el.classList.contains('md-raw-html') || el.classList.contains('md-panel')) {
            // HTML 块 / 四色提示面板：以 outerHTML 原样持久化（保留 class，往返稳定）
            blocks.push({ type: 'html', raw: el.outerHTML });
          } else if (el.classList.contains('code-tools')) {
            // 代码块工具条（UI 附属结构），序列化时忽略
          } else {
            // 未知 div：摊平处理
            Array.prototype.slice.call(el.childNodes).forEach(function (c) { domToBlock(c, blocks); });
          }
          break;
        case 'br': break;
        default:
          // 其他块级元素 → 段落
          blocks.push({ type: 'paragraph', text: serInline(el) });
      }
    }
    function domListToBlock(el) {
      var ordered = el.tagName.toLowerCase() === 'ol';
      var start = ordered ? (parseInt(el.getAttribute('start') || '1', 10) || 1) : 1;
      var items = [];
      Array.prototype.slice.call(el.children).forEach(function (li) {
        if (li.tagName.toLowerCase() !== 'li') { return; }
        var checked = null;
        var body = null, subEls = [];
        Array.prototype.slice.call(li.childNodes).forEach(function (c) {
          if (c.nodeType === 1) {
            var ct = c.tagName.toLowerCase();
            if (ct === 'ul' || ct === 'ol') { subEls.push(c); return; }
            if (c.classList && c.classList.contains('md-check')) { return; }
          }
          if (!body) { body = document.createElement('span'); }
          body.appendChild(c.cloneNode(true));
        });
        if (li.classList.contains('md-task') || li.hasAttribute('data-checked')) {
          checked = li.getAttribute('data-checked') === 'true';
        }
        var sub = [];
        subEls.forEach(function (s) { sub.push(domListToBlock(s)); });
        items.push({ text: body ? serInline(body) : '', checked: checked, sub: sub });
      });
      return { type: 'list', ordered: ordered, start: start, items: items };
    }
    function domTableToBlock(el) {
      var header = [], rows = [], align = [];
      var thead = el.querySelector('thead'), tbody = el.querySelector('tbody');
      if (thead) {
        var trs = thead.querySelectorAll('tr');
        if (trs.length) {
          Array.prototype.slice.call(trs[0].children).forEach(function (th, i2) {
            header.push(serInline(th));
            var a = th.getAttribute('data-align'); align.push(a === 'center' || a === 'left' || a === 'right' ? a : null);
          });
        }
      }
      if (tbody) {
        Array.prototype.slice.call(tbody.querySelectorAll('tr')).forEach(function (tr) {
          var cells = Array.prototype.slice.call(tr.children).map(function (td) { return serInline(td); });
          rows.push(cells);
        });
      }
      // 无 thead 的表（异常结构）：首行视为表头
      if (!header.length && rows.length) { header = rows.shift(); }
      return { type: 'table', align: align, header: header, rows: rows };
    }

    // DOM 行内 → md 文本
    function serInline(el) {
      var out = [];
      serNodes(el.childNodes, out);
      return out.join('').replace(/\u0000/g, '').trim();
    }
    api.serInline = serInline;
    function serNodes(nodes, out) {
      Array.prototype.forEach.call(nodes, function (n) {
        if (n.nodeType === 3) { out.push(escapeMd(n.textContent)); return; }
        if (n.nodeType !== 1) { return; }
        var tag = n.tagName.toLowerCase();
        var inner = [];
        serNodes(n.childNodes, inner);
        var t = inner.join('');
        switch (tag) {
          case 'b': case 'strong': out.push('**' + t + '**'); break;
          case 'i': case 'em': out.push('*' + t + '*'); break;
          case 'del': case 's': case 'strike': out.push('~~' + t + '~~'); break;
          case 'mark': out.push('==' + t + '=='); break;
          case 'u': case 'ins': out.push(t); break; // Markdown 无下划线语法：保文字弃格式
          case 'code': out.push('`' + t.replace(/`/g, '\\`') + '`'); break;
          case 'a': {
            var href = (n.getAttribute('href') || '')
              .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
            var title = (n.getAttribute('title') || '').replace(/"/g, '\'');
            out.push('[' + t + '](' + href + (title ? ' "' + title + '"' : '') + ')');
            break;
          }
          case 'img': {
            var src = n.getAttribute('data-src') || n.getAttribute('src') || '';
            var alt = n.getAttribute('alt') || '';
            out.push('![' + alt + '](' + src + ')');
            break;
          }
          case 'br': out.push('\n'); break;
          case 'sup':
            if (n.classList.contains('md-fn') && n.getAttribute('data-fn')) {
              out.push('[^' + n.getAttribute('data-fn') + ']'); break;
            }
            out.push(t); break;
          case 'span':
            if (n.classList.contains('md-check')) { break; }
            if (n.classList.contains('md-imath') && n.getAttribute('data-tex')) {
              out.push('$' + n.getAttribute('data-tex') + '$'); break;
            }
            if ((n.getAttribute('style') || '').indexOf('font-family') !== -1) {
              // 选区级字体：以行内 HTML 持久化（inlineHtml 白名单还原，F02）
              out.push('<span style="' + n.getAttribute('style') + '">' + t + '</span>');
              break;
            }
            out.push(t); break;
          default: out.push(t);
        }
      });
    }
    api.domToMarkdown = function (rootEl) { return blocksToMd(api.domToBlocks(rootEl)); };
  }

  return api;
});
