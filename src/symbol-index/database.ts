/**
 * SQLite database wrapper for the symbol index.
 * Handles schema creation, migrations, and low-level queries.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type {
  IndexMetadata,
  IndexedFile,
  IndexedSymbol,
  IndexedImport,
  IndexedImportSymbol,
  IndexedDependency,
  IndexStats,
} from './types.js';

const INDEX_VERSION = '1.0.0';

/**
 * Get the index directory for a project
 */
export function getIndexDirectory(projectRoot: string): string {
  const hash = crypto.createHash('md5').update(projectRoot).digest('hex').slice(0, 8);
  const projectName = path.basename(projectRoot);
  return path.join(os.homedir(), '.codi', 'symbol-index', `${projectName}-${hash}`);
}

/**
 * SQLite database wrapper for symbol index
 */
export class SymbolDatabase {
  private db: Database.Database;
  private indexDir: string;
  private dbPath: string;

  constructor(projectRoot: string) {
    this.indexDir = getIndexDirectory(projectRoot);
    this.dbPath = path.join(this.indexDir, 'symbols.db');

    // Ensure directory exists
    if (!fs.existsSync(this.indexDir)) {
      fs.mkdirSync(this.indexDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Initialize schema if needed
    this.initializeSchema();
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Check if tables exist
    const tableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='files'"
    ).get();

    if (!tableExists) {
      this.createSchema();
    }
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    this.db.exec(`
      -- Files table
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        hash TEXT NOT NULL,
        extraction_method TEXT NOT NULL,
        last_indexed TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Symbols table
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        end_line INTEGER,
        visibility TEXT NOT NULL,
        signature TEXT,
        doc_summary TEXT,
        metadata TEXT
      );

      -- Imports table
      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL,
        resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
        is_type_only INTEGER NOT NULL DEFAULT 0,
        line INTEGER NOT NULL
      );

      -- Import symbols table
      CREATE TABLE IF NOT EXISTS import_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        alias TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_namespace INTEGER NOT NULL DEFAULT 0
      );

      -- Exports table
      CREATE TABLE IF NOT EXISTS exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        source_path TEXT,
        resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
        is_type_only INTEGER NOT NULL DEFAULT 0,
        line INTEGER NOT NULL
      );

      -- Export symbols table
      CREATE TABLE IF NOT EXISTS export_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        export_id INTEGER NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        alias TEXT,
        is_default INTEGER NOT NULL DEFAULT 0
      );

      -- File dependencies table (computed from imports)
      CREATE TABLE IF NOT EXISTS file_dependencies (
        from_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        to_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        PRIMARY KEY (from_file_id, to_file_id, type)
      );

      -- Metadata table
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Indexes for fast queries
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_name_kind ON symbols(name, kind);
      CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source_path);
      CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);
      CREATE INDEX IF NOT EXISTS idx_import_symbols_name ON import_symbols(name);
      CREATE INDEX IF NOT EXISTS idx_file_deps_from ON file_dependencies(from_file_id);
      CREATE INDEX IF NOT EXISTS idx_file_deps_to ON file_dependencies(to_file_id);
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

      -- Initialize metadata
      INSERT OR REPLACE INTO metadata (key, value) VALUES ('version', '${INDEX_VERSION}');
      INSERT OR REPLACE INTO metadata (key, value) VALUES ('created_at', datetime('now'));
    `);
  }

  /**
   * Clear all data and reset the database
   */
  clear(): void {
    this.db.exec(`
      DELETE FROM file_dependencies;
      DELETE FROM export_symbols;
      DELETE FROM exports;
      DELETE FROM import_symbols;
      DELETE FROM imports;
      DELETE FROM symbols;
      DELETE FROM files;
      UPDATE metadata SET value = datetime('now') WHERE key = 'last_rebuild';
    `);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ============================================================================
  // File operations
  // ============================================================================

  /**
   * Insert or update a file
   */
  upsertFile(filePath: string, hash: string, extractionMethod: 'regex' | 'ast'): number {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, hash, extraction_method, last_indexed)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(path) DO UPDATE SET
        hash = excluded.hash,
        extraction_method = excluded.extraction_method,
        last_indexed = datetime('now')
      RETURNING id
    `);
    const result = stmt.get(filePath, hash, extractionMethod) as { id: number };
    return result.id;
  }

  /**
   * Get a file by path
   */
  getFile(filePath: string): IndexedFile | undefined {
    const stmt = this.db.prepare(`
      SELECT id, path, hash, extraction_method as extractionMethod, last_indexed as lastIndexed
      FROM files WHERE path = ?
    `);
    return stmt.get(filePath) as IndexedFile | undefined;
  }

  /**
   * Get all indexed files
   */
  getAllFiles(): IndexedFile[] {
    const stmt = this.db.prepare(`
      SELECT id, path, hash, extraction_method as extractionMethod, last_indexed as lastIndexed
      FROM files ORDER BY path
    `);
    return stmt.all() as IndexedFile[];
  }

  /**
   * Delete a file and all its related data (CASCADE)
   */
  deleteFile(filePath: string): void {
    const stmt = this.db.prepare('DELETE FROM files WHERE path = ?');
    stmt.run(filePath);
  }

  /**
   * Get file hash for change detection
   */
  getFileHash(filePath: string): string | undefined {
    const stmt = this.db.prepare('SELECT hash FROM files WHERE path = ?');
    const result = stmt.get(filePath) as { hash: string } | undefined;
    return result?.hash;
  }

  // ============================================================================
  // Symbol operations
  // ============================================================================

  /**
   * Insert a symbol
   */
  insertSymbol(symbol: Omit<IndexedSymbol, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (file_id, name, kind, line, end_line, visibility, signature, doc_summary, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      symbol.fileId,
      symbol.name,
      symbol.kind,
      symbol.line,
      symbol.endLine ?? null,
      symbol.visibility,
      symbol.signature ?? null,
      symbol.docSummary ?? null,
      symbol.metadata ? JSON.stringify(symbol.metadata) : null
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Find symbols by name (supports partial matching)
   */
  findSymbols(
    name: string,
    options: {
      kind?: string;
      exact?: boolean;
      exportedOnly?: boolean;
      limit?: number;
    } = {}
  ): Array<IndexedSymbol & { file: string }> {
    const { kind, exact = false, exportedOnly = false, limit = 10 } = options;

    let query = `
      SELECT s.id, s.file_id as fileId, s.name, s.kind, s.line, s.end_line as endLine,
             s.visibility, s.signature, s.doc_summary as docSummary, s.metadata,
             f.path as file
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (exact) {
      query += ' AND s.name = ?';
      params.push(name);
    } else {
      query += ' AND s.name LIKE ?';
      params.push(`%${name}%`);
    }

    if (kind) {
      query += ' AND s.kind = ?';
      params.push(kind);
    }

    if (exportedOnly) {
      query += " AND s.visibility IN ('export', 'export-default')";
    }

    query += ' ORDER BY CASE WHEN s.name = ? THEN 0 ELSE 1 END, s.name LIMIT ?';
    params.push(name, limit);

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params) as Array<IndexedSymbol & { file: string }>;

    // Parse metadata JSON
    return results.map(r => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata as unknown as string) : undefined,
    }));
  }

  /**
   * Get all symbols for a file
   */
  getFileSymbols(fileId: number): IndexedSymbol[] {
    const stmt = this.db.prepare(`
      SELECT id, file_id as fileId, name, kind, line, end_line as endLine,
             visibility, signature, doc_summary as docSummary, metadata
      FROM symbols WHERE file_id = ?
    `);
    return stmt.all(fileId) as IndexedSymbol[];
  }

  /**
   * Delete all symbols for a file
   */
  deleteFileSymbols(fileId: number): void {
    const stmt = this.db.prepare('DELETE FROM symbols WHERE file_id = ?');
    stmt.run(fileId);
  }

  // ============================================================================
  // Import operations
  // ============================================================================

  /**
   * Insert an import
   */
  insertImport(imp: Omit<IndexedImport, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO imports (file_id, source_path, resolved_file_id, is_type_only, line)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      imp.fileId,
      imp.sourcePath,
      imp.resolvedFileId ?? null,
      imp.isTypeOnly ? 1 : 0,
      imp.line
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Insert an import symbol
   */
  insertImportSymbol(symbol: IndexedImportSymbol & { isNamespace?: boolean }): void {
    const stmt = this.db.prepare(`
      INSERT INTO import_symbols (import_id, name, alias, is_default, is_namespace)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      symbol.importId,
      symbol.name,
      symbol.alias ?? null,
      symbol.isDefault ? 1 : 0,
      symbol.isNamespace ? 1 : 0
    );
  }

  /**
   * Find files that import a symbol
   */
  findImporters(symbolName: string): Array<{ file: string; line: number; isTypeOnly: boolean }> {
    const stmt = this.db.prepare(`
      SELECT f.path as file, i.line, i.is_type_only as isTypeOnly
      FROM import_symbols isym
      JOIN imports i ON isym.import_id = i.id
      JOIN files f ON i.file_id = f.id
      WHERE isym.name = ? OR isym.alias = ?
    `);
    return stmt.all(symbolName, symbolName) as Array<{ file: string; line: number; isTypeOnly: boolean }>;
  }

  /**
   * Get all exported/public symbols for building a symbol registry
   * Returns map of symbol name to array of files where it's defined
   */
  getExportedSymbolRegistry(): Map<string, Array<{ fileId: number; file: string; kind: string }>> {
    const stmt = this.db.prepare(`
      SELECT s.name, s.kind, s.file_id as fileId, f.path as file
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.visibility IN ('export', 'export-default', 'public')
      ORDER BY s.name
    `);
    const rows = stmt.all() as Array<{ name: string; kind: string; fileId: number; file: string }>;

    const registry = new Map<string, Array<{ fileId: number; file: string; kind: string }>>();
    for (const row of rows) {
      if (!registry.has(row.name)) {
        registry.set(row.name, []);
      }
      registry.get(row.name)!.push({ fileId: row.fileId, file: row.file, kind: row.kind });
    }
    return registry;
  }

  /**
   * Get all unique exported symbol names (for efficient regex building)
   */
  getExportedSymbolNames(): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT s.name
      FROM symbols s
      WHERE s.visibility IN ('export', 'export-default', 'public')
        AND length(s.name) >= 3
      ORDER BY length(s.name) DESC
    `);
    const rows = stmt.all() as Array<{ name: string }>;
    return rows.map(r => r.name);
  }

  // ============================================================================
  // Dependency operations
  // ============================================================================

  /**
   * Insert a file dependency
   */
  insertDependency(dep: IndexedDependency): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO file_dependencies (from_file_id, to_file_id, type)
      VALUES (?, ?, ?)
    `);
    stmt.run(dep.fromFileId, dep.toFileId, dep.type);
  }

  /**
   * Get files that a file imports (dependencies)
   */
  getFileDependencies(fileId: number): Array<{ file: string; type: string }> {
    const stmt = this.db.prepare(`
      SELECT f.path as file, fd.type
      FROM file_dependencies fd
      JOIN files f ON fd.to_file_id = f.id
      WHERE fd.from_file_id = ?
    `);
    return stmt.all(fileId) as Array<{ file: string; type: string }>;
  }

  /**
   * Get files that import a file (dependents)
   */
  getFileDependents(fileId: number): Array<{ file: string; type: string }> {
    const stmt = this.db.prepare(`
      SELECT f.path as file, fd.type
      FROM file_dependencies fd
      JOIN files f ON fd.from_file_id = f.id
      WHERE fd.to_file_id = ?
    `);
    return stmt.all(fileId) as Array<{ file: string; type: string }>;
  }

  /**
   * Get dependency graph for a file with depth traversal
   */
  getDependencyGraph(
    filePath: string,
    direction: 'imports' | 'importedBy',
    maxDepth: number = 1
  ): Array<{ file: string; depth: number; type: string }> {
    const results: Array<{ file: string; depth: number; type: string }> = [];
    const visited = new Set<string>();

    const traverse = (currentPath: string, depth: number) => {
      if (depth > maxDepth || visited.has(currentPath)) return;
      visited.add(currentPath);

      const file = this.getFile(currentPath);
      if (!file) return;

      const deps = direction === 'imports'
        ? this.getFileDependencies(file.id)
        : this.getFileDependents(file.id);

      for (const dep of deps) {
        if (!visited.has(dep.file)) {
          results.push({ file: dep.file, depth, type: dep.type });
          traverse(dep.file, depth + 1);
        }
      }
    };

    traverse(filePath, 1);
    return results;
  }

  // ============================================================================
  // Metadata operations
  // ============================================================================

  /**
   * Get metadata value
   */
  getMetadata(key: string): string | undefined {
    const stmt = this.db.prepare('SELECT value FROM metadata WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value;
  }

  /**
   * Set metadata value
   */
  setMetadata(key: string, value: string): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    stmt.run(key, value);
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    const symbolCount = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number };
    const importCount = this.db.prepare('SELECT COUNT(*) as count FROM imports').get() as { count: number };
    const depCount = this.db.prepare('SELECT COUNT(*) as count FROM file_dependencies').get() as { count: number };

    const stats = fs.statSync(this.dbPath);

    return {
      version: this.getMetadata('version') || INDEX_VERSION,
      projectRoot: this.getMetadata('project_root') || '',
      totalFiles: fileCount.count,
      totalSymbols: symbolCount.count,
      totalImports: importCount.count,
      totalDependencies: depCount.count,
      lastFullRebuild: this.getMetadata('last_rebuild') || '',
      lastUpdate: this.getMetadata('last_update') || '',
      indexSizeBytes: stats.size,
    };
  }

  // ============================================================================
  // Transaction support
  // ============================================================================

  /**
   * Run operations in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Get the underlying database for advanced queries
   */
  getDb(): Database.Database {
    return this.db;
  }
}
