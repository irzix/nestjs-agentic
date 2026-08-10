import { randomUUID } from 'crypto';
import type { Document, DocumentChunk, DocumentSplitter } from '../interfaces/document.interface';

export interface ParentChildSplitterOptions {
  parentChunkSize?: number;
  parentChunkOverlap?: number;
  childChunkSize?: number;
  childChunkOverlap?: number;
  /** Whether to embed full parent text into child chunk metadata. Default: true */
  includeParentTextInMetadata?: boolean;
}

export interface ParentChildSplitResult {
  parentChunks: DocumentChunk[];
  childChunks: DocumentChunk[];
}

/**
 * Creates small child chunks (high-precision vector search) linked directly to larger parent chunks (high-context LLM retrieval)
 * with word-boundary preservation and sliding window chunk overlap.
 */
export class ParentChildSplitter implements DocumentSplitter {
  private readonly parentChunkSize: number;
  private readonly parentChunkOverlap: number;
  private readonly childChunkSize: number;
  private readonly childChunkOverlap: number;
  private readonly includeParentTextInMetadata: boolean;

  constructor(options?: ParentChildSplitterOptions) {
    this.parentChunkSize = options?.parentChunkSize ?? 1000;
    this.parentChunkOverlap = options?.parentChunkOverlap ?? 100;
    this.childChunkSize = options?.childChunkSize ?? 200;
    this.childChunkOverlap = options?.childChunkOverlap ?? 20;
    this.includeParentTextInMetadata = options?.includeParentTextInMetadata ?? true;
  }

  async splitDocument(document: Document): Promise<DocumentChunk[]> {
    const { childChunks } = await this.splitParentChild(document);
    return childChunks;
  }

  /**
   * Adjusts slice boundary to nearest whitespace to avoid severing words in half.
   */
  private adjustSliceBoundary(text: string, start: number, end: number): string {
    const rawSlice = text.slice(start, end);
    if (end >= text.length) return rawSlice.trim();

    const lastSpace = rawSlice.lastIndexOf(' ');
    if (lastSpace > rawSlice.length * 0.5) {
      return rawSlice.slice(0, lastSpace).trim();
    }
    return rawSlice.trim();
  }

  async splitParentChild(document: Document): Promise<ParentChildSplitResult> {
    const raw = document.rawContent || '';
    const parentChunks: DocumentChunk[] = [];
    const childChunks: DocumentChunk[] = [];

    let pos = 0;
    let parentIndex = 0;
    const parentStep = Math.max(this.parentChunkSize - this.parentChunkOverlap, 1);

    while (pos < raw.length) {
      const parentText = this.adjustSliceBoundary(raw, pos, pos + this.parentChunkSize);
      if (!parentText) break;

      const parentId = `${document.id}_parent_${parentIndex}_${randomUUID().slice(0, 8)}`;
      const parentChunk: DocumentChunk = {
        id: parentId,
        parentId: document.id,
        content: parentText,
        metadata: {
          ...document.metadata,
          isParent: true,
          parentIndex,
          documentTitle: document.title,
        },
      };
      parentChunks.push(parentChunk);

      let childPos = 0;
      let childIndex = 0;
      const childStep = Math.max(this.childChunkSize - this.childChunkOverlap, 1);

      while (childPos < parentText.length) {
        const childText = this.adjustSliceBoundary(parentText, childPos, childPos + this.childChunkSize);
        if (!childText) break;

        childChunks.push({
          id: `${parentId}_child_${childIndex}_${randomUUID().slice(0, 8)}`,
          parentId,
          content: childText,
          metadata: {
            ...document.metadata,
            isParent: false,
            childIndex,
            documentTitle: document.title,
            ...(this.includeParentTextInMetadata ? { parentText } : {}),
          },
        });

        if (childPos + this.childChunkSize >= parentText.length) break;
        childPos += childStep;
        childIndex++;
      }

      if (pos + this.parentChunkSize >= raw.length) break;
      pos += parentStep;
      parentIndex++;
    }

    return { parentChunks, childChunks };
  }
}
