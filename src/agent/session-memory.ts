export type SessionMemoryIntent = {
  shouldRead: boolean;
  intent: "historical" | "current";
  trigger: string;
  requestContext?: unknown;
};

export type SessionMemorySource = {
  id: string;
  path: string;
  parentSession?: string;
  selectedBy?: string;
};

export type SessionMemoryAction = {
  kind: "tool" | "bash";
  toolName?: string;
  toolCallId?: string;
  command?: string;
  exitCode?: number;
  cancelled?: boolean;
  isError?: boolean;
  resultSummary?: string;
  sourceRef: string;
};

export type SessionMemoryFailedAttempt = {
  action: string;
  tool?: string;
  command?: string;
  resultSummary: string;
  failureType: string;
  sourceRef: string;
};

export type SessionMemoryFact = {
  fact: string;
  sourceRef: string;
  command?: string;
  toolName?: string;
  subject?: string;
  confidence?: "high" | "medium" | "low";
};

export type SessionMemorySnapshot = {
  trigger: string;
  intent: string;
  sourceSession: SessionMemorySource;
  sourceRefs: string[];
  summary: string;
  recentActions: SessionMemoryAction[];
  relevantFacts: SessionMemoryFact[];
  failedAttempts: SessionMemoryFailedAttempt[];
  blockers: unknown[];
  warnings: string[];
};

export function detectSessionMemoryIntent(userPrompt: string): SessionMemoryIntent;

export function createSessionMemorySnapshot(input: {
  session?: unknown;
  resumeContext?: unknown;
  context?: unknown;
  userPrompt?: string;
  selectedBy?: string;
}): SessionMemorySnapshot;

export function renderSessionMemoryPromptBlock(
  snapshot: SessionMemorySnapshot,
  options?: { maxChars?: number }
): string;

export function resolveSessionMemorySource(
  config: unknown,
  currentSession: unknown,
  userPrompt: string
): {
  intent: SessionMemoryIntent;
  session: unknown | null;
  selectedBy: string;
  warnings: string[];
};
