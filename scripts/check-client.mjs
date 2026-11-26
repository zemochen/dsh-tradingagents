#!/usr/bin/env node
/**
 * Node-only smoke check for the browser half.
 *
 * It runs `client.js` exactly the way the DSH shell does — as a **classic script**
 * in a fresh VM context with a stubbed `window.__ModuleLoader__` — then drives the
 * registered factory and `apply()` with stub slot / locale services.
 *
 * What it proves (no browser, no DSH install needed):
 *   - the bundle parses and executes as a classic script (no top-level ESM syntax);
 *   - exactly one registration, with `id` equal to the package name;
 *   - the factory returns a Cordis plugin object (`inject` + `apply`);
 *   - `apply()` registers one `sidebar.panellist` row and one `main` panel whose
 *     id/key match, with a label function and a locale namespace;
 *   - the runtime dictionaries are keyed identically for en and zh;
 *   - both components render with the props the host passes.
 *
 * It does NOT prove that the Host serves or activates the bundle; that is the
 * install-time check (see README "Verify it works").
 *
 * Usage: node scripts/check-client.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/* ------------------------------------------------------------------ manifests */

const pkg = JSON.parse(read('package.json'));

assert.equal(pkg.type, 'module', 'package.json must be an ESM package');
assert.equal(pkg.private, true, 'the plugin must stay private');
assert.equal(pkg.exports['.'], './index.js', 'Host half must be exports["."]');
assert.equal(pkg.exports['./client'], './client.js', 'client half must be exports["./client"]');
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'bundle patch declaration');
assert.equal(pkg.dsh?.client?.platform, 'web', 'client platform must be "web"');
assert.ok(Array.isArray(pkg.dsh?.client?.inject), 'dsh.client.inject must be a string array');

for (const file of ['locale/en.json', 'locale/zh.json']) {
  const meta = JSON.parse(read(file)).meta;
  assert.equal(typeof meta?.title, 'string', `${file} needs meta.title`);
  assert.equal(typeof meta?.description, 'string', `${file} needs meta.description`);
}

/* ------------------------------------------------- client.js as classic script */

const registrations = [];
/** Minimal React stand-in: enough for createElement trees to be inspectable. */
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  // Panel keeps its tab in local state; the stub keeps the initial tab.
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: (effect) => {
    try { effect(); } catch { /* handlers run in the browser, not in this VM */ }
  },
};
const sandbox = {
  window: { __ModuleLoader__: { load: (r) => registrations.push(r) } },
  console,
  // The panel may fire async API calls from event handlers; stub them for the VM.
  document: { baseURI: 'http://127.0.0.1:1/' },
  URL,
  fetch: async () => ({ status: 503, json: async () => ({}) }),
};
vm.createContext(sandbox);
vm.runInContext(read('client.js'), sandbox, { filename: 'client.js' });

assert.equal(registrations.length, 1, 'the bundle must register exactly one factory');
const registration = registrations[0];
assert.equal(registration.id, pkg.name, 'loader id must equal the package.json name');
assert.equal(typeof registration.factory, 'function', 'registration needs a factory');

const mod = registration.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`require("${specifier}") is not in the shell static module table`);
});
assert.equal(typeof mod.apply, 'function', 'the factory must return { apply }');
assert.ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), 'plugin must inject "slots"');

/* ------------------------------------------------------------- stub slot host */

const dictionaries = {};
const registered = [];
const ctx = {
  effect(fn) {
    const dispose = fn();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  locale: {
    register(ns, dicts) {
      dictionaries[ns] = dicts;
      return () => {};
    },
    bind: (ns) => (key, params) => (params ? `${ns}:${key}:${JSON.stringify(params)}` : `${ns}:${key}`),
  },
  slots: {
    inject(_key, callback) {
      return callback();
    },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
  },
  get: () => undefined,
};

mod.apply(ctx);

assert.equal(registered.length, 2, 'apply() must register exactly two entries');
const row = registered.find((entry) => entry.options.name === 'sidebar.panellist');
const panel = registered.find((entry) => entry.options.name === 'main');
assert.ok(row, 'a sidebar.panellist entry is required');
assert.ok(panel, 'a main entry is required');
assert.equal(row.options.id, panel.options.key, 'sidebar row id and main key must be identical');
assert.equal(typeof row.options.label, 'function', 'label must be locale-aware (a function)');
assert.equal(row.options.locale, panel.options.locale, 'both entries share the locale namespace');
assert.equal(typeof panel.options.inject, 'function', 'panel must inject its props');

const ns = row.options.locale;
assert.ok(dictionaries[ns], `apply() must register locale namespace "${ns}"`);
assert.deepEqual(
  Object.keys(dictionaries[ns].zh).sort(),
  Object.keys(dictionaries[ns].en).sort(),
  'zh and en dictionaries must have identical keys',
);

/* ------------------------------------------------------- render both components */

const icon = row.component({ size: 18, active: true });
assert.equal(icon.type, 'svg');
assert.equal(icon.props.width, 18);
assert.equal(icon.props.height, 18);

const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
const injected = panel.options.inject();
const tree = panel.component({
  t,
  usePanelInfo: (selector) => selector({ activePanelId: ns }),
  ...injected,
});
assert.equal(tree.props['data-zemo-trading'], 'panel');
assert.equal(tree.props['data-panel-id'], ns);
// title / subtitle / tab bar / tab body / status / back button
assert.equal(tree.children[0].children[0], 'panel.title');
assert.equal(tree.children[1].children[0], 'panel.subtitle');
const tabBar = tree.children[2];
assert.equal(tabBar.props.role, 'tablist');
const tabButtons = tabBar.children[0];
assert.equal(tabButtons.length, 3, 'panel must expose three tabs');
// VM-context arrays have a different Array prototype, so compare joined values.
assert.equal(
  tabButtons.map((button) => button.children[0]).join(','),
  'tab.analysis,tab.history,tab.watchlist',
  'tab labels come from the locale dictionary',
);
assert.equal(tabButtons[0].props['aria-selected'], true, 'analysis is the default tab');
assert.equal(tabButtons[1].props['aria-selected'], false);
assert.equal(tabButtons[2].props['aria-selected'], false);
assert.equal(tabButtons[0].props['data-active'], 'true');
assert.equal(tabButtons[1].props['data-active'], 'false');
// Regression: both states must carry the same style keys. Mixing a shorthand
// (borderBottom) with a longhand (borderBottomColor) left a stale underline on
// the previously active tab in the live GUI (2026-11-17).
assert.equal(
  Object.keys(tabButtons[0].props.style).sort().join(','),
  Object.keys(tabButtons[1].props.style).sort().join(','),
  'active and inactive tab styles must expose identical key sets',
);
assert.equal(typeof tabButtons[1].props.onClick, 'function', 'tabs must switch on click');
const tabBody = tree.children[3];
assert.equal(tabBody.props.role, 'tabpanel');
assert.equal(tabBody.props['data-tab'], 'analysis');
const analysisPane = tabBody.children[0];
assert.equal(analysisPane.children[0].children[0], 'analysis.hint', 'analysis tab shows the quick-tier hint');
const formRow = analysisPane.children[1];
assert.equal(formRow.children[0].type, 'input', 'analysis tab has a code input');
assert.equal(formRow.children[0].props.maxLength, 6);
assert.equal(formRow.children[1].type, 'select', 'analysis tab has a tier select');
const tierOptions = formRow.children[1].children[0];
assert.equal(tierOptions.length, 3, 'three tiers are offered');
assert.equal(tierOptions[0].props.disabled, undefined, 'quick is enabled');
assert.equal(tierOptions[1].props.disabled, undefined, 'standard is enabled (Phase 4)');
assert.equal(tierOptions[2].props.disabled, undefined, 'deep is enabled (Phase 4)');
assert.equal(formRow.children[2].type, 'button', 'analysis tab has a start button');
assert.match(tree.children[4].children[0], /^panel\.status:/);
assert.equal(tree.children[5].children[0].type, 'button');

/* --------------------------------------------------- tab switching (stateful) */
// Re-render the panel against a stateful hook stub so the click path is exercised.
const hookStates = [];
let hookCursor = 0;
React.useState = (initial) => {
  const index = hookCursor++;
  if (!(index in hookStates)) hookStates[index] = initial;
  return [hookStates[index], (next) => {
    hookStates[index] = typeof next === 'function' ? next(hookStates[index]) : next;
  }];
};
const renderPanel = () => {
  hookCursor = 0;
  return panel.component({
    t,
    usePanelInfo: (selector) => selector({ activePanelId: ns }),
    ...injected,
  });
};
const before = renderPanel();
assert.equal(before.children[2].children[0][0].props['aria-selected'], true);
// Switch to watchlist (no network); history is loaded on demand in the browser.
before.children[2].children[0][2].props.onClick();
const after = renderPanel();
const afterTabs = after.children[2].children[0];
assert.equal(afterTabs[0].props['aria-selected'], false, 'previous tab must lose selection');
assert.equal(afterTabs[2].props['aria-selected'], true, 'clicked tab must gain selection');
assert.equal(afterTabs[2].props['data-active'], 'true');
assert.equal(after.children[3].props['data-tab'], 'watchlist', 'tab body must follow the active tab');
const watchTabText = JSON.stringify(after.children[3]);
assert.match(watchTabText, /watch\.addPlaceholder/, 'watchlist tab renders the add row');
assert.match(watchTabText, /paper\.title/, 'watchlist tab renders the paper account section');

/* -------------------------------------------------------------- bundle patch */

const patch = read('cordis.patch.yml');
assert.match(patch, /^\s*-\s*insert:/m, 'patch must be an insert list');
assert.ok(patch.includes('id: dsh-tradingagents'), 'patch row id');
assert.ok(patch.includes(pkg.name), 'patch row name must be the package name');

/* ------------------------------------------------------------------- icon */

const svg = read('icon.svg').trim();
assert.match(svg, /^<svg[^>]+viewBox="0 0 64 64"/, 'icon is a 64x64 SVG');
assert.ok(svg.endsWith('</svg>'), 'icon SVG must be well-formed at its edges');

console.log(
  `check-client: OK — ${pkg.name} registers 1 factory, ` +
    `sidebar.panellist(id=${row.options.id}) + main(key=${panel.options.key}), ` +
    `locale ${ns} (${Object.keys(dictionaries[ns].en).length} keys/en, ` +
    `${Object.keys(dictionaries[ns].zh).length} keys/zh)`,
);
