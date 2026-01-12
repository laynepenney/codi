/**
 * Intelligent File Grouping
 *
 * Groups files by directory hierarchy or AI classification for
 * more meaningful batch processing during code review.
 */

import { dirname, basename, relative } from 'node:path';
import type {
  FileGroup,
  GroupingOptions,
  GroupingResult,
  ProviderContext,
} from './types.js';
import type { ModelRegistry } from './registry.js';
import type { TaskRouter } from './router.js';
import { logger } from '../logger.js';

/** Default maximum files per group */
const DEFAULT_MAX_GROUP_SIZE = 15;

/** Minimum files in a flat directory to trigger AI classification */
const DEFAULT_AI_THRESHOLD = 10;

/**
 * Group files by directory hierarchy.
 *
 * Creates groups based on the directory structure, keeping related
 * files together (e.g., all files in src/commands/ in one group).
 */
export function groupByHierarchy(
  files: string[],
  maxGroupSize: number = DEFAULT_MAX_GROUP_SIZE
): FileGroup[] {
  // Build directory tree
  const dirMap = new Map<string, string[]>();

  for (const file of files) {
    // Get the parent directory relative to common base
    const dir = dirname(file);
    if (!dirMap.has(dir)) {
      dirMap.set(dir, []);
    }
    dirMap.get(dir)!.push(file);
  }

  // Convert to groups, splitting large directories
  const groups: FileGroup[] = [];

  for (const [dir, dirFiles] of dirMap) {
    // Determine group name from directory path
    const dirParts = dir.split('/').filter(Boolean);
    const groupName = dirParts.length > 0
      ? dirParts.slice(-2).join('/') // e.g., "commands/output" or just "commands"
      : 'root';

    if (dirFiles.length <= maxGroupSize) {
      // Directory fits in one group
      groups.push({
        name: groupName,
        files: dirFiles,
        source: 'hierarchy',
        description: `Files in ${dir}`,
      });
    } else {
      // Split large directory into multiple groups
      const chunks = chunkArray(dirFiles, maxGroupSize);
      chunks.forEach((chunk, i) => {
        groups.push({
          name: `${groupName}-${i + 1}`,
          files: chunk,
          source: 'hierarchy',
          description: `Files in ${dir} (part ${i + 1}/${chunks.length})`,
        });
      });
    }
  }

  // Sort groups by name for consistent ordering
  groups.sort((a, b) => a.name.localeCompare(b.name));

  return groups;
}

/**
 * Group files using AI classification.
 *
 * Uses a fast model to analyze file names and classify them into
 * logical groups based on separation of concerns.
 */
export async function groupByAI(
  files: string[],
  registry: ModelRegistry,
  router: TaskRouter,
  providerContext: ProviderContext,
  maxGroupSize: number = DEFAULT_MAX_GROUP_SIZE
): Promise<FileGroup[]> {
  // Resolve the fast model for classification
  const resolved = router.resolveRole('fast', providerContext);
  if (!resolved) {
    logger.warn('No fast model available for AI classification, falling back to hierarchy');
    return groupByHierarchy(files, maxGroupSize);
  }

  const provider = registry.getProvider(resolved.name);

  // Build the classification prompt
  const fileList = files.map(f => `- ${f}`).join('\n');
  const prompt = `You are classifying source code files into logical groups for code review.

Given these ${files.length} files:
${fileList}

Group them by separation of concerns (e.g., "commands", "providers", "tools", "utilities", "types", "tests", "config", etc.).

Respond with ONLY a JSON array of groups, each with "name" and "files" properties.
Keep groups between 5-${maxGroupSize} files each.
Example format:
[
  {"name": "commands", "files": ["src/commands/foo.ts", "src/commands/bar.ts"]},
  {"name": "providers", "files": ["src/providers/base.ts"]}
]

JSON response:`;

  try {
    const response = await provider.chat([{ role: 'user', content: prompt }]);

    // Parse the JSON response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ name: string; files: string[] }>;

    // Validate and convert to FileGroup
    const groups: FileGroup[] = [];
    const assignedFiles = new Set<string>();

    for (const group of parsed) {
      if (!group.name || !Array.isArray(group.files)) continue;

      // Filter to only files that exist in our input
      const validFiles = group.files.filter(f =>
        files.includes(f) && !assignedFiles.has(f)
      );

      if (validFiles.length > 0) {
        // Split if too large
        const chunks = chunkArray(validFiles, maxGroupSize);
        chunks.forEach((chunk, i) => {
          groups.push({
            name: chunks.length > 1 ? `${group.name}-${i + 1}` : group.name,
            files: chunk,
            source: 'ai-classified',
          });
          chunk.forEach(f => assignedFiles.add(f));
        });
      }
    }

    // Handle any unassigned files
    const unassigned = files.filter(f => !assignedFiles.has(f));
    if (unassigned.length > 0) {
      const chunks = chunkArray(unassigned, maxGroupSize);
      chunks.forEach((chunk, i) => {
        groups.push({
          name: chunks.length > 1 ? `other-${i + 1}` : 'other',
          files: chunk,
          source: 'ai-classified',
          description: 'Files not classified into other groups',
        });
      });
    }

    return groups;
  } catch (error) {
    logger.warn(`AI classification failed: ${error}, falling back to hierarchy`);
    return groupByHierarchy(files, maxGroupSize);
  }
}

/**
 * Group files using hybrid approach.
 *
 * Uses directory hierarchy for well-structured directories,
 * AI classification for flat directories with many files.
 */
export async function groupHybrid(
  files: string[],
  registry: ModelRegistry,
  router: TaskRouter,
  options: GroupingOptions
): Promise<FileGroup[]> {
  const maxGroupSize = options.maxGroupSize ?? DEFAULT_MAX_GROUP_SIZE;
  const aiThreshold = options.aiThreshold ?? DEFAULT_AI_THRESHOLD;
  const providerContext = options.providerContext ?? 'openai';

  // First, group by hierarchy
  const hierarchyGroups = groupByHierarchy(files, maxGroupSize);

  // Check if any directory is flat with many files
  const flatGroups: FileGroup[] = [];
  const structuredGroups: FileGroup[] = [];

  for (const group of hierarchyGroups) {
    // Check if this is a flat directory (all files in same directory)
    const dirs = new Set(group.files.map(f => dirname(f)));

    if (dirs.size === 1 && group.files.length >= aiThreshold) {
      // Flat directory with many files - candidate for AI classification
      flatGroups.push(group);
    } else {
      structuredGroups.push(group);
    }
  }

  // Use AI to classify flat directories
  if (flatGroups.length > 0) {
    const flatFiles = flatGroups.flatMap(g => g.files);
    const aiGroups = await groupByAI(
      flatFiles,
      registry,
      router,
      providerContext,
      maxGroupSize
    );

    return [...structuredGroups, ...aiGroups];
  }

  return structuredGroups;
}

/**
 * Main entry point for file grouping.
 */
export async function groupFiles(
  files: string[],
  options: GroupingOptions,
  registry?: ModelRegistry,
  router?: TaskRouter
): Promise<GroupingResult> {
  const startTime = Date.now();
  let groups: FileGroup[];

  const maxGroupSize = options.maxGroupSize ?? DEFAULT_MAX_GROUP_SIZE;

  switch (options.strategy) {
    case 'hierarchy':
      groups = groupByHierarchy(files, maxGroupSize);
      break;

    case 'ai':
      if (!registry || !router) {
        logger.warn('AI grouping requires registry and router, falling back to hierarchy');
        groups = groupByHierarchy(files, maxGroupSize);
      } else {
        groups = await groupByAI(
          files,
          registry,
          router,
          options.providerContext ?? 'openai',
          maxGroupSize
        );
      }
      break;

    case 'hybrid':
      if (!registry || !router) {
        logger.warn('Hybrid grouping requires registry and router, falling back to hierarchy');
        groups = groupByHierarchy(files, maxGroupSize);
      } else {
        groups = await groupHybrid(files, registry, router, options);
      }
      break;

    default:
      groups = groupByHierarchy(files, maxGroupSize);
  }

  return {
    groups,
    totalFiles: files.length,
    duration: Date.now() - startTime,
  };
}

/**
 * Split an array into chunks of maximum size.
 */
function chunkArray<T>(array: T[], maxSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += maxSize) {
    chunks.push(array.slice(i, i + maxSize));
  }
  return chunks;
}

/**
 * Utility to process files in parallel with concurrency limit.
 */
export async function processInParallel<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = 4
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing: Promise<void>[] = [];
  let index = 0;

  const enqueue = async (): Promise<void> => {
    if (index >= items.length) return;

    const currentIndex = index++;
    const item = items[currentIndex];

    const promise = processor(item, currentIndex)
      .then(result => {
        results[currentIndex] = result;
      })
      .finally(() => {
        executing.splice(executing.indexOf(promise), 1);
      });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }

    await enqueue();
  };

  // Start initial batch
  const starters = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => enqueue());

  await Promise.all(starters);
  await Promise.all(executing);

  return results;
}
