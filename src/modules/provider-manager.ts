// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BaseProvider } from '../providers/base.js';
import type { ModelMap } from '../model-map/index.js';
import { logger } from '../logger.js';

export class ProviderManager {
  constructor(
    private primaryProvider: BaseProvider,
    private modelMap: ModelMap | null = null
  ) {}

  /**
   * Get the provider for chat, potentially using model map routing
   */
  getProviderForChat(taskType?: string): BaseProvider {
    if (taskType && this.modelMap) {
      try {
        const result = this.modelMap.router.routeTask(taskType);
        if (result.type === 'model') {
          const provider = this.modelMap.registry.getProvider(result.model.name);
          logger.debug(`Using ${provider.getName()} (${provider.getModel()}) for task type "${taskType}"`);
          return provider;
        }
      } catch (error) {
        logger.debug(`Failed to route task type "${taskType}", using primary provider: ${error}`);
      }
    }
    return this.primaryProvider;
  }

  /**
   * Get provider for specific task types
   */
  getProviderForTask(taskType: string): BaseProvider {
    if (this.modelMap) {
      try {
        const result = this.modelMap.router.routeTask(taskType);
        if (result.type === 'model') {
          const provider = this.modelMap.registry.getProvider(result.model.name);
          logger.debug(`Using ${provider.getName()} (${provider.getModel()}) for task type "${taskType}"`);
          return provider;
        }
      } catch (error) {
        logger.debug(`Failed to route task type "${taskType}", using primary provider: ${error}`);
      }
    }
    return this.primaryProvider;
  }

  /**
   * Get provider for command execution
   */
  getProviderForCommand(commandName: string): BaseProvider {
    if (this.modelMap) {
      try {
        const result = this.modelMap.router.routeCommand(commandName);
        if (result.type === 'model') {
          const provider = this.modelMap.registry.getProvider(result.model.name);
          logger.debug(`Using ${provider.getName()} (${provider.getModel()}) for command "${commandName}"`);
          return provider;
        }
      } catch (error) {
        logger.debug(`Failed to route command "${commandName}", using primary provider: ${error}`);
      }
    }
    return this.primaryProvider;
  }

  /**
   * Get the primary provider
   */
  getProvider(): BaseProvider {
    return this.primaryProvider;
  }

  /**
   * Set the primary provider
   */
  setProvider(provider: BaseProvider, onProviderChange?: (provider: BaseProvider) => void): void {
    this.primaryProvider = provider;
    if (onProviderChange) {
      onProviderChange(provider);
    }
  }

  /**
   * Check if a command has a pipeline configuration
   */
  commandHasPipeline(commandName: string): boolean {
    return this.modelMap?.router.commandHasPipeline(commandName) ?? false;
  }

  /**
   * Get the model map instance
   */
  getModelMap(): ModelMap | null {
    return this.modelMap;
  }

  /**
   * Set the model map instance
   */
  setModelMap(modelMap: ModelMap): void {
    this.modelMap = modelMap;
  }
}