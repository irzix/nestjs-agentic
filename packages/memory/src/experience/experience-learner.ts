import { randomUUID } from 'crypto';
import type { AgentMemoryStore } from '../interfaces/memory.interface';
import type {
  AgentTrajectory,
  ExperienceEngine,
  ExperienceRecord,
  ReflectionResult,
} from '../interfaces/experience.interface';
import { ReflectionEngine } from './reflection.engine';

export interface ExperienceLearnerOptions {
  memoryStore?: AgentMemoryStore;
}

/**
 * Trajectory experience learner that critiques execution traces, extracts
 * self-correcting rules, and persists them into cognitive memory.
 */
export class ExperienceLearner implements ExperienceEngine {
  private readonly memoryStore?: AgentMemoryStore;
  private readonly reflectionEngine: ReflectionEngine;
  private readonly fallbackStore = new Map<string, ExperienceRecord[]>();

  constructor(options?: ExperienceLearnerOptions) {
    this.memoryStore = options?.memoryStore;
    this.reflectionEngine = new ReflectionEngine();
  }

  /**
   * Evaluates an agent execution trajectory, extracts lessons learned from errors,
   * and automatically persists them into long-term memory for future self-correction.
   */
  async critiqueTrajectory(trajectory: AgentTrajectory): Promise<ReflectionResult> {
    const reflection = await this.reflectionEngine.critiqueTrajectory(trajectory);

    if (!reflection.success && reflection.lessonsLearned.length > 0) {
      for (const lesson of reflection.lessonsLearned) {
        await this.recordLesson({
          id: randomUUID(),
          tenantId: trajectory.sessionId,
          agentName: trajectory.agentName,
          taskTrigger: trajectory.goal,
          pattern: reflection.critique ?? 'Execution Failure',
          lesson,
          importance: reflection.importance ?? 0.5,
          timestamp: new Date(),
        });
      }
    }

    return reflection;
  }

  /**
   * Persists a learned lesson into memory or fallback storage.
   */
  async recordLesson(record: ExperienceRecord): Promise<void> {
    const item: ExperienceRecord = {
      ...record,
      id: record.id || randomUUID(),
      importance: record.importance ?? 0.5,
      timestamp: record.timestamp || new Date(),
    };

    if (this.memoryStore) {
      await this.memoryStore.save({
        id: item.id,
        sessionId: item.tenantId ?? 'global_experience',
        type: 'episodic',
        importance: item.importance,
        content: `[Learned Lesson for ${item.taskTrigger}]: ${item.lesson}`,
        metadata: {
          agentName: item.agentName,
          taskTrigger: item.taskTrigger,
          pattern: item.pattern,
          lesson: item.lesson,
          importance: item.importance,
        },
      });
    }

    const triggerKey = item.taskTrigger.toLowerCase();
    const existing = this.fallbackStore.get(triggerKey) ?? [];
    existing.push(item);
    this.fallbackStore.set(triggerKey, existing);
  }

  /**
   * Recalls past learned lessons matching a task trigger or session tenant.
   */
  async recallLessons(trigger: string, tenantId?: string): Promise<ExperienceRecord[]> {
    const triggerKey = trigger.toLowerCase();
    const fallbackRecords = this.fallbackStore.get(triggerKey) ?? [];

    if (this.memoryStore) {
      const recalled = await this.memoryStore.recall(trigger, {
        sessionId: tenantId ?? 'global_experience',
      });
      const memoryRecords: ExperienceRecord[] = recalled.map((r) => ({
        id: r.id,
        tenantId: r.sessionId,
        agentName: (r.metadata?.agentName as string) ?? 'unknown',
        taskTrigger: (r.metadata?.taskTrigger as string) ?? trigger,
        pattern: (r.metadata?.pattern as string) ?? 'Historical Pattern',
        lesson: (r.metadata?.lesson as string) ?? r.content,
        importance: r.importance ?? (r.metadata?.importance as number) ?? 0.5,
        timestamp: r.timestamp,
      }));

      return memoryRecords.length > 0 ? memoryRecords : fallbackRecords;
    }

    return fallbackRecords;
  }

  /**
   * Formats relevant experiences into prompt guidance for an agent before execution.
   */
  async buildGuidancePrompt(trigger: string, tenantId?: string): Promise<string> {
    const experiences = await this.recallLessons(trigger, tenantId);
    if (experiences.length === 0) {
      return '';
    }

    const lessons = experiences.map((e) => `- ${e.lesson}`).join('\n');
    return `\n[Historical Trajectory Guidance & Learned Rules]:\n${lessons}\n`;
  }
}
