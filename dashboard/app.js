/* HarborMaster board — the reading face.
 *
 * Fed by `window.__HM__`, written into data.js by scripts/build-data.ps1 from
 * `harbormaster --probe --json`. No fetch(), so the page works from a file://
 * path with no server and no CORS; no build step, so there is nothing to run
 * before opening it.
 *
 * Library split is decided in vendor/VENDOR.md and is not a per-panel choice:
 * anything with a time axis is uPlot, everything else is ECharts.
 */
(function () {
  'use strict';

  var D = window.__HM__;
  var snap = D && D.snapshot;
  if (!snap) {
    document.getElementById('subtitle').textContent =
      'No data. Run scripts/build-data.ps1 to write data.js.';
    return;
  }

  var C = {
    ink: '#dfe6ef', mute: '#7c8a9c', line: '#27303d', surface: '#1c222d',
    good: '#46c88a', warn: '#e0a23c', crit: '#e05c5c', accent: '#4bb8d8'
  };

  // ── header ────────────────────────────────────────────────────────────────
  var generated = new Date(snap.generated);
  var ageMin = Math.round((Date.now() - generated.getTime()) / 60000);
  var ageTxt = ageMin < 90 ? ageMin + ' min ago'
             : Math.round(ageMin / 60) + ' h ago';
  document.getElementById('subtitle').innerHTML =
    'berth <b>' + esc(snap.berth) + '</b> · snapshot ' + esc(generated.toISOString().replace('T', ' ').slice(0, 16)) +
    ' <span class="' + (ageMin > 180 ? 'stale' : 'mute') + '">(' + ageTxt + ')</span>' +
    ' · ' + D.history.length + ' snapshot' + (D.history.length === 1 ? '' : 's') + ' kept';

  // ── KPI strip ─────────────────────────────────────────────────────────────
  var t = snap.totals;
  var crit = snap.gaps.filter(function (g) { return g.severity === 'crit'; }).length;
  var measured = snap.rows.filter(function (r) { return r.measurement === 'measured'; }).length;
  // Only cargo that could be measured counts in the denominator — a Node service
  // with no property is not a shortfall.
  var measurable = snap.rows.filter(function (r) { return r.measurement !== 'not provisioned'; }).length;

  kpi('Cargo', t.projects, t.drupal + ' Drupal · ' + t.node + ' Node');
  kpi('Healthy', t.healthy + ' / ' + t.projects, '', t.healthy === t.projects ? 'good' : 'crit');
  kpi('Measured', measured + ' / ' + measurable, measurable === 0 ? '' : 'emitting and recording',
      measured === measurable ? 'good' : 'warn');
  kpi('Open gaps', snap.gaps.length, crit + ' critical', crit > 0 ? 'crit' : (snap.gaps.length ? 'warn' : 'good'));
  if (snap.host) {
    kpi('Disk', snap.host.disk_pct + '%', snap.host.disk, snap.host.disk_pct > 85 ? 'crit' : '');
    kpi('Load', snap.host.load, 'uptime ' + snap.host.uptime);
  }

  function kpi(k, v, n, cls) {
    var el = document.createElement('div');
    el.className = 'kpi';
    el.innerHTML = '<div class="k">' + esc(k) + '</div>' +
                   '<div class="v ' + (cls || '') + '">' + esc(String(v)) + '</div>' +
                   '<div class="n">' + esc(n || '') + '</div>';
    document.getElementById('kpis').appendChild(el);
  }

  // ── fleet table ───────────────────────────────────────────────────────────
  var rows = snap.rows.slice().sort(function (a, b) {
    return a.project.slug.localeCompare(b.project.slug);
  });

  var html = '<table class="fleet"><thead><tr>' +
    '<th>cargo</th><th>health</th><th>http</th><th>response</th>' +
    '<th>core</th><th>measurement</th><th>tag</th><th>users · 7d</th>' +
    '</tr></thead><tbody>';

  rows.forEach(function (r) {
    var a = analytics(r);
    var maint = r.project.maintenance && r.project.maintenance !== '0';
    html += '<tr>' +
      '<td class="mono">' + esc(r.project.slug) + '</td>' +
      '<td class="' + healthCls(r.health) + '">' + esc(maint ? 'maintenance' : r.health) + '</td>' +
      '<td class="mono ' + (r.http && r.http.ok ? '' : 'crit') + '">' + (r.http ? r.http.code : '—') + '</td>' +
      '<td class="mono">' + (r.http ? r.http.latency_ms + ' ms' : '—') + '</td>' +
      '<td class="mono">' + esc(r.project.core || '—') + '</td>' +
      '<td class="' + measCls(r.measurement) + '">' + esc(r.measurement) + '</td>' +
      '<td class="mono mute">' + esc((r.http && r.http.emitted_tag) || '—') + '</td>' +
      '<td class="mono">' + (a ? a.users_recent + ' · ' + a.sessions_recent + ' s' : stateTxt(r.analytics)) + '</td>' +
      '</tr>';
  });
  document.getElementById('fleet').innerHTML = html + '</tbody></table>';

  // ── gaps ──────────────────────────────────────────────────────────────────
  var gl = document.getElementById('gaps');
  if (!snap.gaps.length) {
    gl.innerHTML = '<li class="empty">Nothing open.</li>';
  } else {
    snap.gaps.slice().sort(function (a, b) {
      return (a.severity === 'crit' ? 0 : 1) - (b.severity === 'crit' ? 0 : 1);
    }).forEach(function (g) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="lbl ' + (g.severity === 'crit' ? 'crit' : 'warn') + '">' +
        esc(g.label) + '</span> <span class="mute">' + esc(g.text) + '</span>';
      gl.appendChild(li);
    });
  }

  // ── ECharts: everything that is not a time series ─────────────────────────
  var base = {
    backgroundColor: 'transparent',
    textStyle: { color: C.ink, fontFamily: 'Segoe UI, system-ui, sans-serif' },
    grid: { left: 112, right: 22, top: 14, bottom: 26 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }
  };
  function axisCat(names) {
    return {
      type: 'category', data: names,
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.mute, fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 11 }
    };
  }
  function axisVal(name) {
    return {
      type: 'value', name: name, nameTextStyle: { color: C.mute, fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: C.mute, fontSize: 11 },
      splitLine: { lineStyle: { color: C.line } }
    };
  }

  // Response time, worst at the top — the eye should land on the slowest.
  var lat = rows.filter(function (r) { return r.http; })
                .sort(function (a, b) { return a.http.latency_ms - b.http.latency_ms; });
  echarts.init(document.getElementById('latency'), null, { renderer: 'canvas' }).setOption(Object.assign({}, base, {
    xAxis: axisVal('ms'),
    yAxis: axisCat(lat.map(function (r) { return r.project.slug; })),
    series: [{
      type: 'bar', barWidth: '58%',
      data: lat.map(function (r) {
        return { value: r.http.latency_ms, itemStyle: { color: r.http.ok ? C.accent : C.crit } };
      }),
      label: { show: true, position: 'right', color: C.mute, fontSize: 11, formatter: '{c} ms' }
    }]
  }));

  // Certificate runway. 21 days is the board's existing warning threshold.
  var tls = rows.map(function (r) { return { slug: r.project.slug, days: daysUntil(r.project.tls) }; })
                .filter(function (x) { return x.days !== null; })
                .sort(function (a, b) { return b.days - a.days; });
  echarts.init(document.getElementById('tls')).setOption(Object.assign({}, base, {
    xAxis: axisVal('days'),
    yAxis: axisCat(tls.map(function (x) { return x.slug; })),
    series: [{
      type: 'bar', barWidth: '58%',
      data: tls.map(function (x) {
        return { value: x.days, itemStyle: { color: x.days <= 7 ? C.crit : x.days <= 21 ? C.warn : C.good } };
      }),
      label: { show: true, position: 'right', color: C.mute, fontSize: 11, formatter: '{c} d' },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: C.warn, type: 'dashed', width: 1 },
        label: { color: C.mute, fontSize: 10, formatter: '21 d' },
        data: [{ xAxis: 21 }]
      }
    }]
  }));

  // Berth headroom. Percentages share one axis; load is a count, so it is
  // plotted as its own series against the same scale only because 4 vCPU makes
  // "load 4" and "100%" mean roughly the same thing — labelled, not implied.
  if (snap.host) {
    var h = snap.host;
    echarts.init(document.getElementById('host')).setOption(Object.assign({}, base, {
      grid: { left: 92, right: 46, top: 14, bottom: 26 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
                 formatter: function (p) { return p.map(function (x) { return x.name + ': ' + x.value + (x.name === 'load (×25)' ? '' : '%'); }).join('<br>'); } },
      xAxis: Object.assign(axisVal('% of capacity'), { max: 100 }),
      yAxis: axisCat(['load (×25)', 'memory', 'disk']),
      series: [{
        type: 'bar', barWidth: '52%',
        data: [
          { value: Math.min(100, Math.round(parseFloat(h.load) * 25)), itemStyle: { color: pct(parseFloat(h.load) * 25) } },
          { value: h.mem_pct, itemStyle: { color: pct(h.mem_pct) } },
          { value: h.disk_pct, itemStyle: { color: pct(h.disk_pct) } }
        ],
        label: {
          show: true, position: 'right', color: C.mute, fontSize: 11,
          formatter: function (p) {
            return p.dataIndex === 0 ? h.load : (p.dataIndex === 1 ? h.mem_pct + '% · ' + h.mem : h.disk_pct + '% · ' + h.disk);
          }
        }
      }]
    }));
  }
  function pct(v) { return v >= 85 ? C.crit : v >= 70 ? C.warn : C.good; }

  // ── uPlot: the only time axis on the page ─────────────────────────────────
  drawSeries();
  function drawSeries() {
    var el = document.getElementById('series');
    var hist = D.history.filter(function (h) { return h.t && h.latency; });
    if (hist.length < 2) {
      el.innerHTML = '<div class="empty">Needs at least two snapshots. ' +
        'Kept so far: ' + D.history.length + '. Run the build again to add one.</div>';
      return;
    }
    var slugs = Object.keys(hist[hist.length - 1].latency).sort();
    var xs = hist.map(function (h) { return Math.floor(new Date(h.t).getTime() / 1000); });
    var data = [xs].concat(slugs.map(function (s) {
      return hist.map(function (h) { return h.latency[s] == null ? null : h.latency[s]; });
    }));
    var palette = [C.accent, C.good, C.warn, '#9b7fd4', '#d87fb8', '#6fd0c0'];
    var opts = {
      width: el.clientWidth, height: 300,
      scales: { x: { time: true } },
      axes: [
        { stroke: C.mute, grid: { stroke: C.line, width: 1 }, ticks: { stroke: C.line } },
        { stroke: C.mute, label: 'ms', labelSize: 30, grid: { stroke: C.line, width: 1 }, ticks: { stroke: C.line } }
      ],
      series: [{}].concat(slugs.map(function (s, i) {
        return { label: s, stroke: palette[i % palette.length], width: 1.6, points: { show: hist.length < 30 } };
      }))
    };
    var u = new uPlot(opts, data, el);
    window.addEventListener('resize', function () { u.setSize({ width: el.clientWidth, height: 300 }); });
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function analytics(r) {
    return r.analytics && typeof r.analytics === 'object' ? r.analytics.Ok || null : null;
  }
  function stateTxt(a) {
    if (a === 'AuthExpired') return '<span class="warn">auth expired</span>';
    if (a === 'Loading') return '<span class="mute">checking…</span>';
    if (a === 'Disabled') return '<span class="mute">not configured</span>';
    if (a === 'NoProperty') return '<span class="mute">—</span>';
    return '<span class="mute">—</span>';
  }
  function healthCls(h) { return h === 'healthy' ? 'good' : h === 'degraded' ? 'warn' : 'crit'; }
  function measCls(m) {
    if (m === 'measured') return 'good';
    if (m === 'BLIND' || m === 'DARK' || m === 'UNOWNED TAG') return 'crit';
    if (m === 'never recorded') return 'warn';
    return 'mute';
  }
  function daysUntil(s) {
    if (!s) return null;
    var d = Date.parse(s);
    if (isNaN(d)) return null;
    return Math.round((d - Date.now()) / 86400000);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
})();
