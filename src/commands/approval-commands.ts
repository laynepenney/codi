// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Approval management commands.
 * Allows users to view and manage approved command patterns and categories.
 */
import { registerCommand, type Command, type CommandContext } from './index.js';
import {
  listApprovals,
  listPathApprovals,
  removeApprovedPattern,
  removeApprovedCategory,
  addApprovedPattern,
  addApprovedCategory,
  addApprovedPathPattern,
  addApprovedPathCategory,
  removeApprovedPathPattern,
  removeApprovedPathCategory,
  getAllCategories,
  getAllPathCategories,
} from '../approvals.js';

/**
 * /approvals command - View and manage approved command patterns and file path patterns.
 */
export const approvalsCommand: Command = {
  name: 'approvals',
  aliases: ['approved', 'approval'],
  description: 'View and manage approved command patterns and file path patterns',
  usage: '/approvals [list|add|remove|categories|pathcategories]',
  taskType: 'fast',
  execute: async (args: string, _context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const action = parts[0] || 'list';

    switch (action) {
      case 'list': {
        const { patterns, categories } = listApprovals();
        const { pathPatterns, pathCategories } = listPathApprovals();
        return `__APPROVALS_LIST__:${JSON.stringify({ patterns, categories, pathPatterns, pathCategories })}`;
      }

      case 'add': {
        const type = parts[1]; // 'pattern', 'category', 'path', or 'pathcategory'
        const value = parts.slice(2).join(' ');

        if (type === 'pattern' && value) {
          const result = addApprovedPattern(value);
          if (result.success) {
            return `__APPROVAL_ADDED__:pattern:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        if (type === 'category' && value) {
          const result = addApprovedCategory(value);
          if (result.success) {
            return `__APPROVAL_ADDED__:category:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        if (type === 'path' && value) {
          const result = addApprovedPathPattern(value, '*');
          if (result.success) {
            return `__APPROVAL_ADDED__:path:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        if (type === 'pathcategory' && value) {
          const result = addApprovedPathCategory(value);
          if (result.success) {
            return `__APPROVAL_ADDED__:pathcategory:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        return '__APPROVAL_USAGE__:add pattern|category|path|pathcategory <value>';
      }

      case 'remove': {
        const type = parts[1]; // 'pattern', 'category', 'path', or 'pathcategory'
        const value = parts.slice(2).join(' ');

        if (type === 'pattern' && value) {
          const result = removeApprovedPattern(value);
          if (result.success) {
            return result.removed
              ? `__APPROVAL_REMOVED__:pattern:${value}`
              : `__APPROVAL_NOT_FOUND__:pattern:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        if (type === 'category' && value) {
          const result = removeApprovedCategory(value);
          if (result.success) {
            return result.removed
              ? `__APPROVAL_REMOVED__:category:${value}`
              : `__APPROVAL_NOT_FOUND__:category:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        if (type === 'path' && value) {
          const result = removeApprovedPathPattern(value);
          if (result.success) {
            return result.removed
              ? `__APPROVAL_REMOVED__:path:${value}`
              : `__APPROVAL_NOT_FOUND__:path:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        if (type === 'pathcategory' && value) {
          const result = removeApprovedPathCategory(value);
          if (result.success) {
            return result.removed
              ? `__APPROVAL_REMOVED__:pathcategory:${value}`
              : `__APPROVAL_NOT_FOUND__:pathcategory:${value}`;
          }
          return `__APPROVAL_ERROR__:${result.error}`;
        }

        return '__APPROVAL_USAGE__:remove pattern|category|path|pathcategory <value>';
      }

      case 'categories': {
        const categories = getAllCategories();
        return `__APPROVAL_CATEGORIES__:${JSON.stringify(categories)}`;
      }

      case 'pathcategories': {
        const pathCategories = getAllPathCategories();
        return `__APPROVAL_PATH_CATEGORIES__:${JSON.stringify(pathCategories)}`;
      }

      default:
        return '__APPROVAL_USAGE__:list | add | remove | categories | pathcategories';
    }
  },
};

export function registerApprovalCommands(): void {
  registerCommand(approvalsCommand);
}
