# Operations plan — HarborMaster takes over backups, migrations and releases

> Status: **proposed, 2026-09-16.** Nothing here is built yet. Every "today"
> claim below was read from the live VPS and the workstation on 2026-09-16,
> not recalled from docs.

## The goal

HarborMaster today answers "is the fleet up, current and measured?". This plan
makes it the operator's console for the work that changes the fleet:

1. **Every product is backable.** Each property's full state can be captured,
   copied off the box, and proven restorable.
2. **Production is reproducible in batch.** The whole estate can be rebuilt on
   another server from off-box copies.
3. **Production is reproducible on call.** Any single property can be stood up
   on another server, or on a local DDEV, from the same artefact.
4. **Releases and migrations run through it.** Deploys, rollbacks, Drupal
   schema/content migrations and server moves are driven from the board, with
   the safety gates the platform policy already demands.

## Principles this keeps

- **Off-box.** HarborMaster stays on the workstation and reaches the host over
  SSH. That is also what makes it the natural owner of the off-host copy: it
  already runs on the second machine.
- **Host scripts execute; HarborMaster drives.** The host tooling in
  `web_server/infra/` (`backup`, `restore`, `deploy-prod`, `tec-site-apex`) is
  the single implementation. HarborMaster calls it and never re-implements it in
  Rust. New capability is added to `infra/`, shipped by `infra/install.sh`, and
  surfaced by HarborMaster.
- **Discovery, not lists.** `tec-site-apex --list` is the registry. Nothing in
  this plan adds a hand-maintained property list, and it removes the two that
  exist.
- **Platform policy wins** (`web_server/docs/CORE_INFRASTRUCTURE_POLICY.md`):
  - §0.1: the operator is the only source of intent. HarborMaster proposes and
    shows the exact command; the operator confirms every mutating step.
  - §0.2: HarborMaster may turn maintenance ON; turning it OFF stays a human
    click, never a step inside a flow.
  - §0.4: destructive steps show their blast radius and need a typed
    confirmation, not a single click.
  - §0.5: secrets never leave the box in cleartext. Off-box secret bundles are
    encrypted at rest.
  - §0.7: the installed base is the truth. HarborMaster's first new job is
    reporting where the host and the repo disagree.

## What the estate looks like today

| Property | Stack | State on the host | Nightly backup |
| --- | --- | --- | --- |
| tecnocratica | Drupal + MariaDB | db 434M, files 39M | yes, 30 dumps, 18 file snapshots |
| monpetitcafe | Drupal + MariaDB | db 750M, files 16M | yes, 30 dumps, 13 snapshots |
| tempowatch | Drupal + MariaDB | db 356M, files 61M | yes, 30 dumps, 1 snapshot |
| zero-shot-games | Drupal + MariaDB | db 363M, files 28M | yes, 30 dumps, 2 snapshots |
| oidoenvivo | Drupal + MariaDB | db 301M, files 1.3M, **private files 8K** | yes, 23 dumps, 3 snapshots; **private files not covered** |
| myevery | Node + SQLite (WAL) | `data/myevery.db` + 1 MB WAL | **no** — `backup --all` skips stacks without a `db` service |

Host: Ubuntu 24.04, Docker 29.6, Compose 5.2, Traefik v3, 69G of 315G used,
15G RAM. The last nightly run (2026-09-16 03:30 UTC) completed for all five
Drupal properties.

### Gaps, in order of risk

1. **The off-host copy is four months stale.** The workstation vault
   (`~/ssdnodes/_backups`) was last written 2026-05-22 and holds only
   tecnocratica and monpetitcafe, one dump each. Losing the VPS today loses
   four properties' content outright, and the other two roll back four months.
2. **`pull-backups` hardcodes two properties** for the secrets pull, so even a
   fresh run would copy `.env` for only two of six.
3. **myevery's data is never backed up.** Its SQLite database runs in WAL mode,
   so a plain file copy can also be inconsistent.
4. **The edge is not backed up.** `acme.json` (117K, every certificate),
   `traefik.yml` and the Traefik compose exist only on the host. Rebuilding
   without `acme.json` means re-issuing every certificate at once, against
   Let's Encrypt's rate limits.
5. **oidoenvivo's private files dir is outside the backup.** `backup` copies
   only `data/drupal-files`.
6. **Host configuration is not captured.** Cron entries, `/usr/local/bin`,
   ufw rules, sshd hardening and the GHCR login live only on the box.
7. **The host has drifted from the repo.** `deploy-myevery`,
   `docker-stats-snapshot` and `/etc/cron.d/webrunners-docker-stats` exist on
   the host but not in `web_server/infra`. Stray `.env.bak-*`, `.env.save`,
   `docker-compose.yaml.bak` and a legacy `monpetitcafe.com.co/backups/` dir sit
   next to live state.
8. **Images float.** Every app runs `:latest`, Traefik runs `traefik:v3`, and
   the `mariadb:11.4` tag has moved: three DB containers run an 2026-08-24
   build, two run a 2026-09-09 build. A rebuild today would not reproduce what
   is running.
9. **HarborMaster's own Redeploy bypasses `deploy-prod`.** It runs compose
   pull/up and `drush deploy` itself, so it skips the sitemap regeneration and
   the maintenance guarantee that the CI path gets.
10. **No manual-operation log.** Policy §9.4 names `~/deploy.log`; it does not
    exist.

Also pending, outside this plan but in its way: 41 upgradable packages, a
reboot required, and 42 GB of reclaimable Docker images.

## The core idea: one portable bundle

Backups, DR, server migration and "clone to local" are the same operation
with different targets. They should share one artefact.

A **property bundle** is a directory (or tarball) per property per point in
time:

```
<slug>/<ts>/
├── manifest.json        # slug, apex, type, git rev, image digests, host,
│                        # data parts, sizes, sha256 of every file below
├── compose.yaml         # the host copy, verbatim
├── env.age              # .env + credentials.txt, age-encrypted
├── db.sql.gz            # Drupal: the existing lean dump (revision tables kept)
├── app-data.tar.zst     # Node: SQLite taken with `.backup`, never a raw copy
├── files/ -> snapshot   # public files, hardlinked from the existing snapshot
└── private/ -> snapshot # private files, when the stack has them
```

An **edge bundle** (once per host) carries `traefik.yml`, the Traefik compose,
`acme.json` (age-encrypted), and a **host bundle** carries the cron files,
the `/usr/local/bin` inventory with hashes, ufw rules, sshd settings and the
package baseline.

The manifest records **image digests**, not tags. That is what makes a restore
reproduce what was running, while `deploy-prod` keeps pulling `:latest` for
normal releases.

## Phases

| Phase | Delivers | Risk |
| --- | --- | --- |
| P0 | See backup and drift state on the board | read-only |
| P1 | Close the coverage gaps; off-host copy on a schedule | additive host changes |
| P2 | Portable bundles; restore anywhere; automated restore drills | writes only to throwaway targets |
| P3 | Rebuild a whole host from bundles | needs a second target |
| P4 | Releases, rollbacks and migrations driven from HarborMaster | mutating, gated |

### P0 — See it (read-only)

- `gather.sh` reports per property: newest dump time and size, dump count,
  newest file snapshot, backup log errors, and which data parts exist but are
  **not** covered (private files, app data).
- It reports per host: whether the edge and host bundles exist and how old
  they are, the pending-update count it already has, and reclaimable image
  space.
- Drift report: sha256 of each `/usr/local/bin` tool against its
  `web_server/infra/scripts` twin; host-only tools; stray backup files; each
  running container's image digest against the tag's current digest; floating
  tags.
- HarborMaster reads the workstation vault and shows its age per property.
- Board: a **DR readiness** strip per property (on-box backup age, off-box
  copy age, last drill result) and a host strip for edge, host config and
  drift. Stale or missing turns amber, then red.

Acceptance: every gap listed above shows up on the board without anyone
knowing to look for it.

### P1 — Close the coverage gaps

In `web_server/infra` (shipped by `install.sh`):

- `backup` also snapshots `data/drupal-private` when present.
- `backup` handles non-Drupal stacks by type: for myevery, an online
  `sqlite3 .backup` through the app container, then the same delta and
  retention rules. `backup --all` stops skipping stacks without a `db`
  service and dispatches by type instead.
- New `backup-edge` and `backup-host` write the edge and host bundles.
- Each run writes `manifest.json` with digests and the git rev.
- `pull-backups` takes its site list from `tec-site-apex --list`, encrypts the
  secret payload with `age` before it lands on the workstation, and also pulls
  the edge and host bundles.
- The host-only tools (`deploy-myevery`, `docker-stats-snapshot`, the stats
  cron file) are brought into the repo and shipped by `install.sh`, or retired.
  Stray `.bak` and `.save` files are reviewed with the operator, then removed.
- `deploy-prod` appends one line per deploy to a digest ledger per property
  (time, previous digest, new digest, git rev). This is the rollback history.

In HarborMaster:

- A headless mode, `harbormaster --pull-backups`, alongside the existing
  `--probe`, run by Windows Task Scheduler without stealing focus (the
  `silent-watcher` pattern). It pulls whenever the workstation is on and
  records success on the board.
- The vault moves to a configurable path, so a second copy can live on a
  different physical disk from WSL's.

Acceptance: a fresh vault on the workstation contains all six properties,
their encrypted secrets, and the edge bundle; the board shows each one as
fresh.

### P2 — Restore anywhere, and prove it

- `bundle-restore <slug> <bundle> --target <host|ddev>` in `web_server/infra`:
  - creates the site dir and edge network if missing, writes the compose,
    decrypts the env;
  - pulls the **recorded digests**;
  - loads the DB through the db container, restores files with the right
    ownership (33:33), restores app data;
  - runs `drush deploy` for Drupal stacks;
  - runs the same health gate CI uses (status 200, minimum body size, no PHP
    fatal markers).
- The DDEV target replaces the manual parts of `fetch-prod` for a point-in-time
  restore; `fetch-prod` stays the tool for "latest prod".
- **Automated restore drill.** Monthly, HarborMaster restores each property's
  newest bundle into a throwaway local target and checks that content really
  loads: for Drupal, entity loads return a non-zero count (the lesson from the
  2026-08-20 unrestorable-dump incident); for myevery, `PRAGMA
  integrity_check` and `/healthz`. The result goes on the DR strip. Policy
  asks for at least quarterly; monthly costs nothing once automated.

Acceptance: every property shows a green drill younger than 35 days.

### P3 — Rebuild the whole host

- `host-bootstrap <target>`: Epic 0 codified and idempotent. User and sudo,
  sshd hardening, ufw, fail2ban, unattended-upgrades, Docker, the
  `tecnocratica-edge` network, Traefik from the edge bundle, then
  `install.sh`. The GHCR login needs a PAT the operator supplies at run time.
  Verification is `docs/RESET.md` §8 turned into checks.
- An **estate manifest** (`estate.json`), generated from the live host by
  gather and committed to `web_server`, lists every property, its type, apex,
  sibling domains and data parts. It is the desired state for a batch rebuild.
- `estate-rebuild <target>`: bootstrap, then restore every bundle in manifest
  order, carrying `acme.json` over so certificates do not re-issue at once.
- **DNS cutover** is its own gated step, per property or all at once: lower
  TTLs first, verify the target through a hosts-file override, switch the A
  records (the GoDaddy tooling behind dangler already exists), watch
  certificates and the health gate, keep the source running until the
  operator retires it.
- **Rehearsal** needs a real second target. Options, cheapest first: a local
  Linux VM tested through hosts-file overrides (proves everything except DNS
  and certificates), or a short-lived second SSDnodes box (proves all of it).

Acceptance: a rehearsal rebuild on a second target reaches green health on
every property without touching production.

### P4 — Releases and migrations from the board

Releases:

- A release panel per property: repo HEAD, last CI run and conclusion, GHCR
  digest for `:latest`, deployed digest, and whether they agree. This absorbs
  `freshness-check`'s published-latest check.
- **Preflight gates** before a release is offered: no `Only in DB` entries in
  `drush config:status` (policy §2.2), `composer audit` clean, and a fresh
  pre-release bundle taken automatically.
- **Trigger** through `gh workflow run`, so the CI health gate stays in the
  loop. A direct `deploy-prod` over the operator key stays available for when
  GitHub is down.
- **Rollback** picks a previous digest from the ledger and redeploys it,
  followed by `drush config:import` and the health gate (DR-2, codified).
- HarborMaster's Redeploy button is rewired to call `deploy-prod <slug>`.

Migrations:

- **Drupal schema and content migrations** (destroy-and-recipe, the
  media-model scripts) become **operations**: an ordered runbook with a gate
  per step. Every operation starts with maintenance ON and a pre-op bundle,
  and ends by stopping and handing maintenance OFF to the operator.
- **Moving a property to another server** is P2's restore to a remote target,
  followed by P3's DNS cutover for that one property.
- **Onboarding a new property** turns `PROPERTY_PROTOCOL.md` §9 (still manual,
  and flagged there as a future `deploy-prop` script) into an operation.

Every mutating operation writes a line to the host's manual-operation log, so
policy §9.4 finally has its file.

### Later, optional

Products that do not live on the VPS, such as the `elevenlabs_agent` contrib
module on drupal.org and the desktop apps released through GitHub, could show
their release state on the board read-only. Publishing them stays in their own
workflows.

## Decisions for the operator

1. **Vault location.** Where the off-host copy lives, and whether a second
   copy goes to a different physical disk. A cloud bucket stays deferred per
   the no-SaaS preference.
2. **Encryption key custody.** Where the `age` private key lives (password
   manager), and who can decrypt a restore.
3. **Rehearsal target.** A local VM, or a short-lived second SSDnodes server.
4. **Release trigger.** Always through GitHub Actions, or direct deploys
   allowed from the board.
5. **Pinning.** Keep `:latest` for normal deploys and restore by recorded
   digest (recommended), or pin digests in the compose files.
6. **Stray files.** Which of the `.bak` and `.save` files on the host are
   still wanted.

## Do now, before any of this is built

The first gap is live risk, not roadmap: the only recent backups of four
properties are on the machine they protect. Running the existing
`pull-backups` today refreshes the dumps and file snapshots for all five
Drupal properties, because it mirrors the whole backup tree, but copies
secrets for only two, and writes those secrets to the workstation in
plaintext.
