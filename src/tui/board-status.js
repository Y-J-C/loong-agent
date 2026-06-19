'use strict';

const { createDefaultExtensionRuntime } = require('../extensions');

function genericStatusSnapshot() {
  return {
    model: 'generic',
    arch: process.arch || 'unknown',
    system: process.platform || 'unknown',
    node: process.version,
    npmStatus: 'unknown',
    gppStatus: 'unknown',
    limitations: [],
    updatedAt: new Date().toISOString(),
    error: '',
  };
}

function boardStatusContribution(config) {
  const runtime = createDefaultExtensionRuntime(config || {});
  return runtime.getTuiContributions().find((item) => {
    return item && item.kind === 'boardStatus' && item.enabled !== false;
  }) || null;
}

async function createBoardStatusSnapshot(config) {
  const contribution = boardStatusContribution(config);
  if (contribution && typeof contribution.createSnapshot === 'function') {
    return contribution.createSnapshot(config || {});
  }
  return genericStatusSnapshot();
}

function formatBoardStatus(status, config) {
  const contribution = boardStatusContribution(config);
  if (contribution && typeof contribution.format === 'function') {
    return contribution.format(status);
  }
  if (!status) return 'runtime unknown';
  return [
    status.model || 'generic',
    status.arch || process.arch || 'unknown',
    `node ${status.node || process.version}`,
  ].join(' - ');
}

module.exports = {
  createBoardStatusSnapshot,
  formatBoardStatus,
};
