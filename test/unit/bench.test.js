/**
 * 性能基准（F01 非功能验收的 CI 化）：
 * 大文档 parse / blocksToMd / inlineHtml / 高亮耗时，宽松阈值断言（防性能回退）。
 */
'use strict';
const assert = require('assert');
const MdCore = require('../../src/markdown/core.js');
require('../../src/markdown/highlight.js');
const MdHl = globalThis.MdHl;

function makeDoc(kb) {
  const paras = [];
  const target = kb * 1024;
  let size = 0, i = 0;
  while (size < target) {
    const t = i % 10;
    if (t === 0) { paras.push('## 章节 ' + i); }
    else if (t === 3) { paras.push('- [ ] 任务' + i + '：' + '待办事项描述。'.repeat(8)); }
    else if (t === 5) { paras.push('| A' + i + ' | B | C |\n|:---|---:|---|\n| 数据 | 2 | 3 |\n| 行' + i + ' | 5 | 6 |'); }
    else if (t === 7) { paras.push('```plsql\nSELECT * FROM t' + i + ' WHERE x = ' + i + ';\n```'); }
    else { paras.push('第' + i + '段：这是**加粗**与*斜体*和`代码`的性能测试文本。'.repeat(6)); }
    size = paras.join('\n').length;
    i++;
  }
  return paras.join('\n\n');
}

function bench(fn, n) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) { fn(); }
  return Number(process.hrtime.bigint() - t0) / 1e6 / n; // ms/op
}

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.message || e)); }
}

console.log('== 性能基准（宽松阈值，防回退） ==');
const DOC_50 = makeDoc(50);
const DOC_200 = makeDoc(200);

test('50KB 文档 parse < 150ms（实测 ' + bench(() => MdCore.parse(DOC_50), 3).toFixed(1) + 'ms）', () => {
  assert.ok(bench(() => MdCore.parse(DOC_50), 3) < 150);
});
test('50KB 往返 roundtrip < 300ms（实测 ' + bench(() => MdCore.roundtrip(DOC_50), 3).toFixed(1) + 'ms）', () => {
  assert.ok(bench(() => MdCore.roundtrip(DOC_50), 3) < 300);
});
test('200KB 文档 parse < 800ms（实测 ' + bench(() => MdCore.parse(DOC_200), 1).toFixed(1) + 'ms）', () => {
  assert.ok(bench(() => MdCore.parse(DOC_200), 1) < 800);
});
test('PL/SQL 高亮 100 行 < 60ms（实测 ' + bench(() => MdHl.highlight('SELECT * FROM t WHERE x = 1;'.repeat(100), 'plsql'), 3).toFixed(1) + 'ms）', () => {
  assert.ok(bench(() => MdHl.highlight('SELECT * FROM t WHERE x = 1;\n'.repeat(100), 'plsql'), 3) < 60);
});
test('inlineHtml 5000 字段 < 50ms（实测 ' + bench(() => MdCore.inlineHtml('**粗**与*斜*和[链](a.b)混合文本。'.repeat(200)), 3).toFixed(1) + 'ms）', () => {
  assert.ok(bench(() => MdCore.inlineHtml('**粗**与*斜*和[链](a.b)混合文本。'.repeat(200)), 3) < 50);
});

console.log('\n结果: ' + (failed ? failed + ' 项失败' : '全部通过'));
if (failed) { process.exitCode = 1; }
