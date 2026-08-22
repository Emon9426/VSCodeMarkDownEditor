/**
 * Markdown 核心引擎单元测试 — 覆盖：解析、序列化、往返保真（round-trip）
 * 运行：node test/unit/markdown.test.js
 */
'use strict';
const assert = require('assert');
const MdCore = require('../../src/markdown/core.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// ---------- 深比较（语义往返稳定性） ----------
function deepEq(a, b) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); }

console.log('== 解析：基础块 ==');
test('标题 H1-H6', () => {
  const b = MdCore.parse('## 你好');
  assert.strictEqual(b[0].type, 'heading');
  assert.strictEqual(b[0].level, 2);
  assert.strictEqual(b[0].text, '你好');
});
test('段落', () => {
  const b = MdCore.parse('第一行\n第二行');
  assert.strictEqual(b[0].type, 'paragraph');
  assert.strictEqual(b[0].text, '第一行\n第二行');
});
test('代码块（语言保留）', () => {
  const md = '```plsql\nSELECT * FROM dual;\nEND;\n```';
  const b = MdCore.parse(md);
  assert.strictEqual(b[0].type, 'code');
  assert.strictEqual(b[0].lang, 'plsql');
  assert.ok(b[0].code.includes('SELECT'));
});
test('分割线', () => {
  assert.strictEqual(MdCore.parse('---')[0].type, 'hr');
});
test('引用块（含嵌套段落）', () => {
  const b = MdCore.parse('> 引用内容');
  assert.strictEqual(b[0].type, 'quote');
  assert.strictEqual(b[0].blocks[0].text, '引用内容');
});

console.log('== 解析：行内 ==');
test('粗体', () => {
  assert.ok(MdCore.inlineHtml('**粗**').includes('<b>粗</b>'));
});
test('斜体', () => {
  assert.ok(MdCore.inlineHtml('*斜*').includes('<i>斜</i>'));
});
test('粗斜体', () => {
  const h = MdCore.inlineHtml('***粗斜***');
  assert.ok(h.includes('<b><i>粗斜</i></b>'), h);
});
test('删除线', () => {
  assert.ok(MdCore.inlineHtml('~~删~~').includes('<del>删</del>'));
});
test('高亮 ==', () => {
  assert.ok(MdCore.inlineHtml('==重点==').includes('<mark>重点</mark>'));
});
test('行内代码（内部标记不解析）', () => {
  const h = MdCore.inlineHtml('`a*b`');
  assert.ok(h.includes('<code>a*b</code>'), h);
});
test('链接（含 title）', () => {
  const h = MdCore.inlineHtml('[文本](https://a.com "标题")');
  assert.ok(h.includes('href="https://a.com"'), h);
  assert.ok(h.includes('title="标题"'), h);
});
test('图片', () => {
  const h = MdCore.inlineHtml('![替代](./images/a.png)');
  assert.ok(h.includes('data-src="./images/a.png"'), h);
});
test('裸 URL 自动链接', () => {
  const h = MdCore.inlineHtml('见 https://example.com/x 说明');
  assert.ok(h.includes('<a href="https://example.com/x">'), h);
});
test('反斜杠转义不产生标记', () => {
  const h = MdCore.inlineHtml('\\*不是斜体\\*');
  assert.ok(!h.includes('<i>'), h);
});

console.log('== 解析：列表 ==');
test('无序列表', () => {
  const b = MdCore.parse('- 甲\n- 乙');
  assert.strictEqual(b[0].type, 'list');
  assert.strictEqual(b[0].ordered, false);
  assert.strictEqual(b[0].items.length, 2);
});
test('有序列表（起始编号）', () => {
  const b = MdCore.parse('3. 三\n4. 四');
  assert.strictEqual(b[0].ordered, true);
  assert.strictEqual(b[0].start, 3);
});
test('任务列表（勾选状态）', () => {
  const b = MdCore.parse('- [x] 完成\n- [ ] 未完成');
  assert.strictEqual(b[0].items[0].checked, true);
  assert.strictEqual(b[0].items[1].checked, false);
});
test('嵌套列表', () => {
  const b = MdCore.parse('- 甲\n  - 子甲\n- 乙');
  assert.strictEqual(b[0].items[0].sub.length, 1);
  assert.strictEqual(b[0].items[0].sub[0].type, 'list');
  assert.strictEqual(b[0].items[0].sub[0].items[0].text, '子甲');
});

console.log('== 解析：表格 ==');
test('表格（表头/对齐）', () => {
  const b = MdCore.parse('| A | B | C |\n|:---|:---:|---:|\n| 1 | 2 | 3 |');
  assert.strictEqual(b[0].type, 'table');
  assert.deepStrictEqual(b[0].header, ['A', 'B', 'C']);
  assert.deepStrictEqual(b[0].align, ['left', 'center', 'right']);
  assert.deepStrictEqual(b[0].rows[0], ['1', '2', '3']);
});

console.log('== 往返保真（round-trip） ==');
function rt(md) { return MdCore.roundtrip(md); }

test('标题往返', () => {
  assert.strictEqual(rt('### 标题三\n'), '### 标题三\n');
});
test('段落往返', () => {
  assert.strictEqual(rt('你好世界\n'), '你好世界\n');
});
test('代码块往返（PL/SQL）', () => {
  const md = '```plsql\nCREATE PROCEDURE p IS\nBEGIN\n  NULL;\nEND;\n```\n';
  assert.strictEqual(rt(md), md);
});
test('表格往返（含对齐，规范格式稳定）', () => {
  const md = '| A | B |\n|:---:|---:|\n| 1 | 2 |\n';
  const once = rt(md);
  const canon = '| A | B |\n| :---: | ---: |\n| 1 | 2 |\n';
  assert.strictEqual(once, canon);
  assert.strictEqual(rt(once), once); // 二次往返稳定
  deepEq(MdCore.parse(md), MdCore.parse(once)); // 语义一致
});
test('任务列表往返', () => {
  const md = '- [x] a\n- [ ] b\n';
  assert.strictEqual(rt(md), md);
});
test('嵌套列表往返', () => {
  const md = '- a\n  - b\n';
  assert.strictEqual(rt(md), md);
});
test('有序列表往返', () => {
  assert.strictEqual(rt('1. a\n2. b\n'), '1. a\n2. b\n');
});
test('引用往返', () => {
  assert.strictEqual(rt('> 引用\n'), '> 引用\n');
});
test('行内标记往返（语义稳定）', () => {
  const md = '这是**粗**、*斜*、~~删~~、==高==、`码` 的句子\n';
  const blocks1 = MdCore.parse(md);
  const blocks2 = MdCore.parse(rt(md));
  deepEq(blocks1, blocks2);
});
test('链接图片往返（语义稳定）', () => {
  const md = '见[链接](https://a.com)与![图](./images/x.png)\n';
  deepEq(MdCore.parse(md), MdCore.parse(rt(md)));
});
test('混合文档二次往返稳定（idempotent）', () => {
  const md = [
    '# 项目计划', '', '简述**重点**内容。', '',
    '> 引用一行', '',
    '- [ ] 任务一', '- [x] 任务二', '',
    '| A | B |', '|---|:---:|', '| 1 | 2 |', '',
    '```js', 'const a = 1;', '```', '',
    '---', ''
  ].join('\n');
  const once = rt(md);
  const twice = rt(once);
  assert.strictEqual(twice, once);
});

console.log('== 渲染 HTML（预览） ==');
test('blocksToHtml 基本结构', () => {
  const html = MdCore.blocksToHtml(MdCore.parse('# T\n\n正文'));
  assert.ok(html.includes('<h1>'));
  assert.ok(html.includes('<p>'));
});
test('任务列表渲染勾选框', () => {
  const html = MdCore.blocksToHtml(MdCore.parse('- [x] a'));
  assert.ok(html.includes('md-check'), html);
});
test('代码块渲染 data-lang', () => {
  const html = MdCore.blocksToHtml(MdCore.parse('```python\nx=1\n```'));
  assert.ok(html.includes('data-lang="python"'), html);
});
test('HTML 转义防注入', () => {
  const html = MdCore.inlineHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), html);
});

console.log('== escapeMd 保真 ==');
test('文本中的特殊字符不产生标记', () => {
  const t = MdCore.escapeMd('3 * 4 = 12 ~~或== [x]');
  const html = MdCore.inlineHtml(t);
  assert.ok(!html.includes('<i>') && !html.includes('<del>') && !html.includes('<mark>'), t + ' -> ' + html);
});

console.log('== 排查复现：表格单元格管道符 ==');
test('解析：单元格内转义管道 \\| 保留为单格', () => {
  const b = MdCore.parse('| a | b \\| c |\n|---|---|\n| 1 | 2 |');
  assert.strictEqual(b[0].rows.length, 1);
  assert.strictEqual(b[0].header.length, 2, '表头应为 2 列');
  assert.strictEqual(b[0].header[1], 'b | c', '转义管道还原为字符：' + b[0].header[1]);
});
test('序列化：单元格文本含 | 时输出转义（不破坏表格结构）', () => {
  // 模拟 DOM 层 domTableToBlock 的单元格文本含原始管道符
  const md = '| a | b |\n|---|---|\n| 1 | 2 |\n';
  const blocks = MdCore.parse(md);
  blocks[0].rows[0][1] = 'x | y'; // 用户在单元格中输入了管道符
  const out = MdCore.blocksToMd(blocks);
  const re = MdCore.parse(out);
  assert.strictEqual(re[0].rows[0][1], 'x | y', '往返后单元格内容不丢失且不拆列：' + out.split('\n')[2]);
  assert.strictEqual(re[0].rows[0].length, 2, '行仍是 2 列');
});

console.log('== 审查修复回归 ==');
test('H5：代码块内容含 ``` 行时围栏自动加长（文档不被吞）', () => {
  const md = '````js\nconst a = 1;\n```\nconst b = 2;\n````\n';
  const once = rt(md);
  assert.ok(once.startsWith('````'), '外层围栏应为 4 个反引号：' + once.slice(0, 8));
  const b2 = MdCore.parse(once);
  assert.strictEqual(b2.length, 1, '整体仍是一个代码块');
  assert.ok(b2[0].code.includes('```'), '内层 ``` 保留在代码内容中');
});
test('H7：文本 [] 往返无双重转义', () => {
  const t = MdCore.escapeMd('数组[]占位');
  assert.strictEqual(t, '数组\\[\\]占位', '应为单层转义：' + t);
  const h = MdCore.inlineHtml(t);
  assert.ok(h.indexOf('[]') !== -1 && h.indexOf('\\\\[') === -1, '渲染还原为 []：' + h);
});
test('M6：链接 URL 括号/空格序列化转义（DOM→md 方向由 jsdom 覆盖，此处验证 %28 可往返）', () => {
  const md = '[维基](https://x.com/Foo_%28bar%29)\n';
  deepEq(MdCore.parse(md), MdCore.parse(rt(md)));
  const b = MdCore.parse(md);
  assert.ok(b[0].text.indexOf('%28bar%29') !== -1);
});

console.log('== 脚注（v1.4.0） ==');
test('解析：脚注引用渲染为上标，定义解析为块', () => {
  const b = MdCore.parse('正文[^1]继续\n\n[^1]: 这是脚注内容\n');
  assert.ok(MdCore.inlineHtml('正文[^1]继续').includes('sup class="md-fn"'), '引用为 sup');
  assert.strictEqual(b[1].type, 'footnote');
  assert.strictEqual(b[1].id, '1');
  assert.strictEqual(b[1].text, '这是脚注内容');
});
test('脚注往返（引用 + 定义）', () => {
  const md = '正文[^1]继续\n\n[^1]: 脚注一\n\n又有[^note2]\n\n[^note2]: 脚注二\n';
  const once = rt(md);
  assert.ok(once.indexOf('[^1]: 脚注一') !== -1, '定义保留：' + once);
  deepEq(MdCore.parse(md), MdCore.parse(once));
});
test('脚注定义渲染（md-fn-def）', () => {
  const html = MdCore.blocksToHtml(MdCore.parse('[^1]: 内容\n'));
  assert.ok(html.includes('md-fn-def') && html.includes('data-fn="1"'));
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if (failed) { process.exitCode = 1; }
