'use strict';

const path = require('path');
const { READONLY_COMMANDS } = require('../tools.js');

const PATH_TOOLS = {
  list_directory: 'relative_path',
  read_file: 'file_path',
  search_files: 'relative_path',
};

const SENSITIVE_PATH_PATTERN = /(^|[\\/])\.env($|[\\/])|api[_-]?key|token|secret|authorization|credential/i;

const DANGEROUS_COMMAND_PATTERN =
  /\b(apt(-get)?\s+(install|remove|purge|upgrade|full-upgrade|dist-upgrade|autoremove)|npm\s+(install|update|audit\s+fix)|yarn\s+(add|install|upgrade)|pnpm\s+(add|install|update)|rm\s+|mv\s+|cp\s+|chmod\s+|chown\s+|dd\s+|mkfs|mount\s+|umount\s+|reboot|shutdown|systemctl\s+(start|stop|restart|enable|disable)|service\s+\S+\s+(start|stop|restart))\b|(^|[^<])>>?|&&|\|\||;\s*|`|\$\(/i;

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

function inspectReadonlyCommand(action) {
  if (action.tool !== 'run_readonly_command') return null;
  const command = String((action.input && action.input.command) || '').trim();
  if (!command) {
    return block(action, 'readonly_command_missing', 'Missing read-only command.');
  }
  if (DANGEROUS_COMMAND_PATTERN.test(command)) {
    return block(action, 'dangerous_command', `Command is blocked by safety policy: ${command}`);
  }
  if (!READONLY_COMMANDS.has(command)) {
    return block(action, 'readonly_allowlist', `Command is not in read-only allowlist: ${command}`);
  }
  return null;
}

async function toolSafetyPolicyHook(context) {
  const action = context && context.action ? context.action : {};
  const config = context && context.config ? context.config : {};
  const tool = context && context.tool ? context.tool : null;
  if (tool && tool.safety && tool.safety.readOnly === false) {
    return block(action, 'readonly_required', `Tool is not read-only: ${action.tool || 'unknown'}`);
  }
  return inspectPathTool(config, action) || inspectReadonlyCommand(action);
}

module.exports = {
  toolSafetyPolicyHook,
};
