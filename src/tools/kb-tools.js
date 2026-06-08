'use strict';

const { READONLY_COMMAND_METADATA } = require('../tools.js');
const {
  buildTopicEnvelope,
  listTopics,
  readTopic,
  searchKnowledge,
} = require('../kb');
const { requireString, optionalNumber, summarize } = require('../tool-utils');

function validateTopic(input) {
  return requireString(input || {}, 'topic');
}

function validateQuery(input) {
  return requireString(input || {}, 'query') || optionalNumber(input || {}, 'limit');
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
    },
    promptSnippet: 'Use kb_search when the relevant topic is unclear.',
    promptGuidelines:
      'Search results are local knowledge hints, not absolute facts. Check status/confidence before relying on them.',
    validate: validateQuery,
    renderCall: (input) => `query=${input.query}`,
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 600),
    execute: async (config, input) => {
      const matches = searchKnowledge(config, input.query, { limit: input.limit });
      const warnings = matches.map((match) => match.warning).filter(Boolean);
      return {
        ok: true,
        data: {
          query: input.query,
          matches,
        },
        summary: matches.length
          ? `kb_search found ${matches.length} topic(s): ${matches.map((match) => match.topic).join(', ')}`
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
      data: 'risk and unknowns topic summaries',
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
      const matches = searchKnowledge(config, input.query, { limit: 5 })
        .filter((match) => match.topic === 'risk_list' || match.topic === 'unknowns');
      const evidence = []
        .concat(risk.evidence || [])
        .concat(unknowns.evidence || []);
      const warnings = []
        .concat(risk.warnings || [])
        .concat(unknowns.warnings || []);
      return {
        ok: risk.ok && unknowns.ok,
        data: {
          query: input.query,
          risks: risk.data,
          unknowns: unknowns.data,
          matches,
        },
        summary: `risk_lookup: risk_list status=${risk.status || 'unknown'}, unknowns status=${unknowns.status || 'unknown'}`,
        evidence,
        warnings,
        error: risk.error || unknowns.error || '',
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
    description: 'Show allowed read-only diagnostic commands from the structured allowlist plus local notes.',
    category: 'diagnostics',
    safety: kbSafety(),
    evidencePolicy: kbEvidencePolicy(),
    resultSchema: {
      data: 'readonly command metadata and kb command notes',
      evidence: 'structured allowlist and kb source',
      warnings: 'command reference kb uncertainty',
    },
    parameters: {
      query: 'string optional',
    },
    promptSnippet: 'Use command_reference before suggesting diagnostic shell commands.',
    promptGuidelines:
      'The structured READONLY_COMMAND_METADATA allowlist is authoritative. Do not invent commands.',
    validate: () => '',
    renderCall: (input) => input && input.query ? `query=${input.query}` : 'all readonly commands',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async (config, input) => {
      const topic = buildTopicEnvelope(config, 'command_reference');
      const query = String((input && input.query) || '').toLowerCase().trim();
      const commands = READONLY_COMMAND_METADATA.filter((item) => {
        if (!query) return true;
        return `${item.command} ${item.category} ${item.risk} ${item.description}`.toLowerCase().indexOf(query) >= 0;
      });
      const evidence = [{
        source: 'runtime',
        topic: 'command_reference',
        path: 'src/tools.js',
        status: 'measured',
        confidence: 'high',
      }].concat(topic.evidence || []);
      const warnings = topic.warnings ? topic.warnings.slice() : [];
      if (!commands.length) warnings.push(`No allowed command matched query: ${input && input.query ? input.query : ''}`);
      return {
        ok: true,
        data: {
          query: input && input.query ? input.query : '',
          commands,
          notes: topic.data,
          authoritativeSource: 'READONLY_COMMAND_METADATA',
        },
        summary: `command_reference: ${commands.length} allowed command(s) from READONLY_COMMAND_METADATA`,
        evidence,
        warnings,
        error: '',
        commands,
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
