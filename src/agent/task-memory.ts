export type TaskMemoryCurrentStep = {
  id: string;
  title: string;
  status: string;
  summary?: string;
};

export type TaskMemoryCompletedAction = {
  action: string;
  tool?: string;
  command?: string;
  resultSummary?: string;
  evidenceRef?: string;
};

export type TaskMemoryFailedAttempt = {
  action: string;
  tool?: string;
  command?: string;
  resultSummary: string;
  failureType:
    | "command_error"
    | "permission_denied"
    | "network_error"
    | "missing_dependency"
    | "arch_incompatible"
    | "path_not_found"
    | "policy_blocked"
    | "timeout"
    | "unknown";
  evidenceRef: string;
  retryAdvice: string;
};

export type TaskMemoryVerifiedFact = {
  fact: string;
  evidenceRef: string;
  command?: string;
  exitCode?: number;
  summary?: string;
};

export type TaskMemoryBlocker = {
  category: string;
  summary: string;
  suggestedMinimalNextStep?: string;
  evidenceRef?: string;
};

export type TaskMemorySnapshot = {
  goal: string;
  constraints: string[];
  currentStep: TaskMemoryCurrentStep;
  completedActions: TaskMemoryCompletedAction[];
  failedAttempts: TaskMemoryFailedAttempt[];
  verifiedFacts: TaskMemoryVerifiedFact[];
  blockers: TaskMemoryBlocker[];
  nextSuggestedActions: string[];
};

export function classifyFailureType(input: unknown): TaskMemoryFailedAttempt["failureType"];

export function createTaskMemorySnapshot(input: {
  taskState?: unknown;
  messages?: unknown[];
  observations?: unknown[];
  userPrompt?: string;
}): TaskMemorySnapshot;

export function renderTaskMemoryPromptBlock(
  snapshot: TaskMemorySnapshot,
  options?: { maxChars?: number }
): string;
