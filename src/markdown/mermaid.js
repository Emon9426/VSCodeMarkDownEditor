/**
 * Markdown Word — 轻量 Mermaid 流程图渲染器（UMD 双端）
 * graph TD/LR 子集 → SVG：节点（[] 方框 / () 圆角 / {} 菱形 / 裸 id）、
 * 边（--> 实线 / -.-> 虚线 / --- 无箭头 / -->|标签|）、分层层叠布局。
 * 外部 Mermaid 库（~2MB）无法经安全通道获取的自研替代；不支持语法（子图/时序图等）降级为源码。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.MdMm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var ARROWS = ['-.->', '-->', '==>', '---', '->'];
  function parseNode(tok) {
    var t = tok.trim();
    var m = t.match(/^(\w+)\s*([\[\(\{])(.*)[\]\)\}]$/);
    if (m) {
      var shape = m[2] === '[' ? 'rect' : m[2] === '(' ? 'round' : 'diamond';
      return { id: m[1], label: m[3].trim() || m[1], shape: shape };
    }
    if (/^\w+$/.test(t)) { return { id: t, label: t, shape: 'rect' }; }
    return null;
  }
  function splitEdge(line) {
    for (var i = 0; i < ARROWS.length; i++) {
      var idx = line.indexOf(ARROWS[i]);
      if (idx !== -1) {
        return { left: line.slice(0, idx), arrow: ARROWS[i], right: line.slice(idx + ARROWS[i].length) };
      }
    }
    return null;
  }

  function parse(code) {
    var lines = String(code).split('\n');
    var dir = 'TD';
    var nodes = {}, order = [];
    var edges = [];
    var started = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.indexOf('%%') === 0) { continue; }
      if (!started) {
        var hm = line.match(/^(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)\b/i);
        if (hm) { dir = /^(LR|RL)$/i.test(hm[1]) ? 'LR' : 'TD'; started = true; continue; }
        if (/^(?:graph|flowchart)\b/i.test(line)) { started = true; continue; }
        return null; // 不支持的首行（sequenceDiagram 等）
      }
      if (/^(?:subgraph|classDef|class|style|linkStyle)\b/.test(line)) { return null; } // 不支持特性 → 降级
      var sp = splitEdge(line);
      if (sp) {
        var left = sp.left.trim().replace(/;$/, '');
        var right = sp.right.trim().replace(/;$/, '');
        var label = null;
        var lm = right.match(/^\|([^|]*)\|\s*(.+)$/);
        if (lm) { label = lm[1].trim(); right = lm[2].trim(); }
        var a = parseNode(left);
        var b = parseNode(right);
        if (a && b) {
          [a, b].forEach(function (n) { if (!nodes[n.id]) { nodes[n.id] = n; order.push(n.id); } });
          edges.push({
            from: a.id, to: b.id, label: label,
            dashed: sp.arrow === '-.->',
            arrow: sp.arrow !== '---'
          });
          continue;
        }
      }
      var solo = parseNode(line.replace(/;$/, ''));
      if (solo && !nodes[solo.id]) { nodes[solo.id] = solo; order.push(solo.id); }
    }
    if (!started) { return null; }
    if (!order.length) { return null; }
    return { dir: dir, nodes: nodes, order: order, edges: edges };
  }

  function layout(g) {
    // 拓扑分层（Kahn）：无入边为第 0 层；环回退到顺序层
    var indeg = {};
    g.order.forEach(function (id) { indeg[id] = 0; });
    g.edges.forEach(function (e) { indeg[e.to] = (indeg[e.to] || 0) + 1; });
    var layers = [];
    var placed = {};
    var remain = g.order.slice();
    var guard = 0;
    while (remain.length && guard++ < 100) {
      var layer = remain.filter(function (id) { return (indeg[id] || 0) === 0 && !placed[id]; });
      if (!layer.length) { layer = [remain[0]]; } // 环
      layer.forEach(function (id) { placed[id] = true; });
      remain = remain.filter(function (id) { return !placed[id]; });
      g.edges.forEach(function (e) { if (placed[e.from] && !placed[e.to]) { indeg[e.to] = Math.max(0, (indeg[e.to] || 1) - 1); } });
      layers.push(layer);
    }
    return layers;
  }

  function sizeOf(label) {
    var w = Math.max(28, label.length * 13 + 22);
    return { w: Math.min(w, 320), h: 36 };
  }

  function render(code) {
    var g;
    var layers;
    try {
      g = parse(code);
      if (!g) { return null; }
      layers = layout(g);
    } catch (e) { return null; }

    var GAP = 56, VGAP = 30, PAD = 16;
    var pos = {};
    var maxCols = 0;
    layers.forEach(function (layer) { maxCols = Math.max(maxCols, layer.length); });
    var colW = 0;
    layers.forEach(function (layer) {
      layer.forEach(function (id) { colW = Math.max(colW, sizeOf(g.nodes[id].label).w); });
    });
    colW += GAP;
    var rowH = 36 + VGAP + (g.edges.some(function (e) { return e.label; }) ? 16 : 0);

    layers.forEach(function (layer, li) {
      layer.forEach(function (id, ci) {
        var total = layer.length;
        var span = colW * maxCols;
        var x = (span - colW * total) / 2 + ci * colW + colW / 2;
        var y = PAD + li * rowH + 18;
        pos[id] = { x: x, y: y };
      });
    });
    var width = colW * maxCols - GAP + PAD * 2;
    var height = PAD * 2 + layers.length * rowH;

    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" style="max-width:100%;height:auto;font-family:inherit">'];
    out.push('<defs><marker id="mArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="#64748b"/></marker></defs>');
    // 边
    g.edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to];
      if (!a || !b) { return; }
      var x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
      // 出入点吸附到节点边缘（垂直/水平方向）
      if (g.dir === 'TD') {
        var sa = sizeOf(g.nodes[e.from].label), sb = sizeOf(g.nodes[e.to].label);
        y1 = a.y + sa.h / 2; y2 = b.y - sb.h / 2;
        if (Math.abs(x2 - x1) > 4) { // 折线：竖出 - 横走 - 竖入
          var my = (y1 + y2) / 2;
          out.push('<path d="M' + x1 + ' ' + y1 + ' V' + my + ' H' + x2 + ' V' + y2 + '" fill="none" stroke="#64748b" stroke-width="1.4"' + (e.dashed ? ' stroke-dasharray="5 3"' : '') + (e.arrow !== false ? ' marker-end="url(#mArrow)"' : '') + '/>');
        } else {
          out.push('<path d="M' + x1 + ' ' + y1 + ' V' + y2 + '" fill="none" stroke="#64748b" stroke-width="1.4"' + (e.dashed ? ' stroke-dasharray="5 3"' : '') + (e.arrow !== false ? ' marker-end="url(#mArrow)"' : '') + '/>');
        }
      } else {
        var sa2 = sizeOf(g.nodes[e.from].label), sb2 = sizeOf(g.nodes[e.to].label);
        x1 = a.x + sa2.w / 2; x2 = b.x - sb2.w / 2;
        if (Math.abs(y2 - y1) > 4) {
          var mx = (x1 + x2) / 2;
          out.push('<path d="M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + x2 + '" fill="none" stroke="#64748b" stroke-width="1.4"' + (e.dashed ? ' stroke-dasharray="5 3"' : '') + (e.arrow !== false ? ' marker-end="url(#mArrow)"' : '') + '/>');
        } else {
          out.push('<path d="M' + x1 + ' ' + y1 + ' H' + x2 + '" fill="none" stroke="#64748b" stroke-width="1.4"' + (e.dashed ? ' stroke-dasharray="5 3"' : '') + (e.arrow !== false ? ' marker-end="url(#mArrow)"' : '') + '/>');
        }
      }
      if (e.label) {
        var lx = (pos[e.from].x + pos[e.to].x) / 2, ly = (pos[e.from].y + pos[e.to].y) / 2 - 4;
        out.push('<text x="' + lx + '" y="' + ly + '" text-anchor="middle" font-size="11" fill="#94a3b8">' + esc(e.label) + '</text>');
      }
    });
    // 节点
    g.order.forEach(function (id) {
      var n = g.nodes[id];
      var p = pos[id];
      if (!p) { return; }
      var sz = sizeOf(n.label);
      var x = p.x - sz.w / 2, y = p.y - sz.h / 2;
      if (n.shape === 'diamond') {
        var cx = p.x, cy = p.y, hw = sz.w / 2 + 8, hh = sz.h / 2 + 10;
        out.push('<polygon points="' + cx + ',' + (cy - hh) + ' ' + (cx + hw) + ',' + cy + ' ' + cx + ',' + (cy + hh) + ' ' + (cx - hw) + ',' + cy + '" fill="#fffbeb" stroke="#d97706" stroke-width="1.3" rx="3"/>');
      } else if (n.shape === 'round') {
        out.push('<rect x="' + x + '" y="' + y + '" width="' + sz.w + '" height="' + sz.h + '" rx="17" fill="#eef2ff" stroke="#4f46e5" stroke-width="1.3"/>');
      } else {
        out.push('<rect x="' + x + '" y="' + y + '" width="' + sz.w + '" height="' + sz.h + '" rx="4" fill="#f0fdf4" stroke="#059669" stroke-width="1.3"/>');
      }
      out.push('<text x="' + p.x + '" y="' + (p.y + 4) + '" text-anchor="middle" font-size="12.5" fill="#1e293b">' + esc(n.label) + '</text>');
    });
    out.push('</svg>');
    return out.join('');
  }

  return { parse: parse, render: render };
});
