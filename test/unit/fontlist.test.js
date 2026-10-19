/**
 * F18 系统字体枚举单元测试（src/fontList.js 纯 Node 模块，issue #1）
 * 构造合成 sfnt name 表验证解析规则：英文名优先 / 中文回退 / nameID16 优先 / 畸形输入兜底。
 * （真实机 240+ 字族的全量扫描在本机人工验证过；此处覆盖解析逻辑分支）
 */
'use strict';
const assert = require('assert');
const { parseNameTable } = require('../../src/fontList.js');

console.log('== F18 系统字体枚举（fontList.js） ==');
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// 构造 name 表数据块：format=0 + count 条记录 + 字符串区（platform=3 时字符串为 UTF-16BE）
function nameTable(records) {
  const strs = []; const recs = []; let off = 0;
  records.forEach(function (r) {
    const bytes = [];
    if (r.platform === 3 || r.platform === 0) { for (let i = 0; i < r.text.length; i++) { const c = r.text.charCodeAt(i); bytes.push(c >> 8, c & 255); } }
    else { for (let i = 0; i < r.text.length; i++) { bytes.push(r.text.charCodeAt(i) & 255); } }
    recs.push({ platform: r.platform, lang: r.lang, id: r.id, len: bytes.length, off: off });
    strs.push(Buffer.from(bytes));
    off += bytes.length;
  });
  const head = Buffer.alloc(6 + recs.length * 12);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(recs.length, 2);
  head.writeUInt16BE(6 + recs.length * 12, 4);
  recs.forEach(function (r, i) {
    const rec = 6 + i * 12;
    head.writeUInt16BE(r.platform, rec);
    head.writeUInt16BE(3, rec + 2);
    head.writeUInt16BE(r.lang, rec + 4);
    head.writeUInt16BE(r.id, rec + 6);
    head.writeUInt16BE(r.len, rec + 8);
    head.writeUInt16BE(r.off, rec + 10);
  });
  return Buffer.concat([head].concat(strs));
}

test('英文名优先（en + zh 双记录）', () => {
  const t = nameTable([
    { platform: 3, lang: 0x0409, id: 1, text: 'Microsoft YaHei' },
    { platform: 3, lang: 0x0804, id: 1, text: '微软雅黑' }
  ]);
  assert.deepStrictEqual(parseNameTable(t), ['Microsoft YaHei']);
});
test('仅有中文名 → 回退 zh', () => {
  const t = nameTable([{ platform: 3, lang: 0x0804, id: 1, text: '方正舒体' }]);
  assert.deepStrictEqual(parseNameTable(t), ['方正舒体']);
});
test('nameID 16（排版字族）优先于 1', () => {
  const t = nameTable([
    { platform: 3, lang: 0x0409, id: 1, text: 'Serif Display Regular' },
    { platform: 3, lang: 0x0409, id: 16, text: 'Serif Display' }
  ]);
  assert.deepStrictEqual(parseNameTable(t), ['Serif Display']);
});
test('平台 0（Unicode）视作英文源', () => {
  const t = nameTable([{ platform: 0, lang: 0, id: 1, text: 'Noto Sans' }]);
  assert.deepStrictEqual(parseNameTable(t), ['Noto Sans']);
});
test('无关 nameID（版权/样式等）不参与；空表/短缓冲/超界记录安全返回 []', () => {
  const noisy = nameTable([
    { platform: 3, lang: 0x0409, id: 0, text: 'Copyright' },
    { platform: 3, lang: 0x0409, id: 2, text: 'Regular' }
  ]);
  assert.deepStrictEqual(parseNameTable(noisy), []);
  assert.deepStrictEqual(parseNameTable(Buffer.alloc(0)), []);
  assert.deepStrictEqual(parseNameTable(Buffer.from([0, 0, 0, 99, 0, 0])), []); // count 虚高越界
});
test('记录长度越界（声明超出字符串区）→ 跳过该记录', () => {
  const head = nameTable([{ platform: 3, lang: 0x0409, id: 1, text: 'OK' }]);
  head.writeUInt16BE(9999, 6 + 8); // 篡改 len 字段
  assert.deepStrictEqual(parseNameTable(head), []);
});

console.log('结果: ' + (failed ? failed + ' 项失败' : '全部通过'));
