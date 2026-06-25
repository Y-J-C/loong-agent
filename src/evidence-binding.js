'use strict';

const { classifyRequestContext, selectContextMessages } = require('./context-selector');

function uniqueClaims(claims) {
  const seen = {};
  const out = [];
  (claims || []).forEach((claim) => {
    const key = `${claim.type}:${claim.normalized || claim.value}`;
    if (seen[key]) return;
    seen[key] = true;
    out.push(claim);
  });
  return out;
}

function normalizeCapacity(value, unit) {
  const numeric = String(value || '').toLowerCase().replace(/\.0+$/, '');
  const unitToken = String(unit || '')
    .toLowerCase()
    .replace(/ib$/, '')
    .replace(/b$/, '')
    .replace(/i$/, '');
  return `${numeric}${unitToken}`;
}

function normalizeToken(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function normalizePath(value) {
  return String(value || '').replace(/[),.;，。；、]+$/g, '');
}

function addRegexClaims(text, regex, type, normalize) {
  const claims = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    claims.push({
      type,
      value,
      normalized: normalize ? normalize(match) : normalizeToken(value),
    });
  }
  return claims;
}

function extractClaims(answerText) {
  const text = String(answerText || '');
  const claims = [];

  claims.push.apply(claims, addRegexClaims(
    text,
    /(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|Ki|Mi|Gi|Ti|K|M|G|T)\b/gi,
    'memory_or_disk_quantity',
    (match) => normalizeCapacity(match[1], match[2])
  ));
  claims.push.apply(claims, addRegexClaims(
    text,
    /\bv?(\d+\.\d+\.\d+)\b/gi,
    'version',
    (match) => match[1].toLowerCase()
  ));
  claims.push.apply(claims, addRegexClaims(
    text,
    /\b0x[0-9a-f]{2}\b/gi,
    'i2c_address',
    (match) => match[0].toLowerCase()
  ));
  claims.push.apply(claims, addRegexClaims(
    text,
    /(?:^|[\s:：])UU(?:$|[\s,，.;；])/g,
    'i2c_address',
    () => 'uu'
  ));
  const pathPattern = /(^|[\s"'`(（\[:：])((?:[A-Za-z]:\\|\/)[^\s"'<>|，。；、）)\]}]+)/g;
  let pathMatch;
  while ((pathMatch = pathPattern.exec(text)) !== null) {
    const value = normalizePath(pathMatch[2]);
    if (!value) continue;
    claims.push({
      type: 'path',
      value,
      normalized: normalizeToken(value),
    });
  }
  claims.push.apply(claims, addRegexClaims(
    text,
    /\b(?:pid|PID|进程)\s*[=:：]?\s*(\d{2,})\b/g,
    'pid',
    (match) => match[1]
  ));
  const sensorPattern = /(^|[^A-Za-z0-9])(-?\d+(?:\.\d+)?)\s*(°?\s*C|℃|hPa|Pa)\b/gi;
  let sensorMatch;
  while ((sensorMatch = sensorPattern.exec(text)) !== null) {
    claims.push({
      type: 'sensor_measurement',
      value: `${sensorMatch[2]} ${sensorMatch[3]}`.trim(),
      normalized: `${String(sensorMatch[2]).toLowerCase()}${String(sensorMatch[3]).toLowerCase().replace(/\s+/g, '').replace('°', '')}`,
    });
  }
  claims.push.apply(claims, addRegexClaims(
    text,
    /\b\d+(?:\.\d+)?%/g,
    'percent',
    (match) => match[0].toLowerCase()
  ));
  claims.push.apply(claims, addRegexClaims(
    text,
    /\b(?:rows|行数|数据行数|samples|样本数|count)\s*[=:：]?\s*(\d+)\b/gi,
    'labeled_count',
    (match) => match[1]
  ));

  return uniqueClaims(claims);
}

function typedObservationMessagesFromState(state) {
  const messages = [];
  for (const message of (state && state.messages) || []) {
    if (message && message.role === 'observation') messages.push(message);
  }
  for (const item of (state && state.observations) || []) {
    if (!item) continue;
    if (item.subject) messages.push(Object.assign({ role: 'observation' }, item));
    if (Array.isArray(item.typedObservations)) {
      item.typedObservations.forEach((typed) => {
        if (typed && typed.subject) messages.push(typed);
      });
    }
  }
  return messages;
}

function rawForObservation(observation) {
  return [
    observation && observation.raw ? observation.raw : '',
    observation && observation.parsed ? JSON.stringify(observation.parsed) : '',
    observation && observation.evidence ? JSON.stringify(observation.evidence) : '',
  ].filter(Boolean).join('\n');
}

function observationSupportsClaim(observation, claim) {
  const raw = rawForObservation(observation);
  const normalizedRaw = normalizeToken(raw);
  if (!raw) return false;
  if (claim.type === 'memory_or_disk_quantity') {
    const quantities = extractClaims(raw).filter((item) => item.type === 'memory_or_disk_quantity');
    return quantities.some((item) => item.normalized === claim.normalized);
  }
  if (claim.type === 'version') {
    const versions = extractClaims(raw).filter((item) => item.type === 'version');
    return versions.some((item) => item.normalized === claim.normalized);
  }
  if (claim.type === 'i2c_address') {
    if (normalizedRaw.indexOf(claim.normalized) >= 0) return true;
    const hex = /^0x([0-9a-f]{2})$/i.exec(claim.normalized);
    if (hex && observation.subject === 'hardware.i2c') {
      return new RegExp(`(^|\\s)${hex[1]}(\\s|$)`, 'i').test(raw);
    }
    return false;
  }
  if (claim.type === 'path') {
    return normalizedRaw.indexOf(claim.normalized) >= 0;
  }
  if (claim.type === 'pid' || claim.type === 'labeled_count') {
    return new RegExp(`\\b${claim.normalized}\\b`).test(raw);
  }
  if (claim.type === 'sensor_measurement') {
    const numeric = /^(-?\d+(?:\.\d+)?)/.exec(String(claim.value || ''));
    if (numeric && /\bfilesystem|hardware\.sensor\b/.test(String(observation.subject || ''))) {
      return new RegExp(`(^|[^0-9.])${numeric[1].replace('.', '\\.')}([^0-9.]|$)`).test(raw);
    }
    return extractClaims(raw).some((item) => item.type === 'sensor_measurement' && item.normalized === claim.normalized) ||
      normalizedRaw.indexOf(claim.normalized) >= 0;
  }
  return normalizedRaw.indexOf(claim.normalized) >= 0;
}

function buildEvidenceCorpus(state, requestContext) {
  const context = requestContext || classifyRequestContext((state && state.userPrompt) || '');
  const prompt = String((context && context.prompt) || (state && state.userPrompt) || '');
  const effectiveContext = /刚才|本轮|上面|前面/.test(prompt) && context.isHistorical
    ? Object.assign({}, context, {
        intent: 'mixed',
        isCurrent: true,
        currentSubjects: (context.subjects || []).filter((subject) => !/^session\.|^knowledge\./.test(subject)),
        freshness: Array.from(new Set([].concat(context.freshness || [], ['current']))),
      })
    : context;
  const observationMessages = typedObservationMessagesFromState(state);
  const selected = selectContextMessages(observationMessages, effectiveContext, {
    observationsPerSubject: 24,
    conversationMessages: 0,
  }).filter((message) => message && message.role === 'observation');
  return {
    requestContext: effectiveContext,
    observations: selected,
    sources: selected.map((observation) => ({
      id: observation.id || '',
      subject: observation.subject || '',
      freshness: observation.freshness || '',
      source: observation.source || '',
      command: observation.command || '',
      evidence: observation.evidence || [],
    })),
    text: selected.map(rawForObservation).join('\n\n'),
  };
}

function isHardClaim(claim) {
  return {
    i2c_address: true,
    pid: true,
    sensor_measurement: true,
    labeled_count: true,
  }[claim && claim.type] === true;
}

function expectedSubjects(requestContext) {
  const context = requestContext || {};
  if (context.isCurrent && context.currentSubjects && context.currentSubjects.length) return context.currentSubjects;
  if (context.isHistorical && context.historicalSubjects && context.historicalSubjects.length) return context.historicalSubjects;
  return context.subjects || [];
}

function bindClaims(claims, corpus) {
  const observations = (corpus && corpus.observations) || [];
  const supported = [];
  const unsupported = [];
  (claims || []).forEach((claim) => {
    const observation = observations.find((item) => observationSupportsClaim(item, claim));
    if (observation) {
      supported.push(Object.assign({}, claim, {
        source: {
          id: observation.id || '',
          subject: observation.subject || '',
          freshness: observation.freshness || '',
          source: observation.source || '',
        },
      }));
    } else {
      unsupported.push(Object.assign({}, claim, {
        reason: 'claim_not_found_in_selected_observations',
      }));
    }
  });
  return {
    supported,
    unsupported,
    missingEvidence: Boolean(claims && claims.length && !observations.length),
    sources: (corpus && corpus.sources) || [],
  };
}

function compactJson(value, maxLength) {
  const text = JSON.stringify(value || {}, null, 2);
  const limit = Number(maxLength) || 600;
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 18))}\n... [truncated]`;
}

function formatBindingFallback(binding, corpus, requestContext) {
  const context = requestContext || (corpus && corpus.requestContext) || {};
  const observations = (corpus && corpus.observations) || [];
  const lines = [
    '已拒绝使用未被相关 evidence 支撑的回答内容。',
  ];
  if (binding && binding.unsupported && binding.unsupported.length) {
    lines.push(`未被支持的 claim 类型：${binding.unsupported.map((item) => item.type).join(', ')}`);
  }
  if (!observations.length) {
    lines.push(`缺少相关 observation：${expectedSubjects(context).join(', ') || '待确认'}`);
    if (context.isHistorical && !context.isCurrent) {
      lines.push('当前复测是否参与：未参与；当前 observation 不能作为历史事实。');
    }
    return lines.join('\n');
  }
  lines.push('可用 evidence：');
  observations.slice(-3).forEach((observation) => {
    lines.push(`- ${observation.subject || 'unknown'} / ${observation.freshness || 'unknown'} / ${observation.source || 'unknown'}`);
    const raw = String(observation.raw || '').trim();
    if (raw) lines.push('```', raw.length > 1200 ? `${raw.slice(0, 1182)}\n... [truncated]` : raw, '```');
    if (observation.parsed && Object.keys(observation.parsed).length) {
      lines.push(`parsed=${compactJson(observation.parsed, 500)}`);
    }
  });
  if (context.isHistorical && !context.isCurrent) {
    lines.push('当前复测是否参与：未参与；以上仅使用 historical observation。');
  } else if (context.isCurrent) {
    lines.push('当前复测是否参与：已使用本轮 current observation。');
  }
  return lines.join('\n');
}

function validateFinalAnswerBinding(state, prompt, answerText) {
  const requestContext = classifyRequestContext(prompt || '');
  requestContext.prompt = String(prompt || '');
  const claims = extractClaims(answerText);
  if (!claims.length) return null;
  const corpus = buildEvidenceCorpus(state, requestContext);
  const binding = bindClaims(claims, corpus);
  const hardUnsupported = (binding.unsupported || []).filter(isHardClaim);
  const hardClaims = (claims || []).filter(isHardClaim);
  if (!hardUnsupported.length && !(binding.missingEvidence && hardClaims.length)) return null;
  const effectiveBinding = Object.assign({}, binding, {
    unsupported: hardUnsupported,
  });
  return {
    reason: binding.missingEvidence ? 'answer_claim_missing_relevant_evidence' : 'answer_claim_not_in_relevant_evidence',
    claims,
    binding: effectiveBinding,
    requestContext,
    corpus,
    message: [
      'The final answer included claim(s) that are not present in the selected typed observations.',
      hardUnsupported.length ? `Unsupported claim(s): ${hardUnsupported.map((item) => `${item.type}=${item.value}`).join(', ')}` : '',
      'Rewrite the answer using only values that appear in the selected observation raw or parsed evidence.',
    ].filter(Boolean).join('\n'),
    fallbackSummary: formatBindingFallback(effectiveBinding, corpus, requestContext),
  };
}

module.exports = {
  bindClaims,
  buildEvidenceCorpus,
  extractClaims,
  formatBindingFallback,
  validateFinalAnswerBinding,
};
