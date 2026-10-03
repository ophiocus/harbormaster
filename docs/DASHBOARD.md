# The reading face — dynamic dashboard

> Decided 2026-10-03. Answers "what is the interface for all this?" The egui
> board is not it, and was never going to be for the third face in
> [CHARTER.md](CHARTER.md) §4.

## Why a web dashboard at all, when a board already exists

The charter names three faces: the egui **Board**, the **CLI**, and a
**Client view** for hosting clients. The first two exist. The third cannot be
egui — clients will not install a Windows desktop app to see their own site's
numbers.

There is a second reason, and it is the one that bites daily. egui is an
immediate-mode UI toolkit; it is excellent for the Board's actual job, which is
**control** — confirm-gated gantry moves, maintenance toggles, a dense live
status grid. It is a poor place to build charts. Everything in CHARTER §5.4 and
§6 is chart-shaped: per-minute host memory over 28 days, TTFB distributions
before and after a change, opcache by script, APCu by prefix. Writing a zoomable
40,000-point time series by hand in egui is weeks of work that a charting
library does better.

So the split is by **verb, not by audience**:

| Face | Verb | Why there |
|---|---|---|
| egui Board | **do** | confirm-gated actions, live status, no browser in the loop |
| Web dashboard | **see** | charts, history, comparison, before/after verdicts |
| CLI | **script** | cron, CI, and the JSON that feeds the other two |

## The constraint that shapes it: no new surface

CHARTER §3 principle 5 is **"No new public surface. Nothing listens on a port
for HarborMaster."** A dashboard that is a web app would break that on day one.

It does not have to be one. The dashboard here is **a static page fed by a
generated file**:

```
harbormaster --probe --json   ->  one snapshot document
scripts/build-data.ps1        ->  dashboard/data.js  (window.__HM__ = {...})
                                  dashboard/history.jsonl  (append-only)
dashboard/index.html          ->  opens directly, no server
```

`data.js` is a **script assignment, not a `.json` file**, and that is the whole
trick. A browser opening `index.html` from a `file://` path is forbidden by CORS
from `fetch()`ing a sibling file, but it may always load a sibling `<script>`.
So: no server, no port, no CORS exception, no build step, nothing listening.
"Dynamic" here means the charts are interactive and the data is regenerated on
demand — not that anything is running.

This also sets up the client view cleanly: generating one file per client, from
a snapshot filtered to that client's cargo, is the same mechanism with a
different filter. Nothing new has to be stood up, and a file cannot leak another
client's cargo the way a misconfigured query can.

## Libraries

Pinned and committed under `dashboard/vendor/`. The choice and the rule are in
[vendor/VENDOR.md](../dashboard/vendor/VENDOR.md); the short version:

- **uPlot 1.6.32** — anything with a time axis. Built for exactly the density
  §5.4 produces.
- **ECharts 6.1.0** — everything else: treemap, heatmap, boxplot, gauge, bars.

**One library per job, decided once.** The failure mode with two charting
libraries is that panels get written in whichever was handiest, and the page ends
up with two visual languages and two interaction models. The rule above is what
prevents that, and it is the reason the split is recorded rather than left to
taste.

## History

HarborMaster does not keep readings yet — §5.4 is a milestone, not a feature.
Until it does, `build-data.ps1` appends one narrow point per run to
`history.jsonl` (timestamp, healthy count, gap count, host memory, per-cargo
latency). That is enough to make the time-series panel real rather than a mockup,
and it starts accumulating from the first run instead of from the milestone.

When §5.4 lands with proper per-minute telemetry, that store replaces this file;
the panel does not change.

## State

| Piece | State |
|---|---|
| `--probe --json` snapshot (`harbormaster/snapshot/1`) | done |
| Vendored uPlot + ECharts, split rule recorded | done |
| Page: KPIs, cargo table, response time, certificate runway, berth headroom, gaps, latency over time | done |
| `scripts/build-data.ps1`, history accumulation | done |
| A `harbormaster dashboard` verb that does the build-and-open itself | next — the PowerShell script is a stand-in |
| Panels for the DNA (§5.2): opcache treemap, APCu by prefix, TTFB boxplots | needs H2; the spreader has to exist first |
| Client view (§10 H10) | needs a per-client filter over the same generator |

## Notes from the first run against the live berth

- Certificates: all six properties expire **within six seconds of each other**
  (Dec 30). They were staggered across October and November in September, so
  something renewed the whole fleet in one batch. Worth a look — a single failed
  renewal window now takes every property's TLS at once, where before it would
  have taken one.
- The analytics lane renders `auth expired` rather than a fault, which is the
  behaviour the state machine was built for. The GA4 credential expires every 7
  days by design (the OAuth app is deliberately unpublished).
