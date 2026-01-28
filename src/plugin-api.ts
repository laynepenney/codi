// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Plugin API for Codi
 *
 * This module exports the types and interfaces that plugins need to implement
 * commands, tools, and providers. Plugins should import from this module.
 *
 * @example
 * ```typescript
 * import type { CodiPlugin, Command, CommandContext } from 'codi-ai/plugin-api';
 *
 * export const myPlugin: CodiPlugin = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   commands: [myCommand],
 * };
 * ```
 */

// Plugin interface
export type { CodiPlugin, LoadedPlugin } from './plugins.js';

// Command types
export type { Command, CommandContext, ProjectInfo, SessionState } from './commands/index.js';

// Tool types
export type { BaseTool } from './tools/base.js';
export type { ToolDefinition, ToolCall, ToolResult } from './types.js';

// Provider types
export type { BaseProvider } from './providers/base.js';
export type { ProviderConfig, IProvider } from './types.js';
export { createProvider, type CreateProviderOptions } from './providers/index.js';

// Agent type (for commands that need agent access)
export type { Agent } from './agent.js';
