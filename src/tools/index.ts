export { BaseTool } from './base.js';
export { ToolRegistry, globalRegistry } from './registry.js';
export { ReadFileTool } from './read-file.js';
export { WriteFileTool } from './write-file.js';
export { BashTool } from './bash.js';

import { globalRegistry } from './registry.js';
import { ReadFileTool } from './read-file.js';
import { WriteFileTool } from './write-file.js';
import { BashTool } from './bash.js';

/**
 * Register all default tools with the global registry.
 */
export function registerDefaultTools(): void {
  globalRegistry.register(new ReadFileTool());
  globalRegistry.register(new WriteFileTool());
  globalRegistry.register(new BashTool());
}
