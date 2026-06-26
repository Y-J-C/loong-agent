'use strict';

const I2C_SCAN_WARNING =
  'I2C address scanning may probe devices on the bus; only /dev/i2c-0 and /dev/i2c-1 are allowed because they were confirmed present.';

const COMMAND_POLICY_METADATA = [
  { command: 'uname -a', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Kernel and system release.', warnings: [] },
  { command: 'uname -m', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Machine architecture.', warnings: [] },
  { command: 'cat /etc/os-release', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Operating system release.', warnings: [] },
  { command: 'lscpu', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'CPU information.', warnings: [] },
  { command: 'free -h', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Memory usage.', warnings: [] },
  { command: 'df -h', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Filesystem usage.', warnings: [] },
  { command: 'node -v', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Node.js version.', warnings: [] },
  { command: 'npm -v', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'npm version.', warnings: [] },
  { command: 'git --version', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Git version.', warnings: [] },
  { command: 'gcc -v', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'GCC version.', warnings: [] },
  { command: 'clang -v', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Clang version.', warnings: [] },
  { command: 'python3 --version', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Python version.', warnings: [] },
  { command: 'which node', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Node executable path.', warnings: [] },
  { command: 'which npm', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'npm executable path.', warnings: [] },
  { command: 'which git', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'Git executable path.', warnings: [] },
  { command: 'which curl', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'curl executable path.', warnings: [] },
  { command: 'which wget', matchType: 'exact', category: 'runtime', level: 'L0', decision: 'allow', description: 'wget executable path.', warnings: [] },
  { command: 'node src/index.js diagnose', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run local diagnostics.', warnings: [] },
  { command: 'node src/index.js compat', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run Pi compatibility check.', warnings: [] },
  { command: 'node src/index.js --help', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Show CLI help.', warnings: [] },
  { command: 'node src/index.js tui --help', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Show TUI help.', warnings: [] },
  { command: 'node src/index.js sessions', matchType: 'exact', category: 'session', level: 'L0', decision: 'allow', description: 'List sessions.', warnings: [] },
  { command: 'node src/index.js sessions --tree', matchType: 'exact', category: 'session', level: 'L0', decision: 'allow', description: 'List session tree.', warnings: [] },
  { command: 'node src/index.js session latest', matchType: 'exact', category: 'session', level: 'L0', decision: 'allow', description: 'Show latest session trace.', warnings: [] },
  { command: 'node src/index.js session lineage latest', matchType: 'exact', category: 'session', level: 'L0', decision: 'allow', description: 'Show latest session lineage.', warnings: [] },
  { command: 'node scripts/test-runtime.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run runtime tests.', warnings: [] },
  { command: 'node scripts/test-session-tree.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run session tree tests.', warnings: [] },
  { command: 'node scripts/test-cli-smoke.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run CLI smoke tests.', warnings: [] },
  { command: 'node scripts/test-tui-renderer.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run TUI renderer tests.', warnings: [] },
  { command: 'node scripts/test-tui-commands.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run TUI command tests.', warnings: [] },
  { command: 'node scripts/test-tui-input.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run TUI input tests.', warnings: [] },
  { command: 'node scripts/test-tui-theme.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run TUI theme tests.', warnings: [] },
  { command: 'node scripts/test-tui-stats.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run TUI stats tests.', warnings: [] },
  { command: 'node scripts/test-tui-export-demo.js', matchType: 'exact', category: 'diagnostics', level: 'L0', decision: 'allow', description: 'Run TUI export demo tests.', warnings: [] },
  { command: 'dmesg | tail -n 80', matchType: 'exact', category: 'diagnostics', level: 'L1', decision: 'allow', description: 'Read recent kernel messages.', warnings: ['Kernel logs may include noisy hardware state; interpret as diagnostic evidence only.'] },
  { command: 'ls /dev/i2c*', matchType: 'exact', category: 'board', level: 'L0', decision: 'allow', description: 'List I2C device nodes.', warnings: [] },
  { command: 'i2cdetect -l', matchType: 'exact', category: 'board', level: 'L0', decision: 'allow', description: 'List I2C buses.', warnings: [] },
  { command: 'i2cdetect -y 0', matchType: 'exact', category: 'board', level: 'L1', decision: 'allow', description: 'Scan I2C bus 0 for device addresses.', warnings: [I2C_SCAN_WARNING] },
  { command: 'i2cdetect -y 1', matchType: 'exact', category: 'board', level: 'L1', decision: 'allow', description: 'Scan I2C bus 1 for device addresses.', warnings: [I2C_SCAN_WARNING] },
];

const READONLY_SHELL_RECIPES = [
  {
    command: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Neither ss nor netstat available"',
    category: 'network',
    level: 'L0',
    description: 'List TCP listening ports with ss or netstat fallback.',
    warnings: [],
  },
  {
    command: 'ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null || echo "No UDP info"',
    category: 'network',
    level: 'L0',
    description: 'List UDP listening sockets with ss or netstat fallback.',
    warnings: [],
  },
];

const FORBIDDEN_EXAMPLES = [
  'apt upgrade',
  'apt install',
  'fsck',
  'fdisk',
  'parted',
  'mkfs',
  'dd',
  'modify /boot or EFI',
  'modify network configuration',
  'blind peripheral probing outside COMMAND_POLICY_METADATA',
];

const DANGEROUS_COMMAND_PATTERN =
  /\b(apt(-get)?\s+(install|remove|purge|upgrade|full-upgrade|dist-upgrade|autoremove|update)|npm\s+(install|update|audit\s+fix|ci|publish)|yarn\s+(add|install|upgrade|remove)|pnpm\s+(add|install|update|remove)|pip\s+(install|uninstall)|systemctl\s+(start|stop|restart|enable|disable)|service\s+\S+\s+(start|stop|restart))\b|\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|dd|mkfs|mount|umount|reboot|shutdown)\b|(^|[^<])>>?|&&|\|\||;\s*|`|\$\(/i;

const COMMAND_POLICY_COMMANDS = new Set(
  COMMAND_POLICY_METADATA
    .filter((item) => item.decision === 'allow')
    .map((item) => item.command)
);

const READONLY_COMMAND_METADATA = COMMAND_POLICY_METADATA;
const READONLY_COMMANDS = COMMAND_POLICY_COMMANDS;

function findCommandMetadata(command) {
  return COMMAND_POLICY_METADATA.find((item) => {
    if (item.matchType === 'exact') return item.command === command;
    return false;
  }) || null;
}

function normalizeShellRecipe(command) {
  return String(command || '')
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
}

function findReadonlyShellRecipe(command) {
  const normalized = normalizeShellRecipe(command);
  return READONLY_SHELL_RECIPES.find((item) => normalizeShellRecipe(item.command) === normalized) || null;
}

function evaluateCommand(inputCommand) {
  const command = String(inputCommand || '').trim();
  if (!command) {
    return {
      allowed: false,
      policy: 'command_missing',
      level: 'forbidden',
      metadata: null,
      reason: 'Missing command reference query.',
      warnings: [],
    };
  }

  const recipe = findReadonlyShellRecipe(command);
  if (recipe) {
    return {
      allowed: true,
      policy: 'readonly_shell_recipe',
      level: recipe.level,
      category: recipe.category,
      metadata: recipe,
      reason: `Command is listed as a read-only shell recipe: ${recipe.command}`,
      warnings: Array.isArray(recipe.warnings) ? recipe.warnings.slice() : [],
    };
  }

  if (DANGEROUS_COMMAND_PATTERN.test(command)) {
    return {
      allowed: false,
      policy: 'dangerous_command',
      level: 'forbidden',
      metadata: null,
      reason: `Command is blocked by safety policy: ${command}`,
      warnings: ['Dangerous shell command pattern matched.'],
    };
  }

  const metadata = findCommandMetadata(command);
  if (!metadata || metadata.decision !== 'allow') {
    return {
      allowed: false,
      policy: 'unsupported_command',
      level: 'forbidden',
      metadata,
      reason: `Command is not in the recommended command reference: ${command}`,
      warnings: [],
    };
  }

  return {
    allowed: true,
    policy: 'command_allowlist',
    level: metadata.level,
    metadata,
    reason: `Command is listed in the recommended command reference: ${command}`,
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings.slice() : [],
  };
}

function groupCommandPolicyLevels(commands) {
  const groups = { L0: [], L1: [], forbiddenExamples: FORBIDDEN_EXAMPLES.slice() };
  for (const item of commands || []) {
    if (item.level === 'L1') groups.L1.push(item);
    else if (item.level === 'L0') groups.L0.push(item);
  }
  return groups;
}

module.exports = {
  COMMAND_POLICY_COMMANDS,
  COMMAND_POLICY_METADATA,
  DANGEROUS_COMMAND_PATTERN,
  FORBIDDEN_EXAMPLES,
  READONLY_SHELL_RECIPES,
  READONLY_COMMAND_METADATA,
  READONLY_COMMANDS,
  evaluateCommand,
  findReadonlyShellRecipe,
  groupCommandPolicyLevels,
};
