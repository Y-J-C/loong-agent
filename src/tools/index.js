'use strict';

const {
  createToolDefinitionFromAgentTool,
  wrapToolDefinitions,
} = require('../tool-definition-wrapper');
const {
  createBashTool,
  createBashToolDefinition,
} = require('./bash');
const { createDefaultExtensionRuntime } = require('../extensions');
const {
  createBoardProfileTool,
  createBoardProfileToolDefinition,
} = require('./board-profile');
const {
  createCsvHtmlReportToolDefinition,
} = require('./csv-html-report');
const { createFinishTool, createFinishToolDefinition } = require('./finish');
const {
  createListDirectoryTool,
  createListDirectoryToolDefinition,
} = require('./list-directory');
const {
  createLoongEnvCheckTool,
  createLoongEnvCheckToolDefinition,
} = require('./loong-env-check');
const {
  createKnowledgeToolDefinitions,
} = require('./kb-tools');
const {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} = require('./file-tools');
const {
  createDiffFileToolDefinition,
  createDiffTextToolDefinition,
} = require('./diff-tools');
const {
  createGitDiffToolDefinition,
  createGitLogToolDefinition,
  createGitStatusToolDefinition,
} = require('./git-tools');
const { createReadFileTool, createReadFileToolDefinition } = require('./read-file');
const {
  createProjectMapToolDefinition,
} = require('./project-map');
const {
  createProcessLogsToolDefinition,
  createProcessStatusToolDefinition,
  createProcessStopToolDefinition,
  createProcessWaitToolDefinition,
} = require('./process-tools');
const {
  createRuntimeHealthToolDefinition,
} = require('./runtime-health');
const {
  createSearchFilesTool,
  createSearchFilesToolDefinition,
} = require('./search-files');
const {
  createSessionSummaryToolDefinition,
} = require('./session-summary');

function extensionToolDefinitions(options) {
  const runtime = options && options.extensionRuntime
    ? options.extensionRuntime
    : createDefaultExtensionRuntime(options && options.config ? options.config : options || {});
  return Object.keys(runtime.tools || {}).map((name) => runtime.tools[name]);
}

function createCoreToolDefinitions() {
  return [
    createBashToolDefinition(),
    createProcessStatusToolDefinition(),
    createProcessWaitToolDefinition(),
    createProcessLogsToolDefinition(),
    createProcessStopToolDefinition(),
    createReadToolDefinition(),
    createGitStatusToolDefinition(),
    createGitDiffToolDefinition(),
    createGitLogToolDefinition(),
    createDiffTextToolDefinition(),
    createDiffFileToolDefinition(),
    createWriteToolDefinition(),
    createCsvHtmlReportToolDefinition(),
    createEditToolDefinition(),
    createLsToolDefinition(),
    createGrepToolDefinition(),
    createFindToolDefinition(),
    createListDirectoryToolDefinition(),
    createReadFileToolDefinition(),
    createSearchFilesToolDefinition(),
    createRuntimeHealthToolDefinition(),
    createProjectMapToolDefinition(),
    createSessionSummaryToolDefinition(),
    ...createKnowledgeToolDefinitions(),
    createFinishToolDefinition(),
  ];
}

function createDefaultToolDefinitions(options) {
  return extensionToolDefinitions(options).concat(createCoreToolDefinitions());
}

function createReadOnlyCoreToolDefinitions() {
  return [
    createReadToolDefinition(),
    createGitStatusToolDefinition(),
    createGitDiffToolDefinition(),
    createGitLogToolDefinition(),
    createDiffTextToolDefinition(),
    createDiffFileToolDefinition(),
    createLsToolDefinition(),
    createGrepToolDefinition(),
    createFindToolDefinition(),
    createProcessStatusToolDefinition(),
    createProcessWaitToolDefinition(),
    createProcessLogsToolDefinition(),
    createListDirectoryToolDefinition(),
    createReadFileToolDefinition(),
    createSearchFilesToolDefinition(),
    createRuntimeHealthToolDefinition(),
    createProjectMapToolDefinition(),
    createSessionSummaryToolDefinition(),
    ...createKnowledgeToolDefinitions(),
  ];
}

function createReadOnlyToolDefinitions(options) {
  return extensionToolDefinitions(options).concat(createReadOnlyCoreToolDefinitions());
}

function createDefaultTools(options) {
  return wrapToolDefinitions(createDefaultToolDefinitions(options));
}

function createReadOnlyTools(options) {
  return wrapToolDefinitions(createReadOnlyToolDefinitions(options));
}

module.exports = {
  createCoreToolDefinitions,
  createDefaultToolDefinitions,
  createDefaultTools,
  createBashTool,
  createBashToolDefinition,
  createCsvHtmlReportToolDefinition,
  createEditToolDefinition,
  createDiffFileToolDefinition,
  createDiffTextToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createGitDiffToolDefinition,
  createGitLogToolDefinition,
  createGitStatusToolDefinition,
  createLsToolDefinition,
  createProcessLogsToolDefinition,
  createProcessStatusToolDefinition,
  createProcessStopToolDefinition,
  createProcessWaitToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createReadOnlyToolDefinitions,
  createReadOnlyTools,
  createToolDefinitionFromAgentTool,
};
