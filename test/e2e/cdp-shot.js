// CDP 截图：在精确 CSS 视口下 Page.captureScreenshot，替代 --window-size 受最小窗口限制的截图
// 仅连接本机固定回环调试端口 127.0.0.1:9333（由本地 Edge headless 提供），不访问任何外部地址
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

  for (const w of [500, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 640, deviceScaleFactor: 1.5, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(3000);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = `D:/01_WorkSpace/01_Project/08_MarkdownEditor/test/e2e/shots/view-${w}-cdp.png`;
    fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
    console.log('saved', out);
  }
  ws.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
