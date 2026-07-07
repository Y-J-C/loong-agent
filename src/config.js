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

function nonNegativeIntEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function boundedIntEnv(name, defaultValue, minValue, maxValue) {
  const value = Number(process.env[name]);
  const min = Number(minValue);
  const max = Number(maxValue);
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return defaultValue;
  if (value < min || value > max) return defaultValue;
  return Math.floor(value);
}

function listEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  if (value === '') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

const PROVIDER_PROFILES = {
  deepseek: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    contextBudgetChars: 12000,
  },
  ollama: {
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    contextBudgetChars: 5000,
  },
  custom: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    contextBudgetChars: 8000,
  },
};

function normalizeThinkingLevel(value) {
  const level = String(value || 'off').toLowerCase();
  if (level === 'off') return 'off';
  if (level === 'max' || level === 'xhigh') return 'max';
  if (level === 'low' || level === 'medium' || level === 'high') return 'high';
  return 'off';
}

function normalizeRecordModelRequest(value, allowUnsafe) {
  const mode = String(value || 'summary').toLowerCase();
  if (mode === 'off' || mode === 'summary' || mode === 'redacted') return mode;
  if (mode === 'full') return allowUnsafe ? 'full' : 'redacted';
  return 'summary';
}

function normalizeNativeToolChoice(value) {
  const choice = String(value || '').toLowerCase();
  if (choice === 'auto' || choice === 'required' || choice === 'none') return choice;
  return '';
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
  const profileBudget = Number(profile.contextBudgetChars);
  const contextBudgetProfileDefault = Number.isFinite(profileBudget) && profileBudget > 0
    ? profileBudget
    : 8000;
  const hasContextBudgetEnv = process.env.LOONG_AGENT_CONTEXT_BUDGET !== undefined &&
    process.env.LOONG_AGENT_CONTEXT_BUDGET !== '';
  const contextBudgetChars = hasContextBudgetEnv
    ? intEnv('LOONG_AGENT_CONTEXT_BUDGET', contextBudgetProfileDefault)
    : contextBudgetProfileDefault;

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
    contextBudgetChars,
    contextBudgetSource: hasContextBudgetEnv ? 'env' : 'provider_profile',
    contextBudgetProfileDefault,
    allowWrite: boolEnv('LOONG_AGENT_ALLOW_WRITE', false),
    allowCommands: boolEnv('LOONG_AGENT_ALLOW_COMMANDS', false),
    nativeTools: boolEnv('LOONG_AGENT_NATIVE_TOOLS', true),
    nativeToolChoice: normalizeNativeToolChoice(process.env.LOONG_AGENT_NATIVE_TOOL_CHOICE),
    streaming: boolEnv('LOONG_AGENT_STREAMING', true),
    runtimeAppendStream: boolEnv('LOONG_AGENT_RUNTIME_APPEND_STREAM', true),
    tuiMessageLimit: boundedIntEnv('LOONG_AGENT_TUI_MESSAGE_LIMIT', 300, 50, 5000),
    tuiTranscriptLineLimit: boundedIntEnv('LOONG_AGENT_TUI_TRANSCRIPT_LINE_LIMIT', 5000, 50, 50000),
    recordModelRequest: normalizeRecordModelRequest(
      process.env.LOONG_AGENT_RECORD_MODEL_REQUEST || 'summary',
      boolEnv('LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG', false)
    ),
    allowUnsafeModelRequestLog: boolEnv('LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG', false),
    modelRequestMaxChars: nonNegativeIntEnv('LOONG_AGENT_MODEL_REQUEST_MAX_CHARS', 50000),
    extensions: listEnv('LOONG_AGENT_EXTENSIONS', ['loong']),
  };
}

module.exports = {
  loadConfig,
  normalizeNativeToolChoice,
  normalizeThinkingLevel,
  normalizeRecordModelRequest,
  boundedIntEnv,
  PROVIDER_PROFILES,
};
