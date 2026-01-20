// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Importance Scoring for Context Optimization
 *
 * Scores messages and entities based on multiple factors to determine
 * what to keep vs summarize during context compaction.
 *
 * Factors:
 * - Recency: Recent messages are more important
 * - Reference count: Often-referenced content is important
 * - User emphasis: User messages, questions, and emphasis markers
 * - Action relevance: Messages that led to or contain tool calls
 */

import type { Message } from './types.js';
import type { Entity } from './compression.js';
import { hasToolUseBlocks, hasToolResultBlocks } from './utils/message-utils.js';
import { getMessageText } from './utils/token-counter.js';

/**
 * Weights for importance scoring factors.
 * Should sum to approximately 1.0 for normalized scores.
 */
export interface ImportanceWeights {
  recency: number;           // Weight for message recency (0.25 default)
  referenceCount: number;    // Weight for forward references (0.15 default)
  userEmphasis: number;      // Weight for user emphasis (0.25 default)
  actionRelevance: number;   // Weight for tool call relevance (0.2 default)
  codeRelevance: number;     // Weight for indexed code references (0.15 default, RAG-enhanced)
}

/**
 * Default importance weights.
 */
export const DEFAULT_IMPORTANCE_WEIGHTS: ImportanceWeights = {
  recency: 0.25,
  referenceCount: 0.15,
  userEmphasis: 0.25,
  actionRelevance: 0.2,
  codeRelevance: 0.15,
};

/**
 * Detailed score for a single message.
 */
export interface MessageScore {
  messageIndex: number;
  totalScore: number;        // Weighted sum of all factors (0-1)
  factors: {
    recency: number;         // 0-1 based on position
    referenceCount: number;  // 0-1 based on forward refs
    userEmphasis: number;    // 0-1 based on role and content
    actionRelevance: number; // 0-1 based on tool usage
    codeRelevance: number;   // 0-1 based on indexed code references (RAG-enhanced)
  };
}

/**
 * Detailed score for an entity.
 */
export interface EntityScore {
  entityId: string;
  totalScore: number;
  factors: {
    recency: number;
    referenceCount: number;
    userMentioned: boolean;
    actionRelevance: number;
  };
}

/**
 * Information about entity references across messages.
 */
interface EntityReference {
  entities: Set<string>;      // Entities mentioned in this message
  forwardReferences: number;  // How many later messages reference these entities
}

/**
 * Build a map of entity references per message.
 * Tracks which entities appear in each message and counts forward references.
 */
export function buildEntityReferenceMap(
  messages: Message[],
  entities?: Map<string, Entity>
): Map<number, EntityReference> {
  const refMap = new Map<number, EntityReference>();

  // If no entities provided, just track text patterns
  const entityValues = entities
    ? [...entities.values()].map(e => e.value)
    : [];

  // First pass: identify entities in each message
  for (let i = 0; i < messages.length; i++) {
    const text = getMessageText(messages[i]);
    const found = new Set<string>();

    for (const value of entityValues) {
      if (text.includes(value)) {
        found.add(value);
      }
    }

    refMap.set(i, { entities: found, forwardReferences: 0 });
  }

  // Second pass: count forward references
  for (let i = 0; i < messages.length; i++) {
    const current = refMap.get(i)!;

    // Check how many later messages reference entities from this message
    for (let j = i + 1; j < messages.length; j++) {
      const later = refMap.get(j)!;

      // Check if any entities from current appear in later
      for (const entity of current.entities) {
        if (later.entities.has(entity)) {
          current.forwardReferences++;
          break; // Count each later message only once
        }
      }
    }
  }

  return refMap;
}

/**
 * Calculate recency score using exponential decay.
 * Most recent messages get scores close to 1, older messages decay towards 0.
 */
function calculateRecencyScore(index: number, totalMessages: number): number {
  if (totalMessages <= 1) return 1;

  // Exponential decay: e^(-distance/total)
  // This gives recent messages higher scores
  const distanceFromEnd = totalMessages - index - 1;
  return Math.exp(-distanceFromEnd / (totalMessages * 0.5));
}

/**
 * Calculate user emphasis score based on role and content.
 */
function calculateUserEmphasisScore(message: Message): number {
  const text = getMessageText(message);
  let score = message.role === 'user' ? 0.5 : 0.3;

  if (message.role === 'user') {
    // Questions are important (need context to answer)
    if (text.includes('?')) {
      score += 0.2;
    }

    // Emphasis markers
    if (text.includes('!') || /\b(important|critical|must|need|urgent)\b/i.test(text)) {
      score += 0.2;
    }

    // Explicit instructions
    if (/\b(please|should|make sure|don't forget|remember)\b/i.test(text)) {
      score += 0.1;
    }
  }

  return Math.min(score, 1);
}

/**
 * Calculate action relevance score based on tool usage.
 */
function calculateActionRelevanceScore(
  message: Message,
  index: number,
  messages: Message[]
): number {
  let score = 0;

  // Message contains tool_use blocks
  if (hasToolUseBlocks(message)) {
    score = 1;
  }
  // Message contains tool_result blocks
  else if (hasToolResultBlocks(message)) {
    score = 0.8;
  }
  // Check if this message led to tool use (next assistant message has tool_use)
  else if (message.role === 'user') {
    // Look ahead for assistant response with tools
    for (let j = index + 1; j < messages.length && j <= index + 2; j++) {
      if (messages[j].role === 'assistant' && hasToolUseBlocks(messages[j])) {
        score = 0.6;
        break;
      }
    }
  }

  return score;
}

/**
 * Extract file paths from message text.
 * Matches common file path patterns like src/foo/bar.ts, ./file.js, /path/to/file
 */
export function extractFilePaths(text: string): Set<string> {
  const paths = new Set<string>();

  // Match file paths (src/foo/bar.ts, ./file.js, /path/to/file.ext, src/@types/foo.d.ts)
  // Allow @ in directory names for scoped packages
  const pathRegex = /(?:^|[\s"'`(])(\.\/)?((?:[@\w.-]+\/)+[\w.-]+\.[a-zA-Z]{1,10})(?=[\s"'`),:;]|$)/gm;
  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    // Get the path (group 2, after optional ./)
    const path = match[2];
    paths.add(path);
  }

  return paths;
}

/**
 * Calculate code relevance score based on indexed files.
 * Returns higher score if the message discusses code that's in the RAG index.
 */
function calculateCodeRelevanceScore(
  message: Message,
  indexedFiles?: Set<string>
): number {
  // If no indexed files provided, return neutral score
  if (!indexedFiles || indexedFiles.size === 0) {
    return 0.5; // Neutral score when RAG not available
  }

  const text = getMessageText(message);
  const mentionedPaths = extractFilePaths(text);

  if (mentionedPaths.size === 0) {
    return 0.3; // Low score for messages not mentioning files
  }

  // Count how many mentioned paths are in the index
  let indexedCount = 0;
  for (const path of mentionedPaths) {
    // Check for exact match or partial match (file.ts matches src/foo/file.ts)
    const isIndexed = indexedFiles.has(path) ||
      [...indexedFiles].some(f => f.endsWith('/' + path) || f === path);
    if (isIndexed) {
      indexedCount++;
    }
  }

  // Score based on proportion of indexed paths mentioned
  const proportion = indexedCount / mentionedPaths.size;

  // Scale from 0.3 (no indexed paths) to 1.0 (all mentioned paths are indexed)
  return 0.3 + (proportion * 0.7);
}

/**
 * Score all messages by importance.
 * @param indexedFiles - Optional set of file paths from RAG index for code relevance scoring
 */
export function scoreMessages(
  messages: Message[],
  weights: ImportanceWeights = DEFAULT_IMPORTANCE_WEIGHTS,
  entities?: Map<string, Entity>,
  indexedFiles?: Set<string>
): MessageScore[] {
  if (messages.length === 0) return [];

  // Build entity reference map for forward reference counting
  const refMap = buildEntityReferenceMap(messages, entities);

  const scores: MessageScore[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const refs = refMap.get(i)!;

    // Calculate individual factors
    const recency = calculateRecencyScore(i, messages.length);

    // Normalize reference count (cap at 5 refs for max score)
    const referenceCount = Math.min(refs.forwardReferences / 5, 1);

    const userEmphasis = calculateUserEmphasisScore(msg);

    const actionRelevance = calculateActionRelevanceScore(msg, i, messages);

    const codeRelevance = calculateCodeRelevanceScore(msg, indexedFiles);

    // Calculate weighted total
    const totalScore =
      recency * weights.recency +
      referenceCount * weights.referenceCount +
      userEmphasis * weights.userEmphasis +
      actionRelevance * weights.actionRelevance +
      codeRelevance * weights.codeRelevance;

    scores.push({
      messageIndex: i,
      totalScore,
      factors: {
        recency,
        referenceCount,
        userEmphasis,
        actionRelevance,
        codeRelevance,
      },
    });
  }

  return scores;
}

/**
 * Score entities by importance.
 */
export function scoreEntities(
  entities: Map<string, Entity>,
  messages: Message[],
  weights: ImportanceWeights = DEFAULT_IMPORTANCE_WEIGHTS
): EntityScore[] {
  if (entities.size === 0) return [];

  const totalMessages = messages.length;
  const scores: EntityScore[] = [];

  // Pre-compute which entities appear in user messages
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => getMessageText(m))
    .join('\n');

  // Pre-compute which entities appear in tool inputs
  const toolInputText = messages
    .flatMap(m => {
      if (typeof m.content === 'string') return [];
      return m.content
        .filter(block => block.type === 'tool_use' && block.input)
        .map(block => JSON.stringify(block.input));
    })
    .join('\n');

  for (const [id, entity] of entities) {
    // Recency based on firstSeen
    const recency = totalMessages > 0
      ? calculateRecencyScore(entity.firstSeen, totalMessages)
      : 0.5;

    // Reference count normalized
    const referenceCount = Math.min(entity.count / 10, 1);

    // Check if user mentioned this entity
    const userMentioned = userText.includes(entity.value);

    // Action relevance: entity appears in tool inputs
    const actionRelevance = toolInputText.includes(entity.value) ? 1 : 0;

    const totalScore =
      recency * weights.recency +
      referenceCount * weights.referenceCount +
      (userMentioned ? 1 : 0.3) * weights.userEmphasis +
      actionRelevance * weights.actionRelevance;

    scores.push({
      entityId: id,
      totalScore,
      factors: {
        recency,
        referenceCount,
        userMentioned,
        actionRelevance,
      },
    });
  }

  // Sort by score descending
  return scores.sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Get the top N most important messages.
 */
export function getTopMessages(
  scores: MessageScore[],
  n: number
): MessageScore[] {
  return [...scores]
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, n);
}

/**
 * Get messages above a score threshold.
 */
export function getMessagesAboveThreshold(
  scores: MessageScore[],
  threshold: number
): MessageScore[] {
  return scores.filter(s => s.totalScore >= threshold);
}
