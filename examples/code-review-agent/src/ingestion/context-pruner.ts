/**
 * Prunes noisy, generated, lock, and binary diffs from the raw git diff before
 * presenting context to the LLM agent.
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
   * Prunes a multi-file unified git diff string.
   *
   * @param rawDiff Complete unified diff string.
   * @param maxLinesPerFile Max lines allowed per individual file diff (default: 350).
   * @returns Sanitized and pruned diff string with noise removed.
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

      const lines = fileDiff.split('\n');
      if (lines.length > maxLinesPerFile) {
        const truncated = lines.slice(0, maxLinesPerFile).join('\n') +
          `\n\n... [TRUNCATED: ${lines.length - maxLinesPerFile} lines omitted for file ${filePath}] ...\n`;
        retainedDiffs.push(truncated);
        truncatedFiles.push(filePath);
      } else {
        retainedDiffs.push(fileDiff);
      }
    }

    return {
      prunedDiff: retainedDiffs.join('\n'),
      ignoredFiles,
      truncatedFiles,
    };
  }
}
