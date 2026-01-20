// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AST-Based Symbol Extractor
 *
 * Uses ts-morph for accurate TypeScript/JavaScript symbol extraction.
 * More accurate than regex but slower - used for critical files only.
 */

import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import type {
  SymbolExtractor,
  FileSymbolInfo,
  CodeSymbol,
  ImportStatement,
  ExportStatement,
} from './types.js';

/**
 * AST-based symbol extractor using ts-morph.
 * Provides accurate extraction for TypeScript/JavaScript files.
 */
export class AstSymbolExtractor implements SymbolExtractor {
  private project: Project;
  readonly method = 'ast' as const;

  constructor() {
    // Create a project without type checking for speed
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
      },
    });
  }

  /**
   * Extract symbols from file content using AST parsing.
   */
  extract(content: string, filePath: string): FileSymbolInfo {
    const startTime = Date.now();
    const symbols: CodeSymbol[] = [];
    const imports: ImportStatement[] = [];
    const exports: ExportStatement[] = [];
    const errors: string[] = [];

    try {
      // Create a source file from content
      const sourceFile = this.project.createSourceFile(
        filePath,
        content,
        { overwrite: true }
      );

      // Extract imports
      this.extractImports(sourceFile, imports);

      // Extract exports and symbols
      this.extractExportsAndSymbols(sourceFile, filePath, symbols, exports);

      // Clean up to avoid memory leaks
      this.project.removeSourceFile(sourceFile);
    } catch (error) {
      // If AST parsing fails, record the error
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`AST extraction failed: ${errorMsg}`);
    }

    return {
      file: filePath,
      symbols,
      imports,
      exports,
      extractionMethod: 'ast',
      extractionTime: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Extract import statements.
   */
  private extractImports(sourceFile: SourceFile, imports: ImportStatement[]): void {
    // Regular imports
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const importedSymbols: Array<{ name: string; alias?: string; isDefault?: boolean; isNamespace?: boolean }> = [];
      const line = importDecl.getStartLineNumber();

      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        importedSymbols.push({ name: defaultImport.getText(), isDefault: true });
      }

      // Named imports
      const namedImports = importDecl.getNamedImports();
      for (const named of namedImports) {
        const name = named.getName();
        const alias = named.getAliasNode()?.getText();
        importedSymbols.push(alias ? { name, alias } : { name });
      }

      // Namespace import
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        importedSymbols.push({ name: namespaceImport.getText(), isNamespace: true });
      }

      imports.push({
        source: moduleSpecifier,
        symbols: importedSymbols,
        isTypeOnly: importDecl.isTypeOnly(),
        line,
      });
    }

    // Dynamic imports (require statements)
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        if (Node.isIdentifier(expr) && expr.getText() === 'require') {
          const args = node.getArguments();
          if (args.length > 0 && Node.isStringLiteral(args[0])) {
            imports.push({
              source: args[0].getLiteralText(),
              symbols: [],
              isTypeOnly: false,
              line: node.getStartLineNumber(),
            });
          }
        }
      }
    });
  }

  /**
   * Extract exports and symbols.
   */
  private extractExportsAndSymbols(
    sourceFile: SourceFile,
    filePath: string,
    symbols: CodeSymbol[],
    exports: ExportStatement[]
  ): void {
    // Export declarations (re-exports)
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (moduleSpecifier) {
        const namedExports = exportDecl.getNamedExports();
        const exportSymbols = namedExports.map((e) => {
          const alias = e.getAliasNode()?.getText();
          return alias ? { name: e.getName(), alias } : { name: e.getName() };
        });

        exports.push({
          source: moduleSpecifier,
          symbols: exportSymbols.length > 0 ? exportSymbols : [],
          isTypeOnly: exportDecl.isTypeOnly(),
          line: exportDecl.getStartLineNumber(),
        });
      }
    }

    // Functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (!name) continue;

      const isExported = func.isExported();
      const isDefault = func.isDefaultExport();
      const line = func.getStartLineNumber();

      symbols.push({
        name,
        kind: 'function',
        file: filePath,
        line,
        visibility: isDefault ? 'export-default' : isExported ? 'export' : 'internal',
        signature: this.getFunctionSignature(func),
        docSummary: this.getJsDocSummary(func),
      });

      if (isExported) {
        exports.push({
          symbols: [{ name, isDefault }],
          isTypeOnly: false,
          line,
        });
      }
    }

    // Classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;

      const isExported = cls.isExported();
      const isDefault = cls.isDefaultExport();
      const line = cls.getStartLineNumber();

      symbols.push({
        name,
        kind: 'class',
        file: filePath,
        line,
        visibility: isDefault ? 'export-default' : isExported ? 'export' : 'internal',
        signature: this.getClassSignature(cls),
        docSummary: this.getJsDocSummary(cls),
      });

      if (isExported) {
        exports.push({
          symbols: [{ name, isDefault }],
          isTypeOnly: false,
          line,
        });
      }
    }

    // Interfaces
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      const isExported = iface.isExported();
      const line = iface.getStartLineNumber();

      symbols.push({
        name,
        kind: 'interface',
        file: filePath,
        line,
        visibility: isExported ? 'export' : 'internal',
        signature: `interface ${name}`,
        docSummary: this.getJsDocSummary(iface),
      });

      if (isExported) {
        exports.push({
          symbols: [{ name }],
          isTypeOnly: true,
          line,
        });
      }
    }

    // Type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      const name = typeAlias.getName();
      const isExported = typeAlias.isExported();
      const line = typeAlias.getStartLineNumber();

      symbols.push({
        name,
        kind: 'type',
        file: filePath,
        line,
        visibility: isExported ? 'export' : 'internal',
        docSummary: this.getJsDocSummary(typeAlias),
      });

      if (isExported) {
        exports.push({
          symbols: [{ name }],
          isTypeOnly: true,
          line,
        });
      }
    }

    // Enums
    for (const enumDecl of sourceFile.getEnums()) {
      const name = enumDecl.getName();
      const isExported = enumDecl.isExported();
      const line = enumDecl.getStartLineNumber();

      symbols.push({
        name,
        kind: 'enum',
        file: filePath,
        line,
        visibility: isExported ? 'export' : 'internal',
        docSummary: this.getJsDocSummary(enumDecl),
      });

      if (isExported) {
        exports.push({
          symbols: [{ name }],
          isTypeOnly: false,
          line,
        });
      }
    }

    // Variable declarations (const, let, var)
    for (const varStmt of sourceFile.getVariableStatements()) {
      const isExported = varStmt.isExported();
      const isDefault = varStmt.isDefaultExport();
      const line = varStmt.getStartLineNumber();

      for (const decl of varStmt.getDeclarations()) {
        const name = decl.getName();

        symbols.push({
          name,
          kind: 'variable',
          file: filePath,
          line: decl.getStartLineNumber(),
          visibility: isDefault ? 'export-default' : isExported ? 'export' : 'internal',
          docSummary: this.getJsDocSummary(varStmt),
        });

        if (isExported) {
          exports.push({
            symbols: [{ name, isDefault }],
            isTypeOnly: false,
            line,
          });
        }
      }
    }
  }

  /**
   * Get function signature.
   */
  private getFunctionSignature(func: Node): string {
    if (!Node.isFunctionDeclaration(func) && !Node.isFunctionExpression(func)) {
      return '';
    }

    const name = func.getName() || 'anonymous';
    const params = func.getParameters().map((p) => {
      const paramName = p.getName();
      const paramType = p.getType().getText();
      return `${paramName}: ${this.shortenType(paramType)}`;
    });

    const returnType = func.getReturnType().getText();
    return `${name}(${params.join(', ')}): ${this.shortenType(returnType)}`;
  }

  /**
   * Get class signature.
   */
  private getClassSignature(cls: Node): string {
    if (!Node.isClassDeclaration(cls)) {
      return '';
    }

    const name = cls.getName() || 'anonymous';
    const extendsClause = cls.getExtends();
    const implementsClause = cls.getImplements();

    let sig = `class ${name}`;
    if (extendsClause) {
      sig += ` extends ${extendsClause.getText()}`;
    }
    if (implementsClause.length > 0) {
      sig += ` implements ${implementsClause.map((i) => i.getText()).join(', ')}`;
    }

    return sig;
  }

  /**
   * Get first line of JSDoc comment.
   */
  private getJsDocSummary(node: Node): string | undefined {
    const jsDocs = Node.isJSDocable(node) ? node.getJsDocs() : [];
    if (jsDocs.length === 0) return undefined;

    const description = jsDocs[0].getDescription();
    if (!description) return undefined;

    // Get first line/sentence
    const firstLine = description.split('\n')[0].trim();
    const firstSentence = firstLine.split('.')[0];
    return firstSentence.length > 100 ? firstSentence.slice(0, 100) + '...' : firstSentence;
  }

  /**
   * Shorten type string for readability.
   */
  private shortenType(type: string): string {
    // Remove import paths
    let short = type.replace(/import\([^)]+\)\./g, '');

    // Shorten common types
    short = short
      .replace(/Promise<([^>]+)>/g, 'Promise<$1>')
      .replace(/Array<([^>]+)>/g, '$1[]');

    // Truncate if too long
    if (short.length > 50) {
      short = short.slice(0, 50) + '...';
    }

    return short;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    // Clear all source files
    for (const sourceFile of this.project.getSourceFiles()) {
      this.project.removeSourceFile(sourceFile);
    }
  }
}

/**
 * Create an AST extractor instance.
 */
export function createAstExtractor(): AstSymbolExtractor {
  return new AstSymbolExtractor();
}
