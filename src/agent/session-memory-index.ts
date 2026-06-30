export type SessionIndexEntry = {
  version: 1;
  kind: "session_index_entry";
  sessionId: string;
  sessionPath: string;
  createdAt: string;
  updatedAt: string;
  command: string;
  parentSessionId?: string;
  parentSessionPath?: string;
  summary: string;
  taskGoal: string;
  topics: string[];
  keywords: string[];
  commands: string[];
  failureTypes: string[];
  sourceRefs: string[];
  confidence: "low";
  warnings: string[];
};

export function createSessionIndexEntry(
  session: unknown,
  options?: { limit?: number }
): SessionIndexEntry | null;

export function buildSessionIndex(
  config: unknown,
  options?: { limit?: number }
): {
  entries: SessionIndexEntry[];
  warnings: string[];
  stats: {
    sessionsScanned: number;
    entriesWritten: number;
    warnings: number;
  };
};

export function writeSessionIndex(
  config: unknown,
  entries: SessionIndexEntry[],
  options?: { dryRun?: boolean }
): {
  path: string;
  entriesWritten: number;
  dryRun: boolean;
};

export function readSessionIndex(
  config: unknown,
  options?: { path?: string }
): {
  entries: SessionIndexEntry[];
  warnings: string[];
};

export function searchSessionIndex(
  entries: SessionIndexEntry[],
  query: string,
  options?: { minScore?: number }
): {
  entry: SessionIndexEntry;
  score: number;
} | null;
