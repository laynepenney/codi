/**
 * Semantic path categories for file operation auto-approval.
 * Each category defines a set of patterns that match file paths in that category.
 */

export interface PathCategory {
  /** Unique category identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description shown to user */
  description: string;
  /** Path patterns that match this category */
  patterns: RegExp[];
  /** Patterns that should NOT match even if above patterns match */
  excludePatterns?: RegExp[];
}

export const PATH_CATEGORIES: PathCategory[] = [
  {
    id: 'source-ts',
    name: 'TypeScript Source',
    description: 'TypeScript/TSX source files',
    patterns: [/\.tsx?$/, /^src\/.*\.tsx?$/],
    excludePatterns: [/node_modules/, /\.d\.ts$/],
  },
  {
    id: 'source-js',
    name: 'JavaScript Source',
    description: 'JavaScript/JSX source files',
    patterns: [/\.jsx?$/, /^src\/.*\.jsx?$/],
    excludePatterns: [/node_modules/, /dist\//, /build\//],
  },
  {
    id: 'tests',
    name: 'Test Files',
    description: 'Test files (*.test.*, *.spec.*, tests/)',
    patterns: [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /^tests?\//, /__tests__\//],
  },
  {
    id: 'config',
    name: 'Config Files',
    description: 'Configuration files (*.config.*, .rc files)',
    patterns: [/\.config\.[jt]s$/, /\.config\.json$/, /\.[a-z]+rc$/],
    excludePatterns: [/\.env/],
  },
  {
    id: 'styles',
    name: 'Style Files',
    description: 'CSS, SCSS, and style files',
    patterns: [/\.css$/, /\.scss$/, /\.less$/, /\.sass$/],
  },
  {
    id: 'docs',
    name: 'Documentation',
    description: 'Markdown and documentation files',
    patterns: [/\.md$/, /\.mdx$/, /^docs?\//, /README/i],
  },
  {
    id: 'components',
    name: 'React Components',
    description: 'React component files in components/ directories',
    patterns: [/components?\/.*\.[jt]sx?$/, /Components?\/.*\.[jt]sx?$/],
  },
  {
    id: 'python',
    name: 'Python Source',
    description: 'Python source files',
    patterns: [/\.py$/],
    excludePatterns: [/__pycache__/, /\.pyc$/],
  },
  {
    id: 'rust',
    name: 'Rust Source',
    description: 'Rust source files',
    patterns: [/\.rs$/],
    excludePatterns: [/target\//],
  },
  {
    id: 'go',
    name: 'Go Source',
    description: 'Go source files',
    patterns: [/\.go$/],
    excludePatterns: [/_test\.go$/],
  },
];

/**
 * Find which categories a path matches.
 */
export function matchPathCategories(filePath: string): PathCategory[] {
  const matches: PathCategory[] = [];
  const normalized = filePath.replace(/\\/g, '/'); // Normalize Windows paths

  for (const category of PATH_CATEGORIES) {
    // Check if any pattern matches
    const patternMatches = category.patterns.some((p) => p.test(normalized));
    if (!patternMatches) continue;

    // Check if any exclusion pattern matches
    const excluded = category.excludePatterns?.some((p) => p.test(normalized));
    if (excluded) continue;

    matches.push(category);
  }

  return matches;
}

/**
 * Check if a path matches a specific category.
 */
export function matchesPathCategory(filePath: string, categoryId: string): boolean {
  const category = PATH_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return false;

  const normalized = filePath.replace(/\\/g, '/');
  const patternMatches = category.patterns.some((p) => p.test(normalized));
  if (!patternMatches) return false;

  const excluded = category.excludePatterns?.some((p) => p.test(normalized));
  return !excluded;
}

/**
 * Get a category by ID.
 */
export function getPathCategory(categoryId: string): PathCategory | undefined {
  return PATH_CATEGORIES.find((c) => c.id === categoryId);
}

/**
 * Get all available path categories.
 */
export function getAllPathCategories(): PathCategory[] {
  return PATH_CATEGORIES;
}
