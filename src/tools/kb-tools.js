'use strict';

const {
  COMMAND_POLICY_METADATA,
  groupCommandPolicyLevels,
} = require('../command-policy');
const {
  buildTopicEnvelope,
  listTopics,
  readTopic,
  searchKnowledge,
} = require('../kb');
const { requireString, optionalNumber, summarize } = require('../tool-utils');

const RAW_EVIDENCE_PATTERN = /(?:\braw\b|\bevidence\b|证据|日志|dmesg|原始)/i;
const FORBIDDEN_RISK_RULES = [
  { pattern: /\bapt(-get)?\s+(install|upgrade|full-upgrade|dist-upgrade)\b/i, operation: 'system package install/upgrade' },
  { pattern: /\bfsck\b/i, operation: 'filesystem repair' },
  { pattern: /\bfdisk\b/i, operation: 'partition editing' },
  { pattern: /\bparted\b/i, operation: 'partition editing' },
  { pattern: /\bmkfs\b/i, operation: 'filesystem creation' },
  { pattern: /\bdd\b/i, operation: 'raw disk write/copy' },
  { pattern: /修改\s*\/boot|\/boot|efi|设备树|device\s*tree|kernel parameter|内核参数/i, operation: 'boot/device-tree/kernel modification' },
  { pattern: /修改.*网络|eth0|eth1.*配置|network reconfig/i, operation: 'network reconfiguration' },
  { pattern: /盲扫|接线|gpio.*写|i2c.*扫|spi.*扫|peripheral probe/i, operation: 'unsafe peripheral probing' },
];
const CAUTION_RISK_RULES = [
  { pattern: /安装|install|包管理|package|apt|npm|g\+\+|build-essential|docker|podman/i, item: 'package or tool installation requires dependency, source, and disk review' },
  { pattern: /外设|gpio|i2c|spi|uart|音频|display|crtc|audio/i, item: 'peripheral work requires pinout, voltage, permissions, and hardware validation' },
  { pattern: /启动|存储|\/boot|efi|gpt|filesystem|分区/i, item: 'boot and storage work requires backup and recovery planning' },
];
const FORBIDDEN_EXAMPLES = [
  'apt upgrade',
  'apt install',
  'fsck',
  'fdisk',
  'parted',
  'mkfs',
  'dd',
  'modify /boot or EFI',
  'modify network configuration',
  'blind peripheral probing',
];

function validateTopic(input) {
  return requireString(input || {}, 'topic');
}

function validateQuery(input) {
  return requireString(input || {}, 'query') || optionalNumber(input || {}, 'limit') || optionalBoolean(input || {}, 'includeRaw');
}

function optionalBoolean(input, name) {
  if (input[name] === undefined || input[name] === null || input[name] === '') return '';
  return typeof input[name] === 'boolean' ? '' : `Field must be a boolean: ${name}`;
}

function includeRawEvidence(query) {
  return RAW_EVIDENCE_PATTERN.test(String(query || ''));
}

function classifyRisk(query) {
  const text = String(query || '');
  const forbiddenOperations = FORBIDDEN_RISK_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.operation);
  const cautionItems = CAUTION_RISK_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.item);
  const uniqueForbidden = Array.from(new Set(forbiddenOperations));
  const uniqueCaution = Array.from(new Set(cautionItems));
  const riskLevel = uniqueForbidden.length ? 'forbidden' : uniqueCaution.length ? 'caution' : 'unknown';
  const readOnlyAlternatives = [
    'Search the local knowledge base for existing evidence and uncertainty notes.',
    'Use command_reference to find recommended diagnostic commands from COMMAND_POLICY_METADATA.',
    'Prefer loong_env_check or recommended diagnostic commands for current state.',
  ];
  const pendingConfirmations = [];
  if (riskLevel === 'forbidden') {
    pendingConfirmations.push('A backup, recovery path, and explicit maintenance plan are required before any system-changing action.');
  } else if (riskLevel === 'caution') {
    pendingConfirmations.push('Confirm dependency size, disk space, source availability, and board-specific risk before acting.');
  } else {
    pendingConfirmations.push('Risk level is not fully classified from the query; gather read-only evidence before making a recommendation.');
  }
  return {
    riskLevel,
    forbiddenOperations: uniqueForbidden,
    cautionItems: uniqueCaution,
    readOnlyAlternatives,
    pendingConfirmations,
  };
}

function kbSafety() {
  return { readOnly: true, sensitive: false, requiresWorkspace: true };
}

function kbEvidencePolicy() {
  return { emitsEvidence: true, source: 'kb' };
}

function createKbTopicToolDefinition() {
  return {
    name: 'kb_topic',
    label: 'Knowledge topic',
    description: 'Read one local knowledge-base topic with provenance and uncertainty metadata.',
    category: 'filesystem-readonly',
    safety: kbSafety(),
    evidencePolicy: kbEvidencePolicy(),
    resultSchema: {
      data: 'topic metadata, content, unknowns',
      evidence: 'kb path, topic, status, confidence',
      warnings: 'draft or unknown content warnings',
    },
    parameters: {
      topic: `string; one of ${listTopics().join(', ')}`,
    },
    promptSnippet: 'Use kb_topic to inspect known board, environment, risk, command, and unknowns topics.',
    promptGuidelines:
      'Treat draft or unknown knowledge as uncertain. Cite status/confidence and mention unknowns when relevant.',
    validate: validateTopic,
    renderCall: (input) => `topic=${input.topic}`,
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 600),
    execute: async (config, input) => buildTopicEnvelope(config, String(input.topic || '').trim()),
  };
}

function createKbSearchToolDefinition() {
  return {
    name: 'kb_search',
    label: 'Knowledge search',
    description: 'Search local Markdown knowledge topics with lightweight keyword matching.',
    category: 'filesystem-readonly',
    safety: kbSafety(),
    evidencePolicy: kbEvidencePolicy(),
    resultSchema: {
      data: 'matched topics and snippets',
      evidence: 'kb topic sources',
      warnings: 'draft or unknown topic warnings',
    },
    parameters: {
      query: 'string',
      limit: 'number optional',
      includeRaw: 'boolean optional; true forces raw evidence search, false disables raw evidence search',
    },
    promptSnippet: 'Use kb_search when the relevant topic is unclear.',
    promptGuidelines:
      'Search results are local knowledge hints, not absolute facts. Check status/confidence before relying on them.',
    validate: validateQuery,
    renderCall: (input) => `query=${input.query}`,
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 600),
    execute: async (config, input) => {
      const matches = searchKnowledge(config, input.query, { limit: input.limit, includeRaw: input.includeRaw });
      const warnings = matches.map((match) => match.warning).filter(Boolean);
      return {
        ok: true,
        data: {
          query: input.query,
          matches,
        },
        summary: matches.length
          ? `kb_search found ${matches.length} result(s): ${matches.map((match) => match.topic).join(', ')}`
          : `kb_search found no topics for: ${input.query}`,
        evidence: matches.map((match) => match.evidence),
        warnings,
        error: '',
        matches,
      };
    },
  };
}

function createRiskLookupToolDefinition() {
  return {
    name: 'risk_lookup',
    label: 'Risk lookup',
    description: 'Look up local risk and unknowns notes relevant to a query.',
    category: 'diagnostics',
    safety: kbSafety(),
    evidencePolicy: kbEvidencePolicy(),
    resultSchema: {
      data: 'risk level, forbidden operations, read-only alternatives, pending confirmations, and knowledge matches',
      evidence: 'kb risk_list and unknowns sources',
      warnings: 'draft or unknown topic warnings',
    },
    parameters: {
      query: 'string',
    },
    promptSnippet: 'Use risk_lookup before giving risky board, command, or environment advice.',
    promptGuidelines:
      'Mention unresolved unknowns explicitly. Do not present risk notes as proof of measured board state.',
    validate: (input) => requireString(input || {}, 'query'),
    renderCall: (input) => `query=${input.query}`,
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 600),
    execute: async (config, input) => {
      const risk = buildTopicEnvelope(config, 'risk_list');
      const unknowns = buildTopicEnvelope(config, 'unknowns');
      const classification = classifyRisk(input.query);
      const matches = searchKnowledge(config, input.query, { limit: 5, includeRaw: includeRawEvidence(input.query) });
      const evidence = []
        .concat(risk.evidence || [])
        .concat(unknowns.evidence || [])
        .concat(matches.map((match) => match.evidence).filter(Boolean));
      const warnings = []
        .concat(risk.warnings || [])
        .concat(unknowns.warnings || []);
      if (classification.riskLevel === 'forbidden') {
        warnings.push('Forbidden operation detected. Do not present this as an executable agent action.');
      }
      return {
        ok: risk.ok && unknowns.ok,
        data: {
          query: input.query,
          riskLevel: classification.riskLevel,
          forbiddenOperations: classification.forbiddenOperations,
          readOnlyAlternatives: classification.readOnlyAlternatives,
          pendingConfirmations: classification.pendingConfirmations,
          risks: risk.data,
          unknowns: unknowns.data,
          matches,
        },
        summary: `risk_lookup: riskLevel=${classification.riskLevel}, forbidden=${classification.forbiddenOperations.length}, pending=${classification.pendingConfirmations.length}`,
        evidence,
        warnings,
        error: risk.error || unknowns.error || '',
        riskLevel: classification.riskLevel,
        forbiddenOperations: classification.forbiddenOperations,
        readOnlyAlternatives: classification.readOnlyAlternatives,
        pendingConfirmations: classification.pendingConfirmations,
        risks: risk.data,
        unknowns: unknowns.data,
        matches,
      };
    },
  };
}

function createCommandReferenceToolDefinition() {
  return {
    name: 'command_reference',
    label: 'Command reference',
    description: 'Show recommended diagnostic commands from structured command reference metadata plus local notes.',
    category: 'diagnostics',
    safety: kbSafety(),
    evidencePolicy: kbEvidencePolicy(),
    resultSchema: {
      data: 'diagnostic command metadata and kb command notes',
      evidence: 'structured command reference and kb source',
      warnings: 'command reference kb uncertainty',
    },
    parameters: {
      query: 'string optional',
    },
    promptSnippet: 'Use command_reference before suggesting diagnostic shell commands.',
    promptGuidelines:
      'COMMAND_POLICY_METADATA is a recommended diagnostic command reference, not the bash execution boundary. One successful command_reference result is enough to answer command reference questions; summarize it instead of calling this tool again with the same input.',
    repeatPolicy: 'answerable_once',
    answerHint: 'Use this result to answer the user’s command reference question directly.',
    validate: () => '',
    renderCall: (input) => input && input.query ? `query=${input.query}` : 'all recommended commands',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async (config, input) => {
      const topic = buildTopicEnvelope(config, 'command_reference');
      const query = String((input && input.query) || '').toLowerCase().trim();
      const commands = COMMAND_POLICY_METADATA.filter((item) => {
        if (!query) return true;
        return `${item.command} ${item.category} ${item.level} ${item.decision} ${item.description}`.toLowerCase().indexOf(query) >= 0;
      });
      const riskLevels = groupCommandPolicyLevels(COMMAND_POLICY_METADATA);
      const evidence = [{
        source: 'runtime',
        topic: 'command_reference',
        path: 'src/command-policy.js',
        status: 'measured',
        confidence: 'high',
      }].concat(topic.evidence || []);
      const warnings = topic.warnings ? topic.warnings.slice() : [];
      if (!commands.length) warnings.push(`No command reference item matched query: ${input && input.query ? input.query : ''}`);
      return {
        ok: true,
        data: {
          query: input && input.query ? input.query : '',
          commands,
          notes: topic.data,
          riskLevels,
          authoritativeSource: 'COMMAND_POLICY_METADATA recommendations',
        },
        summary: `command_reference: ${commands.length} recommended command item(s) from COMMAND_POLICY_METADATA`,
        evidence,
        warnings,
        error: '',
        commands,
        riskLevels,
        notes: topic.data,
      };
    },
  };
}

function createKnowledgeToolDefinitions() {
  return [
    createKbTopicToolDefinition(),
    createKbSearchToolDefinition(),
    createRiskLookupToolDefinition(),
    createCommandReferenceToolDefinition(),
  ];
}

module.exports = {
  createCommandReferenceToolDefinition,
  createKbSearchToolDefinition,
  createKbTopicToolDefinition,
  createKnowledgeToolDefinitions,
  createRiskLookupToolDefinition,
};
