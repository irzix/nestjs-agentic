import { Injectable } from '@nestjs/common';
import {
  ExperienceLearner,
  ProceduralMemoryStore,
  StanfordMemoryScorer,
} from '@nestjs-agentic/memory';
import type { ExperienceRecord } from '@nestjs-agentic/memory';

/**
 * Service managing long-term cognitive memory, maintainer feedback learning,
 * and false-positive prevention for Njent code reviews.
 */
@Injectable()
export class NjentExperienceService {
  private readonly experienceLearner: ExperienceLearner;
  private readonly proceduralStore: ProceduralMemoryStore;

  constructor() {
    this.experienceLearner = new ExperienceLearner();
    this.proceduralStore = new ProceduralMemoryStore();
  }

  /**
   * Records a false-positive review rule or maintainer correction into episodic memory.
   *
   * @param rule Rule pattern (e.g. "Do not flag custom @UseAuth decorators as missing auth").
   * @param category Review domain category.
   * @param repo Repository identifier.
   */
  async recordMaintainerFeedback(rule: string, category: string, repo: string): Promise<void> {
    const record: ExperienceRecord = {
      id: `lesson_${Date.now()}`,
      tenantId: repo,
      agentName: 'njent-reviewer',
      taskTrigger: category,
      pattern: `False positive on ${category}`,
      lesson: rule,
      importance: 0.9,
      timestamp: new Date(),
    };

    await this.experienceLearner.recordLesson(record);
  }

  /**
   * Retrieves relevant historical maintainer lessons to prevent repeating past false-positives.
   *
   * @param trigger Contextual review query / category.
   * @returns Array of formatted lesson strings.
   */
  async getRelevantLessons(trigger: string): Promise<string[]> {
    const records = await this.experienceLearner.recallLessons(trigger);
    return records.map((r: ExperienceRecord) => r.lesson);
  }

  /**
   * Registers a procedural playbook / standard operating procedure (SOP) into procedural memory.
   *
   * @param name Name of the SOP.
   * @param steps Ordered list of required execution instructions.
   */
  async registerSOP(name: string, steps: string[]): Promise<void> {
    await this.proceduralStore.savePlaybook({
      id: `sop_${name.toLowerCase().replace(/\s+/g, '_')}`,
      name,
      description: `Standard operating procedure for ${name}`,
      triggers: [name.toLowerCase(), 'pr-review', 'governance'],
      steps: steps.map((s, idx) => ({
        stepNumber: idx + 1,
        title: `Step ${idx + 1}`,
        description: s,
      })),
    });
  }

  /**
   * Scores a memory record using the Stanford tri-factor algorithm.
   */
  scoreMemoryItem(record: { content: string; importance?: number; timestamp?: Date }, query: string): number {
    const scored = StanfordMemoryScorer.rankCandidates(
      [
        {
          id: 'rec_1',
          sessionId: 'test',
          type: 'episodic',
          content: record.content,
          importance: record.importance ?? 0.8,
          timestamp: record.timestamp ?? new Date(),
        },
      ],
      query,
    );
    return scored[0]?.score ?? 0;
  }
}
