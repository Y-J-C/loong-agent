'use strict';

const {
  createToolDefinitionFromAgentTool,
  wrapToolDefinitions,
} = require('../tool-definition-wrapper');
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
const { createReadFileTool, createReadFileToolDefinition } = require('./read-file');
const {
  createProjectMapToolDefinition,
} = require('./project-map');
const {
  createReadonlyCommandTool,
  createReadonlyCommandToolDefinition,
} = require('./readonly-command');
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
    createReadonlyCommandToolDefinition(),
    createListDirectoryToolDefinition(),
    createReadFileToolDefinition(),
    createSearchFilesToolDefinition(),
    createRuntimeHealthToolDefinition(),
    createProjectMapToolDefinition(),
    createSessionSummaryToolDefinition(),
    createFinishToolDefinition(),
  ];
}

function createReadOnlyToolDefinitions() {
  return [
    createBoardProfileToolDefinition(),
    createLoongEnvCheckToolDefinition(),
    createReadonlyCommandToolDefinition(),
    createListDirectoryToolDefinition(),
    createReadFileToolDefinition(),
    createSearchFilesToolDefinition(),
    createRuntimeHealthToolDefinition(),
    createProjectMapToolDefinition(),
    createSessionSummaryToolDefinition(),
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
  createReadOnlyToolDefinitions,
  createReadOnlyTools,
  createToolDefinitionFromAgentTool,
};
