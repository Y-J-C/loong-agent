'use strict';

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return [
    value.id,
    value.kind,
    value.title,
    value.summary,
    value.ref,
    value.excerpt,
    value.likelyCategory,
    value.severity,
    value.status,
    value.suggestedMinimalNextStep,
    value.suggestedNextCheck,
    value.failureReason,
    value.resultSummary,
    value.conclusion,
    value.remainingUncertainty,
    value.remainingUncertainties,
    value.facts ? JSON.stringify(value.facts) : '',
  ].filter(Boolean).join(' ');
}

function stateText(state) {
  const parts = [
    textOf(state),
    ...(state.observations || []).map(textOf),
    ...(state.evidence || []).map(textOf),
    ...(state.blockers || []).map(textOf),
  ];
  return parts.join('\n').toLowerCase();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasEvidence(state) {
  return Array.isArray(state.evidence) && state.evidence.length > 0;
}

function hasObservationSupport(state) {
  return (state.observations || []).some((item) => {
    const signal = Array.isArray(item.signal) ? item.signal[0] : '';
    return signal && signal !== 'unknown';
  });
}

function hasProjectStructure(text) {
  return hasAny(text, [
    /project structure/,
    /package\.json/,
    /readme/,
    /makefile/,
    /pyproject\.toml/,
    /requirements\.txt/,
    /\bsrc\b/,
  ]);
}

function hasProjectType(text) {
  return hasAny(text, [
    /project type/,
    /node\.?js/,
    /python/,
    /\bc\/c\+\+\b/,
    /\bmixed\b/,
  ]);
}

function hasEntrypoint(text) {
  const concrete = hasAny(text, [
    /entrypoint (identified|detected|confirmed|found)/,
    /entrypoint (as|:)\s*\S+/,
    /startup command/,
    /npm start/,
    /无需\s*entrypoint/,
    /no entrypoint required/,
    /entrypoint.*not required/,
  ]);
  if (concrete) return true;
  if (hasAny(text, [/entrypoint.*unclear/, /entrypoint.*unknown/, /entrypoint.*不清楚/, /entrypoint.*无法确认/])) {
    return false;
  }
  return hasAny(text, [
    /入口.*已识别/,
    /启动命令/,
  ]);
}

function hasRuntime(text) {
  return hasAny(text, [
    /board runtime/,
    /runtime/,
    /uname -m/,
    /loongarch/,
    /loongson/,
    /node --version/,
    /python --version/,
    /gcc --version/,
    /\bwhich\b/,
  ]);
}

function hasDependencyRisk(text) {
  return hasAny(text, [
    /dependency risk/,
    /dependencies checked/,
    /missing npm/,
    /missing pip/,
    /missing g\+\+/,
    /native dependency/,
    /hard dependency/,
    /npm.*not.*hard blocker/,
    /无.*依赖/,
  ]);
}

function hasLowRiskValidation(text) {
  return hasAny(text, [
    /low-risk validation/,
    /validation/,
    /node --check/,
    /py_compile/,
    /syntax check/,
    /dry-run/,
    /version check/,
    /file existence check/,
  ]);
}

function hasRemainingUncertainty(state, text) {
  return Boolean(state.remainingUncertainty || state.remainingUncertainties) ||
    hasAny(text, [/remaining uncertainty/, /unclear/, /无法验证/, /待确认/, /不确定/]);
}

function blockingErrorPresent(state) {
  return (state.blockers || []).some((blocker) => blocker.category && blocker.category !== 'unknown');
}

function supportedBlocker(state) {
  const evidenceIds = new Set((state.evidence || []).map((item) => item.id).filter(Boolean));
  return (state.blockers || []).find((blocker) => {
    const hasEvidenceId = (blocker.evidenceIds || []).some((id) => evidenceIds.has(id));
    const hasSupport = hasEvidenceId || hasEvidence(state) || hasObservationSupport(state);
    return hasSupport && Boolean(blocker.suggestedMinimalNextStep);
  });
}

function collectMissingCriteria(state) {
  const text = stateText(state);
  const missing = [];
  if (!hasProjectStructure(text)) missing.push('project_structure');
  if (!hasProjectType(text)) missing.push('project_type');
  if (!hasEntrypoint(text)) missing.push('entrypoint');
  if (!hasRuntime(text)) missing.push('runtime');
  if (!hasDependencyRisk(text)) missing.push('dependency_risk');
  if (!hasLowRiskValidation(text)) missing.push('low_risk_validation');
  if (!hasEvidence(state)) missing.push('evidence');
  return missing;
}

function result(canFinish, finishMode, reason, missingCriteria) {
  return {
    canFinish,
    reason,
    missingCriteria: missingCriteria || [],
    finishMode,
  };
}

function checkProjectRunCheckFinish(taskState) {
  const state = taskState || {};
  const text = stateText(state);
  const blocker = supportedBlocker(state);
  if (blocker) {
    return result(true, 'blocked', `Project run check can finish as blocked: ${blocker.summary || blocker.category || 'blocker'}.`, []);
  }

  const missing = collectMissingCriteria(state);
  const onlyMissingEntrypoint = missing.length === 1 && missing[0] === 'entrypoint';
  if (!missing.length && !blockingErrorPresent(state)) {
    return result(true, 'success', 'Project type, entrypoint, runtime, dependency risk, and low-risk validation evidence are available.', []);
  }
  if (
    hasEvidence(state) &&
    hasRemainingUncertainty(state, text) &&
    hasProjectStructure(text) &&
    hasProjectType(text) &&
    hasRuntime(text) &&
    hasDependencyRisk(text) &&
    hasLowRiskValidation(text) &&
    (onlyMissingEntrypoint || missing.length <= 2)
  ) {
    return result(true, 'partial', 'Read-only checks were completed, but remaining uncertainty prevents a full success conclusion.', missing);
  }

  return result(false, 'failed', 'Project run check is missing required evidence or checks and cannot produce a final run conclusion yet.', missing);
}

function checkFinishCriteria(taskState) {
  const state = taskState || {};
  if (state.taskType === 'project_run_check') return checkProjectRunCheckFinish(state);
  if (state.conclusion) return result(true, 'success', 'Task has a recorded conclusion.', []);
  return result(false, 'partial', 'No project_run_check finish criteria apply and no conclusion is recorded.', []);
}

module.exports = {
  checkFinishCriteria,
};
