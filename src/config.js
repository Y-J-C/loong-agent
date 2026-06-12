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
    if (process.env[key] === undefined) process.env[key] = value;
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

const PROVIDER_PROFILES = {
  deepseek: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  ollama: {
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
  },
  custom: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
};

function normalizeThinkingLevel(value) {
  const level = String(value || 'off').toLowerCase();
  if (level === 'off') return 'off';
  if (level === 'max' || level === 'xhigh') return 'max';
  if (level === 'low' || level === 'medium' || level === 'high') return 'high';
  return 'off';
}

function loadConfig() {
  const projectRoot = path.resolve(__dirname, '..');
  loadDotEnv(path.join(projectRoot, '.env'));

  const workspace = path.resolve(
    process.env.LOONG_AGENT_WORKSPACE || process.cwd()
  );
  const providerProfile = process.env.LOONG_AGENT_PROVIDER_PROFILE || 'deepseek';
  const profile = PROVIDER_PROFILES[providerProfile];
  if (!profile) {
    throw new Error(`Unknown LOONG_AGENT_PROVIDER_PROFILE: ${providerProfile}`);
  }

  return {
    projectRoot,
    workspace,
    providerProfile,
    baseUrl: process.env.LOONG_AGENT_BASE_URL || profile.baseUrl || 'https://api.deepseek.com',
    apiKey: process.env.LOONG_AGENT_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    model: process.env.LOONG_AGENT_MODEL || profile.model || 'deepseek-v4-flash',
    provider: process.env.LOONG_AGENT_PROVIDER || profile.provider || 'openai-compatible',
    thinkingLevel: normalizeThinkingLevel(process.env.LOONG_AGENT_THINKING_LEVEL || 'off'),
    jsonMode: boolEnv('LOONG_AGENT_JSON_MODE', true),
    maxLoops: intEnv('LOONG_AGENT_MAX_LOOPS', 6),
    contextBudgetChars: intEnv('LOONG_AGENT_CONTEXT_BUDGET', 1800),
    allowWrite: boolEnv('LOONG_AGENT_ALLOW_WRITE', false),
    allowCommands: boolEnv('LOONG_AGENT_ALLOW_COMMANDS', false),
    streaming: boolEnv('LOONG_AGENT_STREAMING', true),
  };
}

module.exports = {
  loadConfig,
  normalizeThinkingLevel,
  PROVIDER_PROFILES,
};
