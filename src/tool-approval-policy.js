'use strict';

const path = require('path');
const { evaluateCommand } = require('./command-policy');

const SENSITIVE_PATH_PATTERN =
  /(^|[\\/])\.env($|[\\/])|api[_-]?key|token|secret|authorization|credential|(^|[\\/])id_rsa$|(^|[\\/])id_ed25519$|\.pem$|\.key$/i;

const READONLY_TOOLS = {
  board_profile: true,
  command_reference: true,
  find: true,
  grep: true,
  kb_search: true,
  kb_topic: true,
  list_directory: true,
  loong_env_check: true,
  loong_storage_check: true,
  ls: true,
  process_logs: true,
  process_status: true,
  process_wait: true,
  project_map: true,
  read: true,
  read_file: true,
  risk_lookup: true,
  runtime_health: true,
  search_files: true,
  session_summary: true,
};

const ASK_TOOLS = {
  csv_html_report: true,
  edit: true,
  process_stop: true,
  write: true,
};

const PATH_FIELDS = {
  csv_html_report: 'outputPath',
  edit: 'path',
  find: 'path',
  grep: 'path',
  list_directory: 'relative_path',
  ls: 'path',
  process_logs: 'logFile',
  process_status: 'pidFile',
  read: 'path',
  read_file: 'file_path',
  search_files: 'relative_path',
  write: 'path',
};

function normalizeToolName(action) {
  return String(action && action.tool ? action.tool : '').trim();
}

function getPathValue(action) {
  const toolName = normalizeToolName(action);
  const field = PATH_FIELDS[toolName];
  if (!field) return '';
  const input = action && action.input && typeof action.input === 'object' ? action.input : {};
  return input[field] === undefined || input[field] === null ? '' : String(input[field]);
}

function workspacePathInfo(config, value) {
  if (!value) return { insideWorkspace: true, resolvedPath: '' };
  const workspace = path.resolve((config && config.workspace) || process.cwd());
  const resolvedPath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspace, value);
  return {
    insideWorkspace: resolvedPath === workspace || resolvedPath.startsWith(workspace + path.sep),
    resolvedPath,
    workspace,
  };
}

function operationSummary(action) {
  const toolName = normalizeToolName(action);
  const input = action && action.input && typeof action.input === 'object' ? action.input : {};
  if (toolName === 'bash') return `command=${String(input.command || '')}`;
  const pathValue = getPathValue(action);
  if (pathValue) return `path=${pathValue}`;
  if (toolName === 'process_stop') {
    return input.pidFile ? `pidFile=${input.pidFile}` : `pid=${input.pid || ''}`;
  }
  return JSON.stringify(input || {});
}

function decision(status, fields) {
  return Object.assign({
    status,
    riskLevel: 'readonly',
    reason: '',
    warnings: [],
  }, fields || {});
}

function deny(action, policy, reason, riskLevel, extra) {
  return decision('deny', Object.assign({
    policy,
    reason,
    riskLevel: riskLevel || 'sensitive_path',
    approval: createApprovalRequest(action, {
      policy,
      reason,
      riskLevel: riskLevel || 'sensitive_path',
    }),
  }, extra || {}));
}

function ask(action, policy, reason, riskLevel, extra) {
  return decision('ask', Object.assign({
    policy,
    reason,
    riskLevel,
    approval: createApprovalRequest(action, {
      policy,
      reason,
      riskLevel,
      warnings: extra && extra.warnings,
    }),
  }, extra || {}));
}

function allow(action, policy, reason, riskLevel, extra) {
  return decision('allow', Object.assign({
    policy,
    reason,
    riskLevel: riskLevel || 'readonly',
    approval: createApprovalRequest(action, {
      policy,
      reason,
      riskLevel: riskLevel || 'readonly',
      warnings: extra && extra.warnings,
    }),
  }, extra || {}));
}

function createApprovalRequest(action, fields) {
  return {
    tool: normalizeToolName(action) || 'unknown',
    input: action && action.input && typeof action.input === 'object' ? action.input : {},
    operation: operationSummary(action),
    riskLevel: (fields && fields.riskLevel) || 'readonly',
    policy: (fields && fields.policy) || '',
    reason: (fields && fields.reason) || '',
    warnings: fields && Array.isArray(fields.warnings) ? fields.warnings.slice() : [],
  };
}

function classifyToolApproval(config, action, tool) {
  const toolName = normalizeToolName(action);
  const pathValue = getPathValue(action);
  const pathInfo = workspacePathInfo(config, pathValue);

  if (pathValue && SENSITIVE_PATH_PATTERN.test(pathValue)) {
    return deny(action, 'sensitive_path', `Sensitive path is blocked: ${pathValue}`, 'sensitive_path');
  }

  if (toolName === 'bash') {
    const input = action && action.input && typeof action.input === 'object' ? action.input : {};
    const command = String(input.command || '').trim();
    const commandDecision = evaluateCommand(command);
    if (commandDecision.allowed) {
      return allow(action, commandDecision.policy || 'command_allowlist', commandDecision.reason, 'shell_readonly', {
        commandPolicy: commandDecision,
        warnings: commandDecision.warnings,
      });
    }
    return ask(action, commandDecision.policy || 'shell_general', commandDecision.reason || `Shell command requires approval: ${command}`, 'shell_general', {
      commandPolicy: commandDecision,
      warnings: commandDecision.warnings,
    });
  }

  if (ASK_TOOLS[toolName]) {
    if (pathValue && !pathInfo.insideWorkspace) {
      return ask(action, 'external_path', `Tool may modify a path outside the workspace: ${pathValue}`, 'external_path');
    }
    if (toolName === 'process_stop') {
      return ask(action, 'process_control', 'Stopping a process requires approval.', 'process_control');
    }
    return ask(action, 'workspace_write', `Tool may modify workspace files: ${toolName}`, 'workspace_write');
  }

  if (READONLY_TOOLS[toolName]) {
    return allow(action, 'readonly_tool', `Read-only tool allowed: ${toolName}`, 'readonly');
  }

  if (tool && tool.safety && tool.safety.readOnly === true) {
    return allow(action, 'readonly_tool', `Read-only tool allowed: ${toolName || 'unknown'}`, 'readonly');
  }

  if (tool && tool.safety && tool.safety.readOnly === false) {
    return ask(action, 'tool_requires_approval', `Tool is not read-only: ${toolName || 'unknown'}`, 'workspace_write');
  }

  return allow(action, 'unknown_tool_default_allow', `Tool has no mutating safety marker: ${toolName || 'unknown'}`, 'readonly');
}

module.exports = {
  SENSITIVE_PATH_PATTERN,
  classifyToolApproval,
  createApprovalRequest,
};
