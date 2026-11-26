/**
 * Prompt construction. All prompts are written for this project (no upstream
 * prompt text is reused — R4: licence chain unverified).
 */

export const VERDICT_INSTRUCTION = `【输出要求】
1. 先用中文 Markdown 写分析（不超过 600 字），只基于给出的数据，不得编造缺失数据。
2. 最后必须输出且只输出一个 \`\`\`json 代码块，字段固定：
{"direction":"bullish|bearish|neutral","confidence":0-100,"positionPct":0-100,"entryRange":[low,high]或null,"stopLoss":数字或null,"target":数字或null,"oneLineReason":"一句话"}
3. 不得输出其它 json 代码块；方向用英文枚举。`;

const GAP_NOTE = '⚠ 部分数据缺失（见 gaps）；缺失数据不得臆测，结论需标注「基于不完整数据」。';

/** @param {string} text */
function json(value) {
  return JSON.stringify(value, null, 2);
}

/**
 * @param {{ id: string, title: string }} role
 * @param {{ symbol: string, name: string|null, tradeDate: string, slice: any, gaps: string[], userView: string|null }} context
 */
export function buildAnalystPrompt(role, context) {
  const system = `你是 A 股研究团队的${role.title}。你只做研究分析，不提供投资建议，永不下单。${VERDICT_INSTRUCTION}`;
  const user = `标的：${context.name ?? ''}（${context.symbol}），分析日：${context.tradeDate}
${context.userView ? `用户关注点：${context.userView}` : ''}
${context.gaps.length ? GAP_NOTE : ''}

数据（来源与时点见字段；null 表示缺失）：
\`\`\`json
${json(context.slice)}
\`\`\`

缺失类别：${context.gaps.length ? context.gaps.join('、') : '无'}

请从你的角色视角分析该标的，给出明确方向、置信度与理由。`;
  return { system, user };
}

/**
 * @param {'bull'|'bear'} side
 * @param {{ round: number, reports: any[], previous: string|null, symbol: string, tradeDate: string }} context
 */
export function buildDebatePrompt(side, context) {
  const stance = side === 'bull' ? '多头' : '空头';
  const system = `你是多空辩论中的${stance}研究员。必须站在${stance}立场反驳对方，引用分析师结论作为证据，不编造数据。${VERDICT_INSTRUCTION}`;
  const user = `标的 ${context.symbol}，分析日 ${context.tradeDate}，第 ${context.round} 轮辩论。
分析师结论：
\`\`\`json
${json(context.reports)}
\`\`\`
${context.previous ? `对方上一轮发言：\n${context.previous}` : '对方尚未发言，请你先立论。'}
请输出本轮${stance}发言。`;
  return { system, user };
}

/**
 * @param {{ round: number, debate: { bull: string[], bear: string[] } }} context
 */
export function buildDebateRoundSummaryPrompt(context) {
  const system = '你是辩论主持人。用中文总结本轮多空交锋的焦点与分歧，不加入新观点，不编造数据。';
  const user = `第 ${context.round} 轮多空发言：
多头：${context.debate.bull.at(-1) ?? ''}
空头：${context.debate.bear.at(-1) ?? ''}
请用 5 行以内总结。`;
  return { system, user };
}

/**
 * @param {{ symbol: string, tradeDate: string, reports: any[], debate: { bull: string[], bear: string[] } }} context
 */
export function buildResearchPrompt(context) {
  const system = `你是研究经理。综合分析师结论与多空辩论，收敛为一个投资计划（方向、逻辑、关键风险）。${VERDICT_INSTRUCTION}`;
  const user = `标的 ${context.symbol}，分析日 ${context.tradeDate}。
分析师结论：\n\`\`\`json\n${json(context.reports)}\n\`\`\`
辩论（多头）：${context.debate.bull.join('\n---\n')}
辩论（空头）：${context.debate.bear.join('\n---\n')}
请输出投资计划。`;
  return { system, user };
}

/**
 * @param {{ symbol: string, tradeDate: string, plan: string, reports: any[], riskFeedback?: string|null }} context
 */
export function buildTraderPrompt(context) {
  const system = `你是交易员。基于研究计划与风控反馈给出交易提案：方向、入场区间、止损、目标、建议仓位（百分比）。这是研究提案，不是下单指令。${VERDICT_INSTRUCTION}`;
  const user = `标的 ${context.symbol}，分析日 ${context.tradeDate}。
研究计划：\n${context.plan}
分析师结论：\n\`\`\`json\n${json(context.reports)}\n\`\`\`
${context.riskFeedback ? `风控反馈：\n${context.riskFeedback}` : ''}
请给出交易提案。`;
  return { system, user };
}

/**
 * @param {'aggressive'|'conservative'|'neutral'} stance
 * @param {{ symbol: string, proposal: string, plan: string }} context
 */
export function buildRiskPrompt(stance, context) {
  const label = { aggressive: '激进', conservative: '保守', neutral: '中性' }[stance];
  const system = `你是${label}风控。评估交易提案的下行风险与仓位合理性，只有提示权，不执行平仓。${VERDICT_INSTRUCTION}`;
  const user = `标的 ${context.symbol}。
交易提案：\n${context.proposal}
研究计划：\n${context.plan}
请从${label}视角给出风控意见。`;
  return { system, user };
}

/**
 * @param {{ symbol: string, proposal: string, risk: Record<string,string> }} context
 */
export function buildRiskManagerPrompt(context) {
  const system = `你是风控经理。汇总三方风控意见，判断提案是否可接受，给出风险等级与调整建议。${VERDICT_INSTRUCTION}`;
  const user = `标的 ${context.symbol}。
交易提案：\n${context.proposal}
三方意见：\n\`\`\`json\n${json(context.risk)}\n\`\`\`
请给出最终风控意见。`;
  return { system, user };
}

/** 修复调用：只让模型重新输出合法 JSON。 */
export function buildVerdictRepairPrompt(invalidText, errorMessage) {
  return {
    system: `你上一次输出缺少合法 VERDICT。请只输出一个 \`\`\`json 代码块，字段：{"direction":"bullish|bearish|neutral","confidence":0-100,"positionPct":0-100,"entryRange":[low,high]或null,"stopLoss":数字或null,"target":数字或null,"oneLineReason":"一句话"}。不要输出其它内容。`,
    user: `上一次输出（节选）：\n${String(invalidText).slice(-1200)}\n\n解析失败原因：${errorMessage}`,
  };
}
