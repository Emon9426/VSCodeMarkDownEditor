// CDP 视口探针：连接已运行的 Edge headless 远程调试端口，在精确 CSS 视口下读取计算样式
// 仅连接本机固定回环调试端口 127.0.0.1:9333（由本地 Edge headless 提供），不访问任何外部地址
const DEBUG_ENDPOINT = 'http://127.0.0.1:9333/json'; // 固定回环地址，无外部输入
const URL = 'file:///D:/01_WorkSpace/01_Project/08_MarkdownEditor/test/e2e/probe.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // 等待调试端口就绪
  let targets = null;
  for (let i = 0; i < 20; i++) {
    try { targets = await fetch(DEBUG_ENDPOINT); break; } catch { await sleep(500); }
  }
  if (!targets) throw new Error('debug port not reachable');
  const list = await targets.json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let mid = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });

  for (const w of [1280, 800, 700, 501, 500, 480, 360, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 600, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2500); // 等 init/渲染/探针脚本
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const g = id => { const el = document.getElementById(id); return el ? getComputedStyle(el).display : 'N/A'; };
        return JSON.stringify({ vw: innerWidth, mq700: matchMedia('(max-width: 700px)').matches,
          mq500: matchMedia('(max-width: 500px)').matches, sbFont: g('sbFont'), sbLang: g('sbLang'),
          sbPage: g('sbPage'), sbPos: g('sbPos'),
          edPad: getComputedStyle(document.getElementById('editor')).padding });
      })()`,
      returnByValue: true
    });
    console.log(`w=${String(w).padStart(4)} ${r.result && r.result.result ? r.result.result.value : JSON.stringify(r)}`);
  }
  ws.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
