/**
 * 测试入口：直接加载各测试模块（模块自行统计结果并在失败时设置 process.exitCode）
 * 顺序说明：
 * 1. webview.smoke —— 最先加载：注入 DOM stub 后 require core.js，使 DOM 端 API 进入模块缓存
 * 2. markdown.test —— 核心引擎单元测试
 * 3. webview.jsdom.test —— jsdom 真实 DOM/事件/选区的交互集成测试（自建 window，与 stub 无关）
 */
'use strict';
require('./webview.smoke.js');
require('./markdown.test.js');
require('./highlight.test.js');
require('./fontlist.test.js');
require('./audit-buttons.js');
require('./mathmermaid.test.js');
require('./bench.test.js');
require('./webview.jsdom.test.js');
require('./host.outline.test.js');
require('./ui.stability.test.js');
