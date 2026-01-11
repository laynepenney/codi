/**
 * Context Compression System - Phase 1: Entity-Reference Compression
 *
 * Reduces context size by extracting repeated entities (file paths, class names,
 * function names, etc.) and replacing them with short references.
 *
 * Example:
 *   "The UserAuthService in src/services/auth.ts handles authentication"
 *   becomes:
 *   "The E1 in E2 handles authentication"
 *   with entities: { E1: "UserAuthService", E2: "src/services/auth.ts" }
 */

import type { Message } from './types.js';

/**
 * Entity types we extract and compress.
 */
export type EntityType = 'path' | 'class' | 'function' | 'url' | 'variable' | 'import';

/**
 * An extracted entity with metadata.
 */
export interface Entity {
  id: string;           // E1, E2, etc.
  value: string;        // Original text
  type: EntityType;
  count: number;        // How many times it appears
  firstSeen: number;    // Message index where first seen
}

/**
 * Compressed context output.
 */
export interface CompressedContext {
  entities: Map<string, Entity>;     // id -> Entity
  messages: Message[];               // Compressed messages
  originalSize: number;              // Original character count
  compressedSize: number;            // After compression
  compressionRatio: number;          // originalSize / compressedSize
}

/**
 * Patterns for entity extraction.
 * Order matters - more specific patterns first.
 */
const ENTITY_PATTERNS: Array<{ type: EntityType; pattern: RegExp; minLength: number }> = [
  // File paths (Unix and Windows)
  {
    type: 'path',
    pattern: /(?:^|[\s`'"([\{])([a-zA-Z]:[\\\/][^\s`'")\]}\n]+|(?:\.\.?\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+)(?=[\s`'")\]}\n,;:]|$)/g,
    minLength: 10,
  },
  // URLs
  {
    type: 'url',
    pattern: /https?:\/\/[^\s`'")\]}\n]+/g,
    minLength: 15,
  },
  // Import statements (extract the module path)
  {
    type: 'import',
    pattern: /(?:from\s+['"]|import\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g,
    minLength: 5,
  },
  // Class names (PascalCase with at least 2 parts or ending in common suffixes)
  {
    type: 'class',
    pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+(?:Service|Controller|Handler|Manager|Factory|Provider|Repository|Component|Module|Helper|Util|Client|Server|Worker|Processor|Builder|Adapter|Wrapper|Interface|Base|Abstract|Impl)?)\b/g,
    minLength: 8,
  },
  // Function names (camelCase with common prefixes/suffixes)
  {
    type: 'function',
    pattern: /\b((?:get|set|is|has|can|should|will|did|handle|on|process|create|update|delete|fetch|load|save|validate|parse|format|render|init|setup|configure|build|make|find|search|filter|map|reduce|transform)[A-Z][a-zA-Z]+)\b/g,
    minLength: 8,
  },
  // Variable names (snake_case or SCREAMING_SNAKE_CASE with 3+ parts)
  {
    type: 'variable',
    pattern: /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}|[a-z][a-z0-9]*(?:_[a-z0-9]+){2,})\b/g,
    minLength: 10,
  },
];

/**
 * Minimum occurrences needed to compress an entity.
 * Single occurrences aren't worth the overhead.
 */
const MIN_OCCURRENCES = 2;

/**
 * Minimum character savings to justify compression.
 * Entity reference like "E12" is 3 chars, so entity must be longer.
 */
const MIN_SAVINGS_CHARS = 5;

/**
 * Extract text content from a message for analysis.
 */
function extractTextFromMessage(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n');
  }
  return '';
}

/**
 * Count occurrences of a string in text (case-sensitive).
 */
function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/**
 * Extract entities from messages.
 */
export function extractEntities(messages: Message[]): Map<string, Entity> {
  const entityCounts = new Map<string, { type: EntityType; count: number; firstSeen: number }>();

  // Combine all text for analysis
  const allText = messages.map(extractTextFromMessage).join('\n');

  // Extract candidates from each pattern
  for (const { type, pattern, minLength } of ENTITY_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(allText)) !== null) {
      // Use capture group if present, otherwise full match
      const value = match[1] || match[0];

      if (value.length < minLength) continue;

      const existing = entityCounts.get(value);
      if (existing) {
        existing.count++;
      } else {
        // Count actual occurrences in full text
        const count = countOccurrences(allText, value);
        if (count >= MIN_OCCURRENCES) {
          entityCounts.set(value, {
            type,
            count,
            firstSeen: 0, // TODO: track actual message index
          });
        }
      }
    }
  }

  // Filter and assign IDs
  const entities = new Map<string, Entity>();
  let id = 1;

  // Sort by count * length (most savings first)
  const sorted = [...entityCounts.entries()]
    .filter(([value, data]) => {
      const savings = (value.length - 3) * data.count; // "E1" is ~3 chars
      return savings >= MIN_SAVINGS_CHARS * data.count;
    })
    .sort((a, b) => {
      const savingsA = (a[0].length - 3) * a[1].count;
      const savingsB = (b[0].length - 3) * b[1].count;
      return savingsB - savingsA;
    });

  for (const [value, data] of sorted) {
    const entityId = `E${id}`;
    entities.set(entityId, {
      id: entityId,
      value,
      type: data.type,
      count: data.count,
      firstSeen: data.firstSeen,
    });
    id++;

    // Limit to prevent too many entities (diminishing returns)
    if (id > 50) break;
  }

  return entities;
}

/**
 * Replace entities in text with their references.
 */
function compressText(text: string, entities: Map<string, Entity>): string {
  let result = text;

  // Sort entities by length (longest first) to avoid partial replacements
  const sortedEntities = [...entities.values()].sort(
    (a, b) => b.value.length - a.value.length
  );

  for (const entity of sortedEntities) {
    // Use word boundaries where appropriate
    const escaped = entity.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'g');
    result = result.replace(pattern, entity.id);
  }

  return result;
}

/**
 * Compress message content.
 */
function compressMessage(message: Message, entities: Map<string, Entity>): Message {
  if (typeof message.content === 'string') {
    return {
      ...message,
      content: compressText(message.content, entities),
    };
  }

  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map(block => {
        if (block.type === 'text') {
          return {
            ...block,
            text: compressText((block as { type: 'text'; text: string }).text, entities),
          };
        }
        return block;
      }),
    };
  }

  return message;
}

/**
 * Compress a conversation by extracting and replacing entities.
 */
export function compressContext(messages: Message[]): CompressedContext {
  // Calculate original size
  const originalSize = messages
    .map(extractTextFromMessage)
    .join('')
    .length;

  // Extract entities
  const entities = extractEntities(messages);

  // If no entities worth compressing, return original
  if (entities.size === 0) {
    return {
      entities,
      messages,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
    };
  }

  // Compress messages
  const compressedMessages = messages.map(m => compressMessage(m, entities));

  // Calculate compressed size
  const compressedSize = compressedMessages
    .map(extractTextFromMessage)
    .join('')
    .length;

  return {
    entities,
    messages: compressedMessages,
    originalSize,
    compressedSize,
    compressionRatio: originalSize / compressedSize,
  };
}

/**
 * Generate entity legend for injection into context.
 */
export function generateEntityLegend(entities: Map<string, Entity>): string {
  if (entities.size === 0) return '';

  const lines = ['## Entity References'];

  // Group by type
  const byType = new Map<EntityType, Entity[]>();
  for (const entity of entities.values()) {
    const list = byType.get(entity.type) || [];
    list.push(entity);
    byType.set(entity.type, list);
  }

  const typeLabels: Record<EntityType, string> = {
    path: 'Files',
    class: 'Classes',
    function: 'Functions',
    url: 'URLs',
    variable: 'Variables',
    import: 'Imports',
  };

  for (const [type, list] of byType) {
    lines.push(`### ${typeLabels[type]}`);
    for (const entity of list) {
      lines.push(`- ${entity.id}: ${entity.value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Decompress text by replacing entity references with values.
 */
export function decompressText(text: string, entities: Map<string, Entity>): string {
  let result = text;

  for (const entity of entities.values()) {
    const pattern = new RegExp(`\\b${entity.id}\\b`, 'g');
    result = result.replace(pattern, entity.value);
  }

  return result;
}

/**
 * Statistics about compression effectiveness.
 */
export interface CompressionStats {
  originalChars: number;
  compressedChars: number;
  legendChars: number;
  netChars: number;           // compressedChars + legendChars
  savings: number;            // originalChars - netChars
  savingsPercent: number;
  entityCount: number;
  topEntities: Array<{ id: string; value: string; savings: number }>;
}

/**
 * Calculate detailed compression statistics.
 */
export function getCompressionStats(result: CompressedContext): CompressionStats {
  const legend = generateEntityLegend(result.entities);
  const legendChars = legend.length;
  const netChars = result.compressedSize + legendChars;
  const savings = result.originalSize - netChars;

  const topEntities = [...result.entities.values()]
    .map(e => ({
      id: e.id,
      value: e.value,
      savings: (e.value.length - e.id.length) * e.count,
    }))
    .sort((a, b) => b.savings - a.savings)
    .slice(0, 10);

  return {
    originalChars: result.originalSize,
    compressedChars: result.compressedSize,
    legendChars,
    netChars,
    savings,
    savingsPercent: (savings / result.originalSize) * 100,
    entityCount: result.entities.size,
    topEntities,
  };
}
