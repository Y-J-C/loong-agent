'use strict';

const PROJECT_RUN_CHECK_PATTERNS = [
  /能不能运行/,
  /能不能跑/,
  /检查项目/,
  /运行条件/,
  /部署到龙芯派/,
  /板端验证/,
  /判断当前项目是否可运行/,
  /判断当前项目能不能/,
  /can this project run/i,
  /check project runtime/i,
  /run on\s+(?:loongarch|loongson board)/i,
];

function classifyTaskType(input, fallback) {
  const text = String(input || '');
  if (PROJECT_RUN_CHECK_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'project_run_check';
  }
  return fallback || 'general';
}

module.exports = {
  classifyTaskType,
  PROJECT_RUN_CHECK_PATTERNS,
};
