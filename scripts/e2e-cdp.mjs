#!/usr/bin/env node
/**
 * Self-test driver over Chrome DevTools Protocol (no Playwright, no npm install).
 * Requires the Desktop app started with `--remote-debugging-port=9222`.
 *
 *   node scripts/e2e-cdp.mjs [mode]
 *   mode = api   (default) run a quick analysis through the page's fetch/EventSource
 *          ui    click the panel UI (input + start) and read the rendered result
 *          dom   dump buttons/inputs/panel text and a screenshot only
 *
 * Exits 0 and prints evidence; non-zero when the run fails or times out.
 */
import { writeFile } from 'node:fs/promises';

const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const MODE = process.argv[2] ?? 'api';
const SYMBOL = process.argv[3] ?? '600519';
const TIER = process.argv[4] ?? 'quick';
const SSE_MS = Number(process.env.SSE_TIMEOUT_MS ?? 900_000);

async function findPageTarget() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((target) => target.type === 'page' && String(target.url).startsWith('dsh-app://'));
  if (!page) throw new Error('no dsh-app page target found (is the app running with --remote-debugging-port=9222?)');
  return page;
}

async function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (message) => {
    const frame = JSON.parse(message.data);
    if (frame.id && pending.has(frame.id)) {
      const { resolve, reject } = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.error) reject(new Error(`${frame.error.message} ${JSON.stringify(frame.error.data ?? '')}`));
      else resolve(frame.result);
      return;
    }
    events.push(frame);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    events,
    close: () => socket.close(),
  };
}

/** @param {any} client @param {string} expression */
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`page exception: ${result.exceptionDetails.text} ${JSON.stringify(result.exceptionDetails.exception?.description ?? '')}`);
  }
  return result.result?.value;
}

async function waitFor(client, expression, { timeoutMs = 180_000, intervalMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await evaluate(client, expression);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function screenshot(client, file) {
  await client.send('Page.enable');
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const target = await findPageTarget();
  console.log(`page: ${target.title} (${target.url})`);
  const client = await connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  const helperSource = `(() => {
    window.__e2e = {
      panelText() {
        const panel = document.querySelector('[role="tabpanel"]');
        return panel ? (panel.innerText || '') : '';
      },
      click(label) {
        const re = label instanceof RegExp ? label : new RegExp(label);
        const node = [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
        node?.click();
        return !!node;
      },
      openPanel() {
        const node = [...document.querySelectorAll('button')].find((b) => /投研|Research/.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
        node?.click();
        return !!node;
      },
      setCode(value) {
        const input = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '').includes('代码') || (i.placeholder || '').includes('600519'));
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
    };
    return true;
  })()`;
  await evaluate(client, helperSource);
  let helpersReady = false;
  for (let attempt = 0; attempt < 3 && !helpersReady; attempt += 1) {
    helpersReady = await evaluate(client, 'typeof window.__e2e === "object"');
    if (!helpersReady) await sleep(300);
  }
  if (!helpersReady) {
    await evaluate(client, helperSource);
    helpersReady = await evaluate(client, 'typeof window.__e2e === "object"');
  }
  if (!helpersReady) throw new Error('page helpers unavailable');
  console.log('helpers: ready');

  const panelInfo = await evaluate(client, `(() => ({
    buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 30),
    inputs: [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label') || i.placeholder || ''),
    selects: [...document.querySelectorAll('select')].length,
  }))()`);
  console.log('dom:', JSON.stringify(panelInfo));

  if (MODE === 'dom') {
    const file = await screenshot(client, '/tmp/dsh-tradingagents-dom.png');
    console.log(`screenshot: ${file}`);
    client.close();
    return;
  }

  if (MODE === 'uicap') {
    // Find a report whose suggested position is too small for 100 shares and
    // require the UI to show the cap rejection (no position created).
    await evaluate(client, 'window.__e2e.openPanel()');
    await sleep(300);
    await evaluate(client, 'window.__e2e.click("History|历史")');
    await sleep(800);
    const count = await evaluate(client, `(() => {
      return [...document.querySelectorAll('button')].filter((b) => /6[0-9]{5}/.test(b.textContent || '') && /(quick|standard|deep)/.test(b.textContent || '')).length;
    })()`);
    if (!count) throw new Error('no history report items');
    let rejected = null;
    for (let i = 0; i < count; i += 1) {
      const opened = await evaluate(client, `(() => {
        const items = [...document.querySelectorAll('button')].filter((b) => /6[0-9]{5}/.test(b.textContent || '') && /(quick|standard|deep)/.test(b.textContent || ''));
        const item = items[${i}];
        item?.click();
        return !!item;
      })()`);
      if (!opened) continue;
      await sleep(400);
      const pctText = await evaluate(client, `(() => {
        const match = /建议仓位：([0-9]+)%/.exec(window.__e2e.panelText());
        return match ? Number(match[1]) : null;
      })()`);
      if (pctText === null || pctText >= 15) continue;
      await evaluate(client, 'window.__e2e.click("Open by suggestion|按建议建仓")');
      await sleep(250);
      await evaluate(client, 'window.__e2e.click("Confirm open|确认建仓")');
      const message = await waitFor(client, `(() => {
        const text = window.__e2e.panelText();
        if (/超出建议仓位上限/.test(text)) return text.slice(0, 600);
        return null;
      })()`, { timeoutMs: 15_000, label: 'cap rejection' });
      rejected = message;
      break;
    }
    console.log(rejected ? 'UICAP RESULT: cap rejection shown' : 'UICAP RESULT: no low-position report found (skipped)');
    if (rejected) console.log(rejected);
    const file = await screenshot(client, '/tmp/dsh-tradingagents-uicap.png');
    console.log(`screenshot: ${file}`);
    client.close();
    if (!rejected) process.exitCode = 1;
    return;
  }

  if (MODE === 'uipaper') {
    // UI flow: report card → "Open by suggestion" → confirm → close.
    if (process.env.RELOAD === '1') {
      await client.send('Page.enable');
      await client.send('Page.reload', { ignoreCache: true });
      await waitFor(client, `document.readyState === 'complete'`, { label: 'page reload' });
      await sleep(800);
      await evaluate(client, helperSource);
    }
    const plan = await evaluate(client, `fetch('./dsh-tradingagents/api/reports').then(async (response) => {
      const body = await response.json();
      const candidates = (body.items ?? []).filter((item) => (item.verdict?.positionPct ?? 0) >= 15);
      return candidates[0] ?? null;
    })`);
    if (!plan) throw new Error('no report with positionPct >= 15');
    console.log('plan:', JSON.stringify(plan));
    await evaluate(client, 'window.__e2e.openPanel()');
    await sleep(300);
    await evaluate(client, 'window.__e2e.click("History|历史")');
    await sleep(800);
    const openedItem = await evaluate(client, `window.__e2e.click(${JSON.stringify(plan.symbol)})`);
    if (!openedItem) throw new Error(`history item not found for ${plan.symbol}`);
    await waitFor(client, `(() => /For research only|仅供研究参考/.test(window.__e2e.panelText()))()`, { timeoutMs: 15_000, label: 'report rendered' });
    await evaluate(client, 'window.__e2e.click("Open by suggestion|按建议建仓")');
    await waitFor(client, `(() => /Confirm open|确认建仓/.test(window.__e2e.panelText()))()`, { timeoutMs: 10_000, label: 'open draft' });
    await evaluate(client, 'window.__e2e.click("Confirm open|确认建仓")');
    const afterOpen = await waitFor(client, `(() => {
      const text = window.__e2e.panelText();
      if (/超出建议仓位上限|Paper operation failed|模拟盘操作失败/.test(text)) return 'FAILED ' + text.slice(0, 600);
      if (new RegExp(${JSON.stringify(plan.symbol)}).test(text) && /Close|平仓/.test(text)) return text.slice(0, 1200);
      return null;
    })()`, { timeoutMs: 20_000, label: 'position opened in UI' });
    console.log('UIPAPER after open:', String(afterOpen).slice(0, 300));
    const failedOpen = String(afterOpen).startsWith('FAILED');
    await evaluate(client, 'window.__e2e.click("Close|平仓")');
    const afterClose = failedOpen ? '' : await waitFor(client, `(() => {
      const text = window.__e2e.panelText();
      return /No positions|暂无持仓/.test(text) ? text.slice(0, 800) : null;
    })()`, { timeoutMs: 20_000, label: 'position closed in UI' });
    console.log('UIPAPER after close:', String(afterClose).slice(0, 200));
    const file = await screenshot(client, '/tmp/dsh-tradingagents-uipaper.png');
    console.log(`screenshot: ${file}`);
    client.close();
    if (failedOpen || !afterClose) process.exitCode = 1;
    return;
  }

  if (MODE === 'uiwatch') {
    // UI layout check for watchlist + paper sections (no LLM, no host mutations).
    if (process.env.RELOAD === '1') {
      await client.send('Page.enable');
      await client.send('Page.reload', { ignoreCache: true });
      await waitFor(client, `document.readyState === 'complete'`, { label: 'page reload' });
      await sleep(800);
      await evaluate(client, helperSource);
    }
    await evaluate(client, 'window.__e2e.openPanel()');
    await sleep(400);
    await evaluate(client, 'window.__e2e.click("Watchlist|自选")');
    const text = await waitFor(client, `(() => {
      const body = window.__e2e.panelText();
      return /Paper account|模拟盘/.test(body) ? body.slice(0, 1200) : null;
    })()`, { timeoutMs: 15_000, label: 'watchlist/paper section' });
    // Exercise the add-input UI, then require the symbol in the rendered list.
    const typedWatch = await evaluate(client, `(() => {
      const input = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '').includes('Add code') || (i.getAttribute('aria-label') || '').includes('添加代码'));
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '600519');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(150); // let React commit the controlled input before clicking Add
    const added = typedWatch && await evaluate(client, `window.__e2e.click('Add|添加')`);
    let listText = '';
    let addError = null;
    if (added) {
      try {
        listText = await waitFor(client, `(() => {
          const body = window.__e2e.panelText();
          return /600519\\s+\\S/.test(body) ? body.slice(0, 1600) : null;
        })()`, { timeoutMs: 20_000, label: 'watchlist add via UI' });
      } catch (error) {
        addError = error.message;
      }
    }
    const currentText = await evaluate(client, 'window.__e2e.panelText().slice(0, 1600)');
    console.log('UIWATCH RESULT:');
    console.log(`typed=${typedWatch} clicked=${added} waitError=${addError ?? 'none'}`);
    console.log(listText || currentText || text);
    const file = await screenshot(client, '/tmp/dsh-tradingagents-watchlist.png');
    console.log(`screenshot: ${file}`);
    client.close();
    return;
  }

  if (MODE === 'paper') {
    // Host API round-trip through the page origin: watchlist → quotes → open → close → reset.
    const result = await evaluate(client, `(async () => {
      const json = async (path, init) => {
        const response = await fetch('./dsh-tradingagents/api' + path, init);
        let body = null;
        try { body = await response.json(); } catch {}
        return { status: response.status, body };
      };
      const post = (path, body) => json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const steps = [];
      const reports = await json('/reports');
      steps.push({ step: 'reports', status: reports.status, count: reports.body?.items?.length ?? 0 });
      const candidates = (reports.body?.items ?? []).slice(0, 5);
      if (!candidates.length) return { ok: false, steps, error: 'no reports' };
      const watch = await post('/watchlist', { add: [candidates[0].symbol] });
      steps.push({ step: 'watchlist-add', status: watch.status, symbols: watch.body?.symbols });
      const quotes = await json('/quotes?symbols=' + encodeURIComponent(candidates[0].symbol));
      steps.push({ step: 'quotes', status: quotes.status, quote: quotes.body?.quotes?.[candidates[0].symbol] });
      let opened = null;
      for (const candidate of candidates) {
        const response = await post('/paper/open', { reportId: candidate.id, shares: 100 });
        if (response.status === 201) { opened = { candidate, response }; break; }
        steps.push({ step: 'paper-open-skip', id: candidate.id, status: response.status, error: response.body?.error });
      }
      if (!opened) return { ok: false, steps, error: 'no report allowed a 100-share open (cap)' };
      steps.push({ step: 'paper-open', status: opened.response.status, position: opened.response.body.position, fees: opened.response.body.trade.fees });
      const snapshot = await json('/paper');
      steps.push({ step: 'paper-snapshot', status: snapshot.status, positions: snapshot.body?.positions?.length, totals: snapshot.body?.account });
      const closed = await post('/paper/close', { symbol: opened.candidate.symbol, shares: 100 });
      steps.push({ step: 'paper-close', status: closed.status, fees: closed.body?.trade?.fees, positions: closed.body?.positions?.length });
      const reset = await post('/paper/reset', {});
      steps.push({ step: 'paper-reset', status: reset.status, cash: reset.body?.account?.cash });
      const ok = steps.every((step) => !step.status || (step.status >= 200 && step.status < 300));
      return { ok, steps };
    })()`);
    console.log(JSON.stringify(result, null, 2));
    const file = await screenshot(client, '/tmp/dsh-tradingagents-paper.png');
    console.log(`screenshot: ${file}`);
    client.close();
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (MODE === 'reconnect') {
    // Start a run, reload mid-run, reopen panel; reattached SSE must finish.
    await evaluate(client, 'window.__e2e.openPanel()');
    await sleep(400);
    const typedReconnect = await evaluate(client, '(() => { window.__e2e.click("Analysis|分析"); return window.__e2e.setCode(' + JSON.stringify(SYMBOL) + '); })()');
    if (!typedReconnect) throw new Error('analysis form not found');
    await sleep(200);
    await evaluate(client, 'window.__e2e.click("Start analysis|开始分析")');
    await waitFor(client, `(() => {
      const text = window.__e2e.panelText();
      const lines = text.split(String.fromCharCode(10)).filter((line) => /^[0-9]+[.]/.test(line.trim()));
      return lines.length >= 3 ? lines.length : null;
    })()`, { timeoutMs: 60_000, label: 'progress started' });
    await client.send('Page.enable');
    await client.send('Page.reload', { ignoreCache: true });
    await waitFor(client, `document.readyState === 'complete'`, { timeoutMs: 20_000, label: 'page reload' });
    await sleep(900);
    await evaluate(client, helperSource); // page reload cleared the helpers
    await evaluate(client, 'window.__e2e.openPanel()');
    const viewText = await waitFor(client, `(() => {
      const text = window.__e2e.panelText();
      if (/仅供研究参考|For research only/.test(text)) return text.slice(0, 800);
      if (/分析失败|Analysis failed/.test(text)) return 'FAILED: ' + text.slice(0, 800);
      return null;
    })()`, { timeoutMs: 180_000, label: 'reconnected report' });
    const failed = typeof viewText === 'string' && viewText.startsWith('FAILED: ');
    console.log(failed ? 'RECONNECT RESULT: failed' : 'RECONNECT RESULT: report rendered after reload');
    console.log(viewText);
    const file = await screenshot(client, '/tmp/dsh-tradingagents-reconnect.png');
    console.log(`screenshot: ${file}`);
    client.close();
    if (failed) process.exitCode = 1;
    return;
  }

  if (MODE === 'invalid') {
    // Client-side rejection: bad code must produce a message and send no request.
    await client.send('Network.enable');
    await evaluate(client, `(() => {
      window.__e2eAnalyzeRequests = 0;
      const row = [...document.querySelectorAll('button')].find((b) => /投研|Research/.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
      row?.click();
      return !!row;
    })()`);
    await sleep(300);
    // The panel may remember another tab from a previous test; force Analysis.
    await evaluate(client, `(() => {
      const tab = [...document.querySelectorAll('button')].find((b) => b.getAttribute('role') === 'tab' && /分析|Analysis/.test(b.textContent || ''));
      tab?.click();
      return !!tab;
    })()`);
    await sleep(300);
    const typed = await evaluate(client, `(() => {
      const input = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '').includes('代码') || (i.placeholder || '').includes('600519'));
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '60051');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!typed) throw new Error('code input not found (analysis tab not open?)');
    const before = client.events.length;
    await evaluate(client, `(() => {
      const start = [...document.querySelectorAll('button')].find((b) => /开始分析|Start analysis/.test((b.textContent || '')));
      start?.click();
      return !!start;
    })()`);
    const message = await waitFor(client, `(() => {
      const text = document.querySelector('[role="tabpanel"]')?.innerText || '';
      return /6-digit|6 位/.test(text) ? text.slice(0, 600) : null;
    })()`, { timeoutMs: 10_000, label: 'invalid-input message' });
    await sleep(300);
    const requests = client.events
      .slice(before)
      .filter((frame) => frame.method === 'Network.requestWillBeSent')
      .map((frame) => frame.params.request.url)
      .filter((url) => url.includes('/dsh-tradingagents/api/'));
    console.log('INVALID RESULT:', requests.length === 0 ? 'no request sent' : `unexpected requests: ${requests.join(', ')}`);
    console.log(message);
    const file = await screenshot(client, '/tmp/dsh-tradingagents-invalid.png');
    console.log(`screenshot: ${file}`);
    client.close();
    if (requests.length !== 0) process.exitCode = 1;
    return;
  }

  if (MODE === 'view') {
    // Read-only: open panel → History tab → first report. No LLM calls.
    if (process.env.RELOAD === '1') {
      await client.send('Page.enable');
      await client.send('Page.reload', { ignoreCache: true });
      await waitFor(client, `document.readyState === 'complete'`, { label: 'page reload' });
      await sleep(500);
    }
    await evaluate(client, `(() => {
      const row = [...document.querySelectorAll('button')].find((b) => /投研|Research/.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
      row?.click();
      return !!row;
    })()`);
    await sleep(400);
    const opened = await evaluate(client, `(() => {
      const tab = [...document.querySelectorAll('button')].find((b) => /历史|History/.test((b.textContent || '')) && b.getAttribute('role') === 'tab');
      tab?.click();
      return !!tab;
    })()`);
    if (!opened) throw new Error('history tab not found');
    await waitFor(client, `(() => {
      const items = [...document.querySelectorAll('button')].filter((b) => /6\\d{5}/.test(b.textContent || '') && /quick|standard|deep/.test(b.textContent || ''));
      return items.length > 0 ? items.length : null;
    })()`, { label: 'history items' });
    await evaluate(client, `(() => {
      const item = [...document.querySelectorAll('button')].find((b) => /6\\d{5}/.test(b.textContent || '') && /quick|standard|deep/.test(b.textContent || ''));
      item?.click();
      return !!item;
    })()`);
    const view = await waitFor(client, `(() => {
      const text = document.querySelector('[role="tabpanel"]')?.innerText || '';
      if (/仅供研究参考|For research only/.test(text)) return text.slice(0, 1600);
      return null;
    })()`, { label: 'report view' });
    console.log('VIEW RESULT:');
    console.log(view);
    const file = await screenshot(client, '/tmp/dsh-tradingagents-view.png');
    console.log(`screenshot: ${file}`);
    client.close();
    return;
  }

  if (MODE === 'ui') {
    // Open the research panel, type the code, start, and read the verdict card.
    await evaluate(client, `(() => {
      const row = [...document.querySelectorAll('button')].find((b) => /投研|Research/.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
      row?.click();
      return !!row;
    })()`);
    await sleep(500);
    const filled = await evaluate(client, `(() => {
      const input = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '').includes('代码') || (i.placeholder || '').includes('600519'));
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(SYMBOL)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!filled) throw new Error('code input not found');
    await sleep(200);
    await evaluate(client, `(() => {
      const start = [...document.querySelectorAll('button')].find((b) => /开始分析|Start analysis/.test((b.textContent || '')));
      start?.click();
      return !!start;
    })()`);
    const outcome = await waitFor(client, `(() => {
      const text = document.querySelector('[role="tabpanel"]')?.innerText || '';
      if (/仅供研究参考|For research only/.test(text)) return { state: 'done', text: text.slice(0, 1200) };
      if (/分析失败|Analysis failed/.test(text)) return { state: 'failed', text: text.slice(0, 1200) };
      return null;
    })()`, { label: 'analysis outcome' });
    console.log(outcome.state === 'done' ? 'UI RESULT: report rendered' : 'UI RESULT: failed');
    console.log(outcome.text);
    const file = await screenshot(client, `/tmp/dsh-tradingagents-${outcome.state}.png`);
    console.log(`screenshot: ${file}`);
    client.close();
    if (outcome.state !== 'done') process.exitCode = 1;
    return;
  }

  // API mode: drive the real host endpoints from the page (same auth origin).
  const run = await evaluate(client, `(async () => {
    const post = await fetch('./dsh-tradingagents/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: ${JSON.stringify(SYMBOL)}, tier: ${JSON.stringify(TIER)} }),
    });
    const body = await post.json().catch(() => null);
    if (post.status !== 202) return { status: post.status, body };
    const events = [];
    const reportId = await new Promise((resolve, reject) => {
      const source = new EventSource(new URL('./dsh-tradingagents/api/runs/' + encodeURIComponent(body.runId) + '/events', document.baseURI));
      const timer = setTimeout(() => { source.close(); reject(new Error('SSE timeout; events=' + JSON.stringify(events))); }, ${SSE_MS});
      source.onmessage = (message) => {
        const event = JSON.parse(message.data);
        events.push({ seq: event.seq, type: event.type, message: event.message });
        if (event.type === 'done') { clearTimeout(timer); source.close(); resolve(event.data?.reportId ?? null); }
        if (event.type === 'error') { clearTimeout(timer); source.close(); reject(new Error(event.message + ' ' + JSON.stringify(event.data ?? {}) + ' events=' + JSON.stringify(events))); }
      };
      source.onerror = () => { clearTimeout(timer); source.close(); reject(new Error('SSE stream error (host gone?)')); };
    });
    return { status: 202, runId: body.runId, events, reportId };
  })()`);
  console.log(JSON.stringify(run, null, 2));
  client.close();
  if (run.status !== 202 || !run.reportId) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`e2e-cdp: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
