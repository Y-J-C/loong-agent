'use strict';

const {
  createToolDefinitionFromAgentTool,
  wrapToolDefinitions,
} = require('../tool-definition-wrapper');
const {
  createBashTool,
  createBashToolDefinition,
} = require('./bash');
const {
  createBoardProfileTool,
  createBoardProfileToolDefinition,
} = require('./board-profile');
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
const { createReadFileTool, createReadFileToolDefinition } = require('./read-file');
const {
  createProjectMapToolDefinition,
} = require('./project-map');
const {
  createProcessLogsToolDefinition,
  createProcessStatusToolDefinition,
  createProcessStopToolDefinition,
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

function createDefaultToolDefinitions() {
  return [
    createBoardProfileToolDefinition(),
    createLoongEnvCheckToolDefinition(),
    createBashToolDefinition(),
    createProcessStatusToolDefinition(),
    createProcessLogsToolDefinition(),
    createProcessStopToolDefinition(),
    createReadToolDefinition(),
    createWriteToolDefinition(),
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

function createReadOnlyToolDefinitions() {
  return [
    createBoardProfileToolDefinition(),
    createLoongEnvCheckToolDefinition(),
    createReadToolDefinition(),
    createLsToolDefinition(),
    createGrepToolDefinition(),
    createFindToolDefinition(),
    createProcessStatusToolDefinition(),
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

function createDefaultTools() {
  return wrapToolDefinitions(createDefaultToolDefinitions());
}

function createReadOnlyTools() {
  return wrapToolDefinitions(createReadOnlyToolDefinitions());
}

module.exports = {
  createDefaultToolDefinitions,
  createDefaultTools,
  createBashTool,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createProcessLogsToolDefinition,
  createProcessStatusToolDefinition,
  createProcessStopToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createReadOnlyToolDefinitions,
  createReadOnlyTools,
  createToolDefinitionFromAgentTool,
};
