// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Regex-based Symbol Extractor
 *
 * Fast extraction of symbols, imports, and exports using regex patterns.
 * Used for all files as the default extraction method (~80% accuracy).
 */

import type {
  SymbolExtractor,
  FileSymbolInfo,
  CodeSymbol,
  ImportStatement,
  ExportStatement,
  SymbolKind,
  SymbolVisibility,
} from './types.js';

/**
 * Regex patterns for TypeScript/JavaScript symbol extraction
 */
const TS_PATTERNS = {
  // Import patterns
  importDefault: /^import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/gm,
  importNamed: /^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm,
  importNamespace: /^import\s+\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/gm,
  importDefaultAndNamed: /^import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm,
  importTypeOnly: /^import\s+type\s+(?:(\w+)|{([^}]+)})\s*from\s*['"]([^'"]+)['"]/gm,
  importSideEffect: /^import\s*['"]([^'"]+)['"]/gm,

  // Export patterns
  exportNamed: /^export\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm,
  exportDefault: /^export\s+default\s+(?:(class|function|interface)\s+)?(\w+)?/gm,
  exportWildcard: /^export\s+\*(?:\s+as\s+(\w+))?\s+from\s*['"]([^'"]+)['"]/gm,
  exportTypeOnly: /^export\s+type\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm,

  // Symbol patterns
  functionDecl: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/gm,
  arrowFunction: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*([^=]+))?\s*=\s*(?:async\s+)?\(?[^)]*\)?\s*(?::\s*([^=]+))?\s*=>/gm,
  classDecl: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/gm,
  interfaceDecl: /^(?:export\s+)?interface\s+(\w+)(?:<([^>]*)>)?(?:\s+extends\s+([\w,\s]+))?\s*\{/gm,
  typeAlias: /^(?:export\s+)?type\s+(\w+)(?:<([^>]*)>)?\s*=/gm,
  enumDecl: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/gm,
  constDecl: /^(?:export\s+)?const\s+(\w+)\s*(?::\s*([^=]+))?\s*=/gm,
  letDecl: /^(?:export\s+)?let\s+(\w+)\s*(?::\s*([^=]+))?\s*=/gm,

  // JSDoc pattern (for extracting doc summaries)
  jsdoc: /\/\*\*\s*\n\s*\*\s*([^\n*]+)/g,
};

/**
 * Regex patterns for Kotlin symbol extraction
 */
const KOTLIN_PATTERNS = {
  // Import: import package.name.ClassName
  importDecl: /^import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm,

  // Class: class Foo : Bar(), Baz { } (with optional modifiers)
  classDecl: /^(?:(?:public|private|protected|internal|open|abstract|sealed|data|inline|value|enum|annotation)\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s*\([^)]*\))?(?:\s*:\s*([^{]+))?\s*\{?/gm,

  // Interface: interface Foo : Bar { }
  interfaceDecl: /^(?:(?:public|private|protected|internal|sealed|fun)\s+)*interface\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([^{]+))?\s*\{?/gm,

  // Object: object Foo : Bar { } or companion object { }
  objectDecl: /^(?:(?:public|private|protected|internal)\s+)*(?:companion\s+)?object\s+(\w+)?(?:\s*:\s*([^{]+))?\s*\{?/gm,

  // Function: fun foo(): ReturnType { } or fun Type.foo(): ReturnType
  functionDecl: /^(?:(?:public|private|protected|internal|open|abstract|override|suspend|inline|infix|operator|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s+)?(?:(\w+)\.)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{=]+))?/gm,

  // Property: val/var foo: Type = ...
  propertyDecl: /^(?:(?:public|private|protected|internal|open|abstract|override|const|lateinit)\s+)*(?:val|var)\s+(\w+)\s*(?::\s*([^=\n]+))?/gm,

  // Type alias: typealias Foo = Bar
  typeAlias: /^(?:(?:public|private|protected|internal)\s+)*typealias\s+(\w+)(?:<[^>]*>)?\s*=/gm,

  // KDoc pattern
  kdoc: /\/\*\*\s*\n(?:\s*\*[^\n]*\n)*\s*\*\//g,
};

// Alias for backward compatibility
const PATTERNS = TS_PATTERNS;

/**
 * Check if file is Kotlin
 */
function isKotlinFile(filePath: string): boolean {
  return filePath.endsWith('.kt') || filePath.endsWith('.kts');
}

/**
 * Fast regex-based symbol extractor
 */
export class RegexSymbolExtractor implements SymbolExtractor {
  readonly method = 'regex' as const;

  /**
   * Extract symbols from file content
   */
  extract(content: string, filePath: string): FileSymbolInfo {
    const startTime = Date.now();
    const lines = content.split('\n');

    const symbols: CodeSymbol[] = [];
    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];
    const errors: string[] = [];

    try {
      if (isKotlinFile(filePath)) {
        // Kotlin extraction
        imports.push(...this.extractKotlinImports(content, lines));
        symbols.push(...this.extractKotlinSymbols(content, lines, filePath));
        // Kotlin doesn't have separate export statements - visibility is on declarations
      } else {
        // TypeScript/JavaScript extraction
        imports.push(...this.extractImports(content, lines));
        exports.push(...this.extractExports(content, lines));
        symbols.push(...this.extractSymbols(content, lines, filePath));
        this.markExportedSymbols(symbols, exports, content);
      }
    } catch (error) {
      errors.push(`Extraction error: ${error}`);
    }

    return {
      file: filePath,
      symbols,
      imports,
      exports,
      extractionMethod: 'regex',
      extractionTime: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Extract import statements
   */
  private extractImports(content: string, lines: string[]): ImportStatement[] {
    const imports: ImportStatement[] = [];

    // Default import: import foo from 'bar'
    for (const match of content.matchAll(PATTERNS.importDefault)) {
      const line = this.offsetToLine(content, match.index!);
      // Skip if this is part of a more complex import
      const fullLine = lines[line - 1];
      if (fullLine.includes('{')) continue;

      imports.push({
        source: match[2],
        symbols: [{ name: match[1], isDefault: true }],
        isTypeOnly: false,
        line,
      });
    }

    // Named import: import { foo, bar } from 'baz'
    for (const match of content.matchAll(PATTERNS.importNamed)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      // Skip if this has a default import too (handled by importDefaultAndNamed)
      if (/^import\s+\w+\s*,/.test(fullLine)) continue;

      const symbolsStr = match[1];
      const symbols = this.parseNamedSymbols(symbolsStr);
      imports.push({
        source: match[2],
        symbols,
        isTypeOnly: fullLine.includes('import type'),
        line,
      });
    }

    // Namespace import: import * as foo from 'bar'
    for (const match of content.matchAll(PATTERNS.importNamespace)) {
      const line = this.offsetToLine(content, match.index!);
      imports.push({
        source: match[2],
        symbols: [{ name: match[1], isNamespace: true }],
        isTypeOnly: false,
        line,
      });
    }

    // Default + Named: import foo, { bar } from 'baz'
    for (const match of content.matchAll(PATTERNS.importDefaultAndNamed)) {
      const line = this.offsetToLine(content, match.index!);
      const namedSymbols = this.parseNamedSymbols(match[2]);
      imports.push({
        source: match[3],
        symbols: [{ name: match[1], isDefault: true }, ...namedSymbols],
        isTypeOnly: false,
        line,
      });
    }

    // Type-only import: import type { Foo } from 'bar'
    for (const match of content.matchAll(PATTERNS.importTypeOnly)) {
      const line = this.offsetToLine(content, match.index!);
      const symbols = match[1]
        ? [{ name: match[1], isDefault: true }]
        : this.parseNamedSymbols(match[2]);
      imports.push({
        source: match[3],
        symbols,
        isTypeOnly: true,
        line,
      });
    }

    return imports;
  }

  /**
   * Extract export statements
   */
  private extractExports(content: string, lines: string[]): ExportStatement[] {
    const exports: ExportStatement[] = [];

    // Named export: export { foo, bar } or export { foo } from './bar'
    for (const match of content.matchAll(PATTERNS.exportNamed)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      const symbols = this.parseNamedSymbols(match[1]);
      exports.push({
        source: match[2] || undefined,
        symbols: symbols.map((s) => ({
          name: s.name,
          alias: s.alias,
          isDefault: false,
        })),
        isTypeOnly: fullLine.includes('export type'),
        line,
      });
    }

    // Wildcard re-export: export * from './bar' or export * as ns from './bar'
    for (const match of content.matchAll(PATTERNS.exportWildcard)) {
      const line = this.offsetToLine(content, match.index!);
      exports.push({
        source: match[2],
        symbols: match[1] ? [{ name: match[1], isDefault: false }] : [],
        isTypeOnly: false,
        line,
      });
    }

    // Type-only export: export type { Foo }
    for (const match of content.matchAll(PATTERNS.exportTypeOnly)) {
      const line = this.offsetToLine(content, match.index!);
      const symbols = this.parseNamedSymbols(match[1]);
      exports.push({
        source: match[2] || undefined,
        symbols: symbols.map((s) => ({
          name: s.name,
          alias: s.alias,
          isDefault: false,
        })),
        isTypeOnly: true,
        line,
      });
    }

    return exports;
  }

  /**
   * Extract symbol definitions
   */
  private extractSymbols(
    content: string,
    lines: string[],
    filePath: string
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const jsdocMap = this.extractJSDocComments(content);

    // Functions
    for (const match of content.matchAll(PATTERNS.functionDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const docSummary = jsdocMap.get(line);
      const isExported = lines[line - 1].trimStart().startsWith('export');
      const params = this.parseParams(match[3]);

      symbols.push({
        name: match[1],
        kind: 'function',
        file: filePath,
        line,
        visibility: isExported ? 'export' : 'internal',
        signature: `${match[1]}(${match[3].trim()})${match[4] ? `: ${match[4].trim()}` : ''}`,
        docSummary,
        params,
        returnType: match[4]?.trim(),
        typeParams: match[2] ? [match[2]] : undefined,
      });
    }

    // Arrow functions (const foo = () => {})
    for (const match of content.matchAll(PATTERNS.arrowFunction)) {
      const line = this.offsetToLine(content, match.index!);
      const docSummary = jsdocMap.get(line);
      const isExported = lines[line - 1].trimStart().startsWith('export');

      symbols.push({
        name: match[1],
        kind: 'function',
        file: filePath,
        line,
        visibility: isExported ? 'export' : 'internal',
        signature: match[2]?.trim() || `${match[1]}()`,
        docSummary,
        returnType: match[3]?.trim(),
      });
    }

    // Classes
    for (const match of content.matchAll(PATTERNS.classDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const docSummary = jsdocMap.get(line);
      const isExported = lines[line - 1].trimStart().startsWith('export');
      const endLine = this.findBlockEnd(lines, line);

      symbols.push({
        name: match[1],
        kind: 'class',
        file: filePath,
        line,
        endLine,
        visibility: isExported ? 'export' : 'internal',
        docSummary,
        extends: match[2] ? [match[2]] : undefined,
      });
    }

    // Interfaces
    for (const match of content.matchAll(PATTERNS.interfaceDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const docSummary = jsdocMap.get(line);
      const isExported = lines[line - 1].trimStart().startsWith('export');
      const endLine = this.findBlockEnd(lines, line);

      symbols.push({
        name: match[1],
        kind: 'interface',
        file: filePath,
        line,
        endLine,
        visibility: isExported ? 'export' : 'internal',
        docSummary,
        typeParams: match[2] ? [match[2]] : undefined,
        extends: match[3] ? match[3].split(',').map((s) => s.trim()) : undefined,
      });
    }

    // Type aliases
    for (const match of content.matchAll(PATTERNS.typeAlias)) {
      const line = this.offsetToLine(content, match.index!);
      const docSummary = jsdocMap.get(line);
      const isExported = lines[line - 1].trimStart().startsWith('export');

      symbols.push({
        name: match[1],
        kind: 'type',
        file: filePath,
        line,
        visibility: isExported ? 'export' : 'internal',
        docSummary,
        typeParams: match[2] ? [match[2]] : undefined,
      });
    }

    // Enums
    for (const match of content.matchAll(PATTERNS.enumDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const docSummary = jsdocMap.get(line);
      const isExported = lines[line - 1].trimStart().startsWith('export');
      const endLine = this.findBlockEnd(lines, line);

      symbols.push({
        name: match[1],
        kind: 'enum',
        file: filePath,
        line,
        endLine,
        visibility: isExported ? 'export' : 'internal',
        docSummary,
      });
    }

    // Constants (exported only, to reduce noise)
    for (const match of content.matchAll(PATTERNS.constDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      const isExported = fullLine.trimStart().startsWith('export');

      // Skip if this is an arrow function (already captured)
      if (fullLine.includes('=>')) continue;

      // Only capture exported constants or those with type annotations
      if (!isExported && !match[2]) continue;

      const docSummary = jsdocMap.get(line);

      symbols.push({
        name: match[1],
        kind: 'constant',
        file: filePath,
        line,
        visibility: isExported ? 'export' : 'internal',
        signature: match[2]?.trim(),
        docSummary,
      });
    }

    return symbols;
  }

  /**
   * Mark symbols that are exported via export statements
   */
  private markExportedSymbols(
    symbols: CodeSymbol[],
    exports: ExportStatement[],
    content: string
  ): void {
    // Check for default export
    const defaultMatch = content.match(PATTERNS.exportDefault);
    if (defaultMatch) {
      const exportedName = defaultMatch[2];
      if (exportedName) {
        const symbol = symbols.find((s) => s.name === exportedName);
        if (symbol) {
          symbol.visibility = 'export-default';
        }
      }
    }

    // Check named exports without source (local exports)
    for (const exp of exports) {
      if (exp.source) continue; // Re-export, skip

      for (const expSymbol of exp.symbols) {
        const symbol = symbols.find(
          (s) => s.name === (expSymbol.alias || expSymbol.name)
        );
        if (symbol && symbol.visibility === 'internal') {
          symbol.visibility = 'export';
        }
      }
    }
  }

  /**
   * Extract JSDoc comments and map them to line numbers
   */
  private extractJSDocComments(content: string): Map<number, string> {
    const map = new Map<number, string>();
    const jsdocRegex = /\/\*\*\s*\n(?:\s*\*[^\n]*\n)*\s*\*\//g;

    for (const match of content.matchAll(jsdocRegex)) {
      const endOffset = match.index! + match[0].length;
      const endLine = this.offsetToLine(content, endOffset);

      // Extract first non-empty line after /**
      const firstLineMatch = match[0].match(/\/\*\*\s*\n\s*\*\s*([^\n@*]+)/);
      if (firstLineMatch) {
        // The JSDoc applies to the line after it
        map.set(endLine + 1, firstLineMatch[1].trim());
      }
    }

    return map;
  }

  /**
   * Parse named symbols from import/export braces
   */
  private parseNamedSymbols(
    str: string
  ): Array<{ name: string; alias?: string }> {
    return str
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const asMatch = s.match(/(\w+)\s+as\s+(\w+)/);
        if (asMatch) {
          return { name: asMatch[1], alias: asMatch[2] };
        }
        return { name: s };
      });
  }

  /**
   * Parse function parameters
   */
  private parseParams(
    paramsStr: string
  ): Array<{ name: string; type?: string }> {
    if (!paramsStr.trim()) return [];

    return paramsStr
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => {
        // Handle destructuring
        if (p.startsWith('{') || p.startsWith('[')) {
          const colonIdx = p.lastIndexOf(':');
          if (colonIdx > 0) {
            return { name: p.slice(0, colonIdx).trim(), type: p.slice(colonIdx + 1).trim() };
          }
          return { name: p };
        }

        // Normal parameter
        const colonIdx = p.indexOf(':');
        if (colonIdx > 0) {
          const name = p.slice(0, colonIdx).trim().replace(/\?$/, '');
          const type = p.slice(colonIdx + 1).trim();
          return { name, type };
        }

        return { name: p.replace(/\?$/, '') };
      });
  }

  /**
   * Find the end of a code block (brace-based)
   */
  private findBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundFirstBrace = false;

    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundFirstBrace = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (foundFirstBrace && braceCount === 0) {
        return i + 1;
      }
    }

    return lines.length;
  }

  /**
   * Convert character offset to line number
   */
  private offsetToLine(content: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === '\n') line++;
    }
    return line;
  }

  // ============================================================================
  // Kotlin Extraction Methods
  // ============================================================================

  /**
   * Extract Kotlin import statements
   */
  private extractKotlinImports(content: string, lines: string[]): ImportStatement[] {
    const imports: ImportStatement[] = [];

    for (const match of content.matchAll(KOTLIN_PATTERNS.importDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const fullPath = match[1];
      const alias = match[2];

      // Extract the class name (last part of the path)
      const parts = fullPath.split('.');
      const name = parts[parts.length - 1];

      imports.push({
        source: fullPath,
        symbols: [{ name, alias, isDefault: false }],
        isTypeOnly: false,
        line,
      });
    }

    return imports;
  }

  /**
   * Extract Kotlin symbol definitions
   */
  private extractKotlinSymbols(
    content: string,
    lines: string[],
    filePath: string
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const kdocMap = this.extractKDocComments(content);

    // Classes (including data classes, enum classes, etc.)
    for (const match of content.matchAll(KOTLIN_PATTERNS.classDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      const docSummary = kdocMap.get(line);
      const visibility = this.getKotlinVisibility(fullLine);
      const endLine = this.findBlockEnd(lines, line);

      // Parse extends/implements
      const extendsClause = match[2];
      const extendsNames = extendsClause
        ? extendsClause.split(',').map(s => s.trim().replace(/\([^)]*\)/, '').trim())
        : undefined;

      symbols.push({
        name: match[1],
        kind: fullLine.includes('data class') ? 'class' :
              fullLine.includes('enum class') ? 'enum' : 'class',
        file: filePath,
        line,
        endLine,
        visibility,
        docSummary,
        extends: extendsNames,
      });
    }

    // Interfaces
    for (const match of content.matchAll(KOTLIN_PATTERNS.interfaceDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      const docSummary = kdocMap.get(line);
      const visibility = this.getKotlinVisibility(fullLine);
      const endLine = this.findBlockEnd(lines, line);

      symbols.push({
        name: match[1],
        kind: 'interface',
        file: filePath,
        line,
        endLine,
        visibility,
        docSummary,
      });
    }

    // Objects (singleton objects)
    for (const match of content.matchAll(KOTLIN_PATTERNS.objectDecl)) {
      if (!match[1]) continue; // Skip companion object without name
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      const docSummary = kdocMap.get(line);
      const visibility = this.getKotlinVisibility(fullLine);
      const endLine = this.findBlockEnd(lines, line);

      symbols.push({
        name: match[1],
        kind: 'class', // Objects are like singleton classes
        file: filePath,
        line,
        endLine,
        visibility,
        docSummary,
      });
    }

    // Functions
    for (const match of content.matchAll(KOTLIN_PATTERNS.functionDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      const docSummary = kdocMap.get(line);
      const visibility = this.getKotlinVisibility(fullLine);

      const receiverType = match[1]; // Extension function receiver
      const name = match[2];
      const params = match[3];
      const returnType = match[4];

      const signature = receiverType
        ? `${receiverType}.${name}(${params})${returnType ? `: ${returnType}` : ''}`
        : `${name}(${params})${returnType ? `: ${returnType}` : ''}`;

      symbols.push({
        name,
        kind: 'function',
        file: filePath,
        line,
        visibility,
        signature,
        docSummary,
        returnType,
      });
    }

    // Properties (val/var) - only capture top-level or those with visibility
    for (const match of content.matchAll(KOTLIN_PATTERNS.propertyDecl)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];

      // Skip if this looks like a parameter or local variable (indented significantly)
      const indent = fullLine.length - fullLine.trimStart().length;
      if (indent > 4) continue;

      const docSummary = kdocMap.get(line);
      const visibility = this.getKotlinVisibility(fullLine);

      symbols.push({
        name: match[1],
        kind: fullLine.includes('const ') ? 'constant' : 'variable',
        file: filePath,
        line,
        visibility,
        signature: match[2]?.trim(),
        docSummary,
      });
    }

    // Type aliases
    for (const match of content.matchAll(KOTLIN_PATTERNS.typeAlias)) {
      const line = this.offsetToLine(content, match.index!);
      const fullLine = lines[line - 1];
      const docSummary = kdocMap.get(line);
      const visibility = this.getKotlinVisibility(fullLine);

      symbols.push({
        name: match[1],
        kind: 'type',
        file: filePath,
        line,
        visibility,
        docSummary,
      });
    }

    return symbols;
  }

  /**
   * Get Kotlin visibility from line
   */
  private getKotlinVisibility(line: string): SymbolVisibility {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('private ')) return 'internal';
    if (trimmed.startsWith('internal ')) return 'internal';
    if (trimmed.startsWith('protected ')) return 'internal';
    // public is default in Kotlin
    return 'export';
  }

  /**
   * Extract KDoc comments and map them to line numbers
   */
  private extractKDocComments(content: string): Map<number, string> {
    const map = new Map<number, string>();

    for (const match of content.matchAll(KOTLIN_PATTERNS.kdoc)) {
      const endOffset = match.index! + match[0].length;
      const endLine = this.offsetToLine(content, endOffset);

      // Extract first non-empty line after /**
      const firstLineMatch = match[0].match(/\/\*\*\s*\n\s*\*\s*([^\n@*]+)/);
      if (firstLineMatch) {
        map.set(endLine + 1, firstLineMatch[1].trim());
      }
    }

    return map;
  }
}

/**
 * Create a regex symbol extractor instance
 */
export function createRegexExtractor(): RegexSymbolExtractor {
  return new RegexSymbolExtractor();
}
