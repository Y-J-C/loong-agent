'use strict';

const { buildTopicEnvelope, searchKnowledge } = require('../kb');
const { summarize } = require('../tool-utils');

const TOPIC_HINTS = [
  { topic: 'risk_list', pattern: /risk|danger|blocked|error|fail|安全|风险|失败|拒绝|阻断/i },
  { topic: 'unknowns', pattern: /unknown|uncertain|todo|待确认|不确定|未知/i },
  { topic: 'command_reference', pattern: /command|shell|readonly|allowlist|命令|白名单|诊断/i },
  { topic: 'board_profile', pattern: /board|loong|loongarch|hardware|板|龙芯|架构/i },
  { topic: 'environment_report', pattern: /environment|node|runtime|os|kernel|环境|运行时/i },
  { topic: 'software_stack', pattern: /software|stack|npm|commonjs|compiler|g\+\+|docker|podman|pip|软件|依赖/i },
  { topic: 'compatibility_matrix', pattern: /compat|node 14|compatibility|兼容/i },
];

const TROUBLESHOOTING_PATTERN =
  /eth1|npm|g\+\+|pip|docker|podman|\/boot\/efi|gpt|audio|no codecs|crtc|display|gpio|i2c|spi|uart|故障|排查|不能用|不可用/i;
const RAW_EVIDENCE_PATTERN = /(?:\braw\b|\bevidence\b|证据|日志|dmesg|原始)/i;
const HISTORICAL_INTENT_PATTERN = /当时|之前|上次|刚才|那次|历史|记录|session|jsonl|previous|last time|earlier/i;
const CURRENT_INTENT_PATTERN = /当前|现在|此刻|这台设备现在|current|now/i;
const TOOLCHAIN_ENV_PATTERN = /node|npm|gcc|g\+\+|python|python3|git|curl|wget|环境|运行时|工具链/i;
const MAX_TOPIC_CONTEXT = 3;
const MAX_SEARCH_CONTEXT = 3;

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

function temporalIntent(text) {
  const value = String(text || '');
  if (HISTORICAL_INTENT_PATTERN.test(value)) return 'historical';
  if (CURRENT_INTENT_PATTERN.test(value)) return 'current';
  return 'unknown';
}

function addTopic(selected, topic) {
  if (selected.indexOf(topic) < 0) selected.push(topic);
}

function chooseTopics(text, action) {
  const selected = [];
  const intent = temporalIntent(text);
  if (intent === 'historical') {
    addTopic(selected, 'environment_report');
    if (TOOLCHAIN_ENV_PATTERN.test(String(text || ''))) addTopic(selected, 'software_stack');
    addTopic(selected, 'source_index');
    addTopic(selected, 'unknowns');
  }
  if (action && action.tool === 'loong_env_check' && intent !== 'historical') {
    addTopic(selected, 'compatibility_matrix');
    addTopic(selected, 'risk_list');
    addTopic(selected, 'environment_report');
  }
  for (const hint of TOPIC_HINTS) {
    if (hint.pattern.test(text)) addTopic(selected, hint.topic);
  }
  if (!selected.length && text) {
    addTopic(selected, 'risk_list');
    addTopic(selected, 'unknowns');
  }
  return selected.slice(0, MAX_TOPIC_CONTEXT);
}

function includeRawEvidence(text) {
  return RAW_EVIDENCE_PATTERN.test(String(text || ''));
}

function searchLimit(text) {
  return TROUBLESHOOTING_PATTERN.test(String(text || '')) || includeRawEvidence(text) || temporalIntent(text) === 'historical'
    ? 10
    : 2;
}

function formatSearchMatch(match) {
  return [
    `${match.title || match.topic}: ${summarize(match.summary || '', 360)}`,
    match.stage ? `Stage: ${match.stage}` : '',
    match.path ? `Path: ${match.path}` : '',
    match._verification ? `Verification: ${match._verification}` : '',
    match.unknowns ? `Unknowns: ${summarize(match.unknowns, 220)}` : '',
    match.warnings && match.warnings.length ? `Warnings: ${match.warnings.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

function selectSearchContextMatches(matches, text) {
  const selected = [];
  const seen = {};
  function add(match) {
    if (!match || !match.topic || seen[match.topic] || selected.length >= MAX_SEARCH_CONTEXT) return;
    seen[match.topic] = true;
    selected.push(match);
  }
  if (TROUBLESHOOTING_PATTERN.test(String(text || ''))) {
    (matches || [])
      .filter((match) => match.topic === 'maintenance.troubleshooting')
      .forEach(add);
    (matches || [])
      .filter((match) => match.kind === 'playbook')
      .forEach(add);
  }
  if (includeRawEvidence(text)) {
    (matches || [])
      .filter((match) => match.kind === 'raw')
      .forEach(add);
  }
  (matches || [])
    .filter((match) => match.kind === 'preview_doc' || match.kind === 'maintenance' || match.kind === 'playbook')
    .forEach(add);
  (matches || []).forEach(add);
  return selected;
}

function knowledgeContextHook(context) {
  if (!context || !context.state) return null;
  const text = contextText(context);
  if (!text) return;
  const config = context.config || {};
  const action = context.action || {};
  const intent = temporalIntent(text);
  const topics = chooseTopics(text, action);
  const topicResults = [];
  for (const topic of topics) {
    const envelope = buildTopicEnvelope(config, topic);
    if (envelope.ok) topicResults.push(envelope);
  }
  const searchResults = selectSearchContextMatches(searchKnowledge(config, text, {
    limit: searchLimit(text),
    includeRaw: includeRawEvidence(text),
  }), text);
  const evidence = [];
  const unknowns = [];
  const warnings = [];
  const summaries = [];
  const contextAdditions = [];
  for (const item of topicResults) {
    summaries.push(item.summary);
    evidence.push.apply(evidence, item.evidence || []);
    warnings.push.apply(warnings, item.warnings || []);
    contextAdditions.push({
      source: 'knowledge_context',
      title: `Knowledge topic: ${item.topic}`,
      topic: item.topic,
      content: [
        item.summary,
        item.unknowns ? `Unknowns: ${summarize(item.unknowns, 240)}` : '',
        item.warnings && item.warnings.length ? `Warnings: ${item.warnings.join('; ')}` : '',
      ].filter(Boolean).join('\n'),
    });
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
    if (match.warnings && match.warnings.length) warnings.push.apply(warnings, match.warnings);
    contextAdditions.push({
      source: 'knowledge_search',
      title: `Knowledge match: ${match.title || match.topic}`,
      topic: match.topic,
      content: formatSearchMatch(match),
    });
  }
  if (!summaries.length && !evidence.length) return;
  warnings.push('Knowledge context is supporting evidence only. Treat draft, unknown, and 待确认 entries as uncertain.');
  if (intent === 'historical') {
    warnings.push('Historical intent detected; do not treat current checks as historical evidence unless explicitly labeled as current re-check.');
  }
  return {
    contextAdditions,
    knowledgeEvidence: evidence,
    warnings,
    data: {
      topics,
      temporalIntent: intent,
      summary: summarize(summaries.join('\n'), 900),
      unknowns,
      searchMatches: searchResults.map((match) => ({
        kind: match.kind,
        topic: match.topic,
        path: match.path,
        title: match.title,
        stage: match.stage,
        sourceType: match.sourceType,
        score: match.score,
        _domain: match._domain,
        _arch: match._arch,
        _source: match._source,
        _verification: match._verification,
        _priority: match._priority,
        _tags: match._tags,
      })),
    },
  };
}

module.exports = {
  knowledgeContextHook,
  temporalIntent,
};
