export type TaskPhase =
  | "idle"
  | "understand"
  | "plan"
  | "act"
  | "observe"
  | "verify"
  | "finish"
  | "blocked";

export type TaskStepStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type TaskStep = {
  id: string;
  title: string;
  description?: string;
  status: TaskStepStatus;
  expectedOutput?: string;
  toolName?: string;
  startedAt?: string;
  endedAt?: string;
  resultSummary?: string;
  failureReason?: string;
};

export type ObservationSeverity =
  | "info"
  | "warning"
  | "error"
  | "critical";

export type Observation = {
  id: string;
  source: "tool" | "command" | "file" | "model" | "system";
  status: "ok" | "failed" | "unknown";
  signal: string[];
  severity: ObservationSeverity;
  summary: string;
  rawExcerpt?: string;
  facts?: Record<string, string | number | boolean | null>;
  suggestedNextCheck?: string;
  createdAt: string;
};

export type Evidence = {
  id: string;
  kind: "file" | "command" | "tool" | "kb" | "session" | "manual";
  title: string;
  summary: string;
  ref?: string;
  excerpt?: string;
  criteria?: string[];
  signals?: string[];
  toolName?: string;
  command?: string;
  exitCode?: number;
  status?: string;
  createdAt: string;
};

export type Blocker = {
  id: string;
  category:
    | "missing_dependency"
    | "permission"
    | "network"
    | "architecture"
    | "missing_file"
    | "runtime"
    | "unstable_execution"
    | "unsafe_operation"
    | "unknown";
  summary: string;
  evidenceIds?: string[];
  evidenceRef?: string;
  source?: string;
  toolCallId?: string;
  dedupKey?: string;
  suggestedMinimalNextStep?: string;
  createdAt: string;
};

export type FinishCriteria = {
  requiredSignals?: string[];
  requiredEvidenceKinds?: string[];
  allowBlockedFinish?: boolean;
  description: string;
};

export type TaskState = {
  taskId: string;
  goal: string;
  taskType: string;
  phase: TaskPhase;
  steps: TaskStep[];
  currentStepId?: string;
  observations: Observation[];
  evidence: Evidence[];
  blockers: Blocker[];
  finishCriteria?: FinishCriteria;
  conclusion?: string;
  createdAt: string;
  updatedAt: string;
};

export function createTaskState(input: {
  goal: string;
  taskType?: string;
  steps?: TaskStep[];
  finishCriteria?: FinishCriteria;
}): TaskState;

export function updateTaskPhase(state: TaskState, phase: TaskPhase): TaskState;
export function startStep(state: TaskState, stepId: string): TaskState;
export function completeStep(state: TaskState, stepId: string, resultSummary?: string): TaskState;
export function failStep(state: TaskState, stepId: string, failureReason: string): TaskState;
export function addObservation(state: TaskState, observation: Observation): TaskState;
export function addEvidence(state: TaskState, evidence: Evidence): TaskState;
export function addBlocker(state: TaskState, blocker: Blocker): TaskState;
export function setConclusion(state: TaskState, conclusion: string): TaskState;
export function summarizeTaskState(state: TaskState): string;
