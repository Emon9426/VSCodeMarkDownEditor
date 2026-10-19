/**
 * Markdown Word — 系统字体枚举（issue #1：字体列表读取本机全部已安装字体）
 * 纯 Node 无依赖：扫描各平台字体目录，解析 sfnt（TTF/OTF/TTC）name 表取字族名。
 * 供扩展宿主使用（webview 沙箱无法枚举系统字体），结果按名称排序后下发。
 * 读取策略：name 表位于文件任意偏移（TTC 集合可达数十 MB），故两段式——
 * 先读表目录定位 name 表偏移，再整块读出（每字体仅几 KB I/O）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// 各平台字体目录（Windows 用户级 / 系统级，macOS 三级，Linux 常见发行版路径）
function fontDirs() {
  const dirs = [];
  const push = d => { if (d && fs.existsSync && fs.existsSync(d)) { dirs.push(d); } };
  if (process.platform === 'win32') {
    push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
    push(path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts'));
  } else if (process.platform === 'darwin') {
    push('/System/Library/Fonts');
    push('/Library/Fonts');
    push(path.join(os.homedir(), 'Library', 'Fonts'));
  } else {
    push('/usr/share/fonts');
    push('/usr/local/share/fonts');
    push(path.join(os.homedir(), '.fonts'));
    push(path.join(os.homedir(), '.local', 'share', 'fonts'));
  }
  return dirs;
}

function walk(dir, out, depth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 4) { walk(p, out, depth + 1); } }
    else if (/\.(ttf|otf|ttc)$/i.test(e.name)) { out.push(p); }
  }
}

// 从 fd 的 offset 处精确读 length 字节（返回实际读到的切片）
function readChunk(fd, offset, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, offset);
  return buf.subarray(0, n);
}

// UTF-16BE 解码（name 表字符串存储格式，Node 无原生 utf16be 编码）
function utf16be(buf) {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) { s += String.fromCharCode(buf.readUInt16BE(i)); }
  return s;
}

// 解析 name 表数据块（tb[0] 即 name 表起始），返回 [字族名]（可能为空）
function parseNameTable(tb) {
  if (tb.length < 6) { return []; }
  const count = tb.readUInt16BE(2);
  const stringOff = tb.readUInt16BE(4);
  const names = {}; // nameID → { en, zh, any }
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > tb.length) { break; }
    const platform = tb.readUInt16BE(rec);
    const lang = tb.readUInt16BE(rec + 4);
    const id = tb.readUInt16BE(rec + 6);
    if (id !== 1 && id !== 16) { continue; } // 1=字族 16=排版字族（优先）
    const len = tb.readUInt16BE(rec + 8);
    const off = tb.readUInt16BE(rec + 10);
    const end = stringOff + off + len;
    if (end > tb.length) { continue; }
    const raw = tb.slice(stringOff + off, end);
    const str = (platform === 0 || platform === 3) ? utf16be(raw) : raw.toString('latin1');
    if (!str) { continue; }
    const slot = names[id] || (names[id] = {});
    if (platform === 0) { slot.en = slot.en || str; }
    else if (platform === 3 && lang === 0x0409) { slot.en = slot.en || str; }
    else if (platform === 3 && lang === 0x0804) { slot.zh = slot.zh || str; }
    slot.any = slot.any || str;
  }
  const fam = names[16] || names[1];
  if (!fam) { return []; }
  // 优先英文名（CSS 匹配最稳），仅有本地化名的字体回退 zh/any——Chromium 对两种别名均可匹配
  return [fam.en || fam.zh || fam.any];
}

// 读单个 sfnt（base=文件内偏移，TTC 每个成员一个 sfnt 头）的字族名
function sfntFamily(fd, base, fileSize) {
  try {
    if (base < 0 || base + 12 > fileSize) { return []; }
    const head = readChunk(fd, base, 548); // 12 + 16*33，覆盖绝大多数表目录
    if (head.length < 12) { return []; }
    const numTables = head.readUInt16BE(4);
    const dirLen = 12 + 16 * numTables;
    let dir = head;
    if (dirLen > head.length) { dir = readChunk(fd, base, Math.min(dirLen, 8192)); }
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (rec + 16 > dir.length) { break; }
      if (dir.toString('latin1', rec, rec + 4) === 'name') {
        const off = dir.readUInt32BE(rec + 8);
        const len = dir.readUInt32BE(rec + 12);
        if (off + 6 > fileSize) { return []; }
        return parseNameTable(readChunk(fd, off, Math.min(len, 1048576)));
      }
    }
    return [];
  } catch (_e) { return []; }
}

// 解析一个字体文件的全部字族名（TTC 集合含多个成员）
function fileFamilies(f) {
  let fd = null;
  const out = [];
  try {
    const stat = fs.statSync(f);
    fd = fs.openSync(f, 'r');
    const sig = readChunk(fd, 0, 4).toString('latin1');
    if (sig === 'ttcf') {
      const h = readChunk(fd, 0, 512);
      const n = h.readUInt32BE(8);
      for (let i = 0; i < n && i < 64; i++) {
        sfntFamily(fd, h.readUInt32BE(12 + 4 * i), stat.size).forEach(nm => { out.push(nm); });
      }
    } else if (sig === 'OTTO' || sig === '\x00\x01\x00\x00' || sig === 'true' || sig === 'typ1') {
      sfntFamily(fd, 0, stat.size).forEach(nm => { out.push(nm); });
    }
  } catch (_e) { /* 单文件失败不影响整体 */ }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch (_e2) { /* ignore */ } } }
  return out;
}

/**
 * 枚举本机全部已安装字体的字族名（去重、按名称排序）。
 * 任何环境异常都返回数组（可能为空）——字体面板对空列表有「跟随 VS Code」兜底。
 */
function listSystemFonts() {
  const files = [];
  fontDirs().forEach(d => walk(d, files, 0));
  const set = new Set();
  for (const f of files) { fileFamilies(f).forEach(name => { set.add(name); }); }
  const names = Array.from(set).filter(n => n && n.length <= 64);
  // zh 排序：拉丁按字母、汉字按拼音，中文环境直观
  names.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' }));
  return names;
}

module.exports = { listSystemFonts, parseNameTable };
