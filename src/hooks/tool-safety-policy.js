'use strict';

const path = require('path');
const { classifyToolApproval } = require('../tool-approval-policy');

const PATH_TOOLS = {
  kb_search: null,
  kb_topic: null,
  list_directory: 'relative_path',
  risk_lookup: null,
  command_reference: null,
  read_file: 'file_path',
  search_files: 'relative_path',
};

const SENSITIVE_PATH_PATTERN = /(^|[\\/])\.env($|[\\/])|api[_-]?key|token|secret|authorization|credential/i;

function block(action, policy, reason, approval) {
  const blocked = {
    error: reason,
    blocked: true,
    policy,
    tool: action && action.tool ? action.tool : 'unknown',
    approval: approval || undefined,
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

  const pathDecision = inspectPathTool(config, action);
  if (pathDecision) return pathDecision;

  const decision = classifyToolApproval(config, action, tool);
  if (!decision || decision.status === 'allow') return null;
  if (decision.status === 'deny') {
    return block(action, decision.policy || 'tool_policy_denied', decision.reason || 'Tool call denied.', decision.approval);
  }
  if (decision.status === 'ask') {
    const approval = decision.approval || {};
    if (typeof context.requestToolApproval !== 'function') {
      return block(action, 'tool_approval_required', decision.reason || 'Tool call requires approval.', approval);
    }
    if (typeof context.emit === 'function') {
      await context.emit({
        type: 'tool_approval_requested',
        loop: context.loop,
        turn: context.turn,
        toolCallId: context.toolCallId || '',
        toolName: action.tool || 'unknown',
        approval,
        timestamp: new Date().toISOString(),
      });
    }
    let approved = false;
    try {
      const approvalResult = await context.requestToolApproval(approval);
      approved = Boolean(approvalResult && approvalResult.approved);
    } catch (error) {
      approved = false;
    }
    if (typeof context.emit === 'function') {
      await context.emit({
        type: 'tool_approval_decided',
        loop: context.loop,
        turn: context.turn,
        toolCallId: context.toolCallId || '',
        toolName: action.tool || 'unknown',
        approval,
        approved,
        timestamp: new Date().toISOString(),
      });
    }
    if (approved) return null;
    return block(action, 'tool_approval_denied', decision.reason || 'Tool call was denied by user.', approval);
  }
  return null;
}

module.exports = {
  toolSafetyPolicyHook,
};
