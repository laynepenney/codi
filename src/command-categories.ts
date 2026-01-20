// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic command categories for auto-approval.
 * Each category defines a set of patterns that match commands in that category.
 */

export interface CommandCategory {
  /** Unique category identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description shown to user */
  description: string;
  /** Command patterns that match this category */
  patterns: RegExp[];
  /** Patterns that should NOT match even if above patterns match */
  excludePatterns?: RegExp[];
}

export const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    id: 'run-tests',
    name: 'Run Tests',
    description: 'Commands that run test suites',
    patterns: [
      /^npm\s+(run\s+)?test(\s|$)/,
      /^yarn\s+(run\s+)?test(\s|$)/,
      /^pnpm\s+(run\s+)?test(\s|$)/,
      /^bun\s+test(\s|$)/,
      /^npx\s+(jest|vitest|mocha|ava|tape)(\s|$)/,
      /^pytest(\s|$)/,
      /^python\s+-m\s+pytest(\s|$)/,
      /^go\s+test(\s|$)/,
      /^cargo\s+test(\s|$)/,
      /^mix\s+test(\s|$)/,
      /^bundle\s+exec\s+rspec(\s|$)/,
      /^rake\s+test(\s|$)/,
      /^\.\/gradlew\s+test(\s|$)/,
      /^mvn\s+test(\s|$)/,
      /^make\s+test(\s|$)/,
    ],
  },
  {
    id: 'install-deps',
    name: 'Install Dependencies',
    description: 'Commands that install project dependencies',
    patterns: [
      /^npm\s+(ci|install|i)(\s|$)/,
      /^yarn(\s+install)?(\s|$)/,
      /^pnpm\s+(install|i)(\s|$)/,
      /^bun\s+install(\s|$)/,
      /^pip\s+install(\s|$)/,
      /^pip3\s+install(\s|$)/,
      /^python\s+-m\s+pip\s+install(\s|$)/,
      /^cargo\s+(build|fetch)(\s|$)/,
      /^go\s+(mod\s+download|get)(\s|$)/,
      /^bundle\s+install(\s|$)/,
      /^composer\s+install(\s|$)/,
      /^mix\s+deps\.get(\s|$)/,
    ],
    excludePatterns: [
      // Exclude global installs
      /\s+-g(\s|$)/,
      /\s+--global(\s|$)/,
    ],
  },
  {
    id: 'git-safe',
    name: 'Safe Git Operations',
    description: 'Non-destructive git commands (status, log, diff, branch)',
    patterns: [
      /^git\s+(status|log|diff|show|ls-files|remote|tag)(\s|$)/,
      /^git\s+branch(\s+-[avl])?(\s|$)/,
      /^git\s+stash\s+list(\s|$)/,
      /^git\s+config\s+--get(\s|$)/,
      /^git\s+describe(\s|$)/,
      /^git\s+rev-parse(\s|$)/,
    ],
    excludePatterns: [
      /--force/,
      /--hard/,
      /-D\s/,
      /--delete/,
    ],
  },
  {
    id: 'git-commit',
    name: 'Git Commit Operations',
    description: 'Git add, commit, and stash (no push)',
    patterns: [
      /^git\s+add(\s|$)/,
      /^git\s+commit(\s|$)/,
      /^git\s+stash(\s|$)/,
      /^git\s+checkout(\s|$)/,
      /^git\s+switch(\s|$)/,
      /^git\s+restore(\s|$)/,
    ],
    excludePatterns: [
      /--force/,
      /--hard/,
      /--amend/,
    ],
  },
  {
    id: 'build-project',
    name: 'Build Project',
    description: 'Commands that build/compile the project',
    patterns: [
      /^npm\s+run\s+build(\s|$)/,
      /^yarn\s+(run\s+)?build(\s|$)/,
      /^pnpm\s+(run\s+)?build(\s|$)/,
      /^bun\s+run\s+build(\s|$)/,
      /^cargo\s+build(\s|$)/,
      /^go\s+build(\s|$)/,
      /^make(\s+all)?(\s|$)/,
      /^\.\/gradlew\s+build(\s|$)/,
      /^mvn\s+(compile|package)(\s|$)/,
      /^tsc(\s|$)/,
      /^npx\s+tsc(\s|$)/,
    ],
  },
  {
    id: 'lint-format',
    name: 'Lint & Format',
    description: 'Commands that lint or format code',
    patterns: [
      /^npm\s+run\s+(lint|format|prettier|eslint)(\s|$)/,
      /^yarn\s+(run\s+)?(lint|format|prettier|eslint)(\s|$)/,
      /^pnpm\s+(run\s+)?(lint|format|prettier|eslint)(\s|$)/,
      /^npx\s+(eslint|prettier|biome|oxlint)(\s|$)/,
      /^cargo\s+(fmt|clippy)(\s|$)/,
      /^go\s+fmt(\s|$)/,
      /^gofmt(\s|$)/,
      /^black(\s|$)/,
      /^ruff(\s|$)/,
      /^pylint(\s|$)/,
      /^flake8(\s|$)/,
    ],
  },
  {
    id: 'list-files',
    name: 'List Files',
    description: 'Commands that list directory contents',
    patterns: [
      /^ls(\s|$)/,
      /^dir(\s|$)/,
      /^tree(\s|$)/,
      /^find\s+.*-name(\s|$)/,
      /^find\s+.*-type(\s|$)/,
    ],
    excludePatterns: [
      /-exec/,
      /-delete/,
      /xargs/,
    ],
  },
  {
    id: 'read-files',
    name: 'Read Files',
    description: 'Commands that read file contents',
    patterns: [
      /^cat(\s|$)/,
      /^head(\s|$)/,
      /^tail(\s|$)/,
      /^less(\s|$)/,
      /^more(\s|$)/,
      /^bat(\s|$)/,
      /^wc(\s|$)/,
      /^grep(\s|$)/,
      /^rg(\s|$)/,
      /^ag(\s|$)/,
    ],
  },
  {
    id: 'docker-read',
    name: 'Docker Read Operations',
    description: 'Non-destructive docker commands',
    patterns: [
      /^docker\s+(ps|images|logs|inspect|stats|top)(\s|$)/,
      /^docker\s+compose\s+(ps|logs|config)(\s|$)/,
    ],
  },
];

/**
 * Find which categories a command matches.
 */
export function matchCategories(command: string): CommandCategory[] {
  const matches: CommandCategory[] = [];
  const trimmed = command.trim();

  for (const category of COMMAND_CATEGORIES) {
    // Check if any pattern matches
    const patternMatches = category.patterns.some((p) => p.test(trimmed));
    if (!patternMatches) continue;

    // Check if any exclusion pattern matches
    const excluded = category.excludePatterns?.some((p) => p.test(trimmed));
    if (excluded) continue;

    matches.push(category);
  }

  return matches;
}

/**
 * Check if a command matches a specific category.
 */
export function matchesCategory(command: string, categoryId: string): boolean {
  const category = COMMAND_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return false;

  const trimmed = command.trim();
  const patternMatches = category.patterns.some((p) => p.test(trimmed));
  if (!patternMatches) return false;

  const excluded = category.excludePatterns?.some((p) => p.test(trimmed));
  return !excluded;
}

/**
 * Get a category by ID.
 */
export function getCategory(categoryId: string): CommandCategory | undefined {
  return COMMAND_CATEGORIES.find((c) => c.id === categoryId);
}

/**
 * Get all available categories.
 */
export function getAllCategories(): CommandCategory[] {
  return COMMAND_CATEGORIES;
}
