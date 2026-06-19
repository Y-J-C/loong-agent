'use strict';

const { boardProfile } = require('../../board');
const { loongEnvCheck } = require('../../tools');

function shortModel(model) {
  const text = String(model || '');
  if (/LS2K1000/i.test(text)) return 'LS2K1000';
  return text || 'unknown';
}

async function createBoardStatusSnapshot(config) {
  const snapshot = {
    model: 'unknown',
    arch: process.arch || 'unknown',
    system: 'unknown',
    node: process.version,
    npmStatus: 'unknown',
    gppStatus: 'unknown',
    limitations: [],
    updatedAt: new Date().toISOString(),
    error: '',
  };

  try {
    const profileReport = await boardProfile(config, {});
    const profile = profileReport && profileReport.profile ? profileReport.profile : {};
    snapshot.model = shortModel(profile.model || profile.boardModel || profile.id);
    snapshot.arch = profile.arch || snapshot.arch;
    snapshot.system = profile.system || snapshot.system;
    snapshot.limitations = profile.knownLimitations || profile.known_limitations || profile.limitations || [];
  } catch (error) {
    snapshot.error = error && error.message ? error.message : String(error);
  }

  try {
    const env = await loongEnvCheck();
    const hints = env && env.hints ? env.hints : {};
    snapshot.node = hints.nodeVersion || snapshot.node;
    snapshot.npmStatus = hints.npmAvailable ? 'ok' : 'missing';
    snapshot.gppStatus = hints.gccTarget && hints.gccTarget !== 'unknown' ? 'ok' : 'missing';
    if (hints.isLoongArch64) snapshot.arch = 'loongarch64';
  } catch (error) {
    snapshot.error = snapshot.error || (error && error.message ? error.message : String(error));
  }

  return snapshot;
}

function formatBoardStatus(status) {
  if (!status) return 'board unknown';
  return [
    `board ${status.model || 'unknown'}`,
    status.arch || 'unknown',
    `node ${status.node || process.version}`,
    `npm ${status.npmStatus || 'unknown'}`,
    `g++ ${status.gppStatus || 'unknown'}`,
  ].join(' - ');
}

module.exports = {
  createBoardStatusSnapshot,
  formatBoardStatus,
};
