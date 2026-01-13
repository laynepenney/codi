/**
 * Manages approved patterns and categories for bash commands and file operations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { matchesPattern, suggestPattern, matchesPathPattern, suggestPathPattern } from './pattern-matching.js';
import {
  matchCategories,
  matchesCategory,
  getCategory,
  getAllCategories,
  type CommandCategory,
} from './command-categories.js';
import {
  matchPathCategories,
  matchesPathCategory,
  getPathCategory,
  getAllPathCategories,
  type PathCategory,
} from './path-categories.js';

/** An approved command pattern with metadata */
export interface ApprovedPattern {
  /** The glob-like pattern (e.g., "npm *", "git status") */
  pattern: string;
  /** When this pattern was approved */
  approvedAt: string;
  /** Optional description of what this pattern covers */
  description?: string;
}

export interface ApprovalCheckResult {
  approved: boolean;
  reason?: string;
  matchedPattern?: string;
  matchedCategory?: string;
}

export interface ApprovalSuggestions {
  suggestedPattern: string;
  matchedCategories: CommandCategory[];
}

/**
 * Check if a bash command is auto-approved by patterns or categories.
 */
export function checkCommandApproval(
  command: string,
  approvedPatterns: ApprovedPattern[],
  approvedCategories: string[]
): ApprovalCheckResult {
  // Check approved patterns first
  for (const { pattern } of approvedPatterns) {
    if (matchesPattern(command, pattern)) {
      return {
        approved: true,
        reason: `matches pattern: ${pattern}`,
        matchedPattern: pattern,
      };
    }
  }

  // Check approved categories
  for (const categoryId of approvedCategories) {
    if (matchesCategory(command, categoryId)) {
      const cat = getCategory(categoryId);
      return {
        approved: true,
        reason: `matches category: ${cat?.name || categoryId}`,
        matchedCategory: categoryId,
      };
    }
  }

  return { approved: false };
}

/**
 * Get approval suggestions for a command.
 */
export function getApprovalSuggestions(command: string): ApprovalSuggestions {
  return {
    suggestedPattern: suggestPattern(command),
    matchedCategories: matchCategories(command),
  };
}

/**
 * Find the config file path.
 */
function findConfigPath(cwd: string): string {
  const candidates = ['.codi.json', '.codi/config.json', 'codi.config.json'];

  for (const candidate of candidates) {
    const fullPath = path.join(cwd, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Default to .codi.json
  return path.join(cwd, '.codi.json');
}

/**
 * Load config from file.
 */
function loadConfig(configPath: string): Record<string, unknown> {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Save config to file.
 */
function saveConfig(configPath: string, config: Record<string, unknown>): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Add an approved pattern to the config file.
 */
export function addApprovedPattern(
  pattern: string,
  description?: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  const configPath = findConfigPath(cwd);

  try {
    const config = loadConfig(configPath);

    // Initialize array if needed
    if (!Array.isArray(config.approvedPatterns)) {
      config.approvedPatterns = [];
    }

    const patterns = config.approvedPatterns as ApprovedPattern[];

    // Check if pattern already exists
    const exists = patterns.some((p) => p.pattern === pattern);
    if (exists) {
      return { success: true }; // Already approved
    }

    // Add new pattern
    patterns.push({
      pattern,
      approvedAt: new Date().toISOString(),
      description,
    });

    saveConfig(configPath, config);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Add an approved category to the config file.
 */
export function addApprovedCategory(
  categoryId: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  // Validate category exists
  const category = getCategory(categoryId);
  if (!category) {
    return {
      success: false,
      error: `Unknown category: ${categoryId}`,
    };
  }

  const configPath = findConfigPath(cwd);

  try {
    const config = loadConfig(configPath);

    // Initialize array if needed
    if (!Array.isArray(config.approvedCategories)) {
      config.approvedCategories = [];
    }

    const categories = config.approvedCategories as string[];

    // Check if category already exists
    if (categories.includes(categoryId)) {
      return { success: true }; // Already approved
    }

    // Add new category
    categories.push(categoryId);

    saveConfig(configPath, config);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove an approved pattern from the config file.
 */
export function removeApprovedPattern(
  pattern: string,
  cwd: string = process.cwd()
): { success: boolean; removed: boolean; error?: string } {
  const configPath = findConfigPath(cwd);

  try {
    if (!fs.existsSync(configPath)) {
      return { success: true, removed: false };
    }

    const config = loadConfig(configPath);
    const patterns = config.approvedPatterns as ApprovedPattern[] | undefined;
    const originalLength = patterns?.length || 0;

    config.approvedPatterns = (patterns || []).filter((p) => p.pattern !== pattern);

    const removed = (config.approvedPatterns as ApprovedPattern[]).length < originalLength;

    saveConfig(configPath, config);
    return { success: true, removed };
  } catch (error) {
    return {
      success: false,
      removed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove an approved category from the config file.
 */
export function removeApprovedCategory(
  categoryId: string,
  cwd: string = process.cwd()
): { success: boolean; removed: boolean; error?: string } {
  const configPath = findConfigPath(cwd);

  try {
    if (!fs.existsSync(configPath)) {
      return { success: true, removed: false };
    }

    const config = loadConfig(configPath);
    const categories = config.approvedCategories as string[] | undefined;
    const originalLength = categories?.length || 0;

    config.approvedCategories = (categories || []).filter((c) => c !== categoryId);

    const removed = (config.approvedCategories as string[]).length < originalLength;

    saveConfig(configPath, config);
    return { success: true, removed };
  } catch (error) {
    return {
      success: false,
      removed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List all approved patterns and categories.
 */
export function listApprovals(cwd: string = process.cwd()): {
  patterns: ApprovedPattern[];
  categories: { id: string; name: string; description: string }[];
} {
  const configPath = findConfigPath(cwd);

  try {
    if (!fs.existsSync(configPath)) {
      return { patterns: [], categories: [] };
    }

    const config = loadConfig(configPath);

    const patterns = (config.approvedPatterns as ApprovedPattern[] | undefined) || [];
    const categoryIds = (config.approvedCategories as string[] | undefined) || [];

    const categories = categoryIds
      .map((id) => getCategory(id))
      .filter((c): c is CommandCategory => c !== undefined)
      .map((c) => ({ id: c.id, name: c.name, description: c.description }));

    return { patterns, categories };
  } catch {
    return { patterns: [], categories: [] };
  }
}

// Re-export for convenience
export { getAllCategories, getCategory };

// ============================================================================
// Path Approval (for file operations)
// ============================================================================

/** An approved file path pattern with metadata */
export interface ApprovedPathPattern {
  /** The glob-like path pattern */
  pattern: string;
  /** Tool name this pattern applies to, or * for all file tools */
  toolName: string;
  /** When this pattern was approved */
  approvedAt: string;
  /** Optional description of what this pattern covers */
  description?: string;
}

export interface PathApprovalCheckResult {
  approved: boolean;
  reason?: string;
  matchedPattern?: string;
  matchedCategory?: string;
}

export interface PathApprovalSuggestions {
  suggestedPattern: string;
  matchedCategories: PathCategory[];
}

/**
 * Check if a file operation is auto-approved by path patterns or categories.
 */
export function checkPathApproval(
  toolName: string,
  filePath: string,
  approvedPathPatterns: ApprovedPathPattern[],
  approvedPathCategories: string[]
): PathApprovalCheckResult {
  // Normalize path
  const normalized = filePath.replace(/\\/g, '/');

  // Check approved path patterns first
  for (const { pattern, toolName: patternToolName } of approvedPathPatterns) {
    // Pattern must match tool name or be wildcard
    if (patternToolName !== '*' && patternToolName !== toolName) {
      continue;
    }

    if (matchesPathPattern(normalized, pattern)) {
      return {
        approved: true,
        reason: `matches path pattern: ${pattern}`,
        matchedPattern: pattern,
      };
    }
  }

  // Check approved path categories
  for (const categoryId of approvedPathCategories) {
    if (matchesPathCategory(normalized, categoryId)) {
      const cat = getPathCategory(categoryId);
      return {
        approved: true,
        reason: `matches path category: ${cat?.name || categoryId}`,
        matchedCategory: categoryId,
      };
    }
  }

  return { approved: false };
}

/**
 * Get path approval suggestions for a file path.
 */
export function getPathApprovalSuggestions(filePath: string): PathApprovalSuggestions {
  return {
    suggestedPattern: suggestPathPattern(filePath),
    matchedCategories: matchPathCategories(filePath),
  };
}

/**
 * Add an approved path pattern to the config file.
 */
export function addApprovedPathPattern(
  pattern: string,
  toolName: string = '*',
  description?: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  const configPath = findConfigPath(cwd);

  try {
    const config = loadConfig(configPath);

    // Initialize array if needed
    if (!Array.isArray(config.approvedPathPatterns)) {
      config.approvedPathPatterns = [];
    }

    const patterns = config.approvedPathPatterns as ApprovedPathPattern[];

    // Check if pattern already exists for this tool
    const exists = patterns.some((p) => p.pattern === pattern && p.toolName === toolName);
    if (exists) {
      return { success: true }; // Already approved
    }

    // Add new pattern
    patterns.push({
      pattern,
      toolName,
      approvedAt: new Date().toISOString(),
      description,
    });

    saveConfig(configPath, config);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Add an approved path category to the config file.
 */
export function addApprovedPathCategory(
  categoryId: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  // Validate category exists
  const category = getPathCategory(categoryId);
  if (!category) {
    return {
      success: false,
      error: `Unknown path category: ${categoryId}`,
    };
  }

  const configPath = findConfigPath(cwd);

  try {
    const config = loadConfig(configPath);

    // Initialize array if needed
    if (!Array.isArray(config.approvedPathCategories)) {
      config.approvedPathCategories = [];
    }

    const categories = config.approvedPathCategories as string[];

    // Check if category already exists
    if (categories.includes(categoryId)) {
      return { success: true }; // Already approved
    }

    // Add new category
    categories.push(categoryId);

    saveConfig(configPath, config);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove an approved path pattern from the config file.
 */
export function removeApprovedPathPattern(
  pattern: string,
  toolName?: string,
  cwd: string = process.cwd()
): { success: boolean; removed: boolean; error?: string } {
  const configPath = findConfigPath(cwd);

  try {
    if (!fs.existsSync(configPath)) {
      return { success: true, removed: false };
    }

    const config = loadConfig(configPath);
    const patterns = config.approvedPathPatterns as ApprovedPathPattern[] | undefined;
    const originalLength = patterns?.length || 0;

    config.approvedPathPatterns = (patterns || []).filter((p) => {
      if (toolName) {
        return !(p.pattern === pattern && p.toolName === toolName);
      }
      return p.pattern !== pattern;
    });

    const removed = (config.approvedPathPatterns as ApprovedPathPattern[]).length < originalLength;

    saveConfig(configPath, config);
    return { success: true, removed };
  } catch (error) {
    return {
      success: false,
      removed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Remove an approved path category from the config file.
 */
export function removeApprovedPathCategory(
  categoryId: string,
  cwd: string = process.cwd()
): { success: boolean; removed: boolean; error?: string } {
  const configPath = findConfigPath(cwd);

  try {
    if (!fs.existsSync(configPath)) {
      return { success: true, removed: false };
    }

    const config = loadConfig(configPath);
    const categories = config.approvedPathCategories as string[] | undefined;
    const originalLength = categories?.length || 0;

    config.approvedPathCategories = (categories || []).filter((c) => c !== categoryId);

    const removed = (config.approvedPathCategories as string[]).length < originalLength;

    saveConfig(configPath, config);
    return { success: true, removed };
  } catch (error) {
    return {
      success: false,
      removed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List all approved path patterns and categories.
 */
export function listPathApprovals(cwd: string = process.cwd()): {
  pathPatterns: ApprovedPathPattern[];
  pathCategories: { id: string; name: string; description: string }[];
} {
  const configPath = findConfigPath(cwd);

  try {
    if (!fs.existsSync(configPath)) {
      return { pathPatterns: [], pathCategories: [] };
    }

    const config = loadConfig(configPath);

    const pathPatterns = (config.approvedPathPatterns as ApprovedPathPattern[] | undefined) || [];
    const categoryIds = (config.approvedPathCategories as string[] | undefined) || [];

    const pathCategories = categoryIds
      .map((id) => getPathCategory(id))
      .filter((c): c is PathCategory => c !== undefined)
      .map((c) => ({ id: c.id, name: c.name, description: c.description }));

    return { pathPatterns, pathCategories };
  } catch {
    return { pathPatterns: [], pathCategories: [] };
  }
}

// Re-export path category functions
export { getAllPathCategories, getPathCategory };
