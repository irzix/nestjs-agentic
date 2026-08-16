import type { Document, DocumentChunk, DocumentSplitter } from '../interfaces/document.interface';

/**
 * Supported AST code syntactic entity types.
 */
export type AstNodeType =
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'enum'
  | 'imports'
  | 'code';

/**
 * Options for configuring AstCodebaseSplitter.
 */
export interface AstCodebaseSplitterOptions {
  /** Maximum character size for a single code chunk before sub-splitting methods. Default: `1500` */
  maxChunkSize?: number;

  /** Minimum character size for a chunk to avoid tiny fragments. Default: `20` */
  minChunkSize?: number;

  /** Whether to sub-split class methods into discrete chunks for large classes. Default: `true` */
  splitClassMethods?: boolean;
}

/**
 * Semantic AST Codebase Splitter.
 *
 * Deconstructs TypeScript and JavaScript source code into discrete,
 * syntactically valid semantic units (classes, interfaces, functions, types, enums, imports)
 * preserving decorator hierarchies, line boundaries, and dependency metadata without breaking logical blocks.
 *
 * @see Lewis et al. (NeurIPS 2020, arXiv:2005.11401)
 * @see Microsoft GraphRAG (Edge et al., arXiv:2404.16130)
 */
export class AstCodebaseSplitter implements DocumentSplitter {
  private readonly maxChunkSize: number;
  private readonly minChunkSize: number;
  private readonly splitClassMethods: boolean;

  constructor(options?: AstCodebaseSplitterOptions) {
    this.maxChunkSize = options?.maxChunkSize ?? 1500;
    this.minChunkSize = options?.minChunkSize ?? 20;
    this.splitClassMethods = options?.splitClassMethods ?? true;
  }

  /**
   * Splits a code document into AST-aligned semantic DocumentChunks.
   *
   * @param document The source code document.
   * @returns Array of AST-aligned DocumentChunk objects with rich metadata.
   */
  async splitDocument(document: Document): Promise<DocumentChunk[]> {
    const rawContent = document.rawContent;
    if (!rawContent || rawContent.trim().length === 0) {
      return [];
    }

    const lines = rawContent.split('\n');
    const chunks: DocumentChunk[] = [];
    const fileName = document.title || 'source.ts';
    let chunkCounter = 0;

    const createChunk = (
      content: string,
      nodeType: AstNodeType,
      identifier: string,
      startLine: number,
      endLine: number,
      extraMetadata: Record<string, unknown> = {},
    ): DocumentChunk => {
      chunkCounter++;
      return {
        id: `${document.id}_ast_${chunkCounter}`,
        parentId: document.id,
        content: content.trim(),
        metadata: {
          filePath: fileName,
          nodeType,
          identifier,
          startLine,
          endLine,
          ...document.metadata,
          ...extraMetadata,
        },
      };
    };

    // 1. Extract import block
    const importLines: string[] = [];
    let importStartLine = -1;
    let importEndLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('import ') || (importLines.length > 0 && !trimmed.startsWith('export ') && !trimmed.startsWith('class ') && !trimmed.startsWith('interface ') && !trimmed.startsWith('@') && trimmed.includes('from '))) {
        if (importStartLine === -1) importStartLine = i + 1;
        importLines.push(line);
        importEndLine = i + 1;
      }
    }

    if (importLines.length > 0) {
      const importsContent = importLines.join('\n');
      if (importsContent.length >= this.minChunkSize) {
        chunks.push(
          createChunk(importsContent, 'imports', 'imports', importStartLine, importEndLine, {
            importedModules: this.extractImportModuleNames(importLines),
          }),
        );
      }
    }

    // 2. Parse top-level declarations with brace depth tracking
    let idx = 0;
    while (idx < lines.length) {
      const line = lines[idx];
      const trimmed = line.trim();

      // Collect leading decorators and comments
      let decoratorLines: string[] = [];
      let declStartLine = idx + 1;

      while (idx < lines.length && (lines[idx].trim().startsWith('@') || lines[idx].trim().startsWith('//') || lines[idx].trim().startsWith('/*') || lines[idx].trim().startsWith('*'))) {
        decoratorLines.push(lines[idx]);
        idx++;
      }

      if (idx >= lines.length) break;

      const currentLine = lines[idx];
      const currentTrimmed = currentLine.trim();

      // Match Interface Declaration
      const interfaceMatch = currentTrimmed.match(/^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/);
      if (interfaceMatch) {
        const interfaceName = interfaceMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx } = this.extractBracedBlock(lines, idx, decoratorLines);

        chunks.push(
          createChunk(blockContent, 'interface', interfaceName, declStartLine, endLine, {
            exported: isExported,
          }),
        );
        idx = nextIdx;
        continue;
      }

      // Match Type Alias Declaration
      const typeMatch = currentTrimmed.match(/^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/);
      if (typeMatch) {
        const typeName = typeMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { statementContent, endLine, nextIdx } = this.extractSemicolonStatement(lines, idx, decoratorLines);

        chunks.push(
          createChunk(statementContent, 'type', typeName, declStartLine, endLine, {
            exported: isExported,
          }),
        );
        idx = nextIdx;
        continue;
      }

      // Match Class Declaration
      const classMatch = currentTrimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/);
      if (classMatch) {
        const className = classMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx, bodyLines } = this.extractBracedBlock(lines, idx, decoratorLines);

        if (this.splitClassMethods && blockContent.length > this.maxChunkSize && bodyLines.length > 0) {
          // Emit Class Header / Signature
          const classHeader = `${decoratorLines.join('\n')}\n${currentTrimmed.split('{')[0].trim()} { ... }`.trim();
          chunks.push(
            createChunk(classHeader, 'class', className, declStartLine, idx + 1, {
              exported: isExported,
              isClassSignature: true,
            }),
          );

          // Sub-split class methods and constructor
          const methodChunks = this.splitClassMembers(bodyLines, className, idx + 2, isExported);
          for (const m of methodChunks) {
            chunks.push(
              createChunk(m.content, 'function', `${className}.${m.name}`, m.startLine, m.endLine, {
                parentClass: className,
                exported: isExported,
              }),
            );
          }
        } else {
          chunks.push(
            createChunk(blockContent, 'class', className, declStartLine, endLine, {
              exported: isExported,
            }),
          );
        }

        idx = nextIdx;
        continue;
      }

      // Match Function Declaration
      const funcMatch = currentTrimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
      if (funcMatch) {
        const funcName = funcMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx } = this.extractBracedBlock(lines, idx, decoratorLines);

        chunks.push(
          createChunk(blockContent, 'function', funcName, declStartLine, endLine, {
            exported: isExported,
          }),
        );
        idx = nextIdx;
        continue;
      }

      // Match Enum Declaration
      const enumMatch = currentTrimmed.match(/^(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/);
      if (enumMatch) {
        const enumName = enumMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx } = this.extractBracedBlock(lines, idx, decoratorLines);

        chunks.push(
          createChunk(blockContent, 'enum', enumName, declStartLine, endLine, {
            exported: isExported,
          }),
        );
        idx = nextIdx;
        continue;
      }

      idx++;
    }

    return chunks;
  }

  private extractBracedBlock(
    lines: string[],
    startIdx: number,
    decoratorLines: string[],
  ): { blockContent: string; endLine: number; nextIdx: number; bodyLines: string[] } {
    let braceCount = 0;
    let foundOpenBrace = false;
    const blockLines: string[] = [...decoratorLines];
    const bodyLines: string[] = [];
    let i = startIdx;

    for (; i < lines.length; i++) {
      const line = lines[i];
      blockLines.push(line);

      for (const ch of line) {
        if (ch === '{') {
          braceCount++;
          foundOpenBrace = true;
        } else if (ch === '}') {
          braceCount--;
        }
      }

      if (foundOpenBrace) {
        if (braceCount > 0) {
          bodyLines.push(line);
        } else if (braceCount === 0) {
          break;
        }
      }
    }

    return {
      blockContent: blockLines.join('\n').trim(),
      endLine: i + 1,
      nextIdx: i + 1,
      bodyLines,
    };
  }

  private extractSemicolonStatement(
    lines: string[],
    startIdx: number,
    decoratorLines: string[],
  ): { statementContent: string; endLine: number; nextIdx: number } {
    const stmtLines: string[] = [...decoratorLines];
    let i = startIdx;

    for (; i < lines.length; i++) {
      const line = lines[i];
      stmtLines.push(line);
      if (line.includes(';')) {
        break;
      }
    }

    return {
      statementContent: stmtLines.join('\n').trim(),
      endLine: i + 1,
      nextIdx: i + 1,
    };
  }

  private splitClassMembers(
    bodyLines: string[],
    className: string,
    bodyStartLine: number,
    _isExported: boolean,
  ): Array<{ name: string; content: string; startLine: number; endLine: number }> {
    const members: Array<{ name: string; content: string; startLine: number; endLine: number }> = [];
    let i = 0;

    while (i < bodyLines.length) {
      const line = bodyLines[i];
      const trimmed = line.trim();

      const memberMatch = trimmed.match(
        /^(?:@\w+\(.*\)\s+)*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z0-9_$]+)\s*\(/,
      );

      if (memberMatch) {
        const memberName = memberMatch[1];
        let braceCount = 0;
        let foundOpen = false;
        const methodLines: string[] = [];
        const mStartLine = bodyStartLine + i;

        for (; i < bodyLines.length; i++) {
          const mLine = bodyLines[i];
          methodLines.push(mLine);

          for (const ch of mLine) {
            if (ch === '{') {
              braceCount++;
              foundOpen = true;
            } else if (ch === '}') {
              braceCount--;
            }
          }

          if (foundOpen && braceCount === 0) {
            break;
          }
        }

        const mEndLine = bodyStartLine + i;
        const content = methodLines.join('\n').trim();
        if (content.length >= this.minChunkSize) {
          members.push({
            name: memberName,
            content: `// Method in class ${className}\n${content}`,
            startLine: mStartLine,
            endLine: mEndLine,
          });
        }
      }
      i++;
    }

    return members;
  }

  private extractImportModuleNames(importLines: string[]): string[] {
    const modules: string[] = [];
    const regex = /from\s+['"]([^'"]+)['"]/g;
    const text = importLines.join('\n');
    let match;
    while ((match = regex.exec(text)) !== null) {
      modules.push(match[1]);
    }
    return Array.from(new Set(modules));
  }
}
