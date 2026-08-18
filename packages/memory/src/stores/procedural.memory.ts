import { randomUUID } from 'crypto';
import type {
  AgentMemoryStore,
  MemoryQueryOptions,
  MemoryRecord,
} from '../interfaces/memory.interface';
import type {
  PlaybookMatchOptions,
  ProceduralPlaybook,
  ScoredPlaybook,
} from '../interfaces/procedural.interface';

export interface ProceduralMemoryOptions {
  initialPlaybooks?: ProceduralPlaybook[];
}

/**
 * Procedural Memory Store for saving, retrieving, matching, and formatting
 * deterministic Standard Operating Procedures (SOPs) and workflow playbooks.
 */
export class ProceduralMemoryStore implements AgentMemoryStore {
  private readonly playbooks = new Map<string, ProceduralPlaybook>();

  constructor(options?: ProceduralMemoryOptions) {
    if (options?.initialPlaybooks) {
      for (const pb of options.initialPlaybooks) {
        this.playbooks.set(pb.id, pb);
      }
    }
  }

  /**
   * Saves or updates a procedural playbook in memory.
   *
   * @param playbook The procedural playbook structure to store.
   */
  async savePlaybook(playbook: ProceduralPlaybook): Promise<void> {
    const item: ProceduralPlaybook = {
      ...playbook,
      id: playbook.id || randomUUID(),
      updatedAt: new Date(),
      createdAt: playbook.createdAt || new Date(),
    };
    this.playbooks.set(item.id, item);
  }

  /**
   * Retrieves a procedural playbook by unique identifier.
   *
   * @param id Playbook identifier string.
   * @returns The matching playbook or `null` if not found.
   */
  async getPlaybook(id: string): Promise<ProceduralPlaybook | null> {
    return this.playbooks.get(id) ?? null;
  }

  /**
   * Deletes a procedural playbook by unique identifier.
   *
   * @param id Playbook identifier string to remove.
   * @returns `true` if a playbook was deleted, `false` otherwise.
   */
  async deletePlaybook(id: string): Promise<boolean> {
    return this.playbooks.delete(id);
  }

  /**
   * Lists all registered procedural playbooks.
   *
   * @returns Array of all stored `ProceduralPlaybook` definitions.
   */
  async listPlaybooks(): Promise<ProceduralPlaybook[]> {
    return Array.from(this.playbooks.values());
  }

  /**
   * Matches and ranks procedural playbooks against a query trigger or topic.
   *
   * @param query Search query text or array of trigger keywords.
   * @param options Match options (limit, score cutoff, prerequisite filters).
   * @returns Ranked array of `ScoredPlaybook` entries sorted descending by match score.
   */
  async matchPlaybooks(
    query: string | string[],
    options?: PlaybookMatchOptions,
  ): Promise<ScoredPlaybook[]> {
    const queryList = (Array.isArray(query) ? query : [query])
      .map((q) => q.toLowerCase().trim())
      .filter(Boolean);

    if (queryList.length === 0) {
      return [];
    }

    const minScore = options?.minMatchScore ?? 0.1;
    const limit = options?.limit ?? 5;
    const scoredList: ScoredPlaybook[] = [];

    for (const playbook of this.playbooks.values()) {
      // Check prerequisite filter
      if (options?.prerequisitesFilter && options.prerequisitesFilter.length > 0) {
        const required = options.prerequisitesFilter;
        const available = playbook.prerequisites ?? [];
        const hasAll = required.every((req) => available.includes(req));
        if (!hasAll) continue;
      }

      let maxScore = 0;
      const matchedTriggers: string[] = [];
      const pbTriggers = (playbook.triggers ?? []).map((t) => t.toLowerCase());
      const pbName = playbook.name.toLowerCase();
      const pbDesc = playbook.description.toLowerCase();

      for (const q of queryList) {
        // 1. Exact trigger match
        for (const trigger of pbTriggers) {
          if (trigger === q) {
            maxScore = Math.max(maxScore, 1.0);
            matchedTriggers.push(trigger);
          } else if (trigger.includes(q) || q.includes(trigger)) {
            maxScore = Math.max(maxScore, 0.85);
            matchedTriggers.push(trigger);
          }
        }

        // 2. Name match
        if (pbName.includes(q)) {
          maxScore = Math.max(maxScore, 0.75);
        }

        // 3. Description keyword overlap
        if (pbDesc.includes(q)) {
          maxScore = Math.max(maxScore, 0.50);
        }
      }

      if (maxScore >= minScore) {
        scoredList.push({
          playbook,
          matchScore: Math.round(maxScore * 100) / 100,
          matchedTriggers: Array.from(new Set(matchedTriggers)),
        });
      }
    }

    // Sort descending by match score
    scoredList.sort((a, b) => b.matchScore - a.matchScore);
    return scoredList.slice(0, limit);
  }

  /**
   * Formats a procedural playbook into structured Markdown SOP prompt guidance.
   *
   * @param playbook The target procedural playbook.
   * @returns Formatted Markdown string containing goal, prerequisites, and ordered steps.
   */
  formatPlaybookInstructions(playbook: ProceduralPlaybook): string {
    const lines: string[] = [];
    lines.push(`### Standard Operating Procedure: ${playbook.name}${playbook.version ? ` (v${playbook.version})` : ''}`);
    lines.push(`**Goal:** ${playbook.description}`);

    if (playbook.prerequisites && playbook.prerequisites.length > 0) {
      lines.push(`**Prerequisites:** ${playbook.prerequisites.join(', ')}`);
    }

    lines.push(`\n**Execution Steps:**`);
    const sortedSteps = [...playbook.steps].sort((a, b) => a.stepNumber - b.stepNumber);

    for (const step of sortedSteps) {
      const toolPart = step.toolName ? ` [Tool: \`${step.toolName}\`]` : '';
      lines.push(`${step.stepNumber}. **${step.title}**${toolPart}`);
      lines.push(`   - ${step.description}`);
      if (step.validationCondition) {
        lines.push(`   - *Validation Criteria:* ${step.validationCondition}`);
      }
      if (step.onFailure) {
        lines.push(`   - *On Failure:* \`${step.onFailure}\``);
      }
    }

    return lines.join('\n');
  }

  // --- AgentMemoryStore Contract Implementation ---

  async save(record: MemoryRecord): Promise<void> {
    if (record.metadata?.playbook) {
      await this.savePlaybook(record.metadata.playbook as ProceduralPlaybook);
      return;
    }

    // Convert flat memory record to single-step procedural playbook if applicable
    const playbook: ProceduralPlaybook = {
      id: record.id,
      name: (record.metadata?.name as string) ?? `Procedure ${record.id}`,
      description: record.content,
      triggers: (record.metadata?.triggers as string[]) ?? [record.content],
      steps: [
        {
          stepNumber: 1,
          title: 'Execute Action',
          description: record.content,
        },
      ],
      createdAt: record.timestamp,
    };
    await this.savePlaybook(playbook);
  }

  async recall(query: string, options?: MemoryQueryOptions): Promise<MemoryRecord[]> {
    const matched = await this.matchPlaybooks(query, {
      limit: options?.limit,
      minMatchScore: options?.minScoreCutoff,
    });

    return matched.map((m) => ({
      id: m.playbook.id,
      sessionId: options?.sessionId ?? 'global_procedural',
      type: 'procedural',
      content: this.formatPlaybookInstructions(m.playbook),
      metadata: {
        playbook: m.playbook,
        matchScore: m.matchScore,
        matchedTriggers: m.matchedTriggers,
      },
      timestamp: m.playbook.updatedAt ?? m.playbook.createdAt,
    }));
  }

  async clear(_sessionId?: string): Promise<void> {
    this.playbooks.clear();
  }
}
