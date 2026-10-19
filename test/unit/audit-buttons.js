/**
 * 全量按钮审计（静态）：main.js 中所有交互控件 → 处理器映射比对
 * 覆盖：Ribbon iconBtn data-cmd / 快速样式动态命令 / runCommand case / tableOp 默认表 /
 *       斜杠菜单项 / 右键菜单 / 状态栏绑定 / fddl 下拉
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/webview/main.js'), 'utf8');

// 1) 提取 runCommand 的 case 标签（switch 在 2088 行附近，取整个函数体）
const runCmdMatch = /function runCommand\(cmd\)[\s\S]{0,30000}?^  \}/m.exec(src);
if (!runCmdMatch) { console.error('未找到 runCommand'); process.exit(1); }
const runCmdBody = runCmdMatch[0];
const caseLabels = new Set();
for (const m of runCmdBody.matchAll(/case '([^']+)':/g)) { caseLabels.add(m[1]); }
// default 分支里转给 tableOp 的命令
const tableOpList = [];
const defMatch = /\[('([a-zA-Z]+)',?\s*)+\]\.indexOf\(cmd\)/.exec(runCmdBody);
if (defMatch) { for (const c of defMatch[0].matchAll(/'([a-zA-Z]+)'/g)) { tableOpList.push(c[1]); } }

// 2) 提取 iconBtn 的 data-cmd：先全局剔除 T('...')（其括号会截断参数匹配），args 中最后一个「纯标识符」串即 cmd
const STYLE_CLASSES = new Set(['danger', 'on']);
const srcNoT = src.replace(/T\('[^']*'\)/g, "''");
const btnCmds = new Set();
for (const m of srcNoT.matchAll(/iconBtn\(([^)]*)\)/g)) {
  const strs = [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]).filter(s => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s) && !STYLE_CLASSES.has(s));
  if (strs.length >= 1) { btnCmds.add(strs[strs.length - 1]); }
}
// 快速样式动态命令
if (/i < 3 \? 'h' \+ \(i \+ 1\) : 'hmore'/.test(src)) { btnCmds.add('h1'); btnCmds.add('h2'); btnCmds.add('h3'); btnCmds.add('hmore'); }
// 表格工具条（ttBar）数组里的命令
for (const m of src.matchAll(/\[\['[^]]*?','[^]]*?','([a-zA-Z]+)'\]/g)) { btnCmds.add(m[1]); }

// 3) 斜杠菜单项命令（SLASH_GROUPS 每项第二列为 cmd，emoji 项为 'emoji:xx' 前缀）
const slashCmds = new Set();
const slashZone = /const SLASH_GROUPS = \[[\s\S]*?\n  \];/.exec(src);
if (slashZone) {
  for (const m of slashZone[0].matchAll(/\['[^']*', '([^']+)',/g)) { slashCmds.add(m[1]); }
}

// 4) fddl / 状态栏绑定清单（人工核对用）
const ddlBinds = [...src.matchAll(/ddls\[(\d)\]\.onclick\s*=\s*(\S+)/g)].map(m => `ddls[${m[1]}] → ${m[2]}`);
const sbBinds = [...src.matchAll(/\$\('#(sb\w+)'\)\.onclick/g)].map(m => m[1]);

// ===== 比对 =====
const handled = new Set([...caseLabels, ...tableOpList]);
const missingBtn = [...btnCmds].filter(c => !handled.has(c)).sort();
const missingSlash = [...slashCmds].filter(c => !handled.has(c) && !/^emoji/.test(c)).sort();

console.log('== 全量按钮静态审计 ==');
console.log('Ribbon/工具条按钮命令数:', btnCmds.size, '| runCommand case 数:', caseLabels.size, '| tableOp 数:', tableOpList.length);
console.log('斜杠菜单命令数（去 emoji 前缀）:', slashCmds.size);
console.log('\nfddl 绑定:', ddlBinds.join(' ; '));
console.log('状态栏绑定:', sbBinds.join(', '));
console.log('\n【按钮 → 无处理器】:', missingBtn.length ? missingBtn.join(', ') : '无 ✓');
console.log('【斜杠项 → 无处理器】:', missingSlash.length ? missingSlash.join(', ') : '无 ✓');
// case 中存在但没有任何按钮/斜杠入口的命令（信息性：可能是快捷键专用）
const orphans = [...caseLabels].filter(c => !btnCmds.has(c) && !slashCmds.has(c)).sort();
console.log('【仅快捷键/内部调用（无 UI 入口，信息性）】:', orphans.join(', '));
console.log('结果: ' + ((missingBtn.length || missingSlash.length) ? '存在无处理器按钮' : '全部通过'));
if (missingBtn.length || missingSlash.length) { process.exitCode = 1; } // 不用 process.exit：会截断后续测试模块
