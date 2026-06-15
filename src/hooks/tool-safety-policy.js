'use strict';

const path = require('path');

const PATH_TOOLS = {
  kb_search: null,
  kb_topic: null,
  list_directory: 'relative_path',
  risk_lookup: null,
  command_reference: null,
  read_file: 'file_path',
  search_files: 'relative_path',
};

const MUTATING_TOOLS_ALLOWED_BY_RUNTIME = {
  write: true,
  edit: true,
  process_stop: true,
};

const SENSITIVE_PATH_PATTERN = /(^|[\\/])\.env($|[\\/])|api[_-]?key|token|secret|authorization|credential/i;

function block(action, policy, reason) {
  const blocked = {
    error: reason,
    blocked: true,
    policy,
    tool: action && action.tool ? action.tool : 'unknown',
  };
  return {
    blocked: true,
    errorType: 'policy_blocked',
    reason,
    result: Object.assign({}, blocked, {
      ok: false,
      data: blocked,
      summary: reason,
      evidence: [{
        source: 'policy',
        policy,
        tool: blocked.tool,
      }],
      warnings: [reason],
    }),
    resultSummary: `${policy}: ${reason}`,
  };
}

function isInsideWorkspace(config, targetPath) {
  const workspace = path.resolve(config.workspace || process.cwd());
  const resolved = path.resolve(workspace, targetPath || '.');
  return resolved === workspace || resolved.startsWith(workspace + path.sep);
}

function inspectPathTool(config, action) {
  const field = PATH_TOOLS[action.tool];
  if (!field) return null;
  const value = String((action.input && action.input[field]) || '.');
  if (!isInsideWorkspace(config, value)) {
    return block(action, 'workspace_boundary', `Path escapes workspace: ${value}`);
  }
  if (SENSITIVE_PATH_PATTERN.test(value)) {
    return block(action, 'sensitive_path', `Sensitive path is blocked: ${value}`);
  }
  return null;
}

async function toolSafetyPolicyHook(context) {
  const action = context && context.action ? context.action : {};
  const config = context && context.config ? context.config : {};
  const tool = context && context.tool ? context.tool : null;
  if (
    tool &&
    tool.safety &&
    tool.safety.readOnly === false &&
    !MUTATING_TOOLS_ALLOWED_BY_RUNTIME[action.tool || '']
  ) {
    return block(action, 'readonly_required', `Tool is not read-only: ${action.tool || 'unknown'}`);
  }
  return inspectPathTool(config, action);
}

module.exports = {
  toolSafetyPolicyHook,
};
