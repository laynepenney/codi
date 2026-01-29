// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApprovedPattern, ApprovedPathPattern } from '../types.js';
import {
  checkCommandApproval,
  getApprovalSuggestions,
  addApprovedPattern as addApprovedPatternUtil,
  addApprovedCategory as addApprovedCategoryUtil,
  checkPathApproval,
  getPathApprovalSuggestions,
  addApprovedPathPattern as addApprovedPathPatternUtil,
  addApprovedPathCategory as addApprovedPathCategoryUtil,
} from '../approvals.js';
import { checkDangerousBash } from '../utils/index.js';
import { TOOL_CATEGORIES } from '../constants.js';

export class ApprovalManager {
  private autoApproveAll: boolean;
  private autoApproveTools: Set<string>;
  private approvedPatterns: ApprovedPattern[];
  private approvedCategories: string[];
  private approvedPathPatterns: ApprovedPathPattern[];
  private approvedPathCategories: string[];
  private customDangerousPatterns: Array<{ pattern: RegExp; description: string }>;

  constructor(
    autoApproveAll: boolean = false,
    autoApproveTools: string[] = [],
    approvedPatterns: ApprovedPattern[] = [],
    approvedCategories: string[] = [],
    approvedPathPatterns: ApprovedPathPattern[] = [],
    approvedPathCategories: string[] = [],
    customDangerousPatterns: Array<{ pattern: RegExp; description: string }> = []
  ) {
    this.autoApproveAll = autoApproveAll;
    this.autoApproveTools = new Set(autoApproveTools);
    this.approvedPatterns = approvedPatterns;
    this.approvedCategories = approvedCategories;
    this.approvedPathPatterns = approvedPathPatterns;
    this.approvedPathCategories = approvedPathCategories;
    this.customDangerousPatterns = customDangerousPatterns;
  }

  /**
   * Check if a tool should be auto-approved
   */
  shouldAutoApprove(toolName: string): boolean {
    return this.autoApproveAll || this.autoApproveTools.has(toolName);
  }

  /**
   * Check if a bash command should be auto-approved
   */
  shouldAutoApproveBash(command: string): boolean {
    const result = checkCommandApproval(
      command,
      this.approvedPatterns,
      this.approvedCategories
    );
    return result.approved;
  }

  /**
   * Check if a file operation should be auto-approved
   */
  shouldAutoApproveFilePath(toolName: string, filePath: string): boolean {
    const result = checkPathApproval(
      toolName,
      filePath,
      this.approvedPathPatterns,
      this.approvedPathCategories
    );
    return result.approved;
  }

  /**
   * Check if a tool is dangerous
   */
  isToolDangerous(toolName: string): boolean {
    return TOOL_CATEGORIES.DESTRUCTIVE.has(toolName);
  }

  /**
   * Check if a bash command is dangerous
   */
  isBashCommandDangerous(command: string): {
    isDangerous: boolean;
    reason?: string;
  } {
    // Check built-in dangerous patterns
    const danger = checkDangerousBash(command);
    let isDangerous = danger.isDangerous;
    let dangerReason = danger.reason;

    // Check custom dangerous patterns if not already flagged
    if (!isDangerous && this.customDangerousPatterns.length > 0) {
      for (const { pattern, description } of this.customDangerousPatterns) {
        if (pattern.test(command)) {
          isDangerous = true;
          dangerReason = description;
          break;
        }
      }
    }

    return { isDangerous, reason: dangerReason };
  }

  /**
   * Get approval suggestions for a bash command
   */
  getApprovalSuggestions(command: string): {
    suggestedPattern: string;
    matchedCategories: Array<{ id: string; name: string; description: string }>;
  } {
    return getApprovalSuggestions(command);
  }

  /**
   * Get path approval suggestions
   */
  getPathApprovalSuggestions(toolName: string, filePath: string): {
    suggestedPattern: string;
    matchedCategories: Array<{ id: string; name: string; description: string }>;
  } {
    return getPathApprovalSuggestions(toolName, filePath);
  }

  /**
   * Add an approved pattern
   */
  addApprovedPattern(pattern: string): { success: boolean; error?: string } {
    return addApprovedPatternUtil(pattern, this.approvedPatterns);
  }

  /**
   * Add an approved category
   */
  addApprovedCategory(categoryId: string): { success: boolean; error?: string } {
    return addApprovedCategoryUtil(categoryId, this.approvedCategories);
  }

  /**
   * Add an approved path pattern
   */
  addApprovedPathPattern(pattern: string): { success: boolean; error?: string } {
    return addApprovedPathPatternUtil(pattern, this.approvedPathPatterns);
  }

  /**
   * Add an approved path category
   */
  addApprovedPathCategory(categoryId: string): { success: boolean; error?: string } {
    return addApprovedPathCategoryUtil(categoryId, this.approvedPathCategories);
  }

  /**
   * Get file tools that support path approval
   */
  getFileTools(): Set<string> {
    return new Set(['write_file', 'edit_file', 'insert_line', 'patch_file']);
  }

  /**
   * Check if tool requires confirmation
   */
  requiresConfirmation(
    toolName: string,
    hasConfirmCallback: boolean,
    command?: string,
    filePath?: string
  ): boolean {
    // Check if auto-approved
    if (this.shouldAutoApprove(toolName)) {
      return false;
    }

    // Check if tool is destructive and has confirm callback
    const needsConfirmation = TOOL_CATEGORIES.DESTRUCTIVE.has(toolName) &&
      hasConfirmCallback;

    // For bash commands, check approved patterns/categories
    if (needsConfirmation && toolName === 'bash' && command) {
      if (this.shouldAutoApproveBash(command)) {
        return false;
      }
    }

    // For file tools, check approved path patterns/categories
    if (needsConfirmation && this.getFileTools().has(toolName) && filePath) {
      if (this.shouldAutoApproveFilePath(toolName, filePath)) {
        return false;
      }
    }

    return needsConfirmation;
  }
}