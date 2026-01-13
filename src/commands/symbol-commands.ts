/**
 * Symbol index management commands.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import { SymbolIndexService, getIndexDirectory } from '../symbol-index/index.js';
import * as fs from 'fs';

// Store a reference to the active symbol index service
let symbolIndexService: SymbolIndexService | null = null;

/**
 * Set the symbol index service for commands to use.
 */
export function setSymbolIndexService(service: SymbolIndexService): void {
  symbolIndexService = service;
}

/**
 * Get the current symbol index service.
 */
export function getSymbolIndexService(): SymbolIndexService | null {
  return symbolIndexService;
}

/**
 * /symbols command - Manage the symbol index.
 */
export const symbolsCommand: Command = {
  name: 'symbols',
  aliases: ['sym', 'index'],
  description: 'Manage the symbol index for AST-based code navigation',
  usage: '/symbols [rebuild|update|stats|search <name>|clear]',
  taskType: 'fast',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const action = parts[0] || 'stats';
    const rest = parts.slice(1).join(' ');

    // Get project root from context or current directory
    const projectRoot = context.projectInfo?.rootPath || process.cwd();

    // Initialize service if not set
    if (!symbolIndexService) {
      symbolIndexService = new SymbolIndexService(projectRoot);
      await symbolIndexService.initialize();
    }

    switch (action) {
      case 'rebuild': {
        const result = await symbolIndexService.rebuild({
          projectRoot,
          onProgress: (processed, total, file) => {
            // Progress callback - could be used for UI updates
          },
        });

        const duration = (result.duration / 1000).toFixed(2);
        const errorsStr = result.errors.length > 0
          ? `\nErrors (${result.errors.length}):\n${result.errors.slice(0, 5).map(e => `  - ${e}`).join('\n')}${result.errors.length > 5 ? `\n  ... and ${result.errors.length - 5} more` : ''}`
          : '';

        return `__SYMBOLS_REBUILD__:${result.filesProcessed}:${result.symbolsExtracted}:${duration}:${errorsStr}`;
      }

      case 'update': {
        const result = await symbolIndexService.incrementalUpdate({
          projectRoot,
        });

        const duration = (result.duration / 1000).toFixed(2);
        return `__SYMBOLS_UPDATE__:${result.added}:${result.modified}:${result.removed}:${duration}`;
      }

      case 'stats': {
        const stats = symbolIndexService.getStats();
        const indexDir = getIndexDirectory(projectRoot);
        const sizeKb = (stats.indexSizeBytes / 1024).toFixed(1);

        return `__SYMBOLS_STATS__:${JSON.stringify({
          ...stats,
          indexDir,
          sizeKb,
        })}`;
      }

      case 'search': {
        if (!rest) {
          return '__SYMBOLS_ERROR__:Search requires a symbol name. Usage: /symbols search <name>';
        }

        const results = symbolIndexService.findSymbols(rest, { limit: 15 });

        if (results.length === 0) {
          return `__SYMBOLS_SEARCH_EMPTY__:${rest}`;
        }

        return `__SYMBOLS_SEARCH__:${rest}:${JSON.stringify(results)}`;
      }

      case 'clear': {
        const indexDir = getIndexDirectory(projectRoot);
        if (fs.existsSync(indexDir)) {
          fs.rmSync(indexDir, { recursive: true, force: true });
          // Reinitialize
          symbolIndexService = new SymbolIndexService(projectRoot);
          await symbolIndexService.initialize();
          return '__SYMBOLS_CLEAR__';
        }
        return '__SYMBOLS_CLEAR_NOT_FOUND__';
      }

      default:
        return `__SYMBOLS_UNKNOWN__:${action}`;
    }
  },
};

/**
 * Register all symbol commands.
 */
export function registerSymbolCommands(): void {
  registerCommand(symbolsCommand);
}
