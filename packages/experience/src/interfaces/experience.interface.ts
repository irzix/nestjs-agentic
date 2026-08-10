export interface TrajectoryStep {
  stepIndex: number;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp?: Date;
}

export interface AgentTrajectory {
  sessionId: string;
  agentName: string;
  goal: string;
  steps: TrajectoryStep[];
  success: boolean;
}

export interface ReflectionResult {
  success: boolean;
  critique?: string;
  lessonsLearned: string[];
  suggestedPromptAdjustment?: string;
}

export interface ExperienceRecord {
  id: string;
  tenantId?: string;
  agentName: string;
  taskTrigger: string;
  pattern: string;
  lesson: string;
  score?: number;
  timestamp?: Date;
}

export interface ExperienceEngine {
  critiqueTrajectory(trajectory: AgentTrajectory): Promise<ReflectionResult>;
  recordLesson(record: ExperienceRecord): Promise<void>;
  recallLessons(trigger: string, tenantId?: string): Promise<ExperienceRecord[]>;
  buildGuidancePrompt(trigger: string, tenantId?: string): Promise<string>;
}
