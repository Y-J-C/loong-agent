export type KnowledgeCandidate = {
  version: 1;
  kind: 'knowledge_candidate';
  status: 'draft';
  confidence: 'low';
  title: string;
  proposedKnowledge: string[];
  sourceSessionId: string;
  sourceSessionPath: string;
  sourceRefs: string[];
  topics: string[];
  commands: string[];
  resultSummary: string;
  risk: {
    level: 'review_required';
    reasons: string[];
  };
  createdAt: string;
};

export function createKnowledgeCandidate(session: unknown, options?: {
  workspace?: string;
  now?: string;
  maxPerSession?: number;
}): KnowledgeCandidate | null;

export function buildKnowledgeCandidates(config: unknown, options?: {
  limit?: number;
  session?: string;
  workspace?: string;
  now?: string;
  maxPerSession?: number;
}): {
  candidates: KnowledgeCandidate[];
  warnings: string[];
  stats: {
    sessionsScanned: number;
    candidatesFound: number;
    warnings: number;
  };
};

export function renderKnowledgeCandidateMarkdown(candidate: KnowledgeCandidate): string;

export function writeKnowledgeCandidates(config: unknown, candidates: KnowledgeCandidate[], options?: {
  dryRun?: boolean;
}): {
  dryRun: boolean;
  filesWritten: number;
  candidatesFound: number;
  files: string[];
};
