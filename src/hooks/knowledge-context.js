'use strict';

const { buildTopicEnvelope, searchKnowledge } = require('../kb');
const { summarize } = require('../tool-utils');

const TOPIC_HINTS = [
  { topic: 'risk_list', pattern: /risk|danger|blocked|error|fail|安全|风险|失败|拒绝|阻断/i },
  { topic: 'unknowns', pattern: /unknown|uncertain|todo|待确认|不确定|未知/i },
  { topic: 'command_reference', pattern: /command|shell|readonly|allowlist|命令|白名单|诊断/i },
  { topic: 'board_profile', pattern: /board|loong|loongarch|hardware|板|龙芯|架构/i },
  { topic: 'environment_report', pattern: /environment|node|runtime|os|kernel|环境|运行时/i },
  { topic: 'software_stack', pattern: /software|stack|npm|commonjs|compiler|g\+\+|软件|依赖/i },
  { topic: 'compatibility_matrix', pattern: /compat|node 14|compatibility|兼容/i },
];

function contextText(context) {
  const action = context && context.action ? context.action : {};
  const result = context && context.result ? context.result : {};
  const messages = context && context.state && Array.isArray(context.state.messages) ? context.state.messages : [];
  const latestUser = messages
    .slice()
    .reverse()
    .find((message) => message && message.role === 'user' && !message.internal);
  return [
    latestUser && latestUser.content,
    action.tool,
    JSON.stringify(action.input || {}),
    result.summary,
    result.error,
    JSON.stringify(result.warnings || []),
  ].filter(Boolean).join('\n');
}

function chooseTopics(text) {
  const selected = [];
  for (const hint of TOPIC_HINTS) {
    if (hint.pattern.test(text) && selected.indexOf(hint.topic) < 0) selected.push(hint.topic);
  }
  if (!selected.length && text) {
    selected.push('risk_list', 'unknowns');
  }
  return selected.slice(0, 3);
}

function knowledgeContextHook(context) {
  if (!context || !context.state || !Array.isArray(context.state.observations)) return;
  const text = contextText(context);
  if (!text) return;
  const config = context.config || {};
  const topics = chooseTopics(text);
  const topicResults = [];
  for (const topic of topics) {
    const envelope = buildTopicEnvelope(config, topic);
    if (envelope.ok) topicResults.push(envelope);
  }
  const searchResults = searchKnowledge(config, text, { limit: 2 });
  const evidence = [];
  const unknowns = [];
  const warnings = [];
  const summaries = [];
  for (const item of topicResults) {
    summaries.push(item.summary);
    evidence.push.apply(evidence, item.evidence || []);
    warnings.push.apply(warnings, item.warnings || []);
    if (item.unknowns) unknowns.push({
      topic: item.topic,
      text: summarize(item.unknowns, 300),
      status: item.status,
      confidence: item.confidence,
    });
  }
  for (const match of searchResults) {
    if (!match || !match.evidence) continue;
    if (!evidence.some((item) => item.topic === match.evidence.topic)) evidence.push(match.evidence);
  }
  if (!summaries.length && !evidence.length) return;
  context.state.observations.push({
    loop: context.state.turn || context.loop || 0,
    tool: 'knowledge_context',
    reason: 'related knowledge summary',
    input: {
      topics,
    },
    result: {
      summary: summarize(summaries.join('\n'), 900),
      evidence,
      unknowns,
      warnings,
      caution: 'Knowledge context is supporting evidence only. Treat draft, unknown, and 待确认 entries as uncertain.',
    },
  });
}

module.exports = {
  knowledgeContextHook,
};
