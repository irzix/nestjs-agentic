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
 * Production-grade AST Codebase Splitter.
 *
 * Deconstructs TypeScript and JavaScript source code into discrete,
 * syntactically valid semantic units (classes, interfaces, functions, types, enums, imports)
 * preserving JSDoc comments, decorator hierarchies, line boundaries, and dependency metadata.
 *
 * @see Lewis et al. (NeurIPS 2020, arXiv:2005.11401)
 * @see Microsoft GraphRAG (Edge et al., arXiv:2404.16130)
 */
export class AstCodebaseSplitter implements DocumentSplitter {
  private readonly maxChunkSize: number;
  private readonly minChunkSize: number;
  private readonly splitClassMethods: boolean;

  // Simple, linear regular expressions immune to catastrophic backtracking (ReDoS)
  private static readonly RE_INTERFACE = /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/;
  private static readonly RE_TYPE_ALIAS = /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/;
  private static readonly RE_CLASS = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/;
  private static readonly RE_FUNCTION = /^(?:export\s+)?(?:async\s+)?function\s*(?:\*\s*)?([A-Za-z0-9_$]+)?\s*\(/;
  private static readonly RE_ARROW_FUNCTION =
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_$]+)(?:\s*:\s*[^=]+)?\s*=>\s*\{/;
  private static readonly RE_ENUM = /^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/;
  private static readonly RE_MODULE_SPECIFIER = /from\s+['"]([^'"]+)['"]|import\s*\(?['"]([^'"]+)['"]\)?/;

  private static readonly RESERVED_KEYWORDS = new Set([
    'class',
    'interface',
    'type',
    'enum',
    'export',
    'import',
    'return',
    'if',
    'else',
    'for',
    'while',
    'switch',
    'case',
    'break',
    'const',
    'let',
    'var',
  ]);

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
    if (!document || typeof document.rawContent !== 'string') {
      return [];
    }

    const rawContent = document.rawContent;
    if (rawContent.trim().length === 0) {
      return [];
    }

    const docId = document.id || `doc_${Date.now()}`;
    const fileName =
      document.title ||
      (typeof document.metadata?.filePath === 'string' ? document.metadata.filePath : 'source.ts');

    const lines = rawContent.split('\n');
    const chunks: DocumentChunk[] = [];
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
        id: `${docId}_ast_${chunkCounter}`,
        parentId: docId,
        content: content.trim(),
        metadata: {
          ...document.metadata,
          ...extraMetadata,
          filePath: fileName,
          nodeType,
          identifier,
          startLine,
          endLine,
        },
      };
    };

    // 1. Extract import block with bracket-depth tracking
    const importLines: string[] = [];
    let importStartLine = -1;
    let importEndLine = -1;
    let importBraceDepth = 0;
    let inImportStatement = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('//') || (trimmed.startsWith('/*') && !trimmed.includes('*/'))) {
        continue;
      }

      if (trimmed.startsWith('import ') || trimmed.startsWith('import(') || inImportStatement) {
        if (importStartLine === -1) importStartLine = i + 1;
        importLines.push(line);
        importEndLine = i + 1;
        inImportStatement = true;

        for (const ch of trimmed) {
          if (ch === '{') importBraceDepth++;
          else if (ch === '}') importBraceDepth--;
        }

        if (importBraceDepth <= 0 && (trimmed.endsWith(';') || trimmed.includes("from '") || trimmed.includes('from "'))) {
          inImportStatement = false;
        }
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

    // 2. Parse top-level declarations with single-pass O(N) scan
    let idx = 0;
    while (idx < lines.length) {
      const line = lines[idx];
      const trimmed = line.trim();

      if (trimmed.startsWith('import ') || trimmed.length === 0) {
        idx++;
        continue;
      }

      // Collect strictly associated leading JSDoc and decorators
      const leadingLines: string[] = [];
      const declStartLine = idx + 1;

      while (
        idx < lines.length &&
        (lines[idx].trim().startsWith('@') ||
          lines[idx].trim().startsWith('/**') ||
          lines[idx].trim().startsWith('*') ||
          lines[idx].trim().startsWith('*/') ||
          lines[idx].trim().startsWith('//'))
      ) {
        leadingLines.push(lines[idx]);
        idx++;
      }

      if (idx >= lines.length) break;

      const currentLine = lines[idx];
      const currentTrimmed = currentLine.trim();

      // Interface
      const interfaceMatch = currentTrimmed.match(AstCodebaseSplitter.RE_INTERFACE);
      if (interfaceMatch) {
        const interfaceName = interfaceMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx } = this.extractBracedBlock(lines, idx, leadingLines);

        chunks.push(
          createChunk(blockContent, 'interface', interfaceName, declStartLine, endLine, {
            exported: isExported,
          }),
        );
        idx = nextIdx;
        continue;
      }

      // Type Alias
      const typeMatch = currentTrimmed.match(AstCodebaseSplitter.RE_TYPE_ALIAS);
      if (typeMatch) {
        const typeName = typeMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { statementContent, endLine, nextIdx } = this.extractSemicolonStatement(lines, idx, leadingLines);

        chunks.push(
          createChunk(statementContent, 'type', typeName, declStartLine, endLine, {
            exported: isExported,
          }),
        );
        idx = nextIdx;
        continue;
      }

      // Class
      const classMatch = currentTrimmed.match(AstCodebaseSplitter.RE_CLASS);
      if (classMatch) {
        const className = classMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx, bodyLines } = this.extractBracedBlock(lines, idx, leadingLines);

        if (this.splitClassMethods && blockContent.length > this.maxChunkSize && bodyLines.length > 0) {
          const classSignature = `${leadingLines.join('\n')}\n${currentTrimmed.split('{')[0].trim()} { ... }`.trim();
          chunks.push(
            createChunk(classSignature, 'class', className, declStartLine, idx + 1, {
              exported: isExported,
              isClassSignature: true,
            }),
          );

          const methodChunks = this.splitClassMembers(bodyLines, className, idx + 2, isExported);
          for (const m of methodChunks) {
            chunks.push(
              createChunk(m.content, 'function', `${className}.${m.name}`, m.startLine, m.endLine, {
                parentClass: className,
                exported: isExported,
                isStatic: m.isStatic,
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

      // Standard Function
      const funcMatch = currentTrimmed.match(AstCodebaseSplitter.RE_FUNCTION);
      if (funcMatch) {
        const funcName = funcMatch[1] ?? 'anonymousFunction';
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx } = this.extractBracedBlock(lines, idx, leadingLines);

        chunks.push(
          createChunk(blockContent, 'function', funcName, declStartLine, endLine, {
            exported: isExported,
          }),
        );
        idx = nextIdx;
        continue;
      }

      // Arrow Function
      const arrowMatch = currentTrimmed.match(AstCodebaseSplitter.RE_ARROW_FUNCTION);
      if (arrowMatch) {
        const funcName = arrowMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx } = this.extractBracedBlock(lines, idx, leadingLines);

        chunks.push(
          createChunk(blockContent, 'function', funcName, declStartLine, endLine, {
            exported: isExported,
            isArrow: true,
          }),
        );
        idx = nextIdx;
        continue;
      }

      // Enum
      const enumMatch = currentTrimmed.match(AstCodebaseSplitter.RE_ENUM);
      if (enumMatch) {
        const enumName = enumMatch[1];
        const isExported = currentTrimmed.startsWith('export ');
        const { blockContent, endLine, nextIdx } = this.extractBracedBlock(lines, idx, leadingLines);

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
    leadingLines: string[],
  ): { blockContent: string; endLine: number; nextIdx: number; bodyLines: string[] } {
    let braceCount = 0;
    let foundOpenBrace = false;
    const blockLines: string[] = [...leadingLines];
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
        if (braceCount === 0) {
          break;
        } else if (i !== startIdx) {
          bodyLines.push(line);
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
    leadingLines: string[],
  ): { statementContent: string; endLine: number; nextIdx: number } {
    const stmtLines: string[] = [...leadingLines];
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

  /**
   * Linear, ReDoS-immune class member parser.
   */
  private splitClassMembers(
    bodyLines: string[],
    className: string,
    bodyStartLine: number,
    _isExported: boolean,
  ): Array<{ name: string; content: string; startLine: number; endLine: number; isStatic?: boolean }> {
    const members: Array<{ name: string; content: string; startLine: number; endLine: number; isStatic?: boolean }> = [];
    let i = 0;

    while (i < bodyLines.length) {
      const line = bodyLines[i];
      const trimmed = line.trim();

      if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        i++;
        continue;
      }

      const isStatic = /\bstatic\b/.test(trimmed);

      // Strip decorators: e.g. @Tool({ ... })
      let cleanLine = trimmed.replace(/^@\w+(?:\([^)]*\))?\s+/, '');
      // Strip access modifiers linearly
      cleanLine = cleanLine
        .replace(/^(?:public|private|protected|static|readonly|override|abstract|async)\s+/, '')
        .replace(/^(?:public|private|protected|static|readonly|override|abstract|async)\s+/, '')
        .replace(/^(?:get|set)\s+/, '');

      const memberNameMatch = cleanLine.match(/^(constructor|#?[A-Za-z0-9_$]+)/);

      if (memberNameMatch) {
        const memberName = memberNameMatch[1];
        if (AstCodebaseSplitter.RESERVED_KEYWORDS.has(memberName)) {
          i++;
          continue;
        }

        const mStartLine = bodyStartLine + i;

        // Check if property statement without braces
        if (trimmed.includes(';') && !trimmed.includes('{')) {
          if (trimmed.length >= this.minChunkSize) {
            members.push({
              name: memberName,
              content: `// Property in class ${className}\n${trimmed}`,
              startLine: mStartLine,
              endLine: mStartLine,
              isStatic,
            });
          }
          i++;
          continue;
        }

        let braceCount = 0;
        let foundOpen = false;
        const methodLines: string[] = [];

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
            isStatic,
          });
        }
      }
      i++;
    }

    return members;
  }

  private extractImportModuleNames(importLines: string[]): string[] {
    const modules: string[] = [];
    const text = importLines.join('\n');
    const regex = new RegExp(AstCodebaseSplitter.RE_MODULE_SPECIFIER.source, 'g');
    let match;

    while ((match = regex.exec(text)) !== null) {
      const mod = match[1] ?? match[2];
      if (mod) modules.push(mod);
    }

    return Array.from(new Set(modules));
  }
}
