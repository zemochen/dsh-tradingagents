/**
 * Browser half of `@local/dsh-tradingagents` — hand-written classic script, no bundler.
 * Loaded by the DSH shell as `<script src=/plugins/...>`; `id` MUST equal package.json name.
 * Phase 3: analysis tab wired to the host runtime (`/dsh-tradingagents/api`), SSE progress,
 * decision-card + role-panel rendering, read-only history. No order/trading capability.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-tradingagents',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-tradingagents';
    const PANEL_ID = 'dsh-tradingagents';
    const API = './dsh-tradingagents/api';
    const TIERS = ['quick', 'standard', 'deep'];
    const SESSION_KEY = 'dsh-tradingagents.run';
    const DICTIONARIES = {
      en: {
        'nav.label': 'Research',
        'panel.title': 'Zemo Trading',
        'panel.subtitle': 'Research workstation: enter an A-share code, run the pipeline, read the report.',
        'panel.status': 'Slot wiring: sidebar.panellist → main key "{id}"',
        'panel.back': 'Back to conversation',
        'tab.analysis': 'Analysis',
        'tab.history': 'History',
        'tab.watchlist': 'Watchlist',
        'analysis.symbol': 'Stock code (6 digits)',
        'analysis.symbol.placeholder': 'e.g. 600519',
        'analysis.tier': 'Tier',
        'tier.quick': 'Quick',
        'tier.standard': 'Standard',
        'tier.deep': 'Deep',
        'analysis.start': 'Start analysis',
        'analysis.cancel': 'Cancel',
        'analysis.running': 'Running…',
        'analysis.hint': 'Tiers: quick (3 analysts, 8 calls) · standard (7 analysts + risk, 18) · deep (3 debate rounds + 2 reviews, 22).',
        'analysis.invalid': 'Enter a 6-digit A-share code.',
        'analysis.busy': 'An analysis is already running.',
        'analysis.failed': 'Analysis failed',
        'analysis.progress': 'Progress',
        'report.direction': 'Direction',
        'report.confidence': 'Confidence',
        'report.position': 'Position',
        'report.entry': 'Entry range',
        'report.stop': 'Stop loss',
        'report.target': 'Target',
        'report.reason': 'Reason',
        'report.gaps': 'Data gaps',
        'report.noGaps': 'None.',
        'report.debate': 'Bull vs bear',
        'report.roles': 'Role panels',
        'report.disclaimer': 'For research only; not investment advice.',
        'report.none': 'No report loaded.',
        'history.empty': 'No reports yet.',
        'history.loading': 'Loading…',
        'history.reload': 'Reload',
        'watch.add': 'Add',
        'watch.addPlaceholder': 'Add code (6 digits)',
        'watch.empty': 'Watchlist is empty.',
        'watch.refresh': 'Refresh quotes',
        'watch.remove': 'Remove',
        'watch.analyze': 'Analyze',
        'watch.quotesError': 'Quote refresh failed',
        'paper.title': 'Paper account (virtual, not live)',
        'paper.initialCapital': 'Initial capital',
        'paper.cash': 'Cash',
        'paper.totalAssets': 'Total assets',
        'paper.saveCapital': 'Set',
        'paper.positions': 'Positions',
        'paper.noPositions': 'No positions.',
        'paper.shares': 'Shares',
        'paper.avgCost': 'Avg cost',
        'paper.latest': 'Latest',
        'paper.pnl': 'P&L',
        'paper.value': 'Value',
        'paper.close': 'Close',
        'paper.trades': 'Trades',
        'paper.noTrades': 'No trades.',
        'paper.reset': 'Reset account',
        'paper.resetConfirm': 'Confirm reset (clears positions and trades)',
        'paper.openDraft': 'Open from report',
        'paper.openShares': 'Shares (multiples of 100)',
        'paper.confirmOpen': 'Confirm open',
        'paper.cancel': 'Cancel',
        'paper.error': 'Paper operation failed',
        'paper.feesNote': 'Fees: commission 0.03% (min ¥5), stamp 0.05% on sell, transfer 0.001% both sides (2026 published rates).',
        'report.addWatch': 'Add to watchlist',
        'report.prepareOpen': 'Open by suggestion',
        'report.watched': 'Added to watchlist',
        'report.oldSchema': 'Older report (summary only)', 'report.attempts': 'Quote attempts',
        'table.symbol': 'Symbol', 'table.name': 'Name', 'table.price': 'Price', 'table.change': 'Change', 'table.action': 'Actions',
      },
      zh: {
        'nav.label': '投研',
        'panel.title': 'Zemo Trading',
        'panel.subtitle': '投研工作台：输入 A 股代码，跑流水线，读报告。',
        'panel.status': '插槽通路：sidebar.panellist → main 键 "{id}"',
        'panel.back': '返回会话',
        'tab.analysis': '分析',
        'tab.history': '历史',
        'tab.watchlist': '自选 & 模拟持仓',
        'analysis.symbol': '股票代码（6 位）',
        'analysis.symbol.placeholder': '例如 600519',
        'analysis.tier': '档位',
        'tier.quick': '快速',
        'tier.standard': '标准',
        'tier.deep': '深度',
        'analysis.start': '开始分析',
        'analysis.cancel': '取消',
        'analysis.running': '分析中…',
        'analysis.hint': '档位：快速（3 分析师，8 次调用）· 标准（7 分析师 + 风控，18）· 深度（3 轮辩论 + 2 次复核，22）。',
        'analysis.invalid': '请输入 6 位 A 股代码。',
        'analysis.busy': '已有分析在跑，可先取消。',
        'analysis.failed': '分析失败',
        'analysis.progress': '进度',
        'report.direction': '方向',
        'report.confidence': '置信度',
        'report.position': '建议仓位',
        'report.entry': '入场区间',
        'report.stop': '止损',
        'report.target': '目标',
        'report.reason': '理由',
        'report.gaps': '数据缺口',
        'report.noGaps': '无。',
        'report.debate': '多空对照',
        'report.roles': '角色面板',
        'report.disclaimer': '仅供研究参考，不构成投资建议。',
        'report.none': '尚未加载报告。',
        'history.empty': '还没有报告。',
        'history.loading': '加载中…',
        'history.reload': '刷新',
        'watch.add': '添加',
        'watch.addPlaceholder': '添加代码（6 位）',
        'watch.empty': '自选为空。',
        'watch.refresh': '刷新行情',
        'watch.remove': '移除',
        'watch.analyze': '分析',
        'watch.quotesError': '行情刷新失败',
        'paper.title': '模拟盘（虚拟资金，非实盘）',
        'paper.initialCapital': '初始资金',
        'paper.cash': '现金',
        'paper.totalAssets': '总资产',
        'paper.saveCapital': '设置',
        'paper.positions': '持仓',
        'paper.noPositions': '暂无持仓。',
        'paper.shares': '股数',
        'paper.avgCost': '成本',
        'paper.latest': '最新价',
        'paper.pnl': '浮动盈亏',
        'paper.value': '市值',
        'paper.close': '平仓',
        'paper.trades': '流水',
        'paper.noTrades': '暂无流水。',
        'paper.reset': '重置账户',
        'paper.resetConfirm': '再次点击确认重置（清空持仓与流水）',
        'paper.openDraft': '按报告建议建仓',
        'paper.openShares': '股数（100 的整数倍）',
        'paper.confirmOpen': '确认建仓',
        'paper.cancel': '取消',
        'paper.error': '模拟盘操作失败',
        'paper.feesNote': '费用：佣金 0.03%（最低 5 元）、印花税卖出 0.05%、过户费双边 0.001%（2026 公示费率估算）。',
        'report.addWatch': '加入自选',
        'report.prepareOpen': '按建议建仓',
        'report.watched': '已加入自选',
        'report.oldSchema': '旧版本报告（仅显示摘要）', 'report.attempts': '行情尝试链',
        'table.symbol': '代码', 'table.name': '名称', 'table.price': '最新价', 'table.change': '涨跌幅', 'table.action': '操作',
      },
    };
    const DIRECTION_ZH = { bullish: '看多', bearish: '看空', neutral: '中性' };
    const DIRECTION_EN = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' };

    // Report content is Chinese regardless of the UI locale (Q10). UI chrome
    // (tabs/buttons) still follows the host locale.
    const REPORT_ZH = {
      direction: '方向', confidence: '置信度', position: '建议仓位', entry: '入场区间',
      stop: '止损', target: '目标', reason: '理由', gaps: '数据缺口', noGaps: '无。',
      debate: '多空对照', bull: '多头', bear: '空头', roles: '角色面板',
      disclaimer: '仅供研究参考，不构成投资建议。', none: '尚未加载报告。',
      oldSchema: '旧版本报告（仅显示摘要）', attempts: '行情尝试链',
    };
    const money = (value) => (value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(2));
    const pctText = (value) => (value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(2)}%`);
    const styles = {
      page: {
        boxSizing: 'border-box', height: '100%', overflow: 'auto',
        padding: 'calc(var(--dsh-frame-top-clearance, 0px) + 24px) 24px 24px',
        color: 'var(--dsw-alias-label-primary)', fontSize: 14, lineHeight: 1.6,
      },
      title: { margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.4 },
      subtitle: { margin: '4px 0 20px', color: 'var(--dsw-alias-label-secondary)' },
      status: {
        display: 'inline-block', margin: 0, padding: '2px 8px', borderRadius: 4,
        background: 'var(--dsw-alias-interactive-bg-hover)',
        fontFamily: 'var(--ds-font-family-code)', fontSize: 12,
      },
      tabBar: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-l3)', marginBottom: 16 },
      tabBody: { minHeight: 240 },
      actions: { marginTop: 20 },
      button: {
        padding: '6px 12px', border: '1px solid var(--dsw-alias-border-l3)',
        borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-button-elevated-fill)',
        color: 'inherit', font: 'inherit', cursor: 'pointer',
      },
      primary: { background: 'var(--dsw-alias-interactive-bg-hover)', fontWeight: 600 },
      danger: { borderColor: 'var(--dsw-alias-border-danger, #b33)' },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
      input: {
        padding: '6px 10px', minWidth: 140, border: '1px solid var(--dsw-alias-border-l3)',
        borderRadius: 'var(--dsw-radius-md)', background: 'transparent', color: 'inherit', font: 'inherit',
      },
      select: {
        padding: '6px 10px', border: '1px solid var(--dsw-alias-border-l3)',
        borderRadius: 'var(--dsw-radius-md)', background: 'transparent', color: 'inherit', font: 'inherit',
      },
      hint: { margin: '0 0 12px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      error: { margin: '0 0 12px', color: 'var(--dsw-alias-label-danger, #c33)' },
      progress: { margin: '12px 0', padding: 0, listStyle: 'none' },
      progressItem: { padding: '2px 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      card: {
        marginTop: 16, padding: 16, border: '1px solid var(--dsw-alias-border-l3)',
        borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-interactive-bg-hover)',
      },
      cardTitle: { margin: '0 0 8px', fontSize: 16, fontWeight: 600 },
      kv: { margin: 0, padding: 0, listStyle: 'none' },
      kvItem: { margin: '2px 0' },
      section: { marginTop: 20 },
      table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
      th: { textAlign: 'left', borderBottom: '1px solid var(--dsw-alias-border-l3)', padding: '4px 6px', verticalAlign: 'top' },
      td: { borderBottom: '1px solid var(--dsw-alias-border-l3)', padding: '6px', verticalAlign: 'top', overflowWrap: 'anywhere' },
      details: { margin: '6px 0', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-md)', padding: '4px 8px' },
      summary: { cursor: 'pointer' },
      mdP: { margin: '6px 0' },
      mdH: { margin: '10px 0 4px', fontSize: 13, fontWeight: 600 },
      mdList: { margin: '4px 0', paddingLeft: 18 },
      disclaimer: { marginTop: 16, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      historyList: { margin: 0, padding: 0, listStyle: 'none' },
      success: { margin: '8px 0', color: 'var(--dsw-alias-label-success, #2a7)', fontSize: 12 },
      small: { padding: '3px 8px', fontSize: 12 },
      tableScroll: { overflowX: 'auto' },
      historyItem: {
        display: 'flex', gap: 12, alignItems: 'baseline', width: '100%', textAlign: 'left',
        padding: '6px 8px', border: 'none', borderBottom: '1px solid var(--dsw-alias-border-l3)',
        background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer',
      },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
    };
    function tabStyle(active) {
      return {
        font: 'inherit', padding: '6px 12px', border: 'none', borderRadius: 'var(--dsw-radius-md)',
        background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        fontWeight: active ? 600 : 400, cursor: 'pointer',
      };
    }
    function apiUrl(path) {
      return new URL(`${API}${path}`, document.baseURI).toString();
    }

    async function apiFetch(path, options) {
      const response = await fetch(apiUrl(path), {
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    }

    /** Minimal Markdown: headings, paragraphs, `- ` lists, **bold**, inline code. No dependency. */
    function renderInline(text, keyPrefix) {
      return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
        const key = `${keyPrefix}-${index}`;
        if (part.startsWith('**') && part.endsWith('**')) return h('strong', { key }, part.slice(2, -2));
        if (part.startsWith('`') && part.endsWith('`')) return h('code', { key }, part.slice(1, -1));
        return part;
      });
    }
    function Markdownish({ text, id }) {
      const lines = String(text ?? '').split('\n');
      const nodes = [];
      let list = [];
      const flush = () => {
        if (list.length === 0) return;
        nodes.push(h('ul', { key: `${id}-ul-${nodes.length}`, style: styles.mdList }, list));
        list = [];
      };
      lines.forEach((raw, index) => {
        const line = raw.trimEnd();
        if (/^\s*[-*]\s+/.test(line)) {
          list.push(h('li', { key: `${id}-li-${index}` }, renderInline(line.replace(/^\s*[-*]\s+/, ''), `${id}-li-${index}`)));
          return;
        }
        flush();
        if (line.trim() === '') return;
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          nodes.push(h('h4', { key: `${id}-h-${index}`, style: styles.mdH }, renderInline(heading[2], `${id}-h-${index}`)));
          return;
        }
        nodes.push(h('p', { key: `${id}-p-${index}`, style: styles.mdP }, renderInline(line, `${id}-p-${index}`)));
      });
      flush();
      return h('div', null, nodes);
    }
    function decisionCard(t, report, actions) {
      const direction = DIRECTION_ZH[report.verdict.direction] ?? report.verdict.direction;
      const range = report.verdict.entryRange ? `${report.verdict.entryRange[0]} – ${report.verdict.entryRange[1]}` : '—';
      const kv = [
        [REPORT_ZH.direction, direction],
        [REPORT_ZH.confidence, `${report.verdict.confidence}/100`],
        [REPORT_ZH.position, `${report.verdict.positionPct}%`],
        [REPORT_ZH.entry, range],
        [REPORT_ZH.stop, report.verdict.stopLoss == null ? '—' : String(report.verdict.stopLoss)],
        [REPORT_ZH.target, report.verdict.target == null ? '—' : String(report.verdict.target)],
        [REPORT_ZH.reason, report.verdict.oneLineReason ?? '—'],
      ];
      return h('div', { style: styles.card },
        h('h3', { style: styles.cardTitle }, `${report.name ?? ''}（${report.symbol}）· ${report.tradeDate}`),
        h('p', { style: styles.muted }, `${({ quick: '快速', standard: '标准', deep: '深度' })[report.tier] ?? report.tier}档 · ${report.models?.analysts?.model ?? '—'}（分析师）/ ${report.models?.judge?.model ?? '—'}（拍板）`),
        h('ul', { style: styles.kv }, kv.map(([label, value], index) => h('li', { key: String(index), style: styles.kvItem }, h('strong', null, `${label}：`), value))),
        actions && actions.length
          ? h('div', { style: styles.row }, actions.map((action) => h('button', {
            key: action.key, type: 'button', style: { ...styles.button, ...styles.small }, onClick: action.onClick, disabled: Boolean(action.disabled),
          }, action.label)))
          : null,
        h('p', { style: styles.disclaimer }, REPORT_ZH.disclaimer),
      );
    }
    function reportView(t, report, actions) {
      if (!report) return h('p', { style: styles.muted }, REPORT_ZH.none);
      if (report.schemaVersion !== '1.0') {
        // Old-schema reports must not be force-fed into the v1 renderer.
        return h('div', { style: styles.card },
          h('h3', { style: styles.cardTitle }, `${report.name ?? ''}（${report.symbol ?? '—'}）· ${report.tradeDate ?? '—'}`),
          h('p', { style: styles.muted }, `${t('report.oldSchema')}：schemaVersion ${report.schemaVersion ?? '未知'}`),
          report.verdict
            ? h('p', { style: styles.kvItem }, `${DIRECTION_ZH[report.verdict.direction] ?? report.verdict.direction} · ${report.verdict.confidence ?? '—'}/100 · ${report.verdict.positionPct ?? '—'}%`)
            : null,
        );
      }
      const sections = [decisionCard(t, report, actions)];
      sections.push(h('section', { key: 'gaps', style: styles.section },
        h('h3', { style: styles.mdH }, REPORT_ZH.gaps),
        report.data.missing.length === 0
          ? h('p', { style: styles.muted }, REPORT_ZH.noGaps)
          : h('ul', { style: styles.mdList }, report.data.missing.map((category) => {
            const entry = report.data.categories[category] ?? {};
            const chain = (entry.attempts ?? []).map((attempt) => `${attempt.source ?? '(none)'}${attempt.ok ? ' ✓' : ` ✗ ${attempt.error?.code ?? 'ERR'}`}`).join(' → ');
            return h('li', { key: category }, `${category}（${chain || '—'}，asOf ${entry.asOf ?? '—'}）`);
          })),
      ));
      sections.push(h('section', { key: 'debate', style: styles.section },
        h('h3', { style: styles.mdH }, REPORT_ZH.debate),
        h('table', { style: styles.table },
          h('thead', null, h('tr', null,
            h('th', { style: styles.th }, '#'), h('th', { style: styles.th }, REPORT_ZH.bull), h('th', { style: styles.th }, REPORT_ZH.bear))),
          h('tbody', null, Array.from({ length: report.debate.rounds }, (_, index) => h('tr', { key: String(index) },
            h('td', { style: styles.td }, String(index + 1)),
            h('td', { style: styles.td }, String(report.debate.bull[index]?.text ?? report.debate.bull[index] ?? '').slice(0, 400)),
            h('td', { style: styles.td }, String(report.debate.bear[index]?.text ?? report.debate.bear[index] ?? '').slice(0, 400)))),
          ),
        ),
      ));
      sections.push(h('section', { key: 'roles', style: styles.section },
        h('h3', { style: styles.mdH }, REPORT_ZH.roles),
        report.roles.map((role) => h('details', { key: role.id, style: styles.details },
          h('summary', { style: styles.summary }, `${role.title}${role.verdict ? ` · ${DIRECTION_ZH[role.verdict.direction] ?? role.verdict.direction} ${role.verdict.confidence}` : ''}`),
          h(Markdownish, { text: role.reportMd, id: role.id }),
        )),
      ));
      return h('div', null, sections);
    }
    function progressList(t, run) {
      if (!run || run.events.length === 0) return null;
      return h('div', null,
        h('h4', { style: styles.mdH }, t('analysis.progress')),
        h('ul', { style: styles.progress }, run.events.slice(-12).map((event, index) =>
          h('li', { key: String(index), style: styles.progressItem }, `${event.seq}. ${event.message}`))),
      );
    }
    function PanelIcon({ size = 16, active = false }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, style: { display: 'block', opacity: active ? 1 : 0.85 } },
        h('path', { d: 'M2.4 12.2 L6 8.6 L8.7 10.4 L13.4 4.9', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { cx: 13.4, cy: 4.9, r: 1.6, fill: 'currentColor' }));
    }
    function TradingPanel({ t, usePanelInfo, onSelectConversation }) {
      const activePanelId = usePanelInfo((info) => info.activePanelId);
      const [activeTabId, setActiveTabId] = React.useState('analysis');
      const [symbol, setSymbol] = React.useState('');
      const [tier, setTier] = React.useState('standard');
      const [run, setRun] = React.useState(null); // {runId, status, events, report, error, busy}
      const [history, setHistory] = React.useState({ loaded: false, loading: false, items: [], report: null });
      const [watch, setWatch] = React.useState({ symbols: [], quotes: {}, loading: false, error: null, message: null, openDraft: null });
      const [paper, setPaper] = React.useState({ data: null, loading: false, error: null, resetArmed: false });
      const [watchInput, setWatchInput] = React.useState('');
      const [capitalInput, setCapitalInput] = React.useState('');

      const streamRef = React.useRef ? React.useRef(null) : { current: null };

      const updateRun = (patch) => setRun((prev) => ({ ...(prev ?? { events: [] }), ...patch }));
      async function loadReport(reportId) {
        const result = await apiFetch(`/reports/${encodeURIComponent(reportId)}`);
        if (result.status === 200 && result.body?.report) return result.body.report;
        throw new Error(result.body?.message ?? `HTTP ${result.status}`);
      }

      function closeStream() {
        if (streamRef.current) {
          try { streamRef.current.close(); } catch { /* already closed */ }
          streamRef.current = null;
        }
      }

      function attachStream(runId, from, meta) {
        closeStream();
        const source = new EventSource(apiUrl(`/runs/${encodeURIComponent(runId)}/events?from=${from}`));
        streamRef.current = source;
        let lastSeq = from;
        // EventSource auto-reconnect reuses the original ?from=; dedupe by seq
        // so a transient drop cannot duplicate progress lines.
        const seen = new Set();
        source.onmessage = (message) => {
          let event;
          try { event = JSON.parse(message.data); } catch { return; }
          if (typeof event.seq === 'number') {
            if (seen.has(event.seq)) return;
            seen.add(event.seq);
          }
          lastSeq = typeof event.seq === 'number' ? event.seq : lastSeq;
          try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ runId, from: lastSeq + 1, symbol: meta.symbol, tier: meta.tier })); } catch { /* private mode */ }
          setRun((prev) => {
            const base = prev?.runId === runId ? prev : { runId, status: 'running', events: [], report: null, error: null };
            return { ...base, runId, status: event.type === 'done' ? 'done' : event.type === 'error' ? 'failed' : 'running', events: [...base.events, event] };
          });
          if (event.type === 'done') {
            closeStream();
            try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
            const reportId = event.data?.reportId;
            if (reportId) loadReport(reportId).then((report) => setRun((prev) => ({ ...(prev ?? {}), report }))).catch(() => {});
          }
          if (event.type === 'error') {
            closeStream();
            try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
            setRun((prev) => ({ ...(prev ?? {}), status: 'failed', errorCode: event.data?.code ?? 'FAILED', error: event.message, errorData: event.data ?? null }));
          }
        };
        source.onerror = () => {
          // Host restart / stream gone: stop retrying and ask user to rerun.
          if (source.readyState === 2) {
            closeStream();
            setRun((prev) => (prev && prev.status === 'running' ? { ...prev, status: 'failed', error: '连接中断，请重新发起分析' } : prev));
          }
        };
      }

      React.useEffect(() => {
        try {
          const saved = window.sessionStorage?.getItem(SESSION_KEY);
          if (!saved) return;
          const parsed = JSON.parse(saved);
          if (parsed?.runId) {
            setRun({ runId: parsed.runId, status: 'running', events: [], report: null, error: null });
            attachStream(parsed.runId, parsed.from ?? 0, { symbol: parsed.symbol, tier: parsed.tier });
          }
        } catch { /* ignore */ }
        return () => closeStream();
      }, []);
      async function startAnalysis() {
        const trimmed = symbol.trim();
        if (!/^\d{6}$/.test(trimmed)) {
          updateRun({ status: 'failed', error: t('analysis.invalid'), errorCode: 'INVALID_SYMBOL' });
          return;
        }
        setRun({ runId: null, status: 'running', events: [], report: null, error: null });
        const result = await apiFetch('/analyze', { method: 'POST', body: JSON.stringify({ symbol: trimmed, tier }) });
        if (result.status === 202 && result.body?.runId) {
          attachStream(result.body.runId, 0, { symbol: trimmed, tier });
        } else if (result.status === 409) {
          setRun({ runId: result.body?.runId ?? null, status: 'failed', events: [], report: null, error: t('analysis.busy') });
        } else if (result.status === 501) {
          setRun({ runId: null, status: 'failed', events: [], report: null, error: t('analysis.tierUnsupported') });
        } else {
          setRun({ runId: null, status: 'failed', events: [], report: null, error: result.body?.message ?? `HTTP ${result.status}` });
        }
      }
      async function cancelRun() {
        if (!run?.runId) return;
        await apiFetch(`/runs/${encodeURIComponent(run.runId)}/cancel`, { method: 'POST' });
      }
      async function loadHistory(refresh) {
        setHistory((prev) => ({ ...prev, loading: true }));
        const result = await apiFetch('/reports');
        if (result.status === 200) {
          setHistory((prev) => ({ loaded: true, loading: false, items: result.body?.items ?? [], report: refresh ? null : prev.report }));
        } else setHistory((prev) => ({ ...prev, loading: false }));
      }
      async function openHistory(id) {
        try {
          const report = await loadReport(id);
          setHistory((prev) => ({ ...prev, report }));
        } catch (error) {
          setHistory((prev) => ({ ...prev, report: null, error: error.message }));
        }
      }

      async function loadWatchState() {
        if (watch.loading) return;
        setWatch((prev) => ({ ...prev, loading: true, error: null, message: null }));
        const [listResult, paperResult] = await Promise.all([apiFetch('/watchlist'), apiFetch('/paper')]);
        const symbols = listResult.status === 200 ? (listResult.body?.symbols ?? []) : watch.symbols;
        const paperData = paperResult.status === 200 ? paperResult.body : paper.data;
        setWatch((prev) => ({ ...prev, symbols, loading: false }));
        setPaper((prev) => ({ ...prev, data: paperData, loading: false }));
        await refreshQuotes(symbols, paperData);
      }

      async function refreshQuotes(symbolsIn, paperIn) {
        const symbols = symbolsIn ?? watch.symbols;
        const positions = (paperIn ?? paper.data)?.positions ?? [];
        const list = [...new Set([...symbols, ...positions.map((position) => position.symbol)])].slice(0, 20);
        if (list.length === 0) return;
        const result = await apiFetch(`/quotes?symbols=${encodeURIComponent(list.join(','))}`);
        if (result.status === 200) setWatch((prev) => ({ ...prev, quotes: { ...prev.quotes, ...(result.body?.quotes ?? {}) } }));
        else setWatch((prev) => ({ ...prev, error: t('watch.quotesError') }));
      }

      async function addWatch() {
        const code = watchInput.trim();
        if (!/^\d{6}$/.test(code)) { setWatch((prev) => ({ ...prev, error: t('analysis.invalid') })); return; }
        const result = await apiFetch('/watchlist', { method: 'POST', body: JSON.stringify({ add: [code] }) });
        if (result.status === 200) {
          const symbols = result.body?.symbols ?? watch.symbols;
          setWatchInput('');
          setWatch((prev) => ({ ...prev, symbols, message: t('report.watched') }));
          await refreshQuotes(symbols);
        } else setWatch((prev) => ({ ...prev, error: result.body?.message ?? `HTTP ${result.status}` }));
      }

      async function addWatchSymbol(symbol) {
        const result = await apiFetch('/watchlist', { method: 'POST', body: JSON.stringify({ add: [symbol] }) });
        if (result.status === 200) setWatch((prev) => ({ ...prev, message: t('report.watched') }));
      }

      async function removeWatch(symbol) {
        const result = await apiFetch('/watchlist', { method: 'POST', body: JSON.stringify({ remove: [symbol] }) });
        if (result.status === 200) {
          const symbols = result.body?.symbols ?? [];
          setWatch((prev) => ({ ...prev, symbols }));
          await refreshQuotes(symbols);
        }
      }

      function analyzeSymbol(symbol) {
        setSymbol(symbol);
        setTier('quick');
        setActiveTabId('analysis');
      }

      function prepareOpen(report) {
        if (!report) return;
        setWatch((prev) => ({
          ...prev,
          openDraft: { reportId: report.id, symbol: report.symbol, name: report.name, shares: 100, positionPct: report.verdict?.positionPct ?? 0 },
        }));
        setActiveTabId('watchlist');
        if (!paper.data) loadWatchState();
      }

      async function confirmOpen() {
        if (!watch.openDraft) return;
        const result = await apiFetch('/paper/open', {
          method: 'POST',
          body: JSON.stringify({ reportId: watch.openDraft.reportId, shares: Number(watch.openDraft.shares) }),
        });
        if (result.status === 201) {
          setWatch((prev) => ({ ...prev, openDraft: null, message: `已建仓（成交价 ${money(result.body.quote?.price)}，费用 ${money(result.body.trade?.fees?.total)}）` }));
          await loadWatchState();
        } else {
          setWatch((prev) => ({ ...prev, error: `${t('paper.error')}：${result.body?.message ?? `HTTP ${result.status}`}` }));
        }
      }

      async function closePosition(symbol) {
        const position = (paper.data?.positions ?? []).find((item) => item.symbol === symbol);
        if (!position) return;
        const result = await apiFetch('/paper/close', { method: 'POST', body: JSON.stringify({ symbol, shares: position.shares }) });
        if (result.status === 200) { setWatch((prev) => ({ ...prev, message: '已平仓' })); await loadWatchState(); }
        else setWatch((prev) => ({ ...prev, error: result.body?.message ?? `HTTP ${result.status}` }));
      }

      async function resetPaperAction() {
        if (!paper.resetArmed) { setPaper((prev) => ({ ...prev, resetArmed: true })); return; }
        const result = await apiFetch('/paper/reset', { method: 'POST', body: '{}' });
        setPaper((prev) => ({ ...prev, resetArmed: false }));
        if (result.status === 200) await loadWatchState();
      }

      async function saveCapital() {
        const value = Number(capitalInput);
        if (!Number.isFinite(value) || value <= 0) { setWatch((prev) => ({ ...prev, error: '初始资金非法' })); return; }
        const result = await apiFetch('/paper/initial-capital', { method: 'POST', body: JSON.stringify({ initialCapital: value }) });
        if (result.status === 200) { setWatch((prev) => ({ ...prev, message: '初始资金已更新' })); setCapitalInput(''); await loadWatchState(); }
        else setWatch((prev) => ({ ...prev, error: result.body?.message ?? `HTTP ${result.status}` }));
      }

      function reportActions(report) {
        if (!report) return [];
        const actions = [{ key: 'watch', label: t('report.addWatch'), onClick: () => addWatchSymbol(report.symbol) }];
        if ((report.verdict?.positionPct ?? 0) > 0) {
          actions.push({ key: 'open', label: t('report.prepareOpen'), onClick: () => prepareOpen(report) });
        }
        return actions;
      }

      function selectTab(id) {
        setActiveTabId(id);
        if (id === 'history' && !history.loaded && !history.loading) loadHistory(false);
        if (id === 'watchlist' && !paper.data && !watch.loading) loadWatchState();
      }

      let tabContent;
      if (activeTabId === 'analysis') {
        tabContent = h('div', null,
          h('p', { style: styles.hint }, t('analysis.hint')),
          h('div', { style: styles.row },
            h('input', {
              style: styles.input, value: symbol, placeholder: t('analysis.symbol.placeholder'),
              'aria-label': t('analysis.symbol'), maxLength: 6,
              onChange: (event) => setSymbol(event.target.value),
            }),
            h('select', { style: styles.select, value: tier, 'aria-label': t('analysis.tier'), onChange: (event) => setTier(event.target.value) },
              TIERS.map((id) => h('option', { key: id, value: id }, t(`tier.${id}`)))),
            h('button', { type: 'button', style: { ...styles.button, ...styles.primary }, onClick: startAnalysis, disabled: run?.status === 'running' }, t('analysis.start')),
            run?.status === 'running' && run?.runId
              ? h('button', { type: 'button', style: { ...styles.button, ...styles.danger }, onClick: cancelRun }, t('analysis.cancel'))
              : null,
          ),
          run?.status === 'failed' && run?.error
            ? h('div', null,
              h('p', { style: styles.error }, `${t('analysis.failed')}：${run.errorCode ?? 'FAILED'} ${run.error}`),
              Array.isArray(run.errorData?.attempts) && run.errorData.attempts.length
                ? h('ul', { style: styles.progress }, run.errorData.attempts.map((attempt, index) => h('li', { key: String(index), style: styles.progressItem },
                  `${t('report.attempts')}：${attempt.source ?? '(none)'} ${attempt.ok ? 'ok' : `✗ ${attempt.error?.code ?? 'ERROR'} ${String(attempt.error?.message ?? '').slice(0, 80)}`}`)))
                : null,
            )
            : null,
          run?.status === 'running' ? h('p', { style: styles.muted }, t('analysis.running')) : null,
          progressList(t, run),
          run?.report ? reportView(t, run.report, reportActions(run.report)) : null,
        );
      } else if (activeTabId === 'history') {
        tabContent = h('div', null,
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.button, onClick: () => loadHistory(true) }, t('history.reload'))),
          history.loading ? h('p', { style: styles.muted }, t('history.loading'))
            : history.items.length === 0 ? h('p', { style: styles.muted }, t('history.empty'))
              : h('ul', { style: styles.historyList }, history.items.map((item) => h('li', { key: item.id },
                h('button', { type: 'button', style: styles.historyItem, onClick: () => openHistory(item.id) },
                  h('span', null, `${item.symbol} · ${item.name ?? ''}`),
                  h('span', { style: styles.muted }, `${item.tradeDate} · ${item.tier}`)),
              ))),
          history.report ? reportView(t, history.report, reportActions(history.report)) : null,
          history.error ? h('p', { style: styles.error }, history.error) : null,
        );
      } else {
        const account = paper.data?.account;
        const positions = paper.data?.positions ?? [];
        const trades = paper.data?.trades ?? [];
        const openDraft = watch.openDraft;
        const header = (labels) => h('thead', null, h('tr', null, labels.map((label, index) => h('th', { key: String(index), style: styles.th }, label))));
        tabContent = h('div', null,
          h('div', { style: styles.row },
            h('input', {
              style: styles.input, value: watchInput, placeholder: t('watch.addPlaceholder'),
              'aria-label': t('watch.addPlaceholder'), maxLength: 6,
              onChange: (event) => setWatchInput(event.target.value),
            }),
            h('button', { type: 'button', style: { ...styles.button, ...styles.small }, onClick: addWatch }, t('watch.add')),
            h('button', { type: 'button', style: styles.button, onClick: () => loadWatchState() }, t('watch.refresh')),
          ),
          watch.message ? h('p', { style: styles.success }, watch.message) : null,
          watch.error ? h('p', { style: styles.error }, watch.error) : null,
          watch.symbols.length === 0
            ? h('p', { style: styles.muted }, t('watch.empty'))
            : h('div', { style: styles.tableScroll }, h('table', { style: styles.table },
              header([t('table.symbol'), t('table.name'), t('table.price'), t('table.change'), t('table.action')]),
              h('tbody', null, watch.symbols.map((symbol) => {
                const quote = watch.quotes[symbol] ?? {};
                return h('tr', { key: symbol },
                  h('td', { style: styles.td }, symbol),
                  h('td', { style: styles.td }, quote.name ?? '—'),
                  h('td', { style: styles.td }, money(quote.price)),
                  h('td', { style: styles.td }, pctText(quote.changePct)),
                  h('td', { style: styles.td },
                    h('button', { type: 'button', style: { ...styles.button, ...styles.small }, onClick: () => analyzeSymbol(symbol) }, t('watch.analyze')),
                    h('button', { type: 'button', style: { ...styles.button, ...styles.small }, onClick: () => removeWatch(symbol) }, t('watch.remove'))),
                );
              })),
            )),
          h('h3', { style: styles.mdH }, t('paper.title')),
          account
            ? h('p', { style: styles.muted }, `${t('paper.initialCapital')} ${money(account.initialCapital)} · ${t('paper.cash')} ${money(account.cash)} · ${t('paper.totalAssets')} ${money(account.totalAssets)}`)
            : null,
          h('div', { style: styles.row },
            h('input', {
              style: styles.input, value: capitalInput, placeholder: t('paper.initialCapital'),
              'aria-label': t('paper.initialCapital'),
              onChange: (event) => setCapitalInput(event.target.value),
            }),
            h('button', { type: 'button', style: { ...styles.button, ...styles.small }, onClick: saveCapital }, t('paper.saveCapital')),
            h('button', {
              type: 'button',
              style: { ...styles.button, ...styles.small, ...(paper.resetArmed ? styles.danger : {}) },
              onClick: resetPaperAction,
            }, paper.resetArmed ? t('paper.resetConfirm') : t('paper.reset')),
          ),
          openDraft
            ? h('div', { style: styles.card },
              h('h4', { style: styles.mdH }, `${t('paper.openDraft')}：${openDraft.symbol} ${openDraft.name ?? ''}（建议仓位 ${openDraft.positionPct}%）`),
              h('div', { style: styles.row },
                h('input', {
                  style: styles.input, type: 'number', step: 100, value: openDraft.shares,
                  'aria-label': t('paper.openShares'),
                  onChange: (event) => setWatch((prev) => ({ ...prev, openDraft: { ...prev.openDraft, shares: Number(event.target.value) } })),
                }),
                h('button', { type: 'button', style: { ...styles.button, ...styles.primary, ...styles.small }, onClick: confirmOpen }, t('paper.confirmOpen')),
                h('button', { type: 'button', style: { ...styles.button, ...styles.small }, onClick: () => setWatch((prev) => ({ ...prev, openDraft: null })) }, t('paper.cancel')),
              ),
            )
            : null,
          h('h4', { style: styles.mdH }, t('paper.positions')),
          positions.length === 0
            ? h('p', { style: styles.muted }, t('paper.noPositions'))
            : h('div', { style: styles.tableScroll }, h('table', { style: styles.table },
              header([t('table.symbol'), t('paper.shares'), t('paper.avgCost'), t('paper.latest'), t('paper.pnl'), t('table.action')]),
              h('tbody', null, positions.map((position) => {
                const quote = watch.quotes[position.symbol] ?? {};
                const pnl = quote.price == null ? null : (quote.price - position.avgCost) * position.shares;
                return h('tr', { key: position.symbol },
                  h('td', { style: styles.td }, position.symbol),
                  h('td', { style: styles.td }, String(position.shares)),
                  h('td', { style: styles.td }, money(position.avgCost)),
                  h('td', { style: styles.td }, money(quote.price)),
                  h('td', { style: styles.td }, money(pnl)),
                  h('td', { style: styles.td }, h('button', { type: 'button', style: { ...styles.button, ...styles.small, ...styles.danger }, onClick: () => closePosition(position.symbol) }, t('paper.close'))),
                );
              })),
            )),
          h('h4', { style: styles.mdH }, t('paper.trades')),
          trades.length === 0
            ? h('p', { style: styles.muted }, t('paper.noTrades'))
            : h('ul', { style: styles.progress }, trades.slice(0, 5).map((trade) => h('li', { key: trade.id, style: styles.progressItem },
              `${String(trade.at).slice(11, 16)} ${trade.type === 'open' ? '建仓' : '平仓'} ${trade.symbol} ${trade.shares} 股 @${money(trade.price)}，费用 ${money(trade.fees?.total)}`))),
          h('p', { style: styles.muted }, t('paper.feesNote')),
        );
      }

      return h('div', { style: styles.page, 'data-zemo-trading': 'panel', 'data-panel-id': PANEL_ID },
        h('h1', { style: styles.title }, t('panel.title')),
        h('p', { style: styles.subtitle }, t('panel.subtitle')),
        h('div', { role: 'tablist', style: styles.tabBar },
          [
            ['analysis', 'tab.analysis'],
            ['history', 'tab.history'],
            ['watchlist', 'tab.watchlist'],
          ].map(([id, labelKey]) => h('button', {
            key: id, type: 'button', role: 'tab',
            'aria-selected': id === activeTabId,
            'data-active': id === activeTabId ? 'true' : 'false',
            style: tabStyle(id === activeTabId),
            onClick: () => selectTab(id),
          }, t(labelKey))),
        ),
        h('div', { role: 'tabpanel', 'data-tab': activeTabId, style: styles.tabBody }, tabContent),
        h('p', { style: styles.status }, t('panel.status', { id: String(activePanelId) })),
        h('div', { style: styles.actions },
          h('button', { type: 'button', style: styles.button, onClick: onSelectConversation }, t('panel.back'))),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-tradingagents: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 100, label: () => t('nav.label'), locale: NS,
        }, PanelIcon));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
          inject: () => ({ onSelectConversation: () => ctx.get('layout')?.selectPanel?.(null) }),
        }, TradingPanel));
      },
    };
  },
});
