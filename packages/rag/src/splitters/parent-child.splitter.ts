import { randomUUID } from 'crypto';
import type { Document, DocumentChunk, DocumentSplitter } from '../interfaces/document.interface';

/**
 * Options for configuring ParentChildSplitter.
 */
export interface ParentChildSplitterOptions {
  /** Character length of parent document chunks. Default: `1000` */
  parentChunkSize?: number;

  /** Character length of child document chunks. Default: `200` */
  childChunkSize?: number;

  /** Character overlap between consecutive child chunks. Default: `50` */
  childOverlap?: number;
}

/**
 * Result payload containing generated parent and child document chunks.
 */
export interface ParentChildSplitResult {
  /** Array of parent DocumentChunk objects. */
  parentChunks: DocumentChunk[];

  /** Array of child DocumentChunk objects containing parent ID references. */
  childChunks: DocumentChunk[];
}

/**
 * Splitter that generates large parent chunks alongside smaller overlapping child chunks for precise retrieval.
 */
export class ParentChildSplitter implements DocumentSplitter {
  private readonly parentChunkSize: number;
  private readonly childChunkSize: number;
  private readonly childOverlap: number;

  /**
   * Creates a new instance of ParentChildSplitter.
   * @param options Configuration options for parent size, child size, and overlap.
   */
  constructor(options?: ParentChildSplitterOptions) {
    this.parentChunkSize = options?.parentChunkSize ?? 1000;
    this.childChunkSize = options?.childChunkSize ?? 200;
    this.childOverlap = options?.childOverlap ?? 50;
  }

  /**
   * Splits a Document into child DocumentChunks referencing parent chunk IDs.
   *
   * @param document The target Document object to split.
   * @returns Promise resolving to child DocumentChunk objects.
   */
  async splitDocument(document: Document): Promise<DocumentChunk[]> {
    const result = await this.splitParentChild(document);
    return result.childChunks;
  }

  /**
   * Performs full parent-child splitting returning both parent and child chunk arrays.
   *
   * @param document Target Document object.
   * @returns Promise resolving to ParentChildSplitResult.
   */
  async splitParentChild(document: Document): Promise<ParentChildSplitResult> {
    const raw = document.rawContent || '';
    if (!raw.trim()) {
      return { parentChunks: [], childChunks: [] };
    }

    const parentChunks: DocumentChunk[] = [];
    const childChunks: DocumentChunk[] = [];

    // Step 1: Slice parent chunks
    let parentStart = 0;
    let parentIndex = 0;
    while (parentStart < raw.length) {
      const parentEnd = Math.min(parentStart + this.parentChunkSize, raw.length);
      const parentContent = raw.slice(parentStart, parentEnd).trim();
      const parentId = `${document.id}_parent_${parentIndex}`;

      const parentChunk: DocumentChunk = {
        id: parentId,
        parentId: document.id,
        content: parentContent,
        metadata: { ...document.metadata, isParent: true, parentIndex },
      };
      parentChunks.push(parentChunk);

      // Step 2: Slice child chunks within this parent chunk
      let childStart = 0;
      let childIndex = 0;
      const step = Math.max(1, this.childChunkSize - this.childOverlap);

      while (childStart < parentContent.length) {
        const childEnd = Math.min(childStart + this.childChunkSize, parentContent.length);
        const childContent = parentContent.slice(childStart, childEnd).trim();

        if (childContent.length > 0) {
          childChunks.push({
            id: `${parentId}_child_${childIndex}`,
            parentId: parentId,
            content: childContent,
            metadata: {
              ...document.metadata,
              isChild: true,
              parentText: parentContent,
            },
          });
        }

        childStart += step;
        childIndex++;
      }

      parentStart += this.parentChunkSize;
      parentIndex++;
    }

    return { parentChunks, childChunks };
  }
}
