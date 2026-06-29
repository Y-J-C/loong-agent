import type { TaskState } from "./task-state";

export function ingestGenericAgentRunEvent(
  taskState: TaskState,
  event: Record<string, unknown>
): TaskState;

export function ingestTaskRuntimeEvent(
  taskState: TaskState,
  event: Record<string, unknown>
): TaskState;
