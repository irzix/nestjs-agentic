/**
 * File role categorization for context-aware code review.
 */
export type FileRole = 'DOCUMENTATION' | 'TEST' | 'CONFIG' | 'SOURCE';

/**
 * Classifies a repository file path into its structural role with strict precedence.
 *
 * Precedence rules:
 * 1. TEST: Files in test directories or matching explicit test/spec suffixes (*.spec.*, *.test.*, test/**).
 * 2. SOURCE: Files inside source roots (packages/../src, apps/../src, src/..) unless ending in .md/.mdx.
 * 3. DOCUMENTATION: Markdown files (*.md, *.mdx) or dedicated docs directories not in src/.
 * 4. CONFIG: Build/config artifacts (*.json, *.yaml, *.yml, *.config.*, dot-rc files).
 * 5. Default: SOURCE (Zero-trust fallback).
 *
 * @param filePath Path of the file in the repository.
 * @returns Classified FileRole.
 */
export function classifyFileRole(filePath: string): FileRole {
  const sanitized = filePath.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim();
  const normalized = sanitized.replace(/\\/g, '/').toLowerCase();

  // 1. Tests take immediate precedence
  if (
    /(^|\/)(test|tests|__tests__)\//i.test(normalized) ||
    /\.(spec|test)\.[a-z0-9]+$/i.test(normalized)
  ) {
    return 'TEST';
  }

  // 2. Markdown and dedicated documentation files
  if (
    normalized.endsWith('.md') ||
    normalized.endsWith('.mdx') ||
    normalized.endsWith('.markdown') ||
    normalized.endsWith('.rst') ||
    normalized.endsWith('.txt')
  ) {
    return 'DOCUMENTATION';
  }

  // 3. Dedicated docs roots (if NOT inside a code source folder like /src/)
  const isInsideSrc = normalized.startsWith('src/') || normalized.includes('/src/');
  if (
    !isInsideSrc &&
    (normalized.startsWith('docs/') ||
      normalized.startsWith('content/') ||
      normalized.includes('/docs/') ||
      normalized.includes('/content/'))
  ) {
    return 'DOCUMENTATION';
  }

  // 4. Configuration and build files
  if (
    normalized.endsWith('.json') ||
    normalized.endsWith('.yaml') ||
    normalized.endsWith('.yml') ||
    normalized.endsWith('.toml') ||
    normalized.includes('.config.') ||
    /(^|\/)\.[^/]*rc(\.[a-z0-9]+)?$/i.test(normalized) ||
    /(^|\/)(dockerfile|\.gitignore|\.env\.example)$/i.test(normalized)
  ) {
    return 'CONFIG';
  }

  // 5. Default safe fallback is SOURCE
  return 'SOURCE';
}

/**
 * Prunes noisy, generated, lock, and binary diffs from the raw git diff before
 * presenting context to the LLM agent, annotating each retained file with safely JSON-encoded metadata.
 */
export class ContextPruner {
  private static readonly IGNORED_PATTERNS = [
    /\.lock$/i,
    /package-lock\.json$/i,
    /pnpm-lock\.yaml$/i,
    /yarn\.lock$/i,
    /\.min\.(js|css)$/i,
    /\.map$/i,
    /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i,
    /\.(pdf|zip|tar|gz|exe|dll|so|dylib)$/i,
  ];

  /**
   * Prunes a multi-file unified git diff string and annotates file roles.
   *
   * @param rawDiff Complete unified diff string.
   * @param maxLinesPerFile Max lines allowed per individual file diff (default: 350).
   * @returns Sanitized and pruned diff string with noise removed and JSON-serialized role annotations.
   */
  static pruneDiff(rawDiff: string, maxLinesPerFile = 350): { prunedDiff: string; ignoredFiles: string[]; truncatedFiles: string[] } {
    if (!rawDiff || rawDiff.trim().length === 0) {
      return { prunedDiff: '', ignoredFiles: [], truncatedFiles: [] };
    }

    const fileDiffs = rawDiff.split(/(?=^diff --git )/m);
    const retainedDiffs: string[] = [];
    const ignoredFiles: string[] = [];
    const truncatedFiles: string[] = [];

    for (const fileDiff of fileDiffs) {
      const match = fileDiff.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
      if (!match) {
        if (fileDiff.trim().length > 0) {
          retainedDiffs.push(fileDiff);
        }
        continue;
      }

      const filePath = match[2];
      const isIgnored = this.IGNORED_PATTERNS.some((pattern) => pattern.test(filePath));

      if (isIgnored) {
        ignoredFiles.push(filePath);
        continue;
      }

      const role = classifyFileRole(filePath);
      // Neutralize HTML comment delimiters and control characters, then serialize via JSON.stringify
      const safePath = filePath
        .replace(/-->/g, '--')
        .replace(/[\r\n\x00-\x1f\x7f]/g, '')
        .slice(0, 300);
      const metadataJson = JSON.stringify({ path: safePath, role });
      const roleHeader = `<!-- [FILE_METADATA: ${metadataJson}] -->\n`;

      const lines = fileDiff.split('\n');
      if (lines.length > maxLinesPerFile) {
        const truncated = roleHeader + lines.slice(0, maxLinesPerFile).join('\n') +
          `\n\n... [TRUNCATED: ${lines.length - maxLinesPerFile} lines omitted for file ${safePath}] ...\n`;
        retainedDiffs.push(truncated);
        truncatedFiles.push(filePath);
      } else {
        retainedDiffs.push(roleHeader + fileDiff);
      }
    }

    return {
      prunedDiff: retainedDiffs.join('\n'),
      ignoredFiles,
      truncatedFiles,
    };
  }
}
