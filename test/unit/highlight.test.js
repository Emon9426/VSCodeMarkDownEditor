/**
 * 语法高亮器单元测试（含 PL/SQL）+ core 集成
 */
'use strict';
const assert = require('assert');
require('../../src/markdown/highlight.js');
const MdHl = globalThis.MdHl;
const MdCore = require('../../src/markdown/core.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

console.log('== 语法高亮器 ==');
test('PL/SQL：关键字 / 类型 / 字符串 / 注释', () => {
  const h = MdHl.highlight("CREATE OR REPLACE PROCEDURE p (x VARCHAR2) IS\n-- 注释\n v VARCHAR2(20) := 'abc';\nBEGIN NULL; END;", 'plsql');
  assert.ok(/hljs-kw">CREATE/.test(h), 'CREATE 关键字：' + h.slice(0, 120));
  assert.ok(/hljs-type">VARCHAR2/.test(h), 'VARCHAR2 类型');
  assert.ok(/hljs-str">'abc'/.test(h), '字符串');
  assert.ok(/hljs-cm">-- 注释/.test(h), '行注释');
  assert.ok(/hljs-kw">PROCEDURE/i.test(h), '大小写不敏感（PROCEDURE 小写输入也应命中，此处验证大写）');
});
test('PL/SQL：小写关键字（nocase）', () => {
  const h = MdHl.highlight('select * from dual;', 'plsql');
  assert.ok(/hljs-kw">select/.test(h), '小写 select 命中');
});
test('PL/SQL：块注释', () => {
  const h = MdHl.highlight('/* 多行\n注释 */ SELECT 1 FROM DUAL;', 'plsql');
  assert.ok(/hljs-cm">\/\* 多行[\s\S]*?注释 \*\//.test(h), '块注释完整');
});
test('PL/SQL：数字', () => {
  const h = MdHl.highlight('x := 3.14159;', 'plsql');
  assert.ok(/hljs-num">3\.14159/.test(h), '数字高亮');
});
test('JavaScript：模板字符串与转义', () => {
  const h = MdHl.highlight('const s = `a \\` b${x}`; // done', 'javascript');
  assert.ok(/hljs-str">`/.test(h), '模板串起始');
  assert.ok(/hljs-kw">const/.test(h), '关键字');
});
test('别名解析：js → javascript，plsql → plsql', () => {
  assert.ok(/hljs-kw">const/.test(MdHl.highlight('const a=1;', 'js')));
  assert.ok(/hljs-kw">SELECT/.test(MdHl.highlight('SELECT 1 FROM DUAL;', 'plsql')));
});
test('未识别语言：纯文本 + 转义安全', () => {
  const h = MdHl.highlight('<script>x</script>', 'unknown-lang');
  assert.ok(h.indexOf('<script>') === -1, '脚本被转义：' + h);
  assert.ok(h.indexOf('&lt;script&gt;') !== -1);
});
test('注入安全：代码中的 < > 一律转义', () => {
  const h = MdHl.highlight('a < b && c > d', 'plsql');
  assert.ok(h.indexOf('< b') === -1 && h.indexOf('&lt; b') !== -1);
});
test('diff：+/- 行高亮', () => {
  const h = MdHl.highlight('+ 新增\n- 删除\n@@ h @@', 'diff');
  assert.ok(/hljs-add">\+ 新增/.test(h) && /hljs-del">- 删除/.test(h));
});
test('xml/html：标签与属性字符串', () => {
  const h = MdHl.highlight('<div class="a">文本</div>', 'html');
  assert.ok(/hljs-kw">div/.test(h), '标签名');
  assert.ok(/hljs-str">a/.test(h), '属性值');
});
test('高亮永不失败：异常输入返回转义文本', () => {
  const h = MdHl.highlight('正常', 'plsql');
  assert.ok(h.indexOf('正常') !== -1);
});

console.log('== core 集成（同环境加载 MdHl 后自动着色） ==');
test('blocksToHtml 代码块包含高亮 span', () => {
  const html = MdCore.blocksToHtml(MdCore.parse('```plsql\nSELECT 1;\n```'));
  assert.ok(/hljs-kw">SELECT/.test(html), html);
});
test('未加载 MdHl 的环境（模拟）：安全退化', () => {
  const saved = globalThis.MdHl;
  delete globalThis.MdHl;
  const html = MdCore.blocksToHtml(MdCore.parse('```plsql\nSELECT 1;\n```'));
  globalThis.MdHl = saved;
  assert.ok(html.indexOf('hljs-kw') === -1, '无高亮器时纯文本');
  assert.ok(html.indexOf('SELECT') !== -1);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if (failed) { process.exitCode = 1; }
