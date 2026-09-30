import { randomUUID } from 'crypto';
import type { AgentMemoryStore } from '../interfaces/memory.interface';
import type {
  AgentTrajectory,
  ExperienceEngine,
  ExperienceRecord,
  ReflectionResult,
} from '../interfaces/experience.interface';
import { ReflectionEngine, type ReflectionEngineOptions } from './reflection.engine';

export interface ExperienceLearnerOptions {
  /** Optional memory store for persisting learned lessons */
  memoryStore?: AgentMemoryStore;
  /** Options configuring the underlying ReflectionEngine */
  reflectionOptions?: ReflectionEngineOptions;
  /**
   * Upper bound on lessons kept in the in-process fallback cache, across all
   * tenants. The least recently written lessons are evicted first. `0`
   * disables the cache. Default: 1000.
   */
  maxFallbackRecords?: number;
}

/** Scope used for lessons recorded without a tenant. */
const GLOBAL_SCOPE = 'global_experience';
const DEFAULT_MAX_FALLBACK_RECORDS = 1000;

/**
 * Trajectory experience learner that critiques execution traces, extracts
 * self-correcting rules, and persists them into cognitive memory.
 *
 * Lessons are isolated per tenant: a lesson recorded for one tenant is never
 * recalled for another, whether it comes from the memory store or from the
 * in-process fallback cache.
 */
export class ExperienceLearner implements ExperienceEngine {
  private readonly memoryStore?: AgentMemoryStore;
  private readonly reflectionEngine: ReflectionEngine;
  private readonly maxFallbackRecords: number;
  /** Keyed by tenant scope and trigger; see `fallbackKey`. */
  private readonly fallbackStore = new Map<string, ExperienceRecord[]>();
  private fallbackSize = 0;

  constructor(options?: ExperienceLearnerOptions) {
    this.memoryStore = options?.memoryStore;
    this.reflectionEngine = new ReflectionEngine(options?.reflectionOptions);
    const max = options?.maxFallbackRecords ?? DEFAULT_MAX_FALLBACK_RECORDS;
    if (!Number.isInteger(max) || max < 0) {
      throw new Error(`maxFallbackRecords must be a non-negative integer, received ${max}.`);
    }
    this.maxFallbackRecords = max;
  }

  /**
   * Evaluates an agent execution trajectory, extracts lessons learned from errors,
   * and automatically persists them into long-term memory for future self-correction.
   *
   * Lessons are stored under `trajectory.tenantId`, or under `trajectory.sessionId`
   * when no tenant is given.
   *
   * @param trajectory The captured execution trajectory.
   * @returns Analytical critique and extracted rules.
   */
  async critiqueTrajectory(trajectory: AgentTrajectory): Promise<ReflectionResult> {
    const reflection = await this.reflectionEngine.critiqueTrajectory(trajectory);

    if (!reflection.success && reflection.lessonsLearned.length > 0) {
      for (const lesson of reflection.lessonsLearned) {
        await this.recordLesson({
          id: randomUUID(),
          tenantId: trajectory.tenantId ?? trajectory.sessionId,
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
   * Persists a learned lesson or failure pattern into memory.
   *
   * @param record The experience record to store.
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
        sessionId: item.tenantId ?? GLOBAL_SCOPE,
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

    this.cacheFallback(item);
  }

  /**
   * Records a successful pattern or best practice into cognitive memory.
   *
   * @param taskTrigger Task description or trigger keyword.
   * @param bestPractice Recommended practice learned from successful execution.
   * @param options Additional metadata and importance score.
   */
  async recordBestPractice(
    taskTrigger: string,
    bestPractice: string,
    options?: { agentName?: string; tenantId?: string; importance?: number },
  ): Promise<void> {
    await this.recordLesson({
      id: randomUUID(),
      agentName: options?.agentName ?? 'governed-agent',
      tenantId: options?.tenantId,
      taskTrigger,
      pattern: 'Successful Execution Pattern',
      lesson: bestPractice,
      importance: options?.importance ?? 0.65,
      timestamp: new Date(),
    });
  }

  /**
   * Recalls past learned lessons matching a task trigger, scoped to one tenant.
   *
   * Only lessons recorded under the same `tenantId` are returned; omitting it
   * reads the global scope, which holds lessons recorded without a tenant.
   *
   * @param trigger Prompt trigger key or task description.
   * @param tenantId Optional tenant or session identifier.
   * @returns Array of matching `ExperienceRecord` entries.
   */
  async recallLessons(trigger: string, tenantId?: string): Promise<ExperienceRecord[]> {
    const fallbackRecords = [...(this.fallbackStore.get(fallbackKey(tenantId, trigger)) ?? [])];

    if (this.memoryStore) {
      const recalled = await this.memoryStore.recall(trigger, {
        sessionId: tenantId ?? GLOBAL_SCOPE,
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
   *
   * Each lesson is rendered as a single bounded line, so a stored lesson cannot
   * break out of the list or smuggle extra prompt sections in with newlines.
   *
   * @param trigger Prompt trigger key or task description.
   * @param tenantId Optional tenant or session identifier.
   * @returns Formatted prompt guidance markdown string.
   */
  async buildGuidancePrompt(trigger: string, tenantId?: string): Promise<string> {
    const experiences = await this.recallLessons(trigger, tenantId);
    const lessons = experiences
      .map((e) => toGuidanceLine(e.lesson))
      .filter((line) => line.length > 0);
    if (lessons.length === 0) {
      return '';
    }

    return `\n[Historical Trajectory Guidance & Learned Rules]:\n${lessons.map((l) => `- ${l}`).join('\n')}\n`;
  }

  /** Adds a lesson to the bounded fallback cache under its tenant scope. */
  private cacheFallback(item: ExperienceRecord): void {
    if (this.maxFallbackRecords === 0) {
      return;
    }
    const key = fallbackKey(item.tenantId, item.taskTrigger);
    const bucket = this.fallbackStore.get(key) ?? [];
    bucket.push(item);
    // Re-inserting moves the bucket to the end, so the first key is always the
    // least recently written one and is evicted first.
    this.fallbackStore.delete(key);
    this.fallbackStore.set(key, bucket);
    this.fallbackSize++;

    while (this.fallbackSize > this.maxFallbackRecords) {
      const oldestKey = this.fallbackStore.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.fallbackStore.get(oldestKey) ?? [];
      oldest.shift();
      this.fallbackSize--;
      if (oldest.length === 0) {
        this.fallbackStore.delete(oldestKey);
      }
    }
  }
}

const MAX_GUIDANCE_LINE_LENGTH = 300;

/** Builds the fallback cache key. NUL never appears in a real tenant id, so scopes cannot collide. */
function fallbackKey(tenantId: string | undefined, trigger: string): string {
  return `${tenantId ?? GLOBAL_SCOPE}\u0000${trigger.toLowerCase()}`;
}

/** Flattens a lesson to one line without control characters, capped in length. */
function toGuidanceLine(lesson: string): string {
  const flat = lesson
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_GUIDANCE_LINE_LENGTH
    ? `${flat.slice(0, MAX_GUIDANCE_LINE_LENGTH - 1)}…`
    : flat;
}
