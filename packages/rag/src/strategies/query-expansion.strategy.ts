import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

export type QueryExpanderFunction = (query: string) => Promise<string[]> | string[];

export interface QueryExpansionStrategyOptions {
  /** Optional dictionary mapping query terms to domain-specific synonyms. */
  synonymsMap?: Record<string, string[]>;
  /** Optional custom query expansion function (e.g. LLM-based query generator or thesaurus service). */
  expandQueryFn?: QueryExpanderFunction;
  /** Optional LLM provider function for automated query expansion. */
  llmProvider?: (prompt: string) => Promise<string>;
  /** Flag to enable or disable LLM-driven query expansion. Default: false */
  useLLM?: boolean;
}

/**
 * RAG Strategy that expands raw input queries into multiple semantic sub-queries using dictionaries,
 * custom functions, or LLM-driven query expansion.
 */
export class QueryExpansionStrategy implements RAGStrategy {
  readonly name = 'QueryExpansion';
  private readonly synonymsMap = new Map<string, string[]>();
  private readonly expandQueryFn?: QueryExpanderFunction;
  private readonly llmProvider?: (prompt: string) => Promise<string>;
  private readonly useLLM: boolean;

  constructor(options?: QueryExpansionStrategyOptions) {
    this.expandQueryFn = options?.expandQueryFn;
    this.llmProvider = options?.llmProvider;
    this.useLLM = options?.useLLM ?? false;

    if (options?.synonymsMap) {
      for (const [key, vals] of Object.entries(options.synonymsMap)) {
        this.synonymsMap.set(key.toLowerCase(), vals);
      }
    }
  }

  async process(context: RAGContext): Promise<RAGContext> {
    const rawQuery = context.query || '';
    const expanded = new Set<string>();
    expanded.add(rawQuery);

    // 1. LLM-based Query Expansion if useLLM is enabled
    if (this.useLLM && this.llmProvider) {
      try {
        const prompt = `Generate 3 semantically equivalent search queries for: "${rawQuery}". Output only comma-separated queries without numbering.`;
        const llmResponse = await this.llmProvider(prompt);
        const generatedQueries = llmResponse.split(',').map((q) => q.trim());
        for (const gq of generatedQueries) {
          if (gq) expanded.add(gq);
        }
      } catch {
        // Fallback gracefully if LLM provider call fails
      }
    }

    // 2. Custom expansion function if provided
    if (this.expandQueryFn) {
      const customExpanded = await this.expandQueryFn(rawQuery);
      for (const q of customExpanded) {
        if (q.trim()) expanded.add(q.trim());
      }
    }

    // 3. Dictionary synonym replacements if configured
    if (this.synonymsMap.size > 0) {
      const tokens = rawQuery.toLowerCase().split(/\s+/);
      for (const token of tokens) {
        const syns = this.synonymsMap.get(token);
        if (syns) {
          for (const s of syns) {
            expanded.add(rawQuery.replace(new RegExp(token, 'gi'), s));
          }
        }
      }
    }

    return {
      ...context,
      expandedQueries: Array.from(expanded),
    };
  }
}
