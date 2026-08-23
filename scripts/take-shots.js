/**
 * README 截图流水线：CDP 驱动 docs/demo.html 逐场景截图 → docs/images/*.png
 * 仅连接本机固定回环调试端口 127.0.0.1:9333（由本地 Edge headless 提供），不访问任何外部地址
 * 用法：先启动 Edge headless（见 README 开发节），node scripts/take-shots.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DEBUG_ENDPOINT = 'http://127.0.0.1:9333/json'; // 固定回环地址，无外部输入
const URL = 'file:///' + path.join(__dirname, '..', 'docs', 'demo.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, '..', 'docs', 'images');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(DEBUG_ENDPOINT)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.result.exceptionDetails.exception || {}));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
  };
  const reload = async () => { await send('Page.navigate', { url: URL }); await sleep(2600); };

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
  await reload();

  // ① 页面模式总览（滚动到顶部）
  await evalJs('document.getElementById("editorWrap").scrollTop = 0');
  await sleep(300);
  await shot('overview-wysiwyg.png');

  // ② 插入页签
  await evalJs('document.querySelector(".rtab[data-panel=\'rp-ins\']").click()');
  await sleep(250);
  await shot('ribbon-insert.png');

  // ③ 表格页签 + 表格上下文（文档里有表格，先光标进表格）→ 直接展示表格工具条
  await evalJs(`(() => {
    const t = document.querySelector('#editor table');
    if (t) { const r = document.createRange(); r.selectNodeContents(t.rows[1].cells[0]); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); }
  })()`);
  await sleep(400);
  await evalJs('document.getElementById("editorWrap").scrollTop = 180');
  await sleep(250);
  await shot('table-toolbar.png');

  // ④ 表格网格选择器
  await evalJs('document.querySelector(".rtab[data-panel=\'rp-ins\']").click()');
  await evalJs(`(() => {
    const p = document.querySelectorAll('#editor > p')[0];
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange'));
    document.querySelector('#rp-ins .rbtn[data-cmd="table"]').click();
  })()`);
  await sleep(300);
  await shot('table-picker.png');

  // ⑤ 斜杠菜单（光标入段落 + 程序化触发 input "/"）
  await reload();
  await send('Input.insertText', { text: '/' }).catch(() => {}); // 需要 focus；失败则走 evaluate 兜底
  await evalJs(`(() => {
    const p = document.querySelectorAll('#editor > p')[0];
    p.focus();
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    // 兜底：直接派发 input 事件路径不可靠时，模拟键盘路径走 beforeinput
    const be = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '/' });
    p.dispatchEvent(be);
    return document.getElementById('slashMenu') ? document.getElementById('slashMenu').style.display : 'none';
  })()`);
  await sleep(400);
  const slashOpen = await evalJs(`document.getElementById('slashMenu') && document.getElementById('slashMenu').style.display`);
  console.log('slash menu display:', slashOpen);
  if (slashOpen === 'flex') { await shot('slash-menu.png'); }
  else {
    // 退路：展示含分组关键词的截图意义不大则跳过，记录
    console.log('slash menu not open, skip');
  }

  // ⑥ Emoji 面板（MRU 置顶）
  await reload();
  await evalJs('document.querySelector(".rbtn[data-cmd=\'emoji\']").click()');
  await sleep(350);
  await shot('emoji-panel.png');

  // ⑦ 查找替换条（正则模式）
  await reload();
  await evalJs(`(() => {
    window.__onMessage({ data: { type: 'command', cmd: 'replace' } });
    const bar = document.getElementById('findBar');
    return bar ? bar.style.display : 'none';
  })()`);
  await sleep(300);
  await shot('find-replace.png');

  // ⑧ 公式与 Mermaid 特写（滚动到位）
  await reload();
  await evalJs(`document.querySelector('#editor .md-math').scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await shot('math-block.png');
  await evalJs(`document.querySelector('#editor .md-mermaid').scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await shot('mermaid-diagram.png');

  // ⑨ 页面设置面板
  await reload();
  await evalJs(`(() => { const sb = document.getElementById('sbPage'); sb.click(); return 'ok'; })()`);
  await sleep(350);
  await shot('page-setup.png');

  // ⑩ 源码模式 / ⑪ 分屏模式
  await reload();
  await evalJs('document.getElementById("sbMode").click()');
  await sleep(400);
  await shot('mode-source.png');
  await evalJs('document.getElementById("sbMode").click()');
  await sleep(400);
  await shot('mode-split.png');

  // ⑫ 暗色主题（页面模式）
  await reload();
  await evalJs('document.body.classList.add("vscode-dark")');
  await sleep(300);
  await shot('dark-theme.png');

  ws.close();
  console.log('done');
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
