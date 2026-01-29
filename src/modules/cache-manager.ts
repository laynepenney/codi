// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ToolDefinition } from '../types.js';
import { countMessageTokens } from '../utils/index.js';

export class CacheManager {
  private cachedToolDefinitions: ToolDefinition[] | null = null;
  private cachedTokenCount: number | null = null;
  private tokenCacheValid: boolean = false;

  constructor(private toolRegistry: { getDefinitions: () => ToolDefinition[] }) {}

  /**
   * Get cached tool definitions
   */
  getCachedToolDefinitions(): ToolDefinition[] {
    if (!this.cachedToolDefinitions) {
      this.cachedToolDefinitions = this.toolRegistry.getDefinitions();
    }
    return this.cachedToolDefinitions;
  }

  /**
   * Invalidate tool definition cache
   */
  invalidateToolCache(): void {
    this.cachedToolDefinitions = null;
  }

  /**
   * Get cached token count
   */
  getCachedTokenCount(messages: any[]): number {
    if (!this.tokenCacheValid) {
      this.cachedTokenCount = countMessageTokens(messages);
      this.tokenCacheValid = true;
    }
    return this.cachedTokenCount!;
  }

  /**
   * Invalidate token count cache
   */
  invalidateTokenCache(): void {
    this.tokenCacheValid = false;
    this.cachedTokenCount = null;
  }

  /**
   * Reset all caches
   */
  resetAllCaches(): void {
    this.invalidateToolCache();
    this.invalidateTokenCache();
  }

  /**
   * Check if token cache is valid
   */
  isTokenCacheValid(): boolean {
    return this.tokenCacheValid;
  }

  /**
   * Check if tool definitions cache is populated
   */
  isToolCachePopulated(): boolean {
    return this.cachedToolDefinitions !== null;
  }

  /**
   * Force cache refresh
   */
  refreshAllCaches(): void {
    this.cachedToolDefinitions = this.toolRegistry.getDefinitions();
    this.tokenCacheValid = false;
  }
}