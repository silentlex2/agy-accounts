// Renders the snapshot cli.js export-page writes next to this file.
// A magpie page cannot fetch (connect-src 'none'), so data arrives as a <script>.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-US'); };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };

  function ago(iso) {
    if (!iso) return '未知';
    var s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 10) return '刚刚';
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    return Math.round(s / 3600) + ' 小时前';
  }

  function poolIndexOf(d, email) {
    var list = d.accounts || [];
    for (var i = 0; i < list.length; i++) { if (list[i].email === email) return i + 1; }
    return 0;
  }

  function renderCurrent(d) {
    var cur = d.current || {};
    var box = $('current');
    box.replaceChildren();
    var row = el('div', 'who');
    row.append(el('span', 'mark'));
    var txt = el('div');
    txt.append(el('div', 'mail', cur.email || '未读到凭据'));
    var bits = [];
    if (cur.authMethod) bits.push(cur.authMethod);
    if (cur.expiresInMin !== null && cur.expiresInMin !== undefined) bits.push('token 还剩 ' + cur.expiresInMin + ' 分钟');
    var idx = poolIndexOf(d, cur.email);
    if (idx) bits.push('池 #' + idx);
    txt.append(el('div', 'meta', bits.join('  ·  ')));
    row.append(txt);
    box.append(row);
  }

  function renderPool(d) {
    var list = $('accounts');
    list.replaceChildren();
    var cur = (d.current || {}).email;
    var accounts = d.accounts || [];
    if (!accounts.length) {
      list.append(el('li', 'empty', '账号池是空的。登录后运行 agy-accounts.cmd add'));
      return;
    }
    accounts.forEach(function (a) {
      var li = el('li');
      var who = el('div', 'who2');
      who.append(el('div', 'em', a.email));
      var sub = [a.label || '未命名'];
      if (a.addedAt) sub.push(String(a.addedAt).slice(0, 10));
      who.append(el('div', 'lb', sub.join('  ·  ')));
      li.append(who);
      if (a.email === cur) li.append(el('span', 'now', 'active'));
      list.append(li);
    });
  }

  function renderFigures(d) {
    var u = d.usage || {};
    var box = $('figures');
    box.replaceChildren();
    [
      ['区间', (u.days || 30) + ' 天'],
      ['生成次数', fmt(u.calls)],
      ['输入 token', fmt(u.input)],
      ['输出 token', fmt(u.output)],
      ['合计 token', fmt(u.total)],
    ].forEach(function (pair) {
      var f = el('div', 'fig');
      f.append(el('div', 'k', pair[0]));
      f.append(el('div', 'v', pair[1]));
      box.append(f);
    });
  }

  function renderSpark(d) {
    var box = $('spark');
    box.replaceChildren();
    var days = ((d.usage || {}).byDay || []);
    var total = ((d.usage || {}).total || 0);
    if (!days.length) {
      box.append(el('div', 'empty', '还没有按天的记录'));
      return;
    }
    var W = 640, H = 44, pad = 3;
    var max = 0;
    days.forEach(function (x) { if (x.total > max) max = x.total; });
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');

    var base = document.createElementNS(ns, 'line');
    base.setAttribute('x1', '0'); base.setAttribute('x2', String(W));
    base.setAttribute('y1', String(H - pad)); base.setAttribute('y2', String(H - pad));
    base.setAttribute('stroke', 'var(--hair)');
    base.setAttribute('stroke-width', '1');
    base.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(base);

    if (days.length === 1 || max === 0) {
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', String(W - 4)); dot.setAttribute('cy', String(H - pad - 1));
      dot.setAttribute('r', '2.4'); dot.setAttribute('fill', 'var(--ink)'); dot.setAttribute('opacity', '0.5');
      svg.append(dot);
    } else {
      var step = (W - pad * 2) / (days.length - 1);
      var pts = days.map(function (x, i) {
        var px = pad + i * step;
        var py = H - pad - (x.total / max) * (H - pad * 2);
        return [px, py];
      });
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var area = line + ' L' + (pad + (days.length - 1) * step).toFixed(1) + ' ' + (H - pad) + ' L' + pad + ' ' + (H - pad) + ' Z';
      var fillEl = document.createElementNS(ns, 'path');
      fillEl.setAttribute('d', area);
      fillEl.setAttribute('fill', 'var(--ink)');
      fillEl.setAttribute('opacity', '0.05');
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', line);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--ink)');
      path.setAttribute('stroke-width', '1.1');
      path.setAttribute('stroke-opacity', '0.5');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(fillEl, path);
    }
    box.append(svg);

    var meta = el('div', 'sparkmeta');
    var first = days[0];
    var last = days[days.length - 1];
    meta.append(el('span', '', first.day));
    meta.append(el('span', 'mid', fmt(total) + ' tokens · ' + days.length + ' 天'));
    meta.append(el('span', '', last.day));
    box.append(meta);
  }

  function renderModels(d) {
    var list = $('models');
    list.replaceChildren();
    var models = ((d.usage || {}).byModel || []);
    if (!models.length) { list.append(el('li', 'empty', '还没有用量记录')); return; }
    var max = 0;
    models.forEach(function (m) { if (m.total > max) max = m.total; });
    models.slice(0, 6).forEach(function (m) {
      var li = el('li');
      li.append(el('div', 'nm', m.model));
      var bar = el('div', 'bar');
      var fill = el('i');
      fill.style.width = Math.max(2, Math.round((m.total / (max || 1)) * 100)) + '%';
      bar.append(fill);
      li.append(bar);
      li.append(el('div', 'n', fmt(m.calls) + ' 次 · ' + fmt(m.total)));
      list.append(li);
    });
  }

  function fmtT(s) { return (s === null || s === undefined || s === 0) ? '—' : Number(s).toFixed(2) + 's'; }

  function renderTurns(d) {
    var stats = $('turnstats');
    var list = $('turns');
    var conv = $('turnconv');
    if (!stats || !list) return;
    stats.replaceChildren();
    list.replaceChildren();
    var t = d.turns;
    if (conv) conv.textContent = t ? t.conv.slice(0, 8) : '';
    if (!t) { list.append(el('li', 'empty', '还没有轮次数据')); return; }
    var s = t.stats || {};
    [
      ['首字中位', fmtT(s.ttftMedian)],
      ['首字 p90', fmtT(s.ttftP90)],
      ['速率中位', (s.tpsMedian || 0) + ' tok/s'],
      ['输出 token', fmt(s.output)],
      ['轮次', fmt(s.count)],
    ].forEach(function (pair) {
      var f = el('div', 'fig');
      f.append(el('div', 'k', pair[0]));
      f.append(el('div', 'v', pair[1]));
      stats.append(f);
    });

    (t.last || []).slice().reverse().forEach(function (x) {
      var li = el('li');
      var head = el('div', 'thead');
      head.append(el('span', 'tidx', '#' + x.idx));
      head.append(el('span', 'tmodel', x.endpoint || '-'));
      head.append(el('span', 'ttps', x.tps ? x.tps + ' tok/s' : '—'));
      li.append(head);
      var bits = [];
      if (x.client) bits.push('界面 ' + x.client);
      bits.push('首字 ' + fmtT(x.ttft));
      bits.push('耗时 ' + fmtT(x.dur));
      bits.push('出 ' + fmt(x.output) + '（思考 ' + fmt(x.think) + '）');
      if (x.cached) bits.push('缓存 ' + fmt(x.cached));
      li.append(el('div', 'tmeta', bits.join('  ·  ')));
      if (x.claude || x.nonGemini) {
        li.append(el('div', 'twarn', '⚠ 这一轮实际路由到了非 Gemini 模型'));
      }
      list.append(li);
    });
  }
  function paint(d) {
    $('stamp').textContent = '快照 ' + ago(d.generatedAt) + ' · 账号 ' + (d.accounts || []).length + ' 个 · 自动刷新';
    renderCurrent(d);
    renderPool(d);
    renderFigures(d);
    renderSpark(d);
    renderModels(d);
    renderTurns(d);
    $('hint').textContent = 'CLI: agy-accounts.cmd use <email> · usage --days 7 · turns --stats';
  }

  function pull() {
    var s = document.createElement('script');
    s.src = 'data.js?v=' + Date.now();
    s.onload = function () {
      if (globalThis.AGY_DATA) { paint(globalThis.AGY_DATA); }
      s.remove();
    };
    s.onerror = function () {
      $('stamp').textContent = '还没有快照 · 运行 agy-accounts.cmd export-page';
      s.remove();
    };
    document.head.append(s);
  }

  $('reload').addEventListener('click', pull);
  if (globalThis.magpie && magpie.ready) {
    magpie.ready.then(function (theme) {
      if (theme && theme.dark) document.documentElement.dataset.theme = 'dark';
    }).catch(function () {});
    if (magpie.onTheme) {
      magpie.onTheme(function (t) {
        if (t && t.dark) document.documentElement.dataset.theme = 'dark';
        else delete document.documentElement.dataset.theme;
      });
    }
  }
  var forced = new URLSearchParams(location.search).get('theme');
  if (forced === 'dark') document.documentElement.dataset.theme = 'dark';
  pull();
  setInterval(pull, 20000);
})();