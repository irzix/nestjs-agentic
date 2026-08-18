/**
 * Represents a single deterministic execution step in a Standard Operating Procedure (SOP).
 */
export interface ProceduralStep {
  /** 1-indexed step sequence number */
  stepNumber: number;
  /** Human-readable title of the step */
  title: string;
  /** Detailed description or instructions for this step */
  description: string;
  /** Optional target tool expected to be executed during this step */
  toolName?: string;
  /** Optional default or template arguments for tool invocation */
  argsTemplate?: Record<string, unknown>;
  /** Optional validation criteria or post-condition that must be met */
  validationCondition?: string;
  /** Error recovery strategy if this step encounters an error */
  onFailure?: 'retry' | 'skip' | 'abort' | 'escalate_hitl';
  /** Execution timeout for this step in milliseconds */
  timeoutMs?: number;
}

/**
 * Standard Operating Procedure (SOP) or workflow playbook stored in Procedural Memory.
 */
export interface ProceduralPlaybook {
  /** Unique playbook identifier */
  id: string;
  /** Human-readable playbook name */
  name: string;
  /** Descriptive overview of what this playbook accomplishes */
  description: string;
  /** List of keywords, task triggers, or event topics that activate this playbook */
  triggers: string[];
  /** Optional prerequisite conditions, required roles, or tools that the caller MUST possess */
  prerequisites?: string[];
  /** Ordered list of deterministic steps */
  steps: ProceduralStep[];
  /** Optional custom metadata (e.g. author, domain, priority) */
  metadata?: Record<string, unknown>;
  /** Semantic version string */
  version?: string;
  /** Creation timestamp */
  createdAt?: Date;
  /** Last update timestamp */
  updatedAt?: Date;
}

/**
 * Procedural playbook with calculated match relevance score.
 */
export interface ScoredPlaybook {
  /** The matching procedural playbook */
  playbook: ProceduralPlaybook;
  /** Match relevance score in [0, 1] */
  matchScore: number;
  /** Specific trigger keywords that matched the query */
  matchedTriggers: string[];
}

/**
 * Options for querying and matching procedural playbooks.
 */
export interface PlaybookMatchOptions {
  /** Maximum number of playbooks to return. Default: 5 */
  limit?: number;
  /** Minimum match score threshold in [0, 1]. Default: 0.1 */
  minMatchScore?: number;
  /**
   * Available capabilities, roles, or tools possessed by the caller.
   * Playbooks requiring prerequisites NOT in this list will be filtered out.
   */
  availablePrerequisites?: string[];
  /**
   * Alias for `availablePrerequisites` (for backward compatibility).
   */
  prerequisitesFilter?: string[];
}
