'use strict';

const fs = require('fs');
const path = require('path');
const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');
const { createFact, mergeFacts } = require('../environment-facts');

const PROJECT_FILES = ['package.json', 'README.md', 'README', 'Makefile', 'pyproject.toml', 'requirements.txt', 'CMakeLists.txt'];

function inspectProject(workspace) {
  const root = path.resolve(workspace || process.cwd());
  let workspaceStatus = 'measured';
  let workspaceError = '';
  try {
    if (!fs.existsSync(root)) workspaceStatus = 'absent';
    else fs.accessSync(root, fs.constants.R_OK);
  } catch (error) {
    const code = error && error.code;
    workspaceStatus = code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : code === 'ENOENT' ? 'absent' : 'check_failed';
    workspaceError = code || error && error.message || 'workspace access check failed';
  }
  const files = PROJECT_FILES.map((name) => ({
    name,
    exists: workspaceStatus === 'measured' && fs.existsSync(path.join(root, name)),
    status: workspaceStatus === 'measured' ? '' : workspaceStatus,
  }));
  let entrypoint = '';
  const packagePath = path.join(root, 'package.json');
  if (workspaceStatus === 'measured' && fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (pkg.scripts && pkg.scripts.start) entrypoint = `npm start (${pkg.scripts.start})`;
      else if (pkg.main) entrypoint = `node ${pkg.main}`;
    } catch (error) {
      entrypoint = '';
    }
  }
  return { workspace: root, workspaceStatus, workspaceError, files, entrypoint, nodeVersion: process.version };
}

function buildProjectFacts(project, observedAt) {
  const facts = [
    createFact({ key: 'project.workspace.path', status: project.workspace ? 'measured' : 'unknown', value: project.workspace || null, source: 'filesystem', observedAt }),
    createFact({ key: 'project.workspace.access', status: project.workspaceStatus || 'measured', value: (project.workspaceStatus || 'measured') === 'measured' ? true : null, source: 'filesystem', observedAt, warnings: project.workspaceError ? [project.workspaceError] : [] }),
    createFact({ key: 'project.entrypoint', status: project.entrypoint ? 'inferred' : 'unknown', value: project.entrypoint || null, source: 'filesystem', observedAt, confidence: project.entrypoint ? 'medium' : 'low', warnings: project.entrypoint ? ['Entrypoint inferred from project manifest.'] : ['No supported entrypoint was found.'] }),
    createFact({ key: 'project.runtime.node.version', status: project.nodeVersion ? 'measured' : 'unknown', value: project.nodeVersion || null, source: 'runtime', observedAt }),
  ];
  (project.files || []).forEach((item) => facts.push(createFact({
    key: `project.file.${String(item.name).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    status: item.status || (item.exists ? 'measured' : 'absent'),
    value: item.exists ? true : null,
    source: 'filesystem',
    observedAt,
  })));
  const hasProjectFile = (project.files || []).some((item) => item.exists);
  const readiness = project.entrypoint && project.nodeVersion ? 'ready' : hasProjectFile ? 'unknown' : 'unknown';
  facts.push(createFact({
    key: 'project.run.readiness',
    status: 'inferred',
    value: readiness,
    source: 'runtime',
    observedAt,
    confidence: readiness === 'ready' ? 'medium' : 'low',
    warnings: readiness === 'ready' ? ['Readiness is based on manifest and runtime inspection only; the project was not started.'] : ['Entrypoint or project manifest evidence is incomplete.'],
  }));
  return mergeFacts(facts);
}

function createProjectMapToolDefinition() {
  return {
    name: 'project_map',
    label: 'Project map',
    description: 'Return the current loong-agent architecture map.',
    category: 'runtime',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'runtime' },
    resultSchema: {
      data: 'architecture map',
      evidence: 'runtime layer mapping',
    },
    parameters: {},
    promptSnippet: 'Use project_map to explain how loong-agent maps to Pi Agent runtime layers.',
    promptGuidelines: 'Use this for architecture answers before reading many source files.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'project architecture map',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async (config) => {
      const result = {
        kind: 'project_map',
        architecture: [
          'CLI -> AgentSession',
          'AgentSession -> AgentRuntime',
          'AgentRuntime -> AgentLoop + EventBus + ToolRegistry + ProviderRegistry',
          'AgentSession -> SessionManager -> SessionRepo -> JsonlSession',
          'AgentLoop -> HookRunner -> prepareNextTurn hooks',
        ],
        piMappings: {
          AgentLoop: 'upstream packages/agent/src/agent-loop.ts behavior subset',
          AgentRuntime: 'upstream packages/agent/src/agent.ts behavior subset',
          SessionRepo: 'upstream harness/session/jsonl-repo.ts behavior subset',
          ToolWrapper: 'upstream coding-agent core tools wrapper behavior subset',
        },
        nonGoals: ['TUI', 'OAuth', 'settings manager', 'real streaming', 'compaction', 'RAG'],
      };
      const project = inspectProject(config && config.workspace);
      result.workspace = project.workspace;
      result.projectFiles = project.files;
      result.entrypoint = project.entrypoint;
      result.readiness = project.entrypoint ? 'ready' : 'unknown';
      result.facts = buildProjectFacts(project, new Date().toISOString());
      return Object.assign({}, result, {
        ok: true,
        data: result,
        summary: `${result.architecture.length} runtime layers, ${Object.keys(result.piMappings).length} Pi mappings`,
        evidence: [{
          source: 'runtime',
          layers: result.architecture.length,
          piMappings: Object.keys(result.piMappings),
        }],
        warnings: [],
        error: '',
      });
    },
  };
}

function createProjectMapTool() {
  return createTool(createProjectMapToolDefinition());
}

module.exports = {
  buildProjectFacts,
  createProjectMapTool,
  createProjectMapToolDefinition,
};
