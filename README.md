# dsh-tradingagents

An A-share multi-agent **research** plugin for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH).
It contributes one left-sidebar entry and one main panel whose body hosts three tabs
(Analysis / History / Watchlist & paper positions). **Never places orders.**

> **Status: v1 feature-complete (2026-11-26), closure audit in progress.** Host + browser halves load,
> all three tiers run against the real LLM (8 / 18 / 22 calls), reports persist with schema v1, and the
> watchlist/paper account use real quotes and fee rules. `src/data/` fetches
> A-share **quote**, **daily K-line**, **fundamentals**, **news/announcements** and **money-flow** data through real
> providers (Eastmoney → Tencent → Sina for quotes, Eastmoney → Tencent for K-lines, Eastmoney for the rest), validates the trade
> date against an exchange calendar (non-trading day → ask the user to pick another date), keeps
> financial statements point-in-time by disclosure date, and records source + timestamps + gaps.
> All three tiers are wired end to end: code input → `POST /analyze` → SSE progress → decision card with role
> panels (quick 3 analysts / standard 7 + risk debate / deep 3 debate rounds + 2 reviews); history is read-only;
> watchlist and a virtual paper account use real quotes and real fee rules. No trading/order capability.

## Layout

```
dsh-tradingagents/
  package.json          # npm package + `dsh` manifest (bundle patch + client declaration)
  cordis.patch.yml      # bundle patch: inserts the Host row into a profile
  index.js              # Host half: Config + HTTP/SSE routes + three tiers + reports/watchlist/paper
  client.js             # Browser half: hand-written lazy-CJS factory, no bundler
  locale/en.json        # Plugin Manager display metadata (meta.title / meta.description)
  locale/zh.json
  icon.svg              # Plugin Manager icon (also exported as `./icon`)
  docs/
    plugin-contract.md  # verified DSH 0.2.2-rc.1 plugin contract, with evidence
    build-decision.md   # why this plugin is hand-written instead of built
  src/
    data/               # A-share data layer (quotes, daily K-lines, fundamentals, news, money-flow, trade-day calendar)
      index.mjs         #   fetchSnapshot: validation, category chains, gaps, fatal quote
      calendar.mjs      #   trade-day check (Eastmoney single-day index K → Tencent fallback)
      errors.mjs        #   ProviderError / InputRejectedError + error codes
      normalize.mjs     #   symbol→exchange, units, Asia/Shanghai ISO timestamps
      providers/        #   eastmoney.mjs / tencent.mjs / sina.mjs (fetch + pure parsers)
      fixtures/         #   real 2026-11-17 responses as parser regression fixtures
    pipeline/           # config / runs / llm + stages/roles/prompts/verdict/report
                        # + paper.mjs / watchlist.mjs (three tiers)
    client/             # reserved (empty); the browser half stays in the root client.js
  scripts/
    check-client.mjs    # Node-only smoke check: runs client.js as a classic script
    check-data.mjs      # real-data smoke: node scripts/check-data.mjs 600519 [YYYY-MM-DD]
    test-data.mjs       # fixture regression tests for the data layer (no network)
    test-pipeline.mjs   # runtime + three-tier tests (Config/runs/routes/SSE/LLM, stub LLM, no network)
    test-paper.mjs      # paper account + watchlist tests (fees/cap/close/routes, stub quote)
    check-report.mjs    # zero-dependency `.decision.json` v1 schema validator
    e2e-cdp.mjs         # CDP self-test (dom/api/ui/view/invalid/reconnect/paper/uiwatch/uipaper/uicap)
    migrate-reports.mjs # one-time schema migration for pre-fix v1 artifacts (backup + re-render)
```

## Install (in a DSH profile)

The plugin is a **bundle**: a package whose `package.json` declares `dsh.bundle.patch`.
Install the directory itself (a local directory is linked, not copied):

```
plugin_manager action=install_bundle target=/Users/zemochen/Work/git/zemo/dsh-tradingagents
```

Then enable the inserted row `dsh-tradingagents` if it is not active. DSH 0.2.2-rc.1 is the
supported Host; the plugin is private and never published.

## Verify it works

First, the dependency-free static check (parses `client.js` as the classic script the browser will
see, then drives `apply()` with stub slot/locale services). It is a plain Node script — run it
directly, no npm needed:

```
node scripts/check-client.mjs
```

If `node` is not on the shell's `PATH` (true for some DSH sessions on this machine), use the DSH
runtime's bundled Node:

```
~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node scripts/check-client.mjs
```

`package.json` also declares `"check": "node scripts/check-client.mjs"` so a machine that *does*
have npm can use `npm run check`; do not assume that command works here — the direct `node`
invocation above is the canonical one.

Then, in the GUI:

1. Sidebar: an icon row labelled **Research** / **投研** appears in the global-panel
   list, below New session.
2. Click it: the centre column switches to the **Zemo Trading** panel, which shows
   the live slot wiring (`sidebar.panellist → main key "dsh-tradingagents"`).
3. Click **Back to conversation**: the panel clears and the conversation returns.
4. Settings → Plugins: the bundle row shows the title/description from `locale/*.json` and
   `icon.svg`.
5. Because a local directory install is *linked*, editing `client.js` is expected to be picked
   up by the client HMR transport without reinstalling (a rebuilt bundle hot-swaps into the open
   page). This path is inferred from the composition, not yet observed — see
   [docs/plugin-contract.md](docs/plugin-contract.md) §14.

## Editing rules

- `client.js` is executed as a **classic script** by the Host and must keep calling
  `window.__ModuleLoader__.load({ id, factory })`. Top-level `import`/`export` is a syntax
  error there. `id` **must** equal the `package.json` `name` (renaming the package means
  editing `id` in `client.js` too).
- React (and the other shell modules) come from the Host's frozen module table via
  `require('react')`; never install a second React and never bundle one.
- The sidebar row id and the `main` key are the same string (`PANEL_ID`); that identity is
  what makes the row open the panel.
- Keep visible copy in the dictionaries in `client.js` (runtime) **and** in
  `locale/*.json` (Plugin Manager metadata). They are separate mechanisms; see
  [docs/plugin-contract.md](docs/plugin-contract.md) §10.
- Add a `ctx.effect(...)` for every listener/timer/style resource you register, and dispose it.

## Scope boundary

This plugin is a research workstation. It must not gain order placement, broker credentials,
or any capability that moves money. Market data may be fetched for analysis; execution is
out of scope by design.

## Known gaps (deliberate)

| Gap | Why it is deliberate |
|---|---|
| No `engines.dsh`, no `@deepseek-ai/dsh*` `peerDependencies` | The Host blocks installation when a declared requirement is unmet (`engines.dsh` wins over peers). We do not yet know which prerelease range the installer will accept for `0.2.2-rc.1`, and a wrong range **blocks install** while omission never does. Add a verified range once the installed behaviour is confirmed; until then the host-upgrade gate is absent. |
| No TypeScript, no build step | The browser half is a hand-written classic script; `docs/build-decision.md` records the evidence that this is fully supported, and the switch trigger if we later need types/JSX. |
| No broker/order API | The plugin is a research workstation; paper trades are virtual and user-confirmed. |
| No install-time tests | Unit/smoke tests are plain Node scripts (`scripts/test-*.mjs`, zero dependencies); `check-client.mjs` covers the fragile bundle format. |

## References

- [docs/plugin-contract.md](docs/plugin-contract.md) — every contract fact used here, with
  file+line evidence from the installed DSH build and explicit `UNVERIFIED` markers.
- [docs/build-decision.md](docs/build-decision.md) — hand-written vs. bundler, with evidence.
