'use strict';

const PROJECT_RUN_CHECK_STEP_DEFINITIONS = [
  {
    id: 'inspect_project_structure',
    title: 'Inspect project structure',
    expectedOutput: 'Identify key files such as package.json, README, Makefile, pyproject.toml, requirements.txt, src/ entry files.',
  },
  {
    id: 'detect_project_type',
    title: 'Detect project type',
    expectedOutput: 'Determine whether the project is Node.js, Python, C/C++, mixed, or unknown.',
  },
  {
    id: 'detect_entrypoint',
    title: 'Detect entrypoint',
    expectedOutput: 'Identify likely startup command or explain why entrypoint is unclear.',
  },
  {
    id: 'check_board_runtime',
    title: 'Check board runtime',
    expectedOutput: 'Check architecture, OS, Node/Python/GCC availability using low-risk commands.',
  },
  {
    id: 'check_dependency_risks',
    title: 'Check dependency risks',
    expectedOutput: 'Determine whether missing npm/pip/g++/native dependency blocks execution.',
  },
  {
    id: 'run_low_risk_validation',
    title: 'Run low-risk validation',
    expectedOutput: 'Run only safe validation such as syntax check, version check, file existence check, or dry-run if available.',
  },
  {
    id: 'produce_conclusion',
    title: 'Produce conclusion',
    expectedOutput: 'Produce conclusion with evidence, blockers, and next minimal check.',
  },
];

const PROJECT_RUN_CHECK_STEP_IDS = PROJECT_RUN_CHECK_STEP_DEFINITIONS.map((step) => step.id);

const PROJECT_RUN_CHECK_SAFETY = {
  defaultReadOnly: true,
  forbiddenActions: [
    'install_dependencies',
    'sudo',
    'systemctl_restart',
    'delete_move_or_overwrite_files',
    'modify_system_config',
    'write_env_or_secrets',
  ],
  preferredFiles: [
    'package.json',
    'README',
    'Makefile',
    'pyproject.toml',
    'requirements.txt',
  ],
  preferredCommands: [
    'node --check',
    'python -m py_compile',
    'file',
    'uname -m',
    'which',
    'ls',
    'cat',
    'find',
  ],
};

function createProjectRunCheckSteps() {
  return PROJECT_RUN_CHECK_STEP_DEFINITIONS.map((step) => Object.assign({ status: 'pending' }, step));
}

function isProjectRunCheckStepId(stepId) {
  return PROJECT_RUN_CHECK_STEP_IDS.includes(stepId);
}

module.exports = {
  createProjectRunCheckSteps,
  isProjectRunCheckStepId,
  PROJECT_RUN_CHECK_SAFETY,
  PROJECT_RUN_CHECK_STEP_DEFINITIONS,
  PROJECT_RUN_CHECK_STEP_IDS,
};
