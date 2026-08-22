/**
 * Markdown Word — 轻量语法高亮器（UMD：Node 与 Webview 双端）
 * 零依赖通用 tokenizer：注释 / 字符串 / 数字 / 关键字 / 类型，覆盖 30+ 语言（含 PL/SQL）。
 * 永远输出安全 HTML（内容经转义）；未识别语言按纯文本处理。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.MdHl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var KW = {
    common_sql: 'SELECT FROM WHERE GROUP BY HAVING ORDER INSERT INTO VALUES UPDATE SET DELETE CREATE OR REPLACE AND OR NOT NULL IS IN LIKE BETWEEN EXISTS JOIN LEFT RIGHT INNER OUTER ON AS DISTINCT UNION ALL CASE WHEN THEN ELSE END COMMIT ROLLBACK GRANT REVOKE TRUNCATE MERGE WITH',
    plsql: 'PROCEDURE FUNCTION PACKAGE BODY TRIGGER CURSOR LOOP IF ELSIF WHILE FOR RETURN DECLARE BEGIN EXCEPTION WHEN OTHERS THEN RAISE GOTO RECORD TYPE VARRAY TABLE OF INDEX BY PLS_INTEGER BINARY_INTEGER CONSTANT DEFAULT OUT IN OUT NOCOPY PRAGMA AUTONOMOUS_TRANSACTION RETURNS DETERMINISTIC OVERLOAD',
    tsql: 'PROCEDURE FUNCTION TRIGGER CURSOR DECLARE BEGIN END TRY CATCH THROW PRINT EXEC EXECUTE SP DECLARE IDENTITY CLUSTERED NONCLUSTERED',
    js: 'abstract arguments async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of return set static super switch this throw true try typeof var void while with yield',
    ts: 'any as asserts boolean declare enum infer internal is keyof namespace never number object private protected public readonly string symbol type undefined unknown unique',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
    cpp: 'bool catch class constexpr delete explicit export friend mutable namespace new noexcept nullptr operator private protected public template this throw try typeid typename using virtual override final nullptr constexpr consteval constinit co_await co_yield co_return',
    csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double dynamic else enum event explicit extern false finally fixed float for foreach get goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while when where select from linq',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false make new len cap append copy delete panic recover',
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield',
    ruby: 'BEGIN END alias and begin break case class def defined do each else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require attr_accessor',
    swift: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is nil super self throw throws try true false',
    kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while by get set import operator reified suspend data sealed open override abstract internal public private protected expect actual tailrec inline crossinline noinline',
    python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self',
    shell: 'if then else elif fi for while do done case esac function in select time until return exit break continue local export readonly declare typeset shift trap unset source alias',
    powershell: 'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in param process return static switch throw trap try until using var while workflow',
    css: 'important media supports keyframes import charset from to and not only',
    graphql: 'query mutation subscription fragment on directive scalar type interface enum input implements extends schema'
  };
  var TYPES = {
    plsql: 'VARCHAR2 NUMBER DATE CLOB BLOB TIMESTAMP BOOLEAN INTEGER ROWID NVARCHAR2 SYS_REFCURSOR DUAL',
    tsql: 'NVARCHAR VARCHAR INT BIGINT SMALLINT BIT DATETIME DATETIME2 UNIQUEIDENTIFIER DECIMAL',
    js: 'Promise Math JSON Object Array String Number Boolean Map Set Symbol Date RegExp Error window document console',
    ts: 'string number boolean any unknown never void object',
    java: 'String Integer Long Double Float Boolean Character Byte Short List Map Set Optional Stream System',
    cpp: 'std string vector map set unique_ptr shared_ptr size_t int8_t uint8_t int32_t uint64_t auto',
    csharp: 'string int long double bool decimal object List Dictionary Task IEnumerable',
    python: 'int str float list dict set tuple bool print len range enumerate zip open type super',
    go: 'string int int64 float64 bool byte rune error any struct map slice chan func'
  };

  var LANGS = {
    plsql: { kw: KW.common_sql + ' ' + KW.plsql, types: TYPES.plsql, line: '--', block: ['/*', '*/'], strings: ["'"], nocase: true, aliases: ['plsql', 'oracle'] },
    sql: { kw: KW.common_sql, types: TYPES.plsql, line: '--', block: ['/*', '*/'], strings: ["'"], nocase: true },
    tsql: { kw: KW.common_sql + ' ' + KW.tsql, types: TYPES.tsql, line: '--', block: ['/*', '*/'], strings: ["'"], nocase: true },
    javascript: { kw: KW.js, types: TYPES.js, line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'] },
    typescript: { kw: KW.js + ' ' + KW.ts, types: TYPES.js + ' ' + TYPES.ts, line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'] },
    json: { kw: 'true false null', line: null, block: null, strings: ['"'] },
    python: { kw: KW.python, types: TYPES.python, line: '#', strings: ['"', "'"] },
    java: { kw: KW.java, types: TYPES.java, line: '//', block: ['/*', '*/'], strings: ['"'] },
    c: { kw: KW.c, types: TYPES.cpp, line: '//', block: ['/*', '*/'], strings: ['"', "'"] },
    cpp: { kw: KW.c + ' ' + KW.cpp, types: TYPES.cpp, line: '//', block: ['/*', '*/'], strings: ['"', "'"] },
    csharp: { kw: KW.csharp, types: TYPES.csharp, line: '//', block: ['/*', '*/'], strings: ['"'] },
    go: { kw: KW.go, types: TYPES.go, line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'] },
    rust: { kw: KW.rust, line: '//', block: ['/*', '*/'], strings: ['"'] },
    php: { kw: KW.php, line: '//', block: ['/*', '*/'], strings: ['"', "'"] },
    ruby: { kw: KW.ruby, line: '#', strings: ['"', "'"] },
    swift: { kw: KW.swift, line: '//', block: ['/*', '*/'], strings: ['"'] },
    kotlin: { kw: KW.kotlin, line: '//', block: ['/*', '*/'], strings: ['"'] },
    scala: { kw: KW.kotlin, line: '//', block: ['/*', '*/'], strings: ['"'] },
    shell: { kw: KW.shell, line: '#', strings: ['"', "'"] },
    bat: { kw: 'echo set if exist for goto call rem off on', line: 'REM', strings: ['"'], nocase: true },
    powershell: { kw: KW.powershell, line: '#', block: ['<#', '#>'], strings: ['"', "'"] },
    css: { kw: KW.css, line: null, block: ['/*', '*/'], strings: ['"', "'"] },
    yaml: { kw: 'true false null yes no on off', line: '#', strings: ['"', "'"] },
    toml: { kw: 'true false', line: '#', strings: ['"', "'"] },
    ini: { kw: 'true false', line: [';', '#'], strings: ['"', "'"] },
    graphql: { kw: KW.graphql, line: '#', strings: ['"'] },
    diff: { diff: true },
    markdown: { line: null, strings: [] },
    xml: { xml: true },
    html: { xml: true },
    dockerfile: { kw: 'FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS', line: '#', strings: ['"', "'"] }
  };
  var ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', golang: 'go', rs: 'rust', kt: 'kotlin', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', yml: 'yaml', md: 'markdown', docker: 'dockerfile', plsql: 'plsql' };

  function prepareLang(lang) {
    var key = String(lang || '').toLowerCase().trim();
    key = ALIAS[key] || key;
    var conf = LANGS[key];
    if (!conf) { return null; }
    if (conf._prepared) { return conf; }
    var lines = (conf.line || null);
    conf._line = Array.isArray(lines) ? lines : (lines ? [lines] : []);
    conf._kw = conf.kw ? new Set(conf.kw.split(/\s+/)) : new Set();
    if (conf.nocase) {
      var lower = new Set();
      conf._kw.forEach(function (w) { lower.add(w.toLowerCase()); });
      conf._kw = lower;
    }
    conf._types = conf.types ? new Set(conf.types.split(/\s+/)) : new Set();
    conf._prepared = true;
    return conf;
  }

  function span(cls, text) { return '<span class="hljs-' + cls + '">' + esc(text) + '</span>'; }

  // 通用 tokenizer
  function tokenize(code, conf) {
    var out = [];
    var i = 0, n = code.length;
    var kw = conf._kw, types = conf._types;
    var strMarks = conf.strings || [];
    var lineMarks = conf._line || [];
    var blockStart = conf.block ? conf.block[0] : null;
    var blockEnd = conf.block ? conf.block[1] : null;

    function startsWith(pos, mark) {
      return mark && code.startsWith(mark, pos);
    }
    while (i < n) {
      var ch = code[i];
      // 块注释
      if (blockStart && startsWith(i, blockStart)) {
        var e = code.indexOf(blockEnd, i + blockStart.length);
        e = e === -1 ? n : e + blockEnd.length;
        out.push(span('cm', code.slice(i, e))); i = e; continue;
      }
      // 行注释
      var hitLine = false;
      for (var li = 0; li < lineMarks.length; li++) {
        if (startsWith(i, lineMarks[li])) {
          var le = code.indexOf('\n', i);
          le = le === -1 ? n : le;
          out.push(span('cm', code.slice(i, le))); i = le; hitLine = true; break;
        }
      }
      if (hitLine) { continue; }
      // 字符串
      var hitStr = false;
      for (var si = 0; si < strMarks.length; si++) {
        var m = strMarks[si];
        if (ch === m) {
          var j = i + 1;
          while (j < n) {
            if (code[j] === '\\') { j += 2; continue; }
            if (code[j] === m || code[j] === '\n' && m !== '`') { j++; break; }
            j++;
          }
          out.push(span('str', code.slice(i, Math.min(j, n)))); i = Math.min(j, n); hitStr = true; break;
        }
      }
      if (hitStr) { continue; }
      // 数字
      if (/[0-9]/.test(ch) && (i === 0 || !/[\w]/.test(code[i - 1]))) {
        var j2 = i;
        while (j2 < n && /[0-9a-fA-FxX._]/.test(code[j2])) { j2++; }
        out.push(span('num', code.slice(i, j2))); i = j2; continue;
      }
      // 词（关键字 / 类型 / 标识符）
      if (/[A-Za-z_$@#]/.test(ch)) {
        var j3 = i;
        while (j3 < n && /[\w$@#]/.test(code[j3])) { j3++; }
        var word = code.slice(i, j3);
        var probe = conf.nocase ? word.toLowerCase() : word;
        if (kw.has(probe)) { out.push(span('kw', word)); }
        else if (types.has(word)) { out.push(span('type', word)); }
        else { out.push(esc(word)); }
        i = j3; continue;
      }
      // 其他字符原样
      out.push(esc(ch)); i++;
    }
    return out.join('');
  }

  function highlightDiff(code) {
    return code.split('\n').map(function (line) {
      if (/^\+/.test(line)) { return span('add', line); }
      if (/^-/.test(line)) { return span('del', line); }
      if (/^@@/.test(line)) { return span('type', line); }
      return esc(line);
    }).join('\n');
  }
  function highlightXmlSafe(code) {
    // 逐段：<tag ...> 内部：标签名 kw、属性名 attr、字符串值 str
    var out = [];
    var i = 0, n = code.length;
    while (i < n) {
      var lt = code.indexOf('<', i);
      if (lt === -1) { out.push(esc(code.slice(i))); break; }
      out.push(esc(code.slice(i, lt)));
      var gt = code.indexOf('>', lt);
      if (gt === -1) { out.push(esc(code.slice(lt))); break; }
      var inner = code.slice(lt + 1, gt);
      var m = inner.match(/^(\/?[\w:-]+)([\s\S]*)$/);
      if (!m) { out.push(esc(code.slice(lt, gt + 1))); i = gt + 1; continue; }
      out.push('&lt;' + span('kw', m[1]));
      var rest = m[2];
      var ri = 0;
      while (ri < rest.length) {
        var q = rest.indexOf('"', ri);
        if (q === -1) { out.push(esc(rest.slice(ri))); break; }
        var q2 = rest.indexOf('"', q + 1);
        if (q2 === -1) { q2 = rest.length - 1; }
        var before = rest.slice(ri, q);
        var attrM = before.match(/([\w:-]+)(\s*)$/);
        if (attrM && attrM.index > 0) {
          out.push(esc(rest.slice(ri, ri + attrM.index)) + span('attr', attrM[1]) + attrM[2]);
        } else { out.push(esc(before)); }
        out.push('"' + span('str', rest.slice(q + 1, q2)) + '"');
        ri = q2 + 1;
      }
      out.push('&gt;');
      i = gt + 1;
    }
    return out.join('');
  }

  function highlight(code, lang) {
    code = String(code == null ? '' : code);
    var conf = prepareLang(lang);
    if (!conf) { return esc(code); }
    try {
      if (conf.diff) { return highlightDiff(code); }
      if (conf.xml) { return highlightXmlSafe(code); }
      return tokenize(code, conf);
    } catch (e) {
      return esc(code); // 高亮永不失败：异常时退化为纯文本
    }
  }

  return { highlight: highlight, prepareLang: prepareLang, escapeHtml: esc };
});
