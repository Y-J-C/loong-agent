#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { loadConfig } = require('./config');
const { createAgentSession } = require('./agent');
const { loongEnvCheck } = require('./tools');
const { chatCompletion } = require('./llm');
const { runCompat, printHumanReport } = require('./compat');
const { printLogReport, runLogDiagnostics } = require('./log-diagnostics');
const { createSessionManager } = require('./session-manager');
const {
  renderSessionHtml,
  renderSessionMarkdown,
  renderSessionAudit,
  renderSessionReplay,
  renderSessionTrace,
  writeSessionExport,
} = require('./session');

function printUsage() {
  console.log(`Loong Pi Agent

Usage:
  node src/index.js diagnose
  node src/index.js compat
  node src/index.js log <file>
  node src/index.js log --stdin
  node src/index.js sessions
  node src/index.js session <session-id-or-path> [--json|--markdown|--html] [--out file]
  node src/index.js session latest [--json|--markdown|--html] [--out file]
  node src/index.js sessions --tree
  node src/index.js session fork <session-id-or-path> [--name branch] [--at entry-id]
  node src/index.js session lineage <session-id-or-path>
  node src/index.js session resume <session-id-or-path> "follow-up"
  node src/index.js session audit <session-id-or-path> [--json]
  node src/index.js session replay <session-id-or-path> [--trace|--markdown]
  node src/index.js doctor
  node src/index.js ask "your question"
  node src/index.js chat
  node src/index.js tui

Environment:
  LOONG_AGENT_BASE_URL   default: https://api.deepseek.com
  LOONG_AGENT_API_KEY    DeepSeek/OpenAI-compatible API key
  LOONG_AGENT_MODEL      default: deepseek-chat
  LOONG_AGENT_WORKSPACE  default: current directory
`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
}

function printSessionTree(nodes, depth) {
  for (const node of nodes || []) {
    const indent = '  '.repeat(depth || 0);
    const label = node.branchName ? `${node.id} (${node.branchName})` : node.id;
    console.log(`${indent}- ${label} [${node.command || 'session'}]`);
    if (node.forkedFromEntryId) {
      console.log(`${indent}  forkedFromEntryId: ${node.forkedFromEntryId}`);
    }
    printSessionTree(node.children || [], (depth || 0) + 1);
  }
}

function printLineage(chain) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const item = chain[index];
    const indent = '  '.repeat(chain.length - 1 - index);
    const branch = item.branchName ? ` (${item.branchName})` : '';
    console.log(`${indent}${item.id}${branch} [${item.command || 'session'}]`);
  }
}

async function doctor(config) {
  const report = await loongEnvCheck();
  const prompt = [
    'Analyze this LoongArch developer board environment.',
    'Focus on whether it can run a lightweight local agent, build npm projects, compile native code, and connect remote LLM services.',
    'Return concise Chinese advice with concrete next steps.',
    '',
    JSON.stringify(report, null, 2),
  ].join('\n');

  const content = await chatCompletion(config, [
    {
      role: 'system',
      content:
        'You are a LoongArch development assistant. Reply in Chinese. Do not reveal secrets.',
    },
    { role: 'user', content: prompt },
  ]);
  console.log(content);
}

async function chat(config) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'loong-agent> ',
  });

  rl.prompt();
  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    if (text === 'exit' || text === 'quit') {
      rl.close();
      return;
    }
    try {
      const session = createAgentSession(config, { command: 'chat' });
      const result = await session.prompt(text);
      console.log(result.summary || JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
    rl.prompt();
  });
}

async function main() {
  const config = loadConfig();
  const command = process.argv[2];
  const args = process.argv.slice(3);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === 'diagnose') {
    printJson(await loongEnvCheck());
    return;
  }

  if (command === 'compat') {
    const result = await runCompat();
    if (args.includes('--json')) printJson(result);
    else printHumanReport(result.report);
    return;
  }

  if (command === 'log') {
    const useStdin = args.includes('--stdin');
    const noModel = args.includes('--no-model');
    const file = args.find((arg) => arg !== '--json' && arg !== '--stdin' && arg !== '--no-model');
    const report = await runLogDiagnostics(config, { file, stdin: useStdin, noModel });
    if (args.includes('--json')) printJson(report);
    else printLogReport(report);
    return;
  }

  if (command === 'sessions') {
    const manager = createSessionManager(config);
    if (args.includes('--tree')) {
      const tree = manager.tree({ limit: 200 });
      if (args.includes('--json')) printJson(tree);
      else printSessionTree(tree, 0);
      return;
    }
    const sessions = manager.list({ limit: 20 });
    if (args.includes('--json')) printJson(sessions);
    else {
      for (const session of sessions) {
        console.log(`${session.id}\t${session.modifiedAt}\t${session.size} bytes`);
      }
    }
    return;
  }

  if (command === 'session') {
    const manager = createSessionManager(config);
    if (args[0] === 'fork') {
      const target = args[1] || 'latest';
      const forked = manager.fork(target, {
        branchName: valueAfter(args, '--name'),
        entryId: valueAfter(args, '--at'),
      });
      console.log(`Forked session: ${forked.id}`);
      console.log(`Session: ${forked.path}`);
      console.log(`Parent: ${forked.parentSession}`);
      return;
    }
    if (args[0] === 'lineage') {
      const target = args[1] || 'latest';
      const chain = manager.lineage(target);
      if (args.includes('--json')) printJson(chain);
      else printLineage(chain);
      return;
    }
    if (args[0] === 'resume') {
      const target = args[1];
      const prompt = args.slice(2).join(' ').trim();
      if (!target) throw new Error('Missing session id or path after resume');
      if (!prompt) throw new Error('Missing follow-up text after session resume <id>');
      const parent = target === 'latest' ? manager.latest() : manager.read(target);
      const resumeContext = manager.extractResumeContext(parent);
      const child = manager.createChildSession(parent, { command: 'resume' });
      const agentSession = createAgentSession(config, {
        command: 'resume',
        session: child,
        parentSession: parent.path,
      });
      const contextPrompt = [
        'Resume from previous session context.',
        `Previous session: ${resumeContext.sourceSessionId}`,
        `Previous session path: ${resumeContext.sourceSessionPath}`,
        resumeContext.parentSession ? `Previous parent session: ${resumeContext.parentSession}` : '',
        'Previous summary:',
        resumeContext.summary || '(none)',
        'Recent tool events:',
        JSON.stringify(resumeContext.recentToolEvents, null, 2),
        '',
        prompt,
      ].filter(Boolean).join('\n');
      const result = await agentSession.prompt(contextPrompt);
      console.log(result.summary || JSON.stringify(result, null, 2));
      if (result.session && result.session.path) {
        console.log(`Session: ${result.session.path}`);
      }
      return;
    }
    if (args[0] === 'audit') {
      const target = args[1] || 'latest';
      const session = target === 'latest' ? manager.latest() : manager.read(target);
      console.log(renderSessionAudit(session, { format: args.includes('--json') ? 'json' : 'text' }));
      return;
    }
    if (args[0] === 'replay') {
      const target = args[1] || 'latest';
      const session = target === 'latest' ? manager.latest() : manager.read(target);
      console.log(renderSessionReplay(session, { format: args.includes('--markdown') ? 'markdown' : 'trace' }));
      return;
    }
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? args[outIndex + 1] : '';
    const target = args.find((arg, index) => {
      return (
        arg !== '--json' &&
        arg !== '--markdown' &&
        arg !== '--html' &&
        arg !== '--out' &&
        !(outIndex >= 0 && index === outIndex + 1)
      );
    });
    const session = target === 'latest' ? manager.latest() : manager.read(target);
    let format = 'trace';
    let content;
    if (args.includes('--json')) {
      format = 'json';
      content = JSON.stringify(session, null, 2);
    } else if (args.includes('--html')) {
      format = 'html';
      content = renderSessionHtml(session);
    } else if (args.includes('--markdown')) {
      format = 'markdown';
      content = renderSessionMarkdown(session);
    } else {
      content = renderSessionTrace(session);
    }

    if (out) {
      const written = writeSessionExport(config, session, { out, format });
      console.log(`Wrote ${written}`);
    } else {
      console.log(content);
    }
    return;
  }

  if (command === 'doctor') {
    await doctor(config);
    return;
  }

  if (command === 'ask') {
    const prompt = args.join(' ').trim();
    if (!prompt) throw new Error('Missing question after ask');
    const session = createAgentSession(config, { command: 'ask' });
    const result = await session.prompt(prompt);
    console.log(result.summary || JSON.stringify(result, null, 2));
    if (result.session && result.session.path) {
      console.log(`Session: ${result.session.path}`);
    }
    return;
  }

  if (command === 'chat') {
    await chat(config);
    return;
  }

  if (command === 'tui') {
    if (args.includes('--help')) {
      console.log(`Loong-Agent TUI

Usage:
  node src/index.js tui

Keys:
  Enter send, Esc abort/back, Ctrl+C/Ctrl+D exit, Ctrl+O expand tools

Commands:
  /help /hotkeys /health /project /sessions /tree /lineage /fork /resume /export /session /audit /new /name /theme /stats /branch /demo /clone /more /debug /exit
  ! <readonly command>
`);
      return;
    }
    await require('./tui').runTui(config);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
