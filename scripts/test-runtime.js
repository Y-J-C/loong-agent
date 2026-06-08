#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAgent } = require('../src/agent-runtime');
const { runAgent } = require('../src/agent');
const { createAgentSession } = require('../src/agent-session');
const { createDefaultPrepareNextTurn, createHookRunner, toolErrorRecoveryHook } = require('../src/hooks');
const { registerProvider } = require('../src/llm');
const { createSessionManager } = require('../src/session-manager');
const { renderSessionTrace } = require('../src/session');
const { READONLY_COMMAND_METADATA, READONLY_COMMANDS } = require('../src/tools');
const {
  createDefaultToolRegistry,
  createDefaultTools,
  createTool,
  createToolRegistry,
  formatToolsForPrompt,
} = require('../src/tool-registry');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-runtime-'));
}

function config(provider, workspace) {
  return {
    provider,
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    workspace: workspace || tempWorkspace(),
  };
}

test('finish event order includes turn_end', async () => {
  registerProvider({
    name: 'test-finish',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'ok' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-finish'), { session: null });
  agent.subscribe((event) => events.push(event.type));
  const result = await agent.prompt('finish');

  assert(result.summary === 'ok', 'finish summary mismatch');
  assert(
    events.join(' -> ') ===
      'agent_start -> turn_start -> message_start -> message_end -> message_start -> message_update -> message_end -> tool_execution_start -> tool_execution_end -> turn_end -> agent_end',
    `unexpected event order: ${events.join(' -> ')}`
  );
});

test('unknown tool records an error event and continues', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-unknown-tool',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'missing_tool',
          input: {},
          reason: 'bad',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const agent = createAgent(config('test-unknown-tool'), { session: null });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('unknown');

  const toolEnd = events.find((event) => event.type === 'tool_execution_end');
  assert(result.summary === 'recovered', 'agent did not recover after unknown tool');
  assert(toolEnd && toolEnd.isError === true, 'missing tool_execution_end error event');
});

test('invalid model JSON fails clearly', async () => {
  registerProvider({
    name: 'test-invalid-json',
    chatCompletion: async () => 'not json',
  });

  const agent = createAgent(config('test-invalid-json'), { session: null });
  let errorMessage = '';
  try {
    await agent.prompt('invalid');
  } catch (error) {
    errorMessage = error.message;
  }
  assert(/Model did not return JSON/.test(errorMessage), `unexpected error: ${errorMessage}`);
});

test('model failure is recorded as assistant error lifecycle', async () => {
  registerProvider({
    name: 'test-model-failure',
    chatCompletion: async () => {
      throw new Error('provider offline');
    },
  });

  const events = [];
  const agent = createAgent(config('test-model-failure'), { session: null });
  agent.subscribe((event) => events.push(event));

  let errorMessage = '';
  try {
    await agent.prompt('fail');
  } catch (error) {
    errorMessage = error.message;
  }

  const agentEnds = events.filter((event) => event.type === 'agent_end');
  const assistantError = events.find((event) => event.type === 'message_end' && event.role === 'assistant' && event.isError);
  const turnEnd = events.find((event) => event.type === 'turn_end');

  assert(errorMessage === 'provider offline', `unexpected model failure: ${errorMessage}`);
  assert(agentEnds.length === 1, `expected one agent_end, got ${agentEnds.length}`);
  assert(agentEnds[0].error === 'provider offline', 'agent_end missing model error');
  assert(agentEnds[0].status === 'error', 'agent_end missing error status');
  assert(assistantError && /provider offline/.test(assistantError.content), 'missing assistant error message');
  assert(turnEnd && turnEnd.isError === true && turnEnd.status === 'error', 'missing failed turn_end');
});

test('abort after model response records failed turn and agent end', async () => {
  registerProvider({
    name: 'test-abort-lifecycle',
    chatCompletion: async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(JSON.stringify({
            tool: 'finish',
            input: { summary: 'should not finish' },
            reason: 'done',
          }));
        }, 50);
      }),
  });

  const events = [];
  const agent = createAgent(config('test-abort-lifecycle'), { session: null });
  agent.subscribe((event) => events.push(event));
  const run = agent.prompt('abort');
  setTimeout(() => agent.abort(), 10);

  let errorMessage = '';
  try {
    await run;
  } catch (error) {
    errorMessage = error.message;
  }

  const turnEnd = events.find((event) => event.type === 'turn_end');
  const agentEnd = events.find((event) => event.type === 'agent_end');
  assert(errorMessage === 'Agent run aborted', `unexpected abort error: ${errorMessage}`);
  assert(turnEnd && turnEnd.reason === 'aborted', 'abort did not record turn_end reason');
  assert(agentEnd && agentEnd.errorCode === 'aborted', 'abort did not record agent_end errorCode');
});

test('tool events include stable metadata and turn status', async () => {
  registerProvider({
    name: 'test-tool-metadata',
    chatCompletion: async () => JSON.stringify({
      tool: 'missing_tool',
      input: {},
      reason: 'metadata',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-tool-metadata'), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('metadata');

  const start = events.find((event) => event.type === 'tool_execution_start');
  const end = events.find((event) => event.type === 'tool_execution_end');
  const turnEnd = events.find((event) => event.type === 'turn_end');

  assert(start && start.toolCallId, 'tool start missing toolCallId');
  assert(end && end.toolCallId === start.toolCallId, 'tool end did not preserve toolCallId');
  assert(typeof end.durationMs === 'number', 'tool end missing durationMs');
  assert(end.status === 'error', 'tool end missing error status');
  assert(turnEnd && turnEnd.status === 'tool_error', 'turn_end missing tool_error status');
  assert(turnEnd && turnEnd.toolName === 'missing_tool', 'turn_end missing tool name');
});

test('beforeToolCall can block a tool call without crashing the loop', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-before-tool-call',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'blocked inspection',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'blocked then recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const agent = createAgent(config('test-before-tool-call'), {
    session: null,
    beforeToolCall: async ({ action }) => {
      if (action.tool !== 'list_directory') return null;
      return {
        blocked: true,
        errorType: 'policy_blocked',
        reason: 'readonly policy blocked this call for test',
      };
    },
  });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('block');
  const blockedEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'blocked then recovered', 'agent did not recover after beforeToolCall block');
  assert(blockedEnd && blockedEnd.isError === true, 'blocked tool was not recorded as error');
  assert(blockedEnd && blockedEnd.errorType === 'policy_blocked', 'blocked tool missing policy error type');
  assert(/readonly policy/.test(blockedEnd.resultSummary), 'blocked tool missing block reason');
});

test('afterToolCall can normalize a tool result before finish', async () => {
  registerProvider({
    name: 'test-after-tool-call',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'raw summary' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-after-tool-call'), {
    session: null,
    afterToolCall: async ({ action, result }) => {
      if (action.tool !== 'finish') return null;
      return {
        result: Object.assign({}, result, { summary: 'normalized summary' }),
        resultSummary: 'finish summary normalized',
      };
    },
  });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('normalize');
  const finishEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');

  assert(result.summary === 'normalized summary', `unexpected normalized summary: ${result.summary}`);
  assert(finishEnd && finishEnd.result.summary === 'normalized summary', 'tool event missing normalized result');
  assert(finishEnd && finishEnd.resultSummary === 'finish summary normalized', 'tool event missing normalized summary');
});

test('tool registry wraps legacy tool results in envelope', async () => {
  const registry = createToolRegistry([
    createTool({
      name: 'legacy_tool',
      description: 'Legacy result.',
      execute: async () => ({ value: 7, summary: 'legacy summary' }),
    }),
  ]);
  const result = await registry.execute(config('test-registry-wrap'), 'legacy_tool', {});
  assert(result.ok === true, 'legacy result missing ok=true');
  assert(result.data && result.data.value === 7, 'legacy result missing data payload');
  assert(result.summary === 'legacy summary', 'legacy result summary mismatch');
  assert(result.value === 7, 'legacy top-level field was not preserved');
  assert(Array.isArray(result.evidence), 'legacy result missing evidence array');
});

test('tool registry preserves envelope result fields', async () => {
  const registry = createToolRegistry([
    createTool({
      name: 'envelope_tool',
      description: 'Envelope result.',
      execute: async () => ({
        ok: true,
        data: { value: 9 },
        summary: 'enveloped',
        evidence: [{ source: 'runtime' }],
        warnings: ['careful'],
        error: '',
        custom: 'kept',
      }),
    }),
  ]);
  const result = await registry.execute(config('test-registry-envelope'), 'envelope_tool', {});
  assert(result.ok === true, 'envelope result changed ok');
  assert(result.data.value === 9, 'envelope result lost data');
  assert(result.summary === 'enveloped', 'envelope result lost summary');
  assert(result.evidence.length === 1, 'envelope result lost evidence');
  assert(result.warnings.length === 1, 'envelope result lost warnings');
  assert(result.custom === 'kept', 'envelope result lost custom field');
});

test('default tools expose metadata contract', async () => {
  const registry = createDefaultToolRegistry();
  const tools = registry.list();
  assert(tools.length > 0, 'default tool list is empty');
  const names = {};
  tools.forEach((tool) => {
    assert(!names[tool.name], `duplicate tool name: ${tool.name}`);
    names[tool.name] = true;
    assert(tool.category, `missing category for ${tool.name}`);
    assert(tool.safety && typeof tool.safety.readOnly === 'boolean', `missing safety profile for ${tool.name}`);
    assert(tool.evidencePolicy && typeof tool.evidencePolicy.emitsEvidence === 'boolean', `missing evidence policy for ${tool.name}`);
  });
  assert(names.finish && names.board_profile && names.run_readonly_command, 'missing expected default tools');
});

test('readonly command allowlist is derived from metadata', async () => {
  assert(READONLY_COMMAND_METADATA.length > 0, 'missing readonly command metadata');
  READONLY_COMMAND_METADATA.forEach((item) => {
    assert(item.command && item.category && item.risk && item.description, 'readonly command metadata incomplete');
    assert(READONLY_COMMANDS.has(item.command), `metadata command not in allowlist: ${item.command}`);
  });
  assert(READONLY_COMMANDS.size === READONLY_COMMAND_METADATA.length, 'readonly command allowlist drifted from metadata');
});

test('finish and board_profile keep compatibility fields under envelope', async () => {
  const workspace = tempWorkspace();
  const cfg = config('test-tool-compat', workspace);
  cfg.projectRoot = process.cwd();
  const registry = createDefaultToolRegistry();
  const finish = await registry.execute(cfg, 'finish', { summary: 'done' });
  const board = await registry.execute(cfg, 'board_profile', {});

  assert(finish.ok === true && finish.finished === true, 'finish compatibility fields missing');
  assert(finish.summary === 'done', 'finish summary mismatch');
  assert(board.ok === true && board.profile, 'board_profile compatibility profile missing');
  assert(board.data && board.data.profile, 'board_profile envelope data missing profile');
});

test('agent session default safety blocks dangerous readonly command', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-dangerous-command',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'run_readonly_command',
          input: { command: 'apt full-upgrade' },
          reason: 'dangerous',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'blocked safely' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-dangerous-command'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('block apt');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'run_readonly_command');
  const turnEnd = events.find((event) => event.type === 'turn_end' && event.status === 'policy_blocked');

  assert(result.summary === 'blocked safely', 'agent did not continue after safety block');
  assert(toolEnd && toolEnd.errorType === 'policy_blocked', 'dangerous command was not policy blocked');
  assert(toolEnd.result && toolEnd.result.blocked === true, 'blocked result missing blocked flag');
  assert(toolEnd.result.ok === false, 'blocked result missing envelope ok=false');
  assert(toolEnd.result.data && toolEnd.result.data.blocked === true, 'blocked result missing envelope data');
  assert(Array.isArray(toolEnd.result.evidence), 'blocked result missing envelope evidence');
  assert(toolEnd.result.policy === 'dangerous_command', `unexpected policy: ${toolEnd.result.policy}`);
  assert(turnEnd, 'turn_end did not expose policy_blocked status');
});

test('agent session default safety blocks non-allowlisted readonly command', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-allowlist',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'run_readonly_command',
          input: { command: 'whoami' },
          reason: 'not listed',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'allowlist enforced' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-allowlist'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('block whoami');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'run_readonly_command');

  assert(result.summary === 'allowlist enforced', 'agent did not continue after allowlist block');
  assert(toolEnd && toolEnd.result.policy === 'readonly_allowlist', 'non-allowlisted command was not blocked by allowlist policy');
});

test('agent session default safety blocks sensitive file reads', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-env',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'read_file',
          input: { file_path: '.env' },
          reason: 'read env',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'env blocked' },
        reason: 'done',
      });
    },
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, '.env'), 'LOONG_AGENT_API_KEY=secret', 'utf8');
  const events = [];
  const session = createAgentSession(config('test-default-safety-env', workspace), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('read env');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'read_file');

  assert(result.summary === 'env blocked', 'agent did not continue after .env block');
  assert(toolEnd && toolEnd.result.policy === 'sensitive_path', 'sensitive file was not blocked');
  assert(JSON.stringify(toolEnd.result).indexOf('secret') < 0, 'blocked result leaked secret');
});

test('agent session default safety blocks workspace escape paths', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-workspace',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '..' },
          reason: 'escape',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'escape blocked' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-workspace'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('escape');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'escape blocked', 'agent did not continue after workspace block');
  assert(toolEnd && toolEnd.result.policy === 'workspace_boundary', 'workspace escape was not blocked');
});

test('agent session default after hook redacts sensitive tool result fields', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-redaction',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'secret_tool',
          input: {},
          reason: 'secret',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'redacted' },
        reason: 'done',
      });
    },
  });

  const registry = createToolRegistry([
    createTool({
      name: 'secret_tool',
      description: 'Return a secret for redaction tests.',
      execute: async () => ({
        apiKey: 'plain-secret',
        nested: {
          text: 'token=abc123',
        },
      }),
    }),
    createTool({
      name: 'finish',
      description: 'Finish.',
      execute: async (config, input) => ({ finished: true, summary: String(input.summary || '') }),
    }),
  ]);
  const events = [];
  const session = createAgentSession(config('test-default-redaction'), { registry, session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('redact');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'secret_tool');

  assert(result.summary === 'redacted', 'agent did not finish after redaction');
  assert(toolEnd && toolEnd.result.apiKey === '[redacted]', 'sensitive key was not redacted');
  assert(/token=\s*\[redacted\]/.test(toolEnd.result.nested.text), 'sensitive text was not redacted');
});

test('agent session user beforeToolCall errors are recorded as tool errors', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-before-hook-error',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'hook error',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'hook error recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-before-hook-error'), {
    session: null,
    beforeToolCall: async ({ action }) => {
      if (action.tool === 'list_directory') throw new Error('custom safety failed');
      return null;
    },
  });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('hook error');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'hook error recovered', 'agent did not recover after before hook error');
  assert(toolEnd && toolEnd.errorType === 'before_tool_call_error', 'before hook error was not recorded as tool error');
});

test('max loop completion records max_loops status', async () => {
  registerProvider({
    name: 'test-max-loop-status',
    chatCompletion: async () => JSON.stringify({
      tool: 'list_directory',
      input: { relative_path: '.' },
      reason: 'keep inspecting',
    }),
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const events = [];
  const cfg = config('test-max-loop-status', workspace);
  cfg.maxLoops = 1;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('max');
  const agentEnd = events.find((event) => event.type === 'agent_end');

  assert(/Reached max loop limit/.test(result.summary), 'max loop summary missing');
  assert(agentEnd && agentEnd.status === 'max_loops', 'agent_end missing max_loops status');
  assert(agentEnd && agentEnd.turns === 1, 'agent_end missing turn count');
});

test('agent rejects concurrent prompt calls', async () => {
  registerProvider({
    name: 'test-slow',
    chatCompletion: async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(JSON.stringify({
            tool: 'finish',
            input: { summary: 'slow ok' },
            reason: 'done',
          }));
        }, 80);
      }),
  });

  const agent = createAgent(config('test-slow'), { session: null });
  const first = agent.prompt('first');
  let errorMessage = '';
  try {
    await agent.prompt('second');
  } catch (error) {
    errorMessage = error.message;
  }
  await first;
  assert(errorMessage === 'Agent is already running', `unexpected concurrency error: ${errorMessage}`);
});

test('session trace renders turn_end and session latest works', async () => {
  registerProvider({
    name: 'test-session',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'session ok' },
      reason: 'done',
    }),
  });

  const workspace = tempWorkspace();
  const result = await runAgent(config('test-session', workspace), 'session test');
  const manager = createSessionManager(config('test-session', workspace));
  const latest = manager.latest();
  const trace = renderSessionTrace(latest);

  assert(result.session && result.session.id === latest.id, 'latest session did not match created run');
  assert(trace.indexOf('turn_end #1') >= 0, `trace missing turn_end: ${trace}`);
  assert(trace.indexOf('message_update: assistant') >= 0, `trace missing message_update: ${trace}`);
});

test('steer is consumed on the next turn after a tool result', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-steer',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'inspect',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'steered' },
        reason: 'done',
      });
    },
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const agent = createAgent(config('test-steer', workspace), { session: null });
  const run = agent.prompt('start');
  agent.steer('use the inspected files');
  const result = await run;
  assert(result.summary === 'steered', 'steer run did not finish');
  assert(agent.getState().messages.some((message) => message.role === 'user' && message.content === 'use the inspected files'), 'steer message was not consumed');
});

test('followUp is consumed after finish', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-follow-up',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'finish',
          input: { summary: 'first' },
          reason: 'done',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'second' },
        reason: 'done',
      });
    },
  });

  const agent = createAgent(config('test-follow-up'), { session: null });
  const run = agent.prompt('start');
  agent.followUp('continue once');
  const result = await run;
  assert(result.summary === 'second', `unexpected followUp summary: ${result.summary}`);
});

test('continue runs from existing state', async () => {
  registerProvider({
    name: 'test-continue',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'continued' },
      reason: 'done',
    }),
  });
  const agent = createAgent(config('test-continue'), { session: null });
  const result = await agent.continue();
  assert(result.summary === 'continued', 'continue did not run');
});

test('agent session persists parentSession on resume child session', async () => {
  registerProvider({
    name: 'test-agent-session',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'ok' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-agent-session', workspace);
  const first = await runAgent(baseConfig, 'first');
  const manager = createSessionManager(baseConfig);
  const parent = manager.read(first.session.id);
  const childSession = manager.createChildSession(parent, { command: 'resume' });
  const session = createAgentSession(baseConfig, {
    command: 'resume',
    session: childSession,
    parentSession: parent.path,
  });
  const second = await session.prompt('second');
  const child = manager.read(second.session.id);
  const header = child.events.find((event) => event.type === 'session');
  assert(header && header.parentSession === parent.path, 'child session missing parentSession');
});

test('hook runner executes hooks in order', async () => {
  const order = [];
  const runner = createHookRunner([
    async () => order.push('a'),
    async () => order.push('b'),
  ]);
  await runner.prepareNextTurn({ state: { observations: [], turn: 1 } });
  assert(order.join(',') === 'a,b', `unexpected hook order: ${order.join(',')}`);
});

test('hook runner returns structured warning when a hook throws', async () => {
  const state = { observations: [], turn: 1 };
  const runner = createHookRunner([
    async () => {
      throw new Error('hook failed');
    },
  ]);
  const result = await runner.prepareNextTurn({ state });
  assert(state.observations.length === 0, 'hook warning should not mutate observations');
  assert(result.warnings.length === 1, 'missing hook warning');
  assert(/hook failed/.test(result.warnings[0]), 'warning did not include hook error');
});

test('tool error recovery hook returns structured runtime context', async () => {
  const state = { observations: [], turn: 1 };
  const result = toolErrorRecoveryHook({
    state,
    isError: true,
    action: { tool: 'read_file' },
    result: { error: 'outside workspace' },
  });
  assert(state.observations.length === 0, 'tool error recovery should not mutate observations');
  assert(result.contextAdditions.length === 1, 'missing tool error recovery context');
  assert(result.contextAdditions[0].source === 'runtime_context', 'unexpected recovery context source');
  assert(/outside workspace/.test(result.contextAdditions[0].content), 'missing tool error text');
});

test('loong_env_check injects controlled knowledge context on next turn', async () => {
  let calls = 0;
  let secondPrompt = '';
  const events = [];
  registerProvider({
    name: 'test-loong-env-context',
    chatCompletion: async (cfg, messages) => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'loong_env_check',
          input: {},
          reason: 'inspect environment',
        });
      }
      secondPrompt = messages[1] && messages[1].content ? messages[1].content : '';
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'context injected' },
        reason: 'done',
      });
    },
  });
  const agent = createAgent(Object.assign(config('test-loong-env-context', path.resolve(__dirname, '..')), {
    contextBudgetChars: 1800,
    streaming: false,
  }), {
    prepareNextTurn: createDefaultPrepareNextTurn(),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('检查当前环境兼容性和风险');
  const update = events.find((event) => event.type === 'context_update');
  assert(result.summary === 'context injected', 'agent did not finish after context injection');
  assert(update, 'missing context_update event');
  assert(update.knowledgeEvidence.some((item) => item.topic === 'compatibility_matrix' || item.topic === 'risk_list'), 'missing expected knowledge evidence');
  assert(secondPrompt.indexOf('Controlled context / knowledge additions') >= 0, 'second prompt missing controlled context section');
  assert(/compatibility_matrix|risk_list/.test(secondPrompt), 'second prompt missing expected knowledge topic');
  assert(/uncertain|待确认/.test(secondPrompt), 'second prompt missing uncertainty warning');
});

test('session manager fork creates child session with parentSession and fork_start', async () => {
  registerProvider({
    name: 'test-fork',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'fork source summary' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-fork', workspace);
  const first = await runAgent(baseConfig, 'fork source');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(first.session.id);
  const forkSession = manager.read(forked.id);
  const header = forkSession.events.find((event) => event.type === 'session');
  const start = forkSession.events.find((event) => event.type === 'fork_start');

  assert(header && header.command === 'fork', 'fork session header command mismatch');
  assert(header && header.parentSession === first.session.path, 'fork header missing parentSession');
  assert(start && start.sourceSessionId === first.session.id, 'fork_start missing source session id');
  assert(start && start.summary === 'fork source summary', 'fork_start missing source summary');
});

test('extractResumeContext includes summary and recent tool events', async () => {
  registerProvider({
    name: 'test-resume-context',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'resume source summary' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-resume-context', workspace);
  const first = await runAgent(baseConfig, 'resume source');
  const manager = createSessionManager(baseConfig);
  const parent = manager.read(first.session.id);
  const context = manager.extractResumeContext(parent);

  assert(context.sourceSessionId === first.session.id, 'resume context source id mismatch');
  assert(context.summary === 'resume source summary', 'resume context missing summary');
  assert(context.recentToolEvents.length > 0, 'resume context missing tool events');
  assert(context.recentToolEvents[0].toolName === 'finish', 'resume context wrong tool event');
});

test('fork session can be used as resume parent', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-fork-resume',
    chatCompletion: async () => {
      calls += 1;
      return JSON.stringify({
        tool: 'finish',
        input: { summary: calls === 1 ? 'base summary' : 'resumed from fork' },
        reason: 'done',
      });
    },
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-fork-resume', workspace);
  const first = await runAgent(baseConfig, 'base');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(first.session.id);
  const forkParent = manager.read(forked.id);
  const childSession = manager.createChildSession(forkParent, { command: 'resume' });
  const session = createAgentSession(baseConfig, {
    command: 'resume',
    session: childSession,
    parentSession: forkParent.path,
  });
  const context = manager.extractResumeContext(forkParent);
  const result = await session.prompt(`Resume from previous session context.\nPrevious session: ${context.sourceSessionId}\n\ncontinue`);
  assert(result.summary === 'resumed from fork', `unexpected fork resume summary: ${result.summary}`);
  const child = manager.read(result.session.id);
  const header = child.events.find((event) => event.type === 'session');
  assert(header && header.parentSession === forkParent.path, 'resume from fork missing parentSession');
});

test('tool prompt includes prompt metadata', async () => {
  const prompt = formatToolsForPrompt(createDefaultTools());
  assert(prompt.indexOf('Use board_profile') >= 0, 'missing promptSnippet in tool prompt');
  assert(prompt.indexOf('Guidance:') >= 0, 'missing promptGuidelines in tool prompt');
  assert(prompt.indexOf('runtime_health') >= 0, 'missing runtime_health tool');
  assert(prompt.indexOf('session_summary') >= 0, 'missing session_summary tool');
});

async function main() {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}`);
      console.error(`  ${error.message}`);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
