/**
 * Repository Inspector & Path Policy Governance.
 *
 * Provides generic, zero-trust security boundaries for code review ingestion:
 * 1. Path traversal and malformed filename sanitization (including percent-encoded paths).
 * 2. Strict allowlist for reviewable source, doc, and config file extensions.
 * 3. Comprehensive denylist for secret-bearing files (.env, keys, credentials, certificates).
 * 4. In-memory secret scrubbing before RAG indexing and LLM prompt assembly.
 * 5. Dynamic monorepo workspace directory discovery without hardcoded package names.
 */

export interface PathValidationResult {
  valid: boolean;
  sanitizedPath?: string;
  reason?: string;
}

export class RepositoryInspector {
  /**
   * Allowed file extensions for code review and RAG ingestion.
   */
  private static readonly ALLOWED_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
    '.md',
    '.mdx',
    '.yaml',
    '.yml',
    '.toml',
    '.sql',
    '.graphql',
    '.gql',
    '.html',
    '.css',
    '.scss',
    '.rs',
    '.go',
    '.py',
    '.java',
    '.kt',
    '.rb',
    '.php',
    '.cs',
    '.proto',
    '.txt',
  ]);

  /**
   * Allowed exact file names without extensions.
   */
  private static readonly ALLOWED_EXACT_FILENAMES = new Set([
    'dockerfile',
    'makefile',
    'procfile',
    '.gitignore',
    '.editorconfig',
    '.npmignore',
    '.dockerignore',
  ]);

  /**
   * Secret-bearing or sensitive file patterns that MUST never be fetched or ingested into RAG/LLMs.
   */
  private static readonly SECRET_DENYLIST_PATTERNS = [
    /^\.env(\..+)?$/i,
    /(^|\/)\.env(\..+)?$/i,
    /\.(pem|key|pkcs12|pfx|crt|cer|kdbx|keystore|jks)$/i,
    /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\..+)?$/i,
    /(^|\/)(credentials|secrets|service-account|client-secret|token)(\.json|\.yaml|\.yml)?$/i,
    /(^|\/)(kubeconfig|\.npmrc|\.pypirc|\.dockercfg|\.netrc)$/i,
    /(^|\/)\.docker\/config\.json$/i,
    /(^|\/)\.aws\//i,
    /(^|\/)\.ssh\//i,
    /(^|\/)\.gnupg\//i,
    /\.git(\/|$)/i,
    /package-lock\.json$/i,
    /pnpm-lock\.yaml$/i,
    /yarn\.lock$/i,
    /cargo\.lock$/i,
    /go\.sum$/i,
    /poetry\.lock$/i,
  ];

  /**
   * Patterns matching common plaintext secrets, tokens, and credentials for in-memory scrubbing.
   */
  private static readonly SECRET_CONTENT_SCRUBBERS: Array<{
    pattern: RegExp;
    replacement: string;
  }> = [
    { pattern: /sk-[a-zA-Z0-9_-]{10,}/g, replacement: '[REDACTED_SECRET_TOKEN]' },
    { pattern: /gh[pousr]_[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED_SECRET_TOKEN]' },
    { pattern: /github_pat_[a-zA-Z0-9_]{20,}/g, replacement: '[REDACTED_SECRET_TOKEN]' },
    { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_SECRET_TOKEN]' },
    {
      pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
      replacement: '[REDACTED_PRIVATE_KEY]',
    },
    { pattern: /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
    {
      pattern: /(mongodb(?:\+srv)?|postgres|postgresql|mysql|redis):\/\/[^:\s]+:[^@\s]+@/gi,
      replacement: '$1://[REDACTED_USER]:[REDACTED_PASSWORD]@',
    },
  ];

  /**
   * Maximum allowed file size for RAG ingestion (500 KB).
   */
  static readonly MAX_FILE_SIZE_BYTES = 500 * 1024;

  /**
   * Maximum number of files to ingest per review round.
   */
  static readonly MAX_INGESTION_FILES = 20;

  /**
   * Validates and sanitizes a relative repository file path.
   *
   * @param rawPath Candidate file path from git diff or manifest.
   * @returns PathValidationResult indicating if path is safe to ingest.
   */
  static validateAndSanitizePath(rawPath: string): PathValidationResult {
    if (!rawPath || typeof rawPath !== 'string') {
      return { valid: false, reason: 'Empty or invalid path type' };
    }

    // Safely decode any percent-encoded components first to prevent %2e%2e traversal bypasses
    let decoded = rawPath;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return { valid: false, reason: 'Malformed URI encoding in path' };
    }

    // Strip control characters, null bytes, and normalize slashes
    const sanitized = decoded.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim().replace(/\\/g, '/');

    // Reject path traversal, absolute paths, and double slashes
    if (
      sanitized.startsWith('/') ||
      sanitized.includes('..') ||
      sanitized.includes('//') ||
      sanitized.startsWith('./')
    ) {
      return { valid: false, reason: 'Path traversal or absolute path detected', sanitizedPath: sanitized };
    }

    // Check secret and sensitive denylist patterns
    for (const pattern of this.SECRET_DENYLIST_PATTERNS) {
      if (pattern.test(sanitized)) {
        return { valid: false, reason: 'Path matches sensitive/secret denylist pattern', sanitizedPath: sanitized };
      }
    }

    // Check extension or exact filename allowlist
    const fileName = sanitized.split('/').pop()?.toLowerCase() || '';
    if (this.ALLOWED_EXACT_FILENAMES.has(fileName)) {
      return { valid: true, sanitizedPath: sanitized };
    }

    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex === -1) {
      return { valid: false, reason: 'File has no extension and is not on allowlist', sanitizedPath: sanitized };
    }

    const ext = fileName.slice(dotIndex).toLowerCase();
    if (!this.ALLOWED_EXTENSIONS.has(ext)) {
      return { valid: false, reason: `Extension ${ext} is not on review allowlist`, sanitizedPath: sanitized };
    }

    // Skip declaration files (*.d.ts) as they contain no operational logic
    if (sanitized.endsWith('.d.ts')) {
      return { valid: false, reason: 'TypeScript declaration files skipped', sanitizedPath: sanitized };
    }

    return { valid: true, sanitizedPath: sanitized };
  }

  /**
   * Parses safe, reviewable file paths from a unified git diff.
   * Only target `b/` paths that exist in the post-change revision are included.
   *
   * @param diff Raw unified diff text.
   * @returns Deduplicated array of sanitized, valid file paths.
   */
  static parseSafeDiffPaths(diff: string): string[] {
    if (!diff) return [];
    const validPaths = new Set<string>();

    for (const line of diff.split('\n')) {
      // Match "+++ b/path/to/file" lines (target file state)
      const match = line.match(/^\+\+\+ b\/(.+)$/);
      if (match) {
        const candidate = match[1].trim();
        // Ignore deletions (/dev/null)
        if (candidate === '/dev/null') continue;

        const validation = this.validateAndSanitizePath(candidate);
        if (validation.valid && validation.sanitizedPath) {
          validPaths.add(validation.sanitizedPath);
        }
      }
    }

    return Array.from(validPaths);
  }

  /**
   * Scrubs plaintext credentials, private keys, and API tokens from file content.
   *
   * @param content Raw file string.
   * @returns Redacted content string safe for RAG vectorization and model prompts.
   */
  static redactSecrets(content: string): string {
    if (!content) return '';
    let scrubbed = content;

    for (const item of this.SECRET_CONTENT_SCRUBBERS) {
      scrubbed = scrubbed.replace(item.pattern, item.replacement);
    }

    return scrubbed;
  }

  /**
   * Dynamically discovers monorepo workspace directory roots (e.g. `['packages', 'apps', 'libs']`)
   * from root `package.json` content with runtime schema validation.
   *
   * @param rootPackageJsonContent Decoded content of root package.json.
   * @returns Array of relative directory roots.
   */
  static discoverWorkspaceDirectories(rootPackageJsonContent?: string): string[] {
    const directories: string[] = [];
    if (!rootPackageJsonContent) return directories;

    try {
      const parsed: unknown = JSON.parse(rootPackageJsonContent);
      if (typeof parsed !== 'object' || parsed === null) {
        return directories;
      }

      const pkg = parsed as Record<string, unknown>;
      let rawGlobs: unknown[] = [];

      if (Array.isArray(pkg.workspaces)) {
        rawGlobs = pkg.workspaces;
      } else if (
        typeof pkg.workspaces === 'object' &&
        pkg.workspaces !== null &&
        Array.isArray((pkg.workspaces as Record<string, unknown>).packages)
      ) {
        rawGlobs = (pkg.workspaces as { packages: unknown[] }).packages;
      }

      for (const item of rawGlobs) {
        if (typeof item === 'string') {
          // Normalize glob pattern like "packages/*" or "apps/*" into base directory name
          const cleanDir = item
            .replace(/\/\*+$/, '')
            .replace(/^\.\//, '')
            .trim();
          if (cleanDir && !cleanDir.includes('..') && !cleanDir.startsWith('/')) {
            directories.push(cleanDir);
          }
        }
      }
    } catch {
      // Gracefully return empty array on malformed JSON
    }

    return Array.from(new Set(directories));
  }
}
