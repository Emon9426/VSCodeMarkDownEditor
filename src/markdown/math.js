/**
 * Markdown Word — 轻量数学公式渲染器（UMD 双端）
 * LaTeX 常用子集 → HTML/CSS：上下标、分数、根号、希腊字母、运算符、\text。
 * 零依赖零字体文件（KaTeX 等外部库无法经安全通道获取的自研替代）。
 * 任何异常/未识别命令都安全退化为原始文本，永不失败。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.MdMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SYM = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
    nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
    phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗',
    leq: '≤', geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼',
    infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
    in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩',
    emptyset: '∅', varnothing: '∅', therefore: '∴', because: '∵',
    rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
    ldots: '…', cdots: '⋯', dots: '…', quad: '\u2003', qquad: '\u2003\u2003',
    sum: '∑', prod: '∏', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
    perp: '⊥', parallel: '∥', angle: '∠', degree: '°', circ: '∘',
    lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', neg: '¬', land: '∧', lor: '∨'
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(tex) {
    var s;
    try {
      s = esc(String(tex == null ? '' : tex));
      s = s.replace(/\\\\/g, '<br>');
      // \text{...}（内容保持文本）
      s = s.replace(/\\text\{([^}]*)\}/g, '<span class="mtext">$1</span>');
      s = s.replace(/\\mathrm\{([^}]*)\}/g, '<span class="mtext">$1</span>');
      // \frac{a}{b}（递归处理嵌套：循环到无变化）
      var guard = 0;
      while (/\\frac\{/.test(s) && guard++ < 20) {
        s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g,
          '<span class="mfrac"><span class="mnum">$1</span><span class="mden">$2</span></span>');
      }
      // \sqrt{x} / \sqrt[n]{x}
      s = s.replace(/\\sqrt\[(\d+)\]\{([^{}]*)\}/g, '<span class="mop">$1</span><span class="msqrt">√<span class="mrad">$2</span></span>');
      s = s.replace(/\\sqrt\{([^{}]*)\}/g, '<span class="msqrt">√<span class="mrad">$1</span></span>');
      // \left \right 括号（去掉命令保留括号）
      s = s.replace(/\\left\s*([(\[{|.])/g, '$1').replace(/\\right\s*[)\]}|.]/g, function (m) {
        return m.replace(/\\right\s*/, '');
      });
      // \overline{x}
      s = s.replace(/\\overline\{([^{}]*)\}/g, '<span class="mover">$1</span>');
      // \vec{x} / \hat{x} / \bar{x}
      s = s.replace(/\\vec\{([^{}]*)\}/g, '<span class="mvec">$1</span>');
      s = s.replace(/\\(?:hat|bar)\{([^{}]*)\}/g, '<span class="mbar">$1</span>');
      // 符号命令（后瞻不接字母即可，避免 \sum_ 中 _ 属于 \w 导致 \b 失效）
      s = s.replace(/\\([a-zA-Z]+)(?![a-zA-Z])/g, function (m, name) {
        return SYM[name] !== undefined ? SYM[name] : m;
      });
      // 上下标（{} 组或单字符），在大括号包裹的 HTML 标签内不误处理（标签含 = " 等非 \^ 起点）
      guard = 0;
      while (/(?:\^|_)\{/.test(s) && guard++ < 20) {
        s = s.replace(/([\\^]?)(?:\^|_)\{([^{}]*)\}/g, function (m, pre, body) {
          if (pre === '\\') { return m; }
          var isSup = m.charAt(pre === '\\' ? 1 : 0) === '^';
          return '<span class="m' + (isSup ? 'sup' : 'sub') + '">' + body + '</span>';
        });
      }
      s = s.replace(/([a-zA-Z0-9)\]])\^([a-zA-Z0-9+\-])/g, '$1<span class="msup">$2</span>');
      s = s.replace(/([a-zA-Z0-9)\]])_([a-zA-Z0-9+\-])/g, '$1<span class="msub">$2</span>');
      // 未识别的剩余命令：去反斜杠降级显示
      s = s.replace(/\\([a-zA-Z]+)/g, '$1');
      s = s.replace(/[{}]/g, '');
      return s;
    } catch (e) {
      return esc(String(tex));
    }
  }

  return { render: render, SYM: SYM };
});
