# HarborMaster — charter

> **Status:** ruled by Carlos 2026-10-02; written the same day. Supersedes the
> scope in `README.md`. Folds in `docs/OPS_PLAN.md` (2026-09-16) and
> `docs/ANALYTICS_PLAN.md` as phases. Formerly **Lighthouse**: the rename is
> planned in §9 and not yet executed.

## 1. What it is

**HarborMaster runs the webrunners platform.** It owns the servers, owns every
server's configuration, and sees and drives every surface of what runs on
them: host, Docker, edge, the PHP runtime inside each request, the databases,
files, logs, backups and releases.

Lighthouse answered "is the fleet up?" for one server. HarborMaster answers
"what is every server running, how well, and why", for every server we will
ever have. `ssdnodes1` is the first berth. There will be more.

Carlos, 2026-10-02:

- "lighthouse needs a name change and scope redirection to being and all
  surfaces platform runner, owns the servers and their configs, ssdnodes1 is
  one server, there will be more"
- the in-request numbers, a PHP explorer and log readers: "all of it, the
  higher purpose of it all … put all this in its DNA"

## 2. The lingo

A container terminal is the literal picture of this platform: containers
handled across berths by machinery that a terminal operating system plans. The
vocabulary is used in code, CLI verbs and the board.

| Terminal | Here |
|---|---|
| **berth** | a server: `ssdnodes1`. Lower-case names, per the seat convention for VMs |
| **stow plan** | the desired state of a berth: what runs on it, with which settings. Kept in this repo, one directory per berth |
| **manifest** | what is actually there now, gathered from the berth |
| **cargo** | an app on the platform: the five Drupal properties, leecher, myevery (DR coverage only) |
| **reefer** | a stateful container (MariaDB, SQLite). Like a reefer needing power, it needs its volume |
| **spreader** | the probe that locks onto one container and reads inside a live request: opcache, APCu, ini, workers |
| **gantry** | moves: deploy, rollback, restart, move a cargo to another berth |
| **moves per hour** | performance: the before/after numbers that prove a change |
| **harbourmaster's log** | the record of every manual operation (policy §9.4) |

## 3. Principles

Kept from Lighthouse:

1. **Off-box.** HarborMaster runs on the operator's workstation and reaches each
   berth over SSH. A dead berth reads as unreachable instead of going dark with
   everything else on it.
2. **The operator is the only source of intent.** Every mutating step shows the
   exact command and is confirmed. Destructive steps show their blast radius
   and need a typed confirmation.
3. **Maintenance OFF is a human click**, never a step inside a flow.
   HarborMaster may turn maintenance on.
4. **Secrets never travel in cleartext** and never enter a log, a commit or the
   board.
5. **No new public surface.** Nothing listens on a port for HarborMaster. The
   spreader is reached only from inside its own container (§5.1).

New:

6. **It owns the configuration.** A berth's stow plan in this repo is its desired
   state: host settings, edge, per-cargo resource overrides, telemetry, the host
   scripts. Today these live in `web_server/infra/`. They move here (§7), and
   from then on there is one source for each file.
7. **Many berths from day one.** No setting assumes one server: no single
   `host_alias`, and no list of properties that is not derived from a stow plan.
8. **Seeing is the purpose.** Every action has a reading that proves it. A
   change without a before/after reading is not done (§6).

## 4. Surfaces

HarborMaster is one codebase with three faces:

| Face | Who | State |
|---|---|---|
| **Board**: the egui desktop app | the operator | exists (Lighthouse v0.1, health + GA4) |
| **CLI**: `harbormaster <verb> <berth> [cargo]`, headless | the operator, cron, CI | `--probe` exists; verbs to come |
| **Client view**: read-only, scoped to one client's cargo | hosting clients (BOUTIQUE_TRANSITION §11.2) | later. It must never show another client's cargo or any secret |

## 5. The DNA: seeing inside every surface

### 5.1 The spreader: inside a live request

Opcache, APCu, the realpath cache and the worker pool exist only inside the web
server's own processes. A CLI `php` sees a different, empty opcache. So the
numbers that prove PHP is tuned can only be read from a real request, which is
what the spreader is:

- **Code:** `spreader.php` lives in this repo and is copied into every image by
  the platform tuning block (drupal-skeleton first, then every property),
  **outside the docroot**, at `/opt/harbormaster/spreader.php`.
- **Exposure:** an Apache `Alias /.harbormaster/spreader` with `Require local`.
  Traefik's requests come from another address, so the path is denied from the
  internet without relying on any secret. Drupal's `.htaccess` rewrites never
  see it, because the alias points outside the docroot.
- **Reach:** `ssh <berth> docker exec <container> curl -s http://127.0.0.1/.harbormaster/spreader`.
  The request is made by the container to itself.
- **Read-only, JSON:**
  - `opcache_get_status(false)` and `opcache_get_configuration()`: cached scripts
    against files on disk, hit rate, memory used and wasted, OOM restarts,
    interned strings;
  - `apcu_cache_info(true)` and `apcu_sma_info(true)`: hits, misses, entries,
    memory, fragmentation;
  - the effective ini (the platform keys plus anything differing from the
    baseline), loaded extensions, PHP version, `realpath_cache_size()`;
  - Apache's scoreboard: busy and idle workers against `MaxRequestWorkers`.
- Never: request data, environment variables, keys or secrets.

### 5.2 The PHP explorer

The board's view of the spreader, per cargo:

- the effective configuration, with drift from the platform baseline marked;
- which scripts fill opcache, by memory;
- APCu entries by prefix (the Drupal cache bins);
- and comparison across cargo, since every property should read the same.

### 5.3 Log readers

One reader, every log, filtered by berth, cargo, time and severity:

| Log | Where |
|---|---|
| Apache errors, PHP warnings and fatals | the container's stdout/stderr (`docker logs`, json-file, rotated) |
| Drupal's own log | `drush watchdog:show` |
| MariaDB slow queries (≥ 1 s) | `<container>-slow.log` in each data directory |
| Traefik access and service logs | `/srv/tecnocratica/traefik/logalot/` |
| Deploy history | `deploy-prod` output, and the digest ledger (OPS_PLAN P1) |
| Host | `journalctl`, `sar`, `host-mem.tsv` (balloon and swap), `docker-stats.tsv` |
| The harbourmaster's log | every operation run through HarborMaster |

### 5.4 Telemetry over time

Readings are kept: the per-minute host memory and balloon counters, the
five-minute container stats, `sar` (28 days), and the spreader readings sampled
on a schedule. The board draws them; the CLI exports them.

## 6. Moves per hour: how a change is proven

The method behind `web_server/docs/PLATFORM_PERFORMANCE_AUDIT.md`, made a
standing feature. For every change to a berth or a cargo:

1. **Before:** take a reading with the same tool, under the same conditions:
   - TTFB, uncached and cached, n ≥ 30;
   - the TLS handshake;
   - spreader numbers;
   - temporary tables written to disk;
   - CPU and memory over a day.
2. **Change it**, through a gantry move.
3. **After:** take the same reading again, once the caches are warm.
4. **Verdict:** state the criterion up front. If it is not met, the change goes
   back.

Guard rails (limits, worker caps, log rotation) are proven by "nothing got
worse": no errors under a light load test, no queued requests, no OOM kills.

## 7. What it owns, and what moves here

Each berth becomes a directory:

```
berths/ssdnodes1/
├── berth.toml           # provider, address, SSH alias, plan, known traits
├── host/                # webrunners.slice, daemon.json, logrotate, sysstat
├── telemetry/           # host-mem-snapshot, docker-stats-snapshot, cron
├── edge/                # traefik.yml, its compose + override
├── cargo/<apex>/        # docker-compose.override.yaml per site
└── scripts/             # deploy-prod, deploy-dev, backup, restore, tec-seed, …
```

`berth.toml` records what is known about the machine:

- SSDnodes, KVM, 4 vCPU, 15.6 GiB, at 104.225.221.7;
- SSH alias `tecnocratica_node_1` today; `ssdnodes1` to be added;
- a ballooned memory plan: the operator ruled 2026-10-01 to ignore it and size
  for the nominal RAM.

What moves from `web_server/infra/`, and when:

| From webrunners | To | When |
|---|---|---|
| `infra/host/` (slice, daemon.json, logrotate, overrides) | `berths/ssdnodes1/host/`, `cargo/` | H3 |
| `infra/telemetry/` | `berths/ssdnodes1/telemetry/` | H3 |
| `infra/traefik/` | `berths/ssdnodes1/edge/` | H3 |
| `infra/scripts/` host-side scripts + `infra/install.sh` | `berths/<berth>/scripts/` + `harbormaster install <berth>` | H3 |
| `infra/scripts/platform-audit/` | the CLI's reading verbs | H2 |
| `infra/templates/` (dev compose, CI template) | `cargo/` templates | H3 |

**webrunners keeps** the platform's policy and protocol documents: DATAFLOW,
PROPERTY_PROTOCOL, CORE policy and the audits. It points here for anything that
runs on a berth. Until a file has moved, it is edited where it is, never in two
places.

## 8. Cargo on the platform

| Cargo | Kind | Notes |
|---|---|---|
| tecnocratica, monpetitcafe, tempowatch, zero-shot-games, oidoenvivo | Drupal + MariaDB | images from each repo's CI |
| leecher | Python job, cron | the platform's event harvester; own repo `I:\leecher`. Its first production run is the operator's go |
| myevery | Node + SQLite | DR and backup only (standing rule) |
| dev environments | Drupal, ephemeral | `dev/<slug>`, smaller limits |

## 9. The rename: Lighthouse → HarborMaster

Display name **HarborMaster**; identifier `harbormaster`. Nothing below has been
done yet.

| Where | Change |
|---|---|
| GitHub | rename `ophiocus/lighthouse` → `ophiocus/harbormaster`. GitHub redirects the old URL, so installed v0.x copies still find their update |
| `Cargo.toml` | `name = "harbormaster"`; description |
| `src/main.rs` | `APP_NAME`, `APP_WINDOW_TITLE`, `APP_GH_REPO`; `LighthouseApp` → `HarborMasterApp` |
| config | `%APPDATA%\Lighthouse\config.json` → `%APPDATA%\HarborMaster\`, read once from the old path if the new one is missing |
| config shape | `host_alias` → a list of berths, read from `berths/*/berth.toml` |
| `wix/main.wxs` | display name, folder, exe, Start-menu shortcut, registry key. **Keep the `UpgradeCode`**, so the MSI upgrades the installed Lighthouse in place |
| local checkout | `I:\lighthouse` → `I:\harbormaster`. Do it from outside any session anchored there |
| icon, README, docs | new name, with the lingo |
| webrunners | the docs naming Lighthouse (BOUTIQUE_TRANSITION §11, CODEBASE_PERFORMANCE_AUDIT is about Google's Lighthouse — leave that one), swivel lanes, memory |
| release | `v0.2.0` "HarborMaster" — the first build under the new name |

## 10. Milestones

| ID | Delivers | Risk |
|---|---|---|
| **H0** | Rename (§9), released as v0.2.0, self-update proven from an installed Lighthouse | none to the fleet |
| **H1** | Berths: `berths/ssdnodes1/berth.toml`, a multi-berth config, board grouped by berth, `ssdnodes1` SSH alias | read-only |
| **H2** | The DNA: spreader in the skeleton and the five images; PHP explorer; log readers; reading verbs (`harbormaster read ttfb|spreader|db|host <berth> [cargo]`). First use: the before/after verdict on the 2026-10 platform tuning | one image change per property; read-only otherwise |
| **H3** | Config ownership: §7's moves, `harbormaster install <berth>` replacing `infra/install.sh` and `infra/host/install.sh` | host files rewritten from a new source: diff-checked against the berth first |
| **H4–H8** | OPS_PLAN P0–P4: backup and drift visibility, coverage gaps, portable bundles and restore drills, whole-berth rebuild, releases and migrations from the board | as OPS_PLAN |
| **H9** | The second berth: placement, moving one cargo between berths, DNS cutover | needs the server |
| **H10** | Client view | read-only, per client |
