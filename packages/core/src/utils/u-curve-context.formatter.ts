/**
 * Context attention priority tiers based on the empirical U-shaped attention distribution.
 *
 * @see Liu et al., "Lost in the Middle" (Stanford & UC Berkeley, TACL 2024)
 */
export type UCurvePriority = 'critical_primacy' | 'high' | 'medium_reference' | 'critical_recency';

/**
 * Represents a discrete section of an LLM prompt with an associated attention priority.
 */
export interface UCurvePromptSection {
  /** Optional identifier for the prompt section */
  id?: string;
  /** Section heading or markdown title */
  title?: string;
  /** Text content of the prompt section */
  content: string;
  /** Attention priority classification determining U-curve placement */
  priority: UCurvePriority;
  /** Secondary tie-breaker order index within the same priority tier */
  order?: number;
}

/**
 * Options configuring UCurveContextFormatter assembly.
 */
export interface UCurveFormatOptions {
  /** Separator between sections. Default: `'\n\n---\n\n'` */
  sectionSeparator?: string;
  /** Whether to render section titles as Markdown headers (`### Title`). Default: `true` */
  renderTitles?: boolean;
  /** Optional global prompt header */
  globalHeader?: string;
  /** Optional global prompt footer */
  globalFooter?: string;
}

/**
 * Production utility for structuring agent prompt tokens according to empirical U-shaped attention curves.
 * Mitigates "Lost in the Middle" degradation by placing critical governance invariants at the start (Primacy)
 * and target tasks/immediate instructions at the end (Recency).
 */
export class UCurveContextFormatter {
  /**
   * Priority rank mapping:
   * 1. 'critical_primacy' -> Top (0)
   * 2. 'high' -> Upper-middle (1)
   * 3. 'medium_reference' -> Center valley (2)
   * 4. 'critical_recency' -> Bottom (3)
   */
  private static readonly PRIORITY_ORDER: Record<UCurvePriority, number> = {
    critical_primacy: 0,
    high: 1,
    medium_reference: 2,
    critical_recency: 3,
  };

  /**
   * Formats and assembles an array of prompt sections into the optimal U-curve attention sequence.
   *
   * @param sections Array of prompt sections with designated attention priorities.
   * @param options Assembly and formatting options.
   * @returns Fully formatted prompt string structured for maximum attention adherence.
   */
  static assemblePrompt(
    sections: UCurvePromptSection[],
    options?: UCurveFormatOptions,
  ): string {
    if (!sections || sections.length === 0) {
      return '';
    }

    const separator = options?.sectionSeparator ?? '\n\n';
    const renderTitles = options?.renderTitles ?? true;

    // Filter out empty sections
    const validSections = sections.filter((s) => s && s.content && s.content.trim().length > 0);

    // Group sections by priority
    const grouped: Record<UCurvePriority, UCurvePromptSection[]> = {
      critical_primacy: [],
      high: [],
      medium_reference: [],
      critical_recency: [],
    };

    for (const section of validSections) {
      grouped[section.priority].push(section);
    }

    // Sort within each group by secondary order
    for (const key of Object.keys(grouped) as UCurvePriority[]) {
      grouped[key].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    // Sequence in U-shape order: Primacy -> High -> Medium Reference -> Recency
    const orderedSections: UCurvePromptSection[] = [
      ...grouped.critical_primacy,
      ...grouped.high,
      ...grouped.medium_reference,
      ...grouped.critical_recency,
    ];

    const formattedParts = orderedSections.map((sec) => {
      const content = sec.content.trim();
      if (renderTitles && sec.title) {
        return `### ${sec.title.trim()}\n${content}`;
      }
      return content;
    });

    const finalParts: string[] = [];
    if (options?.globalHeader) {
      finalParts.push(options.globalHeader.trim());
    }
    finalParts.push(...formattedParts);
    if (options?.globalFooter) {
      finalParts.push(options.globalFooter.trim());
    }

    return finalParts.join(separator);
  }

  /**
   * Distributes an array of generic items into a U-shaped sequence based on a numeric priority score.
   *
   * @param items Array of candidate items.
   * @param scoreExtractor Function extracting priority score (higher score = higher priority).
   * @param placementStrategy 'primacy_first' places #1 score at top, 'recency_first' at bottom.
   * @returns U-shaped reordered array.
   */
  static reorderToUCurve<T>(
    items: T[],
    scoreExtractor: (item: T) => number,
    placementStrategy: 'primacy_first' | 'recency_first' = 'primacy_first',
  ): T[] {
    if (!items || items.length <= 2) {
      return items ? [...items] : [];
    }

    const sorted = [...items].sort((a, b) => scoreExtractor(b) - scoreExtractor(a));
    const n = sorted.length;
    const result: T[] = new Array(n);

    let left = 0;
    let right = n - 1;

    if (placementStrategy === 'primacy_first') {
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) {
          result[left] = sorted[i];
          left++;
        } else {
          result[right] = sorted[i];
          right--;
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) {
          result[right] = sorted[i];
          right--;
        } else {
          result[left] = sorted[i];
          left++;
        }
      }
    }

    return result;
  }
}
