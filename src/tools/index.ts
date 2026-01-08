export { BaseTool } from './base.js';
export { ToolRegistry, globalRegistry } from './registry.js';
export { ReadFileTool } from './read-file.js';
export { WriteFileTool } from './write-file.js';
export { BashTool } from './bash.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
export { ListDirectoryTool } from './list-directory.js';
export { EditFileTool } from './edit-file.js';
export { PatchFileTool } from './patch-file.js';

import { globalRegistry } from './registry.js';
import { ReadFileTool } from './read-file.js';
import { WriteFileTool } from './write-file.js';
import { BashTool } from './bash.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { ListDirectoryTool } from './list-directory.js';
import { EditFileTool } from './edit-file.js';
import { PatchFileTool } from './patch-file.js';

/**
 * Register all default tools with the global registry.
 */
export function registerDefaultTools(): void {
  // File operations
  globalRegistry.register(new ReadFileTool());
  globalRegistry.register(new WriteFileTool());
  globalRegistry.register(new EditFileTool());
  globalRegistry.register(new PatchFileTool());

  // File exploration
  globalRegistry.register(new GlobTool());
  globalRegistry.register(new GrepTool());
  globalRegistry.register(new ListDirectoryTool());

  // Shell
  globalRegistry.register(new BashTool());
}
