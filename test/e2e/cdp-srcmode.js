// CDP 模式布局断言：真实浏览器中切换 所见即所得/源码/分屏，断言源码纸张宽度与页面模式一致
// 仅连接本机固定回环调试端口 127.0.0.1:9333（由本地 Edge headless 提供），不访问任何外部地址
// 用法：先启动 Edge（见 README/CHANGELOG 1.6.2），再 node cdp-srcmode.js
const fs = require('fs');
const DEBUG_ENDPOINT = 'http://127.0.0.1:9333/json'; // 固定回环地址，无外部输入
const URL = 'file:///D:/01_WorkSpace/01_Project/08_MarkdownEditor/test/e2e/e2e.html';
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
    if (r.result && r.result.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : JSON.stringify(r);
  };

  let failed = 0;
  for (const w of [1920, 1280, 800]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2500);
    const out = await evalJs(`(() => {
      const ed = document.getElementById('editor');
      const edW = Math.round(ed.getBoundingClientRect().width);
      const sb = document.getElementById('sbMode');
      const r = { vw: innerWidth, editorW: edW };
      // sbMode 循环：wysiwyg → source → split
      sb.click(); // -> source
      r.bodySource = document.body.className;
      const col = document.getElementById('srcCol');
      r.sourceColW = Math.round(col.getBoundingClientRect().width);
      sb.click(); // -> split
      r.bodySplit = document.body.className;
      const col2 = document.getElementById('srcCol');
      const pv = document.getElementById('preview');
      r.splitColW = Math.round(col2.getBoundingClientRect().width);
      r.splitPreviewW = Math.round(pv.getBoundingClientRect().width);
      return JSON.stringify(r);
    })()`);
    const r = JSON.parse(out);
    // 断言1：源码模式纸张与页面模式纸张同宽（±40px 容纳源码区 32px 留白差异）
    const srcOk = Math.abs(r.sourceColW - r.editorW) <= 40;
    // 断言2：分屏模式源码列 + 预览列铺满主区（合计 ≥ 视口 90%，且各列 > 100px 不塌缩）
    const splitOk = r.splitColW > 100 && r.splitPreviewW > 100 && (r.splitColW + r.splitPreviewW) >= r.vw * 0.9;
    const ok = srcOk && splitOk;
    if (!ok) failed++;
    console.log(`w=${r.vw} 纸张=${r.editorW} 源码列=${r.sourceColW}${srcOk ? '✓' : '✗宽度不一致'} 分屏列=${r.splitColW}/${r.splitPreviewW}${splitOk ? '✓' : '✗塌缩'} ${ok ? 'PASS' : 'FAIL'}`);

    if (w === 1280) { // 证据截图：源码模式 1280 视口
      await evalJs(`document.getElementById('sbMode') && (() => { const s = document.getElementById('sbMode'); s.textContent; return true; })()`);
      // 当前处于 split，再点两次回到 source
      await evalJs(`document.getElementById('sbMode').click()`); // split -> wysiwyg
      await evalJs(`document.getElementById('sbMode').click()`); // wysiwyg -> source
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('D:/01_WorkSpace/01_Project/08_MarkdownEditor/test/e2e/shots/view-1280-source.png', Buffer.from(shot.result.data, 'base64'));
      console.log('saved shots/view-1280-source.png');
    }
  }
  ws.close();
  console.log(failed === 0 ? '结果: 全部通过' : `结果: ${failed} 个视口失败`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
