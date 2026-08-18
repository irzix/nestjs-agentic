/**
 * Represents a single execution step within an agent trajectory.
 */
export interface TrajectoryStep {
  /** 1-indexed step index in the execution trajectory. */
  stepIndex: number;

  /** Name of the tool invoked during this execution step. */
  toolName?: string;

  /** Key-value arguments dictionary passed into the tool. */
  args?: Record<string, unknown>;

  /** Tool execution result output. */
  result?: unknown;

  /** Detailed error message string if the step failed. */
  error?: string;

  /** Timestamp of the tool execution step. */
  timestamp?: Date;
}

/**
 * Complete execution trajectory captured for reflection and self-correction learning.
 */
export interface AgentTrajectory {
  /** Session identifier for tracing context. */
  sessionId: string;

  /** Target agent name. */
  agentName: string;

  /** Initial goal or prompt instruction given to the agent. */
  goal: string;

  /** Chronological array of tool execution steps. */
  steps: TrajectoryStep[];

  /** Overall trajectory execution success status. */
  success: boolean;
}

/**
 * Result payload returned from reflecting on an agent trajectory.
 */
export interface ReflectionResult {
  /** Whether the trajectory execution was successful without unhandled errors. */
  success: boolean;

  /** Detailed analytical critique of the trajectory execution. */
  critique?: string;

  /** Extracted list of learned rules or self-correction lessons. */
  lessonsLearned: string[];

  /** Suggested prompt guidance adjustments for future agent runs. */
  suggestedPromptAdjustment?: string;

  /** Cognitive importance rating of the critique in [0, 1] based on failure severity. */
  importance?: number;
}

/**
 * Persistent record of a learned lesson or pattern stored in memory.
 */
export interface ExperienceRecord {
  /** Unique experience record identifier. */
  id: string;

  /** Tenant or session identifier. */
  tenantId?: string;

  /** Name of the agent that learned the lesson. */
  agentName: string;

  /** Task trigger or prompt context key. */
  taskTrigger: string;

  /** Identified execution pattern or failure mode. */
  pattern: string;

  /** Learned lesson advice or rule for future prompt guidance. */
  lesson: string;

  /** Confidence or quality score of the learned lesson. */
  score?: number;

  /** Cognitive importance score in [0, 1] for Stanford Tri-Factor memory ranking. */
  importance?: number;

  /** Timestamp when the lesson was learned. */
  timestamp?: Date;
}

/**
 * Engine interface defining self-correcting trajectory critique and experience reflection.
 */
export interface ExperienceEngine {
  /**
   * Critiques an execution trajectory and extracts self-correcting lessons.
   * @param trajectory The captured agent execution trajectory.
   */
  critiqueTrajectory(trajectory: AgentTrajectory): Promise<ReflectionResult>;

  /**
   * Records a new lesson into the experience base.
   * @param record The experience record to store.
   */
  recordLesson(record: ExperienceRecord): Promise<void>;

  /**
   * Recalls past experience lessons associated with a trigger.
   * @param trigger Prompt trigger key.
   * @param tenantId Optional tenant identifier.
   */
  recallLessons(trigger: string, tenantId?: string): Promise<ExperienceRecord[]>;

  /**
   * Formats past experience lessons into prompt guidance instructions.
   * @param trigger Prompt trigger key.
   * @param tenantId Optional tenant identifier.
   */
  buildGuidancePrompt(trigger: string, tenantId?: string): Promise<string>;
}
