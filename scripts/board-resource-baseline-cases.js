'use strict';

const { statistics } = require('./board-resource-baseline-runtime');

const CASE_IDS = ['PRES-001', 'PRES-002', 'PRES-003', 'PRES-004', 'PRES-005', 'PRES-006', 'PRES-007'];

const TITLES = {
  'PRES-001': 'Knowledge and evidence governance cost',
  'PRES-002': 'Streaming and Session growth',
  'PRES-003': 'Large output and full log path',
  'PRES-004': 'Session list and tree growth',
  'PRES-005': 'Child process lifecycle cleanup',
  'PRES-006': 'TUI fixed-load rendering baseline',
  'PRES-007': 'Typical board task resource footprint',
};

function fixtureCase(caseId) {
  return {
    caseId, title: TITLES[caseId], required: true,
    evaluationStatus: 'passed', taskOutcome: 'success', availability: 'fixture',
    coldSamples: [], warmSamples: [],
    metrics: { durationMs: { cold: statistics([]), warm: statistics([]) } },
    checks: [{ id: 'fixture_contract', status: 'passed', message: 'Mock fixture is deterministic.' }],
    evidence: [{ source: 'fixture', caseId }], warnings: [], error: '',
  };
}

function createCaseCatalog() {
  return CASE_IDS.map((caseId) => ({ caseId, title: TITLES[caseId] }));
}

module.exports = { CASE_IDS, TITLES, createCaseCatalog, fixtureCase };
