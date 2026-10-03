# Vendored dataviz libraries

Committed, pinned, and loaded by relative `<script src>` — **not** fetched from a
CDN at view time and **not** installed at build time. The dashboard has to open
on a workstation with no network, from a `file://` path, with no build step and
no `npm install`. `node_modules` is a fetching detail; these files are the
dependency.

| File | Library | Version | Licence |
|---|---|---|---|
| `uPlot.iife.min.js`, `uPlot.min.css` | [uPlot](https://github.com/leeoniya/uPlot) | 1.6.32 | MIT |
| `echarts.min.js` | [Apache ECharts](https://echarts.apache.org/) | 6.1.0 | Apache-2.0 |

## The split, and why there are two

**One library per job, decided once so panels do not drift into whichever was
handy.**

- **uPlot → every reading that is a series over time.** The telemetry in
  CHARTER §5.4 is dense: host memory and balloon counters *per minute*, which is
  ~40,000 points over 28 days, plus five-minute container stats, `sar`, and
  sampled spreader readings. uPlot exists for exactly this shape — 50 KB, canvas,
  with pan, zoom and a cursor that stays responsive at that size. It is the
  default for anything with a time axis.
- **ECharts → everything that is not a series over time.** Treemap for opcache
  by script (§5.2), heatmap, boxplot for the TTFB distributions that decide a
  moves-per-hour verdict (§6), gauges for host headroom, bars for comparisons
  across cargo. One dependency covering the rest, rather than four small ones.

The full `echarts.min.js` is used rather than `.common` or `.simple` because
treemap, heatmap, boxplot and gauge are **only** in the full build, and those are
precisely the charts the charter asks for. If the client view (§10 H10) needs to
be lighter, build a custom ECharts bundle with just the used charts rather than
dropping to `.simple`.

## Updating

```
npm install --no-save uplot@<version> echarts@<version>
```

then copy `node_modules/uplot/dist/uPlot.iife.min.js`, `uPlot.min.css` and
`node_modules/echarts/dist/echarts.min.js` over the files here, update the table
above, and re-open the dashboard to check nothing moved. Pin the exact version in
the table — "latest" is not a record of what shipped.
