/**
 * 公式（MdMath）与 Mermaid（MdMm）渲染器测试 + core 集成
 */
'use strict';
const assert = require('assert');
require('../../src/markdown/math.js');
require('../../src/markdown/mermaid.js');
const MdMath = globalThis.MdMath;
const MdMm = globalThis.MdMm;
const MdCore = require('../../src/markdown/core.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

console.log('== 公式渲染器（MdMath） ==');
test('分数 \\frac{a}{b}', () => {
  const h = MdMath.render('\\frac{a}{b}');
  assert.ok(h.indexOf('mfrac') !== -1 && h.indexOf('mnum">a') !== -1 && h.indexOf('mden">b') !== -1, h);
});
test('上下标 x^2 与 a_i', () => {
  assert.ok(MdMath.render('x^2').indexOf('msup">2') !== -1);
  assert.ok(MdMath.render('a_i').indexOf('msub">i') !== -1);
});
test('上下标大括号 x^{n+1}', () => {
  assert.ok(MdMath.render('x^{n+1}').indexOf('msup">n+1') !== -1, MdMath.render('x^{n+1}'));
});
test('希腊字母与运算符', () => {
  assert.ok(MdMath.render('\\alpha + \\beta \\times \\pi').indexOf('α') !== -1);
  assert.ok(MdMath.render('\\sum_{i=1}^{n}').indexOf('∑') !== -1);
  assert.ok(MdMath.render('a \\leq b').indexOf('≤') !== -1);
});
test('根号', () => {
  const h = MdMath.render('\\sqrt{x+1}');
  assert.ok(h.indexOf('√') !== -1 && h.indexOf('mrad') !== -1);
});
test('\\text 与 \\text{文本}', () => {
  assert.ok(MdMath.render('\\text{当} x > 0').indexOf('当') !== -1);
});
test('嵌套分数', () => {
  const h = MdMath.render('\\frac{1}{\\frac{1}{2}}');
  assert.ok((h.match(/mfrac/g) || []).length === 2, h);
});
test('转义安全：输入含 < >', () => {
  const h = MdMath.render('a < b');
  assert.ok(h.indexOf('< b') === -1 && h.indexOf('&lt; b') !== -1);
});
test('未识别命令降级为文本（不失败）', () => {
  const h = MdMath.render('\\unknowncmd{x}');
  assert.ok(h.indexOf('unknowncmd') !== -1);
});

console.log('== 公式 core 集成 ==');
test('块级 $$..$$ 解析 + 往返', () => {
  const b = MdCore.parse('$$E = mc^2$$\n');
  assert.strictEqual(b[0].type, 'math');
  assert.strictEqual(b[0].tex, 'E = mc^2');
  assert.ok(MdCore.roundtrip('$$E = mc^2$$\n').indexOf('$$E = mc^2$$') !== -1);
});
test('多行块级公式', () => {
  const b = MdCore.parse('$$\n\\frac{a}{b} + \\pi\n$$\n');
  assert.strictEqual(b[0].type, 'math');
  assert.ok(b[0].tex.indexOf('\\pi') !== -1);
});
test('行内 $x^2$ 渲染为 span.md-imath', () => {
  const h = MdCore.inlineHtml('值 $x^2$ 结束');
  assert.ok(h.indexOf('md-imath') !== -1 && h.indexOf('data-tex="x^2"') !== -1, h);
});
test('货币 $100 不误渲染', () => {
  const h = MdCore.inlineHtml('价格 $100 与 $200 之间');
  assert.ok(h.indexOf('md-imath') === -1, h);
});
test('无空格行内公式渲染、有空格不渲染', () => {
  assert.ok(MdCore.inlineHtml('$a+b$').indexOf('md-imath') !== -1);
  assert.ok(MdCore.inlineHtml('$a + b$').indexOf('md-imath') === -1);
});

console.log('== Mermaid 子集渲染器（MdMm） ==');
test('graph TD 基本解析', () => {
  const g = MdMm.parse('graph TD\nA[开始] --> B{判断}\nB -->|是| C[结束]');
  assert.ok(g, '解析成功');
  assert.strictEqual(g.dir, 'TD');
  assert.strictEqual(Object.keys(g.nodes).length, 3);
  assert.strictEqual(g.nodes.A.shape, 'rect');
  assert.strictEqual(g.nodes.B.shape, 'diamond');
  assert.strictEqual(g.edges[1].label, '是');
});
test('graph LR 方向', () => {
  const g = MdMm.parse('graph LR\nA --> B');
  assert.strictEqual(g.dir, 'LR');
});
test('render 输出 SVG（节点 + 箭头）', () => {
  const svg = MdMm.render('graph TD\nA[开始] --> B[处理]\nB --> C[结束]');
  assert.ok(svg && svg.indexOf('<svg') === 0, 'svg 根元素');
  assert.ok(svg.indexOf('开始') !== -1 && svg.indexOf('结束') !== -1);
  assert.ok(svg.indexOf('mArrow') !== -1, '箭头 marker');
  assert.ok(svg.indexOf('polygon') !== -1 || svg.indexOf('rect') !== -1, '节点形状');
});
test('不支持语法降级（sequenceDiagram → null）', () => {
  assert.strictEqual(MdMm.render('sequenceDiagram\nA->>B: hi'), null);
  assert.strictEqual(MdMm.render('graph TD\nsubgraph x\nA-->B\nend'), null);
});
test('core 集成：mermaid 代码块渲染为图 + 序列化往返', () => {
  const md = '```mermaid\ngraph TD\nA[开始] --> B[结束]\n```\n';
  const b = MdCore.parse(md);
  assert.strictEqual(b[0].type, 'code');
  assert.strictEqual(b[0].lang, 'mermaid');
  const html = MdCore.blocksToHtml(b);
  assert.ok(html.indexOf('md-mermaid') !== -1 && html.indexOf('<svg') !== -1, '渲染为 SVG');
  const once = MdCore.roundtrip(md);
  assert.ok(once.indexOf('```mermaid') !== -1 && once.indexOf('A[开始]') !== -1, '序列化保留源码');
});
test('分叉合流图渲染', () => {
  const svg = MdMm.render('graph TD\nA --> B\nA --> C\nB --> D\nC --> D');
  assert.ok(svg && svg.indexOf('D') !== -1);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if (failed) { process.exitCode = 1; }
