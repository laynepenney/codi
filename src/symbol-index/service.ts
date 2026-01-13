/**
 * Symbol Index Service
 *
 * Main service class that orchestrates symbol extraction, indexing,
 * and querying. Uses the existing symbolification system from model-map.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import { SymbolDatabase, getIndexDirectory } from './database.js';
import type {
  FileSymbolInfo,
  CodeSymbol,
  ImportStatement,
  IndexBuildOptions,
  IndexStats,
  SymbolSearchResult,
  ReferenceResult,
  DependencyResult,
  InheritanceResult,
} from './types.js';

// Import extractors from model-map
import { RegexSymbolExtractor } from '../model-map/symbols/regex-extractor.js';

// Import tsconfig resolver
import {
  loadTsConfig,
  resolveWithTsConfig,
  type ResolvedTsConfig,
} from './tsconfig-resolver.js';

// Default file patterns
const DEFAULT_INCLUDE_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.kt',  // Kotlin
  '**/*.kts', // Kotlin script
];

const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.min.js',
];

/**
 * Hash a file's contents for change detection
 */
function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve import path to actual file
 */
function resolveImportPath(
  importPath: string,
  fromFile: string,
  projectRoot: string,
  tsconfig?: ResolvedTsConfig | null
): string | undefined {
  const fromDir = path.dirname(fromFile);

  // Try tsconfig paths resolution FIRST (most accurate)
  if (tsconfig) {
    const resolved = resolveWithTsConfig(importPath, fromFile, projectRoot, tsconfig);
    if (resolved) {
      return resolved;
    }
  }

  // Fall back to hardcoded patterns for common aliases
  // @/ alias - commonly maps to project root, src/, or app/
  if (importPath.startsWith('@/')) {
    const aliasPath = importPath.slice(2); // Remove @/
    // Try common alias targets
    const aliasTargets = [
      path.join(projectRoot, aliasPath),
      path.join(projectRoot, 'src', aliasPath),
      path.join(projectRoot, 'app', aliasPath),
      path.join(projectRoot, 'web', aliasPath),
      path.join(projectRoot, 'web', 'app', aliasPath),
    ];

    for (const target of aliasTargets) {
      const resolved = tryResolveWithExtensions(target);
      if (resolved) return resolved;
    }
    return undefined;
  }

  // @components, @lib, etc. - common named aliases
  if (importPath.startsWith('@') && !importPath.includes('/node_modules/')) {
    const parts = importPath.slice(1).split('/');
    const aliasName = parts[0];
    const restPath = parts.slice(1).join('/');

    // Common alias mappings
    const commonAliases: Record<string, string[]> = {
      'components': ['components', 'src/components', 'app/components'],
      'lib': ['lib', 'src/lib', 'app/lib'],
      'utils': ['utils', 'src/utils', 'lib/utils'],
      'hooks': ['hooks', 'src/hooks'],
      'types': ['types', 'src/types'],
    };

    const targets = commonAliases[aliasName];
    if (targets) {
      for (const target of targets) {
        const fullPath = path.join(projectRoot, target, restPath);
        const resolved = tryResolveWithExtensions(fullPath);
        if (resolved) return resolved;
      }
    }
    return undefined;
  }

  // Skip external packages (no . or / prefix and not an alias)
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    // Check if it might be a Kotlin package import
    if (fromFile.endsWith('.kt') || fromFile.endsWith('.kts')) {
      return resolveKotlinImport(importPath, projectRoot);
    }
    return undefined;
  }

  // Relative import
  let resolved: string;
  if (importPath.startsWith('.')) {
    resolved = path.resolve(fromDir, importPath);
  } else {
    resolved = path.resolve(projectRoot, importPath);
  }

  return tryResolveWithExtensions(resolved);
}

/**
 * Try to resolve a path with various extensions
 */
function tryResolveWithExtensions(basePath: string): string | undefined {
  const extensions = [
    '', // exact match
    '.ts', '.tsx', '.js', '.jsx', '.kt', '.kts',
    '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
  ];

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }

  return undefined;
}

/**
 * Resolve Kotlin package import to file path
 * Kotlin imports like: party.jldance.shared.network.ApiClient
 */
function resolveKotlinImport(importPath: string, projectRoot: string): string | undefined {
  // Convert package path to potential file paths
  // e.g., party.jldance.shared.network.ApiClient -> .../party/jldance/shared/network/ApiClient.kt
  const parts = importPath.split('.');
  const className = parts[parts.length - 1];
  const packagePath = parts.slice(0, -1).join('/');

  // Common Kotlin source roots - including multi-module and KMP patterns
  const sourceRoots = [
    // Standard single-module
    'src/main/kotlin',
    'src/main/java', // Kotlin files can be in java directories

    // Kotlin Multiplatform (KMP)
    'src/commonMain/kotlin',
    'src/androidMain/kotlin',
    'src/iosMain/kotlin',
    'src/jvmMain/kotlin',
    'src/jsMain/kotlin',
    'src/nativeMain/kotlin',

    // Multi-module patterns (glob-like, we'll expand them)
    'app/src/main/kotlin',
    'core/src/main/kotlin',
    'shared/src/main/kotlin',
    'shared/src/commonMain/kotlin',
    'shared/src/androidMain/kotlin',
    'shared/src/iosMain/kotlin',

    // Mobile-specific multi-module
    'mobile/shared/src/commonMain/kotlin',
    'mobile/shared/src/androidMain/kotlin',
    'mobile/shared/src/iosMain/kotlin',
    'mobile/androidApp/src/main/kotlin',
    'mobile/iosApp/src/main/kotlin',

    // Common module name patterns
    'modules/core/src/main/kotlin',
    'modules/shared/src/main/kotlin',
    'modules/app/src/main/kotlin',
    'features/*/src/main/kotlin', // Will need glob expansion
  ];

  for (const root of sourceRoots) {
    const filePath = path.join(projectRoot, root, packagePath, `${className}.kt`);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return undefined;
}

/**
 * Symbol Index Service
 */
export class SymbolIndexService {
  private db: SymbolDatabase;
  private projectRoot: string;
  private extractor: RegexSymbolExtractor;
  private initialized: boolean = false;
  private tsconfig: ResolvedTsConfig | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.db = new SymbolDatabase(this.projectRoot);
    this.extractor = new RegexSymbolExtractor();
  }

  /**
   * Initialize the index service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load tsconfig for path alias resolution
    this.tsconfig = loadTsConfig(this.projectRoot);

    // Store project root in metadata
    this.db.setMetadata('project_root', this.projectRoot);
    this.initialized = true;
  }

  /**
   * Check if the index is stale (needs update)
   */
  isStale(maxAgeMinutes: number = 5): boolean {
    const lastUpdate = this.db.getMetadata('last_update');
    if (!lastUpdate) return true;

    const lastUpdateTime = new Date(lastUpdate).getTime();
    const now = Date.now();
    const ageMinutes = (now - lastUpdateTime) / (1000 * 60);

    return ageMinutes > maxAgeMinutes;
  }

  /**
   * Check if index exists and has data
   */
  hasIndex(): boolean {
    const stats = this.db.getStats();
    return stats.totalFiles > 0;
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return this.db.getStats();
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ============================================================================
  // Index Building
  // ============================================================================

  /**
   * Build or rebuild the full index
   */
  async rebuild(options: Partial<IndexBuildOptions> = {}): Promise<{
    filesProcessed: number;
    symbolsExtracted: number;
    duration: number;
    errors: string[];
  }> {
    const startTime = Date.now();
    const errors: string[] = [];

    const includePatterns = options.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;

    // Find all matching files
    const files = await glob(includePatterns, {
      cwd: this.projectRoot,
      ignore: excludePatterns,
      absolute: true,
    });

    // Clear existing data
    this.db.clear();

    let filesProcessed = 0;
    let symbolsExtracted = 0;

    // Process files in a transaction
    this.db.transaction(() => {
      for (const filePath of files) {
        try {
          const relativePath = path.relative(this.projectRoot, filePath);
          const content = fs.readFileSync(filePath, 'utf-8');
          const hash = crypto.createHash('md5').update(content).digest('hex');

          // Extract symbols
          const fileInfo = this.extractor.extract(content, relativePath);

          // Insert file
          const fileId = this.db.upsertFile(relativePath, hash, fileInfo.extractionMethod);

          // Insert symbols
          for (const symbol of fileInfo.symbols) {
            this.db.insertSymbol({
              fileId,
              name: symbol.name,
              kind: symbol.kind,
              line: symbol.line,
              endLine: symbol.endLine,
              visibility: symbol.visibility,
              signature: symbol.signature,
              docSummary: symbol.docSummary,
              metadata: {
                parent: symbol.parent,
                typeParams: symbol.typeParams,
                extends: symbol.extends,
                params: symbol.params,
                returnType: symbol.returnType,
              },
            });
            symbolsExtracted++;
          }

          // Insert imports
          for (const imp of fileInfo.imports) {
            const resolvedPath = resolveImportPath(imp.source, filePath, this.projectRoot, this.tsconfig);
            let resolvedFileId: number | undefined;

            if (resolvedPath) {
              const resolvedRelative = path.relative(this.projectRoot, resolvedPath);
              const resolvedFile = this.db.getFile(resolvedRelative);
              resolvedFileId = resolvedFile?.id;
            }

            const importId = this.db.insertImport({
              fileId,
              sourcePath: imp.source,
              resolvedFileId,
              isTypeOnly: imp.isTypeOnly,
              line: imp.line,
            });

            // Insert import symbols
            for (const sym of imp.symbols) {
              this.db.insertImportSymbol({
                importId,
                name: sym.name,
                alias: sym.alias,
                isDefault: sym.isDefault ?? false,
                isNamespace: sym.isNamespace,
              });
            }
          }

          filesProcessed++;
          options.onProgress?.(filesProcessed, files.length, relativePath);
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Build dependency edges (second pass for resolved file IDs)
      this.buildDependencyEdges();
    });

    // Update metadata
    const now = new Date().toISOString();
    this.db.setMetadata('last_rebuild', now);
    this.db.setMetadata('last_update', now);

    return {
      filesProcessed,
      symbolsExtracted,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Build file dependency edges from imports
   */
  private buildDependencyEdges(): void {
    const files = this.db.getAllFiles();
    const filePathToId = new Map<string, number>();

    for (const file of files) {
      filePathToId.set(file.path, file.id);
    }

    // For each file, resolve its imports and create dependency edges
    for (const file of files) {
      const filePath = path.join(this.projectRoot, file.path);
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
      const fileInfo = this.extractor.extract(content, file.path);

      for (const imp of fileInfo.imports) {
        const resolvedPath = resolveImportPath(imp.source, filePath, this.projectRoot, this.tsconfig);
        if (resolvedPath) {
          const resolvedRelative = path.relative(this.projectRoot, resolvedPath);
          const toFileId = filePathToId.get(resolvedRelative);

          if (toFileId) {
            this.db.insertDependency({
              fromFileId: file.id,
              toFileId,
              type: 'import',
            });
          }
        }
      }
    }
  }

  /**
   * Incremental update - only process changed files
   */
  async incrementalUpdate(options: Partial<IndexBuildOptions> = {}): Promise<{
    added: number;
    modified: number;
    removed: number;
    duration: number;
  }> {
    const startTime = Date.now();

    const includePatterns = options.includePatterns ?? DEFAULT_INCLUDE_PATTERNS;
    const excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;

    // Get current files
    const currentFiles = await glob(includePatterns, {
      cwd: this.projectRoot,
      ignore: excludePatterns,
      absolute: false,
    });
    const currentFileSet = new Set(currentFiles);

    // Get indexed files
    const indexedFiles = this.db.getAllFiles();
    const indexedFileMap = new Map(indexedFiles.map(f => [f.path, f]));

    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    // Find added and modified files
    for (const file of currentFiles) {
      const fullPath = path.join(this.projectRoot, file);
      const currentHash = hashFile(fullPath);
      const indexed = indexedFileMap.get(file);

      if (!indexed) {
        added.push(file);
      } else if (indexed.hash !== currentHash) {
        modified.push(file);
      }
    }

    // Find removed files
    for (const indexed of indexedFiles) {
      if (!currentFileSet.has(indexed.path)) {
        removed.push(indexed.path);
      }
    }

    // Apply updates
    this.db.transaction(() => {
      // Remove deleted files
      for (const file of removed) {
        this.db.deleteFile(file);
      }

      // Process added and modified files
      for (const file of [...added, ...modified]) {
        const fullPath = path.join(this.projectRoot, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const hash = crypto.createHash('md5').update(content).digest('hex');

        // Delete existing data if modified
        if (modified.includes(file)) {
          this.db.deleteFile(file);
        }

        // Extract and insert
        const fileInfo = this.extractor.extract(content, file);
        const fileId = this.db.upsertFile(file, hash, fileInfo.extractionMethod);

        for (const symbol of fileInfo.symbols) {
          this.db.insertSymbol({
            fileId,
            name: symbol.name,
            kind: symbol.kind,
            line: symbol.line,
            endLine: symbol.endLine,
            visibility: symbol.visibility,
            signature: symbol.signature,
            docSummary: symbol.docSummary,
            metadata: {
              parent: symbol.parent,
              typeParams: symbol.typeParams,
              extends: symbol.extends,
              params: symbol.params,
              returnType: symbol.returnType,
            },
          });
        }

        for (const imp of fileInfo.imports) {
          const importId = this.db.insertImport({
            fileId,
            sourcePath: imp.source,
            isTypeOnly: imp.isTypeOnly,
            line: imp.line,
          });

          for (const sym of imp.symbols) {
            this.db.insertImportSymbol({
              importId,
              name: sym.name,
              alias: sym.alias,
              isDefault: sym.isDefault ?? false,
              isNamespace: sym.isNamespace,
            });
          }
        }
      }

      // Rebuild dependency edges if there were changes
      if (added.length > 0 || modified.length > 0 || removed.length > 0) {
        // Clear and rebuild dependencies
        this.db.getDb().exec('DELETE FROM file_dependencies');
        this.buildDependencyEdges();
      }
    });

    // Update metadata
    this.db.setMetadata('last_update', new Date().toISOString());

    return {
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // Query Methods (used by tools)
  // ============================================================================

  /**
   * Find symbols by name
   */
  findSymbols(
    name: string,
    options: {
      kind?: string;
      exact?: boolean;
      exportedOnly?: boolean;
      limit?: number;
    } = {}
  ): SymbolSearchResult[] {
    const results = this.db.findSymbols(name, options);

    return results.map(r => ({
      name: r.name,
      kind: r.kind,
      file: r.file,
      line: r.line,
      endLine: r.endLine,
      visibility: r.visibility,
      signature: r.signature,
      docSummary: r.docSummary,
    }));
  }

  /**
   * Find references to a symbol
   */
  findReferences(
    symbolName: string,
    options: {
      file?: string;
      includeImports?: boolean;
      includeCallsites?: boolean;
      limit?: number;
    } = {}
  ): ReferenceResult[] {
    const { includeImports = true, includeCallsites = true, limit = 20 } = options;
    const results: ReferenceResult[] = [];

    // Find import references
    if (includeImports) {
      const importers = this.db.findImporters(symbolName);
      for (const imp of importers) {
        results.push({
          file: imp.file,
          line: imp.line,
          type: imp.isTypeOnly ? 'type-only' : 'import',
        });
      }
    }

    // Find callsites/usages
    if (includeCallsites) {
      const callsites = this.findCallsites(symbolName, options.file);
      for (const site of callsites) {
        // Avoid duplicates with imports (same file and line)
        const isDupe = results.some(r => r.file === site.file && r.line === site.line);
        if (!isDupe) {
          results.push(site);
        }
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Find callsites (usages) of a symbol in the codebase
   */
  private findCallsites(symbolName: string, definitionFile?: string): ReferenceResult[] {
    const results: ReferenceResult[] = [];
    const files = this.db.getAllFiles();

    // Patterns to search for:
    // - Function calls: symbolName(
    // - Method calls: .symbolName(
    // - Property access: .symbolName
    // - Type usage: : symbolName, <symbolName>, extends symbolName, implements symbolName
    // - Object instantiation: new symbolName(
    const callPattern = new RegExp(
      `(?:^|[^a-zA-Z0-9_])` + // Word boundary (not preceded by identifier chars)
      `(?:new\\s+)?` + // Optional "new" keyword
      `${escapeRegex(symbolName)}` +
      `(?:\\s*[(<]|\\s*$|[^a-zA-Z0-9_])`, // Followed by ( or < or end/non-identifier
      'gm'
    );

    for (const file of files) {
      // Skip the definition file itself
      if (definitionFile && file.path === definitionFile) {
        continue;
      }

      const fullPath = path.join(this.projectRoot, file.path);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip import/export lines - those are handled separately
          if (/^\s*(import|export)\s/.test(line)) continue;

          if (callPattern.test(line)) {
            // Reset regex lastIndex for next test
            callPattern.lastIndex = 0;

            // Extract context (trimmed line content)
            const context = line.trim().slice(0, 60) + (line.trim().length > 60 ? '...' : '');

            results.push({
              file: file.path,
              line: i + 1,
              type: 'usage',
              context,
            });
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Get dependency graph for a file
   */
  getDependencyGraph(
    filePath: string,
    direction: 'imports' | 'importedBy' | 'both',
    depth: number = 1
  ): DependencyResult[] {
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(this.projectRoot, filePath)
      : filePath;

    const results: DependencyResult[] = [];

    if (direction === 'imports' || direction === 'both') {
      const deps = this.db.getDependencyGraph(relativePath, 'imports', depth);
      for (const dep of deps) {
        results.push({
          file: dep.file,
          direction: 'imports',
          depth: dep.depth,
          type: dep.type as 'import' | 'dynamic-import' | 're-export',
        });
      }
    }

    if (direction === 'importedBy' || direction === 'both') {
      const deps = this.db.getDependencyGraph(relativePath, 'importedBy', depth);
      for (const dep of deps) {
        results.push({
          file: dep.file,
          direction: 'importedBy',
          depth: dep.depth,
          type: dep.type as 'import' | 'dynamic-import' | 're-export',
        });
      }
    }

    return results;
  }

  /**
   * Go to definition of a symbol
   */
  gotoDefinition(
    symbolName: string,
    options: {
      fromFile?: string;
      resolveReexports?: boolean;
    } = {}
  ): SymbolSearchResult | undefined {
    // First try exact match
    const results = this.db.findSymbols(symbolName, {
      exact: true,
      limit: 10,
    });

    if (results.length === 0) {
      return undefined;
    }

    // If fromFile is provided, prefer definitions in the same file or imported files
    if (options.fromFile) {
      const relativePath = path.isAbsolute(options.fromFile)
        ? path.relative(this.projectRoot, options.fromFile)
        : options.fromFile;

      // Check if any result is in the same file
      const sameFile = results.find(r => r.file === relativePath);
      if (sameFile) {
        return {
          name: sameFile.name,
          kind: sameFile.kind,
          file: sameFile.file,
          line: sameFile.line,
          endLine: sameFile.endLine,
          visibility: sameFile.visibility,
          signature: sameFile.signature,
          docSummary: sameFile.docSummary,
        };
      }
    }

    // Return the first (most relevant) result
    const best = results[0];
    return {
      name: best.name,
      kind: best.kind,
      file: best.file,
      line: best.line,
      endLine: best.endLine,
      visibility: best.visibility,
      signature: best.signature,
      docSummary: best.docSummary,
    };
  }

  /**
   * Get inheritance hierarchy for a class/interface
   */
  getInheritance(
    name: string,
    direction: 'ancestors' | 'descendants' | 'both'
  ): InheritanceResult[] {
    const results: InheritanceResult[] = [];

    // Find the symbol first
    const symbols = this.db.findSymbols(name, {
      exact: true,
      kind: undefined, // Could be class or interface
      limit: 10,
    });

    if (symbols.length === 0) {
      return results;
    }

    // For ancestors, look at the 'extends' metadata
    if (direction === 'ancestors' || direction === 'both') {
      for (const sym of symbols) {
        if (sym.metadata && Array.isArray((sym.metadata as any).extends)) {
          for (const ext of (sym.metadata as any).extends) {
            // Find the extended class/interface
            const extSymbols = this.db.findSymbols(ext, { exact: true, limit: 1 });
            if (extSymbols.length > 0) {
              results.push({
                name: ext,
                kind: extSymbols[0].kind as 'class' | 'interface',
                file: extSymbols[0].file,
                line: extSymbols[0].line,
                direction: 'extends',
              });
            }
          }
        }
      }
    }

    // For descendants, search all symbols that extend this one
    if (direction === 'descendants' || direction === 'both') {
      const allSymbols = this.db.findSymbols('', { limit: 1000 }); // Get all symbols
      for (const sym of allSymbols) {
        if (sym.metadata && Array.isArray((sym.metadata as any).extends)) {
          if ((sym.metadata as any).extends.includes(name)) {
            results.push({
              name: sym.name,
              kind: sym.kind as 'class' | 'interface',
              file: sym.file,
              line: sym.line,
              direction: sym.kind === 'interface' ? 'implemented-by' : 'extended-by',
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Get the database for advanced queries
   */
  getDatabase(): SymbolDatabase {
    return this.db;
  }
}
