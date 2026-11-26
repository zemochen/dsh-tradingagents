# DSH plugin contract — verified against DSH `0.2.2-rc.1`

This document is the copy-pasteable contract for building a **browser-UI plugin bundle** for the
DeepSeek Harness Desktop app installed on this machine. Every claim carries an evidence pointer.
Claims I could not verify from source are marked **UNVERIFIED** and are not used by the skeleton.

## 0. Evidence base and method

| Alias | Path |
|---|---|
| `AR` | `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules` |
| `EX` | `/Users/zemochen/Documents/deepseek-harness/default-workspace/tmp-research/asar-fixed/dsh/node_modules` |
| `SHELL` | `AR/@deepseek-ai/dsh-web-frontend/dist/assets/index-BgUyXZcc.js` — the built React shell (minified; **all anchors in this doc are on its line 196**, so line numbers are given as `:196` plus an anchor string) |
| `SKILL` | `AR/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development` |
| `PROFILE` | `~/.dsh/profiles/desktop/node_modules` |

`AR` lives inside an ASAR archive: `ls` / `cat` / `grep` / `node` cannot read it, only DSH's own
file-read path (the `read` tool) can. To grep it I re-extracted packages with a Python ASAR parser
into `EX`. **Caveat for future work:** the pre-existing extractor
(`tmp-research/extract.py`) uses `BASE = 16 + headerLength` and is **4 bytes off**, so files
extracted with it are missing their first 4 bytes and last 4 bytes (`window.…` reads as `ow.…`,
`<!doctype html>` as `ctype html>`). `tmp-research/extract-fixed.py` uses `BASE = 12 +
headerLength` and is byte-correct; `EX` was extracted with it. Line numbers are unaffected by the
shift, but do not trust extracted file *edges* from the old script.

`SHELL` is a single-line-per-chunk minified bundle. Where a claim comes from it I quote the anchor
(variable/function name or exact string) so it can be found by search.

Wire-type/API facts also appear in each package's `README.md` (readable directly from `EX` or via
DSH's file reader at `AR`), which is the upstream-maintained prose form of the same behaviour; I
cite both when they agree.

---

## 1. What a plugin is

A plugin is an **npm package with a `dsh` field**. Two independent halves:

| Half | Declared by | Loaded by |
|---|---|---|
| Host | `exports["."]` → `index.js`, reachable as a Cordis Loader row `{ id, name }` | Cordis Loader (Node, ESM) |
| Client | `dsh.client.platform: "web"` + `exports["./client"]` | `@deepseek-ai/dsh-client-modules` (browser, served bundle) |

A package that also declares `dsh.bundle.patch` is a **bundle**: installing it inserts Loader rows
into the profile. Frontend-only plugins therefore need exactly one row for the Host half; the
browser half is discovered from that same row.

Evidence:
- Bundle = package with `dsh.bundle.patch`: `SKILL/references/host-plugin.md:3`.
- Client declaration → served bundle: `AR/@deepseek-ai/dsh-client-modules/README.md:33`.
- Discovery walks **active Loader entries** and reads their manifests:
  `AR/@deepseek-ai/dsh-client-modules/lib/index.js:594-631` (constructor marks
  `internal/plugin` dirty and flushes), `:946-970` (`reconcilePackage` → `graphRow(packageName, …)`).
- Bypassing the plugin manager and hand-editing the profile is explicitly forbidden:
  `SKILL/SKILL.md` ("Do not write the profile's `package.json` or `cordis.patch.yml`") +
  `SKILL/references/host-plugin.md:81`.

Live third-party sample in this profile: `PROFILE/dshmarket` — `package.json` has
`dsh.bundle.patch`, `dsh.client.platform: "web"`, `exports["./client"] = "./client/client.js"`,
`cordis.patch.yml` inserts `{ id: dsh-market, name: dshmarket }`.

---

## 2. `package.json` fields

### Required for a client-UI bundle

| Field | Value | Evidence |
|---|---|---|
| `name` | package name | Browser module id = this value (`index.js:948-960`) |
| `type` | `"module"` | Host half is ESM (`SKILL/references/host-plugin.md:13`) |
| `exports["."]` | `./index.js` | Loader imports the package root (`SKILL/references/host-plugin.md:9-18`) |
| `exports["./client"]` | path to the browser bundle | `index.js:200-210` (`clientExportOf`, accepts a string or `{ default: string }`) |
| `dsh.client.platform` | `"web"` | `index.js:790` — non-`web` declarations are ignored |
| `dsh.client` | object | `index.js:86-100` (`parseDshClient` validates) |
| `dsh.bundle.patch` | `./cordis.patch.yml` | `SKILL/references/host-plugin.md:3` |
| locale + icon exports | `./locale/*.json`, `./icon` | `host-plugin.md:44-51` |

### Optional

| Field | Meaning | Evidence |
|---|---|---|
| `dsh.client.immediately` | boolean; prefetch the bundle at boot (§11) | `index.js:93,800`; `client.js:129-141`; `SHELL:196` `prefetchImmediateTier` |
| `dsh.client.inject` | string[]; client packages whose bundles must arrive first (§11) | `index.js:91`; `client.js:778-796` |
| `dsh.client.external` | string[]; **non-baseline** module requests (§11) | `index.js:92`; `client-modules/README.md:54` |
| `files` | published file list. A **local directory install is linked, so `files` does not filter it** | `SKILL/references/host-plugin.md:35` |
| `icon` (top-level) | path, takes priority over `./icon` | `SKILL/references/host-plugin.md:51` |
| `main` | not read by DSH; `exports` wins | `dshmarket` has both, shipped client packages only `exports` |

### Validation rules that throw (fail loud, at activation)

- `dsh.client` present but `platform` not a string → throw (`index.js:90`).
- `inject`/`external` not a string array → throw (`index.js:91-92` + `optionalStringArray` `:72-76`).
- `immediately` not a boolean → throw (`index.js:93`).
- `dsh.client` declared but no `exports["./client"]` → throw (`index.js:791-792`).
- Two active Loader rows resolving to the same package name → throw (`index.js:951-953`).

### Deliberately omitted in this skeleton: `engines.dsh` / DSH peers

The installer/activator blocks a plugin whose declared DSH version requirement is unmet
(`engines.dsh`, else the `@deepseek-ai/dsh*` / `dsh-*` peer ranges — per the `plugin_manager`
tool contract; the implementing package was **not traced in this session**, so the exact
matching semantics are **UNVERIFIED**). A *wrong* range therefore blocks installation, while
omitting both never does. The skeleton omits both on purpose; adding a verified range is a
follow-up task for the Lead (the host is `0.2.2-rc.1`, a prerelease, so range semantics must be
confirmed against the installer before declaring one). Consequence to keep in mind: the
plugin is not gated against future host upgrades.

---

## 3. How the Host finds and serves the browser bundle

1. On activation, `ClientModuleRegistry` seeds the dirty set from every Loader entry
   (`index.js:615`) and reconciles each entry name (`:946-970`).
2. For a row, it resolves the manifest through the Loader's own resolver, then reads
   `pkg.dsh.client`; `platform !== "web"` → no browser row (`index.js:783-803`).
3. It snapshots bundle metadata (**mtime, ctime, size — not a content hash**) into a 12-hex
   revision (`index.js:191-228`) and holds the bundle bytes (`:946-975`).
4. It registers **one prefix route** `/plugins` on the `webServer` service
   (`index.js:620-627`) and composes `window.__DSH_BOOT__` (`:518-563`).
5. URLs actually served:
   - entry bundle (what the page loads): `/plugins/??<package>/client.js&rev=<rev>`
     — a *combo* URL, `??`-prefixed, one or more package ids (`index.js:262-267`, used by
     `graphRow` `:460-468`);
   - its source map: same combo with `client.js.map` (`:262-267`);
   - a package-local chunk: `/plugins/<package>/client.<name>.js?rev=<rev>`
     (`:279-281`, matched by `chunkRequest` `:1005-1023`);
   - a package asset: `/plugins/<package>/assets/<path>` (`:236`, `assetResponse` `:1062-1088`).
   > The composition comment "serves `/plugins/<id>/client.js`"
   > (`AR/@deepseek-ai/dsh-web-app/cordis.patch.yml:220`) is a shorthand, not the exact route.
6. Response headers for a bundle: `content-type: text/javascript; charset=utf-8` and
   `cache-control: public, max-age=31536000, immutable`; `rev` is the cache buster
   (`index.js:1095-1113`). Unknown URLs answer 404; non-GET/HEAD answer 405 (`:1096`).
7. A package whose row is not active is not in the table → its bundle and assets 404
   (`index.js:1104`, `:1063` — "inactive package answer 404" also `client-modules/README.md:38`).
8. **No build/bundle validation on the Host side**: `prepareSource` only strips
   `//# sourceURL` / `//# sourceMappingURL` trailers, ensures a trailing newline, and concatenates
   entries with `;\n` (`index.js:313-323`, `:395-399`). No transform, no wrapper, no signature.
9. `exports["./assets/*"]` is the only way to publish images to the browser; each is served with a
   content revision in the file name (`client-modules/README.md:38`).

---

## 4. The client bundle format (the `__ModuleLoader__` contract)

The served bundle is **executed as a classic script**. A batch is "one classic script that
registers every package in sequence" (`AR/@deepseek-ai/dsh-client-modules/lib/client.js:730-744`)
and the shell injects such scripts with `document.createElement("script")` + `src` (no
`type="module"`) — `SHELL:196` anchor `function aV(e,t){for(const r of e)switch(r.kind)`.

Therefore **top-level `import` / `export` in a client bundle is a SyntaxError**. The only accepted
form is a call to the queue facade:

```js
window.__ModuleLoader__.load({
  id: '@local/my-plugin',            // == package.json name (or `<name>/client`)
  factory(require) {                 // runs lazily at first materialization
    const React = require('react');  // resolved against the shell module table
    return { inject: ['slots'], apply(ctx) { /* registrations */ } };
  },
});
```

Facts and evidence:

| Fact | Evidence |
|---|---|
| The facade is created by an inline `<head>` script that pushes registrations into a queue; `create()` later switches it to live mode | `index.js:518-540`; browser half `client.js:639-702` |
| Executing a bundle only registers a factory; module-body side effects run at materialization, memoized in `loadCache` | `client.js:14-37`, `:639-702`; `client-modules/README.md:11` |
| Registration `id` is normalized by stripping a trailing `/client` and must match a boot-graph row, whose id **is the package name** (`graphRow(packageName, …)`) | `client.js:98-100`, `:703-716`, `:745-777`; `index.js:948-960` |
| A script that executes without registering its row is an error, retried once on the transport and then on the row's own one-resource URL | `client.js:730-777` (message `loaded without registering "<id>" via __ModuleLoader__.load`, `:760`, `:877`) |
| A second registration for the same id throws (bundle executed twice) | `client.js:708-711` |
| The factory's return value is the Cordis plugin object: `{ apply(ctx), inject: [...] }` (the same shape shipped bundles export) | `SKILL/templates/decoration/client.js:13-20`; `AR/@deepseek-ai/dsh-client-ui-layout/lib/client.js:796-800` (`exports.apply`, `exports.inject`) |
| Factory must be self-contained CJS: `require` cycles throw, partial exports are impossible | `client.js:653-654`; `client-modules/README.md:76` |
| Source maps are optional: a missing `<bundle>.map` is not an error | `index.js:328-341` |
| `require.asset("plugins/<pkg>/assets/<file>")` is the asset resolver; `require.async("./client.<name>.js")` is the only chunk form | `client.js:834-852`; `client-modules/README.md:38,42` |

Factory purity rules: register styles/timers/listeners inside `apply` with `ctx.effect` and return
cleanup; do not replace the app root or append a second app to `document.body`
(`SKILL/references/ui-plugin.md:9-12`).

---

## 5. The static module table (what `require(...)` may resolve)

The shell seeds a **frozen** module table; client bundles resolve against it first
(`client.js:834-843`, `client-modules/README.md:54`). The exact seeded keys, from
`SHELL:196` anchor `function YZ(){return{react:fk,`:

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, zod, @tanstack/react-virtual,
@deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
```

Anything else must be either another **served package row** (declared in `dsh.client.external`,
§11) or a registered factory; otherwise `require` throws the "missed the module table" error
(`client.js:842`). **Never install or bundle a second React** (`ui-plugin.md:9`).

---

## 6. `ctx.slots.register(options, component)` — full option signature

The slot service is `ctx.slots`, provided by **`dsh-client-ui-renderer`**
(`AR/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1348` anchor `super(ctx, "slots")`; apply at
`:1867-1876`), not by ui-layout.

`ctx.slots.register(options, component)` = `ctx.effect(() => _register(options, component))`
(`renderer:1813-1816`), so a registration is **fiber-owned and disposed automatically** when the
plugin unloads. The serialized option list written by the core is in `SHELL:196` anchor
`const l={component:t,options:{`; the core is `SlotCore.register` (same line, anchor
`register(e,t){const r=this.records.get(e.name)`).

| Option | Type | Meaning / rules |
|---|---|---|
| `name` | string, **required** | Slot key. The slot must already be **declared** by some entry's `children`, else throws `slot "…" is not declared (a parent entry's children table must declare it)` |
| `component` | React component (2nd positional arg) | Rendered body |
| `key` | string, required by **keyed** slots | Cell key; duplicate key at the same priority throws |
| `id` | string, required by **list** slots | Cell id; duplicate id at the same priority throws |
| `order` | number, default `0` | List slots sort by `priority` then `order` (ascending) |
| `label` | string **or** `() => string` | Sidebar row text / tooltip; resolved by `resolveSlotLabel` = `typeof e=="function" ? e() : e` (`SHELL:196` anchor `function EI(e)`). Not a translation map. |
| `priority` | number, default `0` | Shadowing axis for every kind; "lowest renders" (`SHELL:196` error text). Duplicates at the same priority throw; register higher to shadow predictably. |
| `select` | `(ownerProps) => match \| null` | **chain** slots only |
| `inject` | `() => props` | Props factory, merged into the component props (see §7). Root-scope entries get no argument; session-scope entries receive the session id (`AR/@deepseek-ai/dsh-client-ui-schedule/lib/client.js:19394-19409`) |
| `children` | `{ [slotName]: { kind, scope, ... } }` | Declares nested slots and gives the component a bound `renderSlot` prop (§7) |
| `store` | store handle, or `() => handle` | Gives the component `useStore` + `actions` (renderer `:747-752`, `:1603-1623`) |
| `locale` | namespace string | Gives the component `t` bound to that namespace; **throws** if the locale plugin is absent (renderer `:742-746`) |
| `registrant` | string | Stamped automatically from the fiber name; not for plugin authors |

Kinds and scopes (`renderer:1130-1221`; `SHELL:196` `entriesOfSlot`): `single` (one cell),
`keyed` (one cell per `key`), `list` (ordered cells by `id`), `chain` (selector election); scopes
`root`, `session`, `session-maybe`.

### Declaration-aware helper: `ctx.slots.inject(key, callback)`

`ctx.slots.inject(key, cb)` waits for the slot **declaration**, runs `cb` in an owned effect while
the declaration is live, and re-runs it if the declaring entry is replaced (declaration epoch
changes). Use it whenever the slot is declared by another package, because your plugin may
activate first (`renderer:1353-1427`, especially `:1384-1399`; documented at
`client-modules/README.md` sibling docs and `SKILL/references/practices.md`). First-party code
uses this form everywhere (`schedule:19387-19393`, `sidebar:733-771`, `layout:705-736`).

### Other `ctx.slots` surface used here

| Method | Use |
|---|---|
| `entries(key)` / `entriesOfSlot(key)` | raw registrations / winning entry per cell (`renderer:1542-1556`) |
| `subscribe(key, fn)` | microtask-batched change notification (`:1591-1593`) |
| `provideRoot({ hooks, keyedHooks, props })` | contribute root-scope standard hooks (that is how `usePanelInfo` exists) (`:1465-1484`) |
| `snapshot(root?)` | JSON-safe declaration/occupancy tree, for inspection (`:1562-1564`) |
| `onEntryError(fn)` | supervision channel for entry crashes (`:1574-1576`) |
| `install(renderer)` / `installLocale(face)` | boot-once, shell-owned; a plugin must not call these |

---

## 7. What props a registered component receives

Assembly order is **kit → entry `inject` → slot declaration props → owner props**, last wins
(`renderer:773-791`, anchor `function renderEntry(slotKey, Comp, kit, standard, injected,
slotInjected, ownerProps, hookContext, hasHookContext)`).

| Prop | Present when | Evidence |
|---|---|---|
| `t` | registration has `locale` | `renderer:742-746`; `localeSeat` cache `:542-558` |
| `useStore`, `actions` | registration has `store` | `:747-752` |
| `renderSlot` (and `renderSlotChain`) | registration declares `children` | `:753-757` |
| root-scope hooks, e.g. `usePanelInfo`, `useSessions`, `useWorkspaces` | entry scope is `root` (contributed via `provideRoot`) | `:667-699` (`materializeStandardBinding`, `standardHookPropName`) |
| `inject()`'s object | registration has `inject` | `:784-790` |
| owner props | passed at the `renderSlot(...)` call site | e.g. `sidebar:228-231` passes `{ size, active }` |

`usePanelInfo` is contributed by ui-layout: `ctx.slots.provideRoot({ hooks: { panelInfo:
layout.panelInfo } })` (`layout:703`), consumed as `usePanelInfo((info) => info.activePanelId)`
(`layout:122-129`, `sidebar:206-207`).

---

## 8. `sidebar.panellist` — the left-sidebar entry contract

Declared by **`dsh-client-ui-sidebar`** as a root-scoped **list** slot
(`AR/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js:749-752`), i.e.
`{ kind: "list", scope: "root" }`. Documented in its README:
`AR/@deepseek-ai/dsh-client-ui-sidebar/README.md:41` ("Plugins add an icon component to the
root-scoped `sidebar.panellist` list with an `id`, optional `order`, and a string or locale-aware
`label`. The same id addresses the component registered in the layout's root-scoped `main` keyed
slot; selecting a missing main entry throws without changing the current selection.").

Registration shape:

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: PANEL_ID,            // list slot: `id` is mandatory
  order: 100,              // optional, ascending
  label: () => t('nav.label'),  // string or function, re-read on locale change
  locale: NS,              // optional; gives the icon `t`
}, PanelIcon));
```

Behaviour, verified in code:

| Behaviour | Evidence |
|---|---|
| The row derives `{ id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id }`, sorted by `order` | `sidebar:688-697` |
| Labels are re-resolved on every locale change (`ctx.locale.subscribe(syncPanels)`) | `sidebar:706` |
| The icon component is rendered with `{ size: wide ? 16 : 18, active }` and `renderSlot(..., { only: id })` | `sidebar:225-231` |
| The same string is the row's visible text, `aria-label`, and the collapsed-rail tooltip | `sidebar:206-237` |
| Click → `selectPanel(id)` (the sidebar calls `ctx.layout.selectPanel`) | `sidebar:217-224`, `sidebar:719-721` |
| With zero registrations the list and its spacing are not rendered | `sidebar/README.md:41` |
| Sibling slots: `sidebar.panellist.actions` (root list, "More" menu), `sidebar.footer.action` (root list), `sidebar.settings` (root single) | `sidebar:736-769` |

---

## 9. `main` — the centre panel and the selection API

Declared by **`dsh-client-ui-layout`** as a root-scoped **keyed** slot
(`AR/@deepseek-ai/dsh-client-ui-layout/lib/client.js:713-716`). README:
`AR/@deepseek-ai/dsh-client-ui-layout/README.md:35` ("Global panels occupy the root-scoped `main`
keyed slot; `conversation` is the reserved key for the Conversation. `ctx.layout.selectPanel(id)`
selects a registered panel, and `null` selects the Conversation without changing the current
Session.").

Registration shape:

```js
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main',
  key: PANEL_ID,     // keyed slot: `key` is mandatory and equals the sidebar row `id`
  locale: NS,
  inject: () => ({ /* panel props */ }),
}, TradingPanel));
```

Rendering and selection:

| Behaviour | Evidence |
|---|---|
| `renderSlot("main", {}, { entryKey: panelId ?? "conversation" })` — only the entry whose `key` matches the selection is mounted | `layout:122-129` |
| `ctx.layout.selectPanel(id)` throws `layout.selectPanel: main panel "<id>" is not registered` **without changing the selection** when no `main` entry has that key; `null` returns to the Conversation | `layout:522-526`; `layout/README.md:35` |
| Clicking a sidebar row selects the panel (no click handler needed in the panel) | `sidebar:217-224` |
| When a panel id disappears from the registry (plugin disabled), the layout resets the selection to the Conversation | `layout:464-466`, `:696-699`, `:772-773` |
| `ctx.layout` service also exposes `toggleSidebar()`, `openRightbar(track, fullscreen)`, `closeRightbar()`, `beginNavigation()`, `panelInfo` | `layout:506-549`, `layout:704` |

---

## 10. Locale: two independent mechanisms

1. **Host-side display metadata** (Plugin Manager / Settings → Plugins, read *without activating*
   the plugin): `locale/<language>.json` with `meta.title` and `meta.description`, plus the icon
   from `./icon` (or the top-level `icon` field, which wins). Locale files are per language
   (`locale/zh.json`, `locale/de.json`, …); a missing file falls back to language-region variants
   and then the manifest `name`/`description`, and a missing image uses default artwork.
   Evidence: `SKILL/references/host-plugin.md:31-51`; sample values in
   `AR/@deepseek-ai/dsh-client-ui-schedule/locale/en.json:1-6` and
   `AR/@deepseek-ai/dsh-client-ui-sidebar/locale/zh.json:1-6` (`en.json` in the sidebar is `:1-5`).
2. **Runtime UI copy in the browser**: dictionaries are JavaScript values registered in `apply`:
   `ctx.locale.register(ns, { zh, en, ja, … })` (also `(ns, locale, dict)`), and read through
   `ctx.locale.bind(ns)` or the injected `t` seat from the registration's `locale` option.
   Both `zh` and `en` are the typed-baseline locales. Evidence:
   `AR/@deepseek-ai/dsh-client-locale/README.md:47-53`; implementation
   `AR/@deepseek-ai/dsh-client-locale/lib/client.js:1675-1716` (`register`, `bind`, `translate`).
   Shipped clients keep the dictionaries in JS, not in `locale/*.json` — cf.
   `AR/@deepseek-ai/dsh-client-ui-layout/lib/client.js:668-678` (registers inline `zh, en, ja, …`).

A browser bundle **cannot fetch** `locale/*.json` (it is not an asset export); the two mechanisms
are not interchangeable. Use both: JSON for the manager's title/description/icon, JS for in-UI
copy.

`ctx.locale.register` returns a disposer and throws on a duplicate locale for the same namespace →
wire it through `ctx.effect` (`locale:1675-1701`).

---

## 11. Modifiers on `dsh.client`

### `immediately: true` — verified semantics

The Host copies it into the graph row (`index.js:466`, `:800`) and into the boot manifest's plugin
view (`client.js:129-141`). The shell then, **before booting plugin entries**, prefetches the
bundles of every `immediately` row:

```
async prefetchImmediateTier(){await Promise.all(this.manifest.plugins.filter(e=>e.immediately)
  .map(e=>this.modules.prefetch(e.id).catch(t=>{})))}
```
— `SHELL:196`, anchor `async prefetchImmediateTier()`; called at boot after
`r.create({...})` and awaited before `KZ({ctx, modules, manifest, ...})` (same line).

So: `immediately` only **warms the bundle download** at boot and swallows download errors. It does
not change activation order (entries are created through
`Promise.all(this.desired.plugins.map(...))` — `client.js:383-397`) and does not materialize the
factory early (materialization happens at first import — `client.js:14-37`).

### `inject: [...]` — arrival ordering, not service injection

Each named package, if it is another boot-graph row, has its bundle arrived **before** the
declaring row's (`client.js:778-796`, and the list is part of the entry identity `:321-329`). It is
*not* `require`, and it is not Cordis service injection. **Service dependencies** are declared in
the module's exported `inject` array (`['slots', 'locale', …]`), which makes Cordis wait before
calling `apply` (e.g. `layout:796-800`, `sidebar:666-672`). Names that are not graph rows are
silently skipped (`client.js:791-794`).

### `external: [...]` — non-baseline module requests

Exact specifiers answered by another dynamic package row or an exact static-table key. The graph
orders dependencies by `external` and rejects self-requests and cycles
(`index.js:480-501`; `client-modules/README.md:54`). React and everything in §5 need **no**
`external` entry. Hand-written bundles that only `require('react')` can omit `external` entirely.

---

## 12. Client → Host data channel

The skeleton does not fetch anything, but the route shape matters for the business phase. Verified
from `AR/@deepseek-ai/dsh-host-webserver/README.md`:

- `register(route)` adds a named `exact` or `prefix` HTTP route and returns a disposer;
  duplicate paths throw; matching is exact → longest prefix → fallback (`:61`).
- A route may take `resource(request, peer?)` returning a Fetch `Response` instead of a
  node:http `handler` (`:63`). **A `resource` route answers only GET/HEAD; any other method
  receives `405 Allow: GET, HEAD` before the resource runs** (`dsh-host-webserver/lib/index.js`:
  "methods a resource answers; any other method receives 405"). Use `handler` for POST/PUT/DELETE.
  Verified live 2026-11-23: a POST to a `resource` prefix route returned 405.
- `registerUpgrade`, `registerFallback`, `getOrigin()` exist (`:61`, `:67`).
- Index resources/markup go through `webserver/index-inject` and `renderIndex` (`:85`), which is
  also how `client-modules` injects the boot manifest (`index.js:628-630`).

Real third-party sample in this profile:
- Host side: `PROFILE/dshmarket/lib/routes.js:2439-2445` registers
  `{ kind: 'exact', path: '/dsh-market/api/v1/capabilities', handler(request, response) }` — the
  node:http `handler` form, wrapped by its own admission gate.
- Client side: `PROFILE/dshmarket/client/client.js:2795-2799` converts an API path with
  `new URL(relative, document.baseURI).pathname`.

The page pins `<base href="./">` (`AR/@deepseek-ai/dsh-host-frontend-static/README.md:44`), and
plugin bundle references are deliberately document-relative (`index.js:269-277`) — so client code
should build URLs from `document.baseURI` rather than hard-coding `/...`.

---

## 13. Dev loop

- `dsh-client-hmr` is **always mounted** by the shipped web app composition
  (`AR/@deepseek-ai/dsh-web-app/cordis.patch.yml:214-215`) and watches each package's stamped entry
  artifact with a 500 ms stat poll (`AR/@deepseek-ai/dsh-client-hmr/README.md:42`).
- A rebuild swaps the plugin into the open page with **no page reload**; its React state is lost,
  session/workspace/connection state survives; failures appear in Settings → Plugins with retry
  (`hmr README:48`, `:64-70`).
- Revisions are filesystem metadata (mtime/ctime/size), so a rebuild that preserves all three is
  invisible (`client-modules/README.md:141`).
- `pnpm run dev:web` belongs to a DSH **source checkout** (watchers + host); it is not needed for a
  linked local plugin here — rewriting the linked `client.js` is expected to be enough for the HMR
  poller, because the poller is generic over `dsh.client` packages (composition evidence above;
  see the live-check caveat in §14).
- Replacing an installed *package* (version content) normally needs a restart, while enable/disable
  and rebuilds are live (`SKILL/references/host-plugin.md:83`).

---

## 14. Verification status

Verified by reading shipped sources (statically, from the installed build):

- §1–§13, except the items below.

**UNVERIFIED** (do not rely on these without a live check):

1. **Live rendering of this skeleton.** Nothing was installed or enabled in this session (by
   instruction, the Lead performs install/enable), so the row/panel have never been rendered. All
   UI claims above come from first-party/shaped-third-party code, not from an observed run.
2. `plugin_manager install_bundle` behaviour for an `@local/*` package name. The Agent's own skill
   says a local directory installs as a **link** and that `install_bundle` performs the profile
   edits (`SKILL/SKILL.md`, `SKILL/references/host-plugin.md:35,81`); I did not execute it. If the installer
   rejects a non-registry scope for any reason, the fallback is a different package name — which
   requires editing `id` in `client.js` (§4).
3. Which Host package implements the display-metadata read (`meta.title`/`meta.description`/icon).
   The behaviour is documented in the shipped skill (`SKILL/references/host-plugin.md:31-51`) and practised by
   shipped packages, but I did not trace the implementing module.
4. `label` accepting a `LocalizedText` map. The resolver is `typeof f === "function" ? f() : f`
   (`SHELL:196` `function EI`), so a map would be rendered as an object. **Treat maps as
   unsupported**; use a function.
5. `dsh.client.platform` values other than `"web"` — any non-`web` value makes the Host skip the
   browser row (`index.js:790`); no other value has documented meaning.
6. Whether the HMR poller is active for a *linked* third-party package on this specific profile
   build. The composition mounts it and it is generic, but I did not observe a swap.
7. `ctx.slots` runtime inspection (`cordis_inspect_query` client `Slots.listSubTree`) was not
   used: it needs the connected page, and this session must not operate the running GUI. The slot
   trees above were read from the shipped bundles instead, which are authoritative for this build.

---

## 15. How this repository's skeleton maps to the contract

| Contract fact | Where it is implemented |
|---|---|
| Bundle patch inserts the Host row | `cordis.patch.yml:9-11` |
| `package.json` manifest (`type`, `exports`, `dsh.bundle.patch`, `dsh.client`) | `package.json:1-37` |
| Host half `export function apply() {}` + route insertion point | `index.js:19-52` |
| Classic-script lazy factory with `id` = package name | `client.js:29-31` |
| Runtime locale dictionaries + `t` seat | `client.js:48-63`, `client.js:173-174` |
| `sidebar.panellist` list entry (`id`, `order`, `label`, `locale`) | `client.js:180-193` |
| `main` keyed entry with the same id (`key`, `locale`, `inject`) | `client.js:198-215` |
| Panel body reads `usePanelInfo` (selection) and offers `selectPanel(null)` | `client.js:144-162`, `client.js:205-210` |
| Node-only smoke check of all of the above (no browser) | `scripts/check-client.mjs` |
| Display metadata + icon for the manager | `locale/en.json`, `locale/zh.json`, `icon.svg` |

See also [`build-decision.md`](build-decision.md) for why `client.js` is hand-written rather than
built.
