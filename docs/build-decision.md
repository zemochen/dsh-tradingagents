# Decision: ship a hand-written `client.js`, no bundler

**Question:** can this plugin ship a browser half as a hand-written CJS-style factory
(`window.__ModuleLoader__.load({ id, factory(require) { … } })`) directly, with no bundler, on this
DSH `0.2.2-rc.1` host?

**Answer: yes — verified from the host's own source. The skeleton in this repo does exactly that.**

Evidence aliases are defined in [`plugin-contract.md`](plugin-contract.md) §0
(`AR`, `EX`, `SHELL`, `SKILL`, `PROFILE`).

---

## 1. How the host gets and executes `client.js`

The whole pipeline, in order, with the code that implements it:

| Step | What happens | Evidence |
|---|---|---|
| 1 | A Loader row activates the package; the Host reads its `package.json` and validates `dsh.client` | `AR/@deepseek-ai/dsh-client-modules/lib/index.js:783-803`, validator `:86-100` |
| 2 | The Host resolves `exports["./client"]` (string, or `{ default: string }`) to a file path | `index.js:200-210`, `:791-796` |
| 3 | It reads the file bytes and takes a metadata revision (mtime, ctime, size) — no content hash, no parse | `index.js:222-228`, `:946-975` |
| 4 | It composes a boot graph row `{ id: <package name>, url, rev }` and serves the bundle over `/plugins` | `index.js:460-468`, `:518-563`, route `:620-627` |
| 5 | On the wire the bundle is served as `text/javascript; charset=utf-8`, `immutable`, at `/plugins/??<package>/client.js&rev=<rev>` | `index.js:262-267`, `:1095-1113` |
| 6 | "Prepare" is only trailing-directive cleanup: strip `//# sourceURL` / `//# sourceMappingURL`, ensure a final newline, join entries with `;\n` | `index.js:313-323`, `:395-399` |
| 7 | The page loads it as a **classic script** (`document.createElement("script")` + `src`, no `type="module"`); a batch is "one classic script that registers every package in sequence" | `SHELL:196` anchor `function aV(e,t){for(const r of e)switch(r.kind)`; `AR/@deepseek-ai/dsh-client-modules/lib/client.js:730-744` |
| 8 | Executing it only enqueues a registration; the factory body runs lazily on first materialization, memoized in `loadCache` | `client.js:14-37`, `:639-702` |
| 9 | The Loader imports the materialized exports as the plugin object (`apply`, `inject`, …) and mounts it | `client.js:703-716`, `:881-902`; shipped bundles export exactly that shape (`AR/@deepseek-ai/dsh-client-ui-layout/lib/client.js:796-800`) |

**There is no transformation step.** Whatever bytes you write are the bytes the browser parses.
That is why the format is a hard requirement rather than a convention.

## 2. Hard requirements (what the format constrains)

1. **Classic script, so no top-level ESM syntax.** `export default { apply() {} }` is a SyntaxError
   (unexpected token `export`) when parsed as a classic script. The only accepted registration is
   `window.__ModuleLoader__.load({ id, factory })` (facade created at `index.js:518-540`; the
   browser half switches it to live mode at `client.js:694-702`).
2. **`id` must equal the package name** (a trailing `/client` is stripped and also accepted):
   `client.js:98-100`, `:703-716`, and the graph row id is `packageName` (`index.js:955`). A wrong
   `id` yields `loaded without registering "<id>" via __ModuleLoader__.load` (`client.js:760`,
   `:877`) and the plugin fails to activate.
3. **The factory must return the Cordis plugin object** (`{ inject, apply }`), and must not
   reference `require` results outside itself.
4. **Everything must be in one file** (or use `require.async("./client.<name>.js")` chunks, which
   implies emitted chunk files): factory-form CJS cannot deliver partial exports, and require
   cycles throw (`client.js:653-654`).
5. **Imports resolve against a frozen table**, so `require('react')` works but an arbitrary npm
   import does not (`client.js:834-843`; the exact seed keys are `SHELL:196` anchor
   `function YZ(){return{react:fk,`). Non-baseline packages must be declared in
   `dsh.client.external` and served as their own bundle rows (`index.js:480-501`).
6. **No source map is required**; a missing `<bundle>.js.map` is tolerated
   (`index.js:328-341`).

## 3. Shipped zero-build precedent

The deployment ships a hand-written, build-tool-free client bundle template as the canonical
example for plugin authors:

- `SKILL/templates/decoration/client.js` — 22 lines, no imports other than
  `require('react')`, calls `window.__ModuleLoader__.load({ id, factory(require) { … } })`, returns
  `{ inject: ['slots'], apply(ctx) { … } }`.
- `SKILL/templates/decoration/package.json` — declares **no dependencies and no build scripts**,
  only `type`, `exports`, `files`, `dsh`.
- `SKILL/references/ui-plugin.md:9` — "The browser artifact registers a lazy factory whose id
  equals the package name. React comes from the browser module table; no duplicate React
  installation, CDN script, or UMD search is needed. **For compiled sources**, use the
  deployment's Client build tooling to emit this format" — i.e. tooling is for *compiled sources*
  (TypeScript/JSX), not a precondition for the format.

Contrast: the third-party `dshmarket` in this profile *is* built — `build:client` in
`PROFILE/dshmarket/package.json` runs `tsdown` plus a banner-normalization script (the script itself
is not shipped in the installed package, so only its name is visible). Its shipped bundle starts
with `window.__ModuleLoader__.load({ id: "dshmarket", factory: (require) => {`
(`PROFILE/dshmarket/client/client.js:1`), i.e. the build emits exactly this wrapper. The build
exists because the source is TypeScript/JSX and large, not because the host demands a build.

## 4. What you give up, and when to switch

Accepted costs of hand-writing for this skeleton:

- no TypeScript types, no JSX (this `client.js` uses `React.createElement`);
- one file: splitting into modules requires emitted chunks (`require.async`) — i.e. a bundler;
- no tree-shaking/minification/import graph; the file is read and served verbatim;
- manual `apply`/`ctx.effect` discipline (already required by the contract).

**Switch trigger:** when the browser half exceeds a few hundred lines, or the first time we want
TypeScript types or JSX. Then adopt the DSH-blessed client build rather than inventing one:

1. Preferred: `tsdown` with the shared Client preset the DSH source checkout ships (the preset is
   referenced by `AR/@deepseek-ai/dsh-client-hmr/README.md:32`; `dshmarket` uses the same shape via
   `build:client` in `PROFILE/dshmarket/package.json`). Emit `lib/client.js` in the factory format
   and point `exports["./client"]` at it. The unit is a *bundle* already: install stays the same.
2. Fallback if no preset is reachable from the desktop install: a ~15-line `esbuild` wrapper that
   compiles the body into an IIFE and injects it as `function (require) { <bundle> }` inside a
   hand-written `__ModuleLoader__.load({ id, factory })` banner, plus
   `--external:react --external:react-dom` etc. Do **not** emit ESM.

Either way the host contract in this document does not change — only who writes the wrapper.

## 5. Verification status

- The static contract above is verified from the installed `0.2.2-rc.1` sources.
- The hand-written bundle has **not been executed in a live page** in this session (nothing was
  installed or enabled; the Lead owns install/enable). Residual risks: an `id` mismatch, a
  non-seed `require`, or a runtime error inside `apply` — all of which surface as
  "loaded without registering …"/entry-failure diagnostics in Settings → Plugins.
- Cheap guard, already in place and run on 2026-11-11:
  `node scripts/check-client.mjs` runs `client.js` in a VM as a classic script with a stubbed
  `window.__ModuleLoader__` and `require`, then drives `apply()` against stub slot/locale services
  and asserts the registration identity (`id`/`key`), dictionaries and rendered trees.
  Output: `check-client: OK — @local/dsh-tradingagents registers 1 factory,
  sidebar.panellist(id=dsh-tradingagents) + main(key=dsh-tradingagents), locale dsh-tradingagents
  (5 keys/en, 5 keys/zh)`.
