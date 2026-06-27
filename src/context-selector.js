'use strict';

const CURRENT_PATTERN = /当前|现在|目前|此刻|这台|开发板|设备|查看|current|now|board|device/i;
const HISTORICAL_PATTERN = /当时|之前|上次|刚才|那次|历史|记录|session|jsonl|previous|last time|earlier|history/i;

function unique(values) {
  const seen = {};
  const out = [];
  (values || []).forEach((value) => {
    if (!value || seen[value]) return;
    seen[value] = true;
    out.push(value);
  });
  return out;
}

function includesAny(values, candidates) {
  const set = {};
  (values || []).forEach((value) => {
    set[value] = true;
  });
  return (candidates || []).some((candidate) => set[candidate]);
}

function commandSubjects(command) {
  const text = String(command || '');
  const subjects = [];
  if (/\bfree\s+-h\b/i.test(text)) subjects.push('system.memory');
  if (/\bdf\s+-hT?\b|\blsblk\b|\bfindmnt\b|\bmount\b|\bdu\s+-sh\b/i.test(text)) subjects.push('system.disk');
  if (/^(node\s+-v|npm\s+-v|python3?\s+--version|git\s+--version|gcc\s+-v|clang\s+-v|uname\s+-[am]|cat\s+\/etc\/os-release|lscpu|which\s+)/i.test(text)) {
    subjects.push('system.runtime');
  }
  if (/i2cdetect|\/dev\/i2c|\/sys\/bus\/i2c|\/sys\/class\/i2c|i2c|iic/i.test(text)) {
    subjects.push('hardware.i2c');
  }
  if (/bmp280|bme280|sensor|iio|hwmon/i.test(text)) subjects.push('hardware.sensor');
  if (/\bss\s+-(?:t|u)lnp\b|\bnetstat\s+-(?:t|u)lnp\b/i.test(text)) subjects.push('network.ports');
  return unique(subjects);
}

function promptSubjects(prompt) {
  const text = String(prompt || '');
  const subjects = [];
  if (/\u5185\u5b58/i.test(text)) subjects.push('system.memory');
  if (/\u78c1\u76d8|\u786c\u76d8|\u5b58\u50a8|\u7a7a\u95f4|\u5206\u533a|\u6302\u8f7d/i.test(text)) subjects.push('system.disk');
  if (/memory|内存|free\s+-h|swap|Mem:/i.test(text)) subjects.push('system.memory');
  if (/disk|storage|filesystem|df\s+-h|磁盘|存储|空间|硬盘/i.test(text)) subjects.push('system.disk');
  if (/runtime|toolchain|node|npm|gcc|g\+\+|python|python3|git|clang|uname|lscpu|运行时|工具链|环境|版本/i.test(text)) {
    subjects.push('system.runtime');
  }
  if (/i2c|i²c|iic/i.test(text)) subjects.push('hardware.i2c');
  if (/sensor|sensors|传感器|bmp280|bme280|iio|hwmon/i.test(text)) subjects.push('hardware.sensor');
  if (/process|pid|进程|后台|日志|log/i.test(text)) subjects.push('process');
  if (/file|filesystem|csv|文件|目录|脚本|路径/i.test(text)) subjects.push('filesystem');
  return unique(subjects);
}

function classifyRequestContext(prompt) {
  const text = String(prompt || '');
  const current = CURRENT_PATTERN.test(text);
  const historical = HISTORICAL_PATTERN.test(text);
  const domainSubjects = promptSubjects(text);
  if (/\u7aef\u53e3|\u76d1\u542c|\u5f00\u653e|\u66b4\u9732|\u670d\u52a1\u66b4\u9732|port|ports|listen|listening|socket|sockets|ss\s+-|netstat/i.test(text) &&
      domainSubjects.indexOf('network.ports') < 0) {
    domainSubjects.push('network.ports');
  }
  const defaultsToCurrent = !historical && domainSubjects.some((subject) => /^system\.|^hardware\.|^network\./.test(subject));
  let intent = 'unknown';
  if (current && historical) intent = 'mixed';
  else if (historical) intent = 'historical';
  else if (current || defaultsToCurrent) intent = 'current';

  const currentSubjects = [];
  const historicalSubjects = [];
  if (intent === 'current' || intent === 'mixed') {
    currentSubjects.push.apply(currentSubjects, domainSubjects);
  }
  if (intent === 'historical' || intent === 'mixed') {
    historicalSubjects.push('session.history', 'knowledge.historical');
    domainSubjects.forEach((subject) => historicalSubjects.push(subject));
  }

  const subjects = unique([].concat(currentSubjects, historicalSubjects, domainSubjects));
  const freshness = [];
  if (currentSubjects.length) freshness.push('current');
  if (historicalSubjects.length) freshness.push('historical');

  return {
    intent,
    subjects,
    currentSubjects: unique(currentSubjects),
    historicalSubjects: unique(historicalSubjects),
    freshness: unique(freshness),
    evidenceSources: intent === 'historical'
      ? ['session', 'knowledge']
      : intent === 'mixed'
        ? ['observation', 'session', 'knowledge']
        : ['observation'],
    isCurrent: intent === 'current' || intent === 'mixed',
    isHistorical: intent === 'historical' || intent === 'mixed',
  };
}

function observationMatches(message, requestContext) {
  if (!message || message.role !== 'observation') return false;
  const subject = message.subject || '';
  const freshness = message.freshness || '';
  const currentSubjects = requestContext.currentSubjects || [];
  const historicalSubjects = requestContext.historicalSubjects || [];
  if (freshness === 'current' && currentSubjects.indexOf(subject) >= 0) return true;
  if (freshness === 'historical' && historicalSubjects.indexOf(subject) >= 0) return true;
  return false;
}

function selectedObservationMessages(messages, requestContext, options) {
  const perSubjectLimit = Math.max(1, Number((options && options.observationsPerSubject) || 2));
  const counts = {};
  const out = [];
  for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!observationMatches(message, requestContext)) continue;
    const key = `${message.subject || 'unknown'}:${message.freshness || 'unknown'}`;
    counts[key] = counts[key] || 0;
    if (counts[key] >= perSubjectLimit) continue;
    counts[key] += 1;
    out.push(Object.assign({}, message, { includeInContext: true }));
  }
  return out.reverse();
}

function selectedConversationMessages(messages, options) {
  const limit = Math.max(0, Number((options && options.conversationMessages) || 4));
  if (!limit) return [];
  return (messages || [])
    .filter((message) => {
      return message &&
        !message.internal &&
        (message.role === 'user' || message.role === 'assistant' || message.role === 'custom' || message.role === 'context');
    })
    .slice(-limit);
}

function selectedBashFallbackMessages(messages, requestContext, selectedObservations) {
  const currentSubjects = requestContext.currentSubjects || [];
  if (!currentSubjects.length) return [];
  const observedSubjects = {};
  (selectedObservations || []).forEach((message) => {
    if (message && message.freshness === 'current' && message.subject) observedSubjects[message.subject] = true;
  });
  const out = [];
  for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'bashExecution' || message.excludeFromContext) continue;
    const subjects = commandSubjects(message.command);
    const matched = subjects.filter((subject) => currentSubjects.indexOf(subject) >= 0 && !observedSubjects[subject]);
    if (!matched.length) continue;
    matched.forEach((subject) => {
      observedSubjects[subject] = true;
    });
    out.push(Object.assign({}, message, {
      includeInContext: true,
      contextFallbackSubjects: matched,
    }));
    if (currentSubjects.every((subject) => observedSubjects[subject])) break;
  }
  return out.reverse();
}

function selectContextMessages(messages, requestContext, options) {
  return selectContextMessageGroups(messages, requestContext, options).selected;
}

function selectContextMessageGroups(messages, requestContext, options) {
  const context = requestContext || classifyRequestContext('');
  const conversation = selectedConversationMessages(messages, options);
  const observations = selectedObservationMessages(messages, context, options);
  const bashFallback = selectedBashFallbackMessages(messages, context, observations);
  const selected = conversation.concat(observations, bashFallback);
  const sorted = selected.sort((left, right) => {
    const leftTurn = Number(left && left.turn) || 0;
    const rightTurn = Number(right && right.turn) || 0;
    if (leftTurn !== rightTurn) return leftTurn - rightTurn;
    const leftTime = Number(left && left.timestamp) || 0;
    const rightTime = Number(right && right.timestamp) || 0;
    return leftTime - rightTime;
  });
  return {
    conversation,
    observations,
    bashFallback,
    selected: sorted,
  };
}

module.exports = {
  classifyRequestContext,
  commandSubjects,
  promptSubjects,
  selectContextMessageGroups,
  selectContextMessages,
};
