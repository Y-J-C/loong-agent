'use strict';

const fs = require('fs');
const path = require('path');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function boolEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function intEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function loadConfig() {
  const projectRoot = path.resolve(__dirname, '..');
  loadDotEnv(path.join(projectRoot, '.env'));

  const workspace = path.resolve(
    process.env.LOONG_AGENT_WORKSPACE || process.cwd()
  );

  return {
    projectRoot,
    workspace,
    baseUrl: process.env.LOONG_AGENT_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.LOONG_AGENT_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    model: process.env.LOONG_AGENT_MODEL || 'deepseek-chat',
    provider: process.env.LOONG_AGENT_PROVIDER || 'openai-compatible',
    maxLoops: intEnv('LOONG_AGENT_MAX_LOOPS', 6),
    allowWrite: boolEnv('LOONG_AGENT_ALLOW_WRITE', false),
    allowCommands: boolEnv('LOONG_AGENT_ALLOW_COMMANDS', false),
  };
}

module.exports = {
  loadConfig,
};
