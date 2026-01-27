// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Memory system for persistent user context and personalization.
 *
 * Implements the context personalization pattern:
 * - Structured user profile (YAML)
 * - Unstructured memory notes (Markdown)
 * - Memory injection into system prompt
 * - Memory consolidation across sessions
 */
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { appendFile, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';
import { logger } from './logger.js';

const CODI_DIR = path.join(os.homedir(), '.codi');
const PROFILE_PATH = path.join(CODI_DIR, 'profile.yaml');
const MEMORIES_PATH = path.join(CODI_DIR, 'memories.md');
const SESSION_NOTES_PATH = path.join(CODI_DIR, 'session-notes.md');

/**
 * User profile structure.
 */
export interface UserProfile {
  name?: string;
  preferences?: {
    language?: string;
    style?: string;
    verbosity?: 'concise' | 'detailed' | 'normal';
    [key: string]: string | undefined;
  };
  expertise?: string[];
  avoid?: string[];
  custom?: Record<string, string>;
}

/**
 * A single memory entry.
 */
export interface MemoryEntry {
  content: string;
  category?: string;
  timestamp: string;
  source?: string; // 'user' | 'auto' | 'imported'
}

/**
 * Ensure the .codi directory exists.
 */
function ensureCodiDir(): void {
  if (!existsSync(CODI_DIR)) {
    mkdirSync(CODI_DIR, { recursive: true });
  }
}

/**
 * Parse YAML profile using js-yaml library.
 * Provides robust parsing with full YAML specification support.
 */
function parseYamlProfile(content: string): UserProfile {
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  return parsed as UserProfile;
}

/**
 * Serialize profile to YAML format using js-yaml library.
 * Provides clean, readable YAML output.
 */
function serializeProfile(profile: UserProfile): string {
  // Filter out empty objects and arrays for cleaner output
  const cleanProfile: UserProfile = {};

  if (profile.name) {
    cleanProfile.name = profile.name;
  }

  if (profile.preferences && Object.keys(profile.preferences).length > 0) {
    // Filter out undefined values from preferences
    const cleanPrefs: Record<string, string> = {};
    for (const [key, value] of Object.entries(profile.preferences)) {
      if (value !== undefined) {
        cleanPrefs[key] = value;
      }
    }
    if (Object.keys(cleanPrefs).length > 0) {
      cleanProfile.preferences = cleanPrefs;
    }
  }

  if (profile.expertise && profile.expertise.length > 0) {
    cleanProfile.expertise = profile.expertise;
  }

  if (profile.avoid && profile.avoid.length > 0) {
    cleanProfile.avoid = profile.avoid;
  }

  if (profile.custom && Object.keys(profile.custom).length > 0) {
    cleanProfile.custom = profile.custom;
  }

  return yaml.dump(cleanProfile, { indent: 2, lineWidth: -1 });
}

/**
 * Load user profile from disk.
 */
export async function loadProfile(): Promise<UserProfile> {
  if (!existsSync(PROFILE_PATH)) {
    return {};
  }

  try {
    const content = await readFile(PROFILE_PATH, 'utf-8');
    return parseYamlProfile(content);
  } catch (error) {
    logger.debug(`Failed to load profile: ${error instanceof Error ? error.message : error}`);
    return {};
  }
}

/**
 * Save user profile to disk.
 */
export async function saveProfile(profile: UserProfile): Promise<void> {
  ensureCodiDir();
  const content = serializeProfile(profile);
  await writeFile(PROFILE_PATH, content);
}

/**
 * Update a specific field in the profile.
 */
export async function updateProfile(key: string, value: string): Promise<UserProfile> {
  const profile = await loadProfile();

  // Handle nested keys like "preferences.language"
  const parts = key.split('.');
  if (parts.length === 2) {
    const [section, field] = parts;
    if (section === 'preferences') {
      profile.preferences = profile.preferences || {};
      profile.preferences[field] = value;
    } else if (section === 'custom') {
      profile.custom = profile.custom || {};
      profile.custom[field] = value;
    }
  } else if (key === 'name') {
    profile.name = value;
  } else if (key === 'expertise') {
    profile.expertise = profile.expertise || [];
    if (!profile.expertise.includes(value)) {
      profile.expertise.push(value);
    }
  } else if (key === 'avoid') {
    profile.avoid = profile.avoid || [];
    if (!profile.avoid.includes(value)) {
      profile.avoid.push(value);
    }
  }

  await saveProfile(profile);
  return profile;
}

/**
 * Parse memories from markdown file.
 */
function parseMemories(content: string): MemoryEntry[] {
  const memories: MemoryEntry[] = [];
  const lines = content.split('\n');
  let currentCategory: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for category header (## Category)
    const headerMatch = trimmed.match(/^##\s+(.+)$/);
    if (headerMatch) {
      const category = headerMatch[1].trim();
      // "General" is treated as no category
      currentCategory = category.toLowerCase() === 'general' ? undefined : category;
      continue;
    }

    // Skip other headers (# title)
    if (trimmed.startsWith('#')) continue;

    // Format: - [category] memory content (timestamp)
    // Or simpler: - memory content (timestamp)
    const match = trimmed.match(/^-\s*(?:\[([^\]]+)\]\s*)?(.+?)(?:\s*\((\d{4}-\d{2}-\d{2})\))?$/);
    if (match) {
      // Inline category takes precedence over section category
      const category = match[1] || currentCategory;
      memories.push({
        content: match[2].trim(),
        category: category || undefined,
        timestamp: match[3] || new Date().toISOString().split('T')[0],
      });
    }
  }

  return memories;
}

/**
 * Serialize memories to markdown format.
 */
function serializeMemories(memories: MemoryEntry[]): string {
  const lines: string[] = ['# Codi Memories', ''];

  // Group by category
  const byCategory = new Map<string, MemoryEntry[]>();
  const uncategorized: MemoryEntry[] = [];

  for (const memory of memories) {
    if (memory.category) {
      const list = byCategory.get(memory.category) || [];
      list.push(memory);
      byCategory.set(memory.category, list);
    } else {
      uncategorized.push(memory);
    }
  }

  // Write categorized memories
  for (const [category, items] of byCategory) {
    lines.push(`## ${category}`);
    for (const item of items) {
      lines.push(`- ${item.content} (${item.timestamp})`);
    }
    lines.push('');
  }

  // Write uncategorized memories
  if (uncategorized.length > 0) {
    if (byCategory.size > 0) {
      lines.push('## General');
    }
    for (const item of uncategorized) {
      lines.push(`- ${item.content} (${item.timestamp})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Load memories from disk.
 */
export async function loadMemories(): Promise<MemoryEntry[]> {
  if (!existsSync(MEMORIES_PATH)) {
    return [];
  }

  try {
    const content = await readFile(MEMORIES_PATH, 'utf-8');
    return parseMemories(content);
  } catch (error) {
    logger.debug(`Failed to load memories: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Save memories to disk.
 */
export async function saveMemories(memories: MemoryEntry[]): Promise<void> {
  ensureCodiDir();
  const content = serializeMemories(memories);
  await writeFile(MEMORIES_PATH, content);
}

/**
 * Add a new memory.
 */
export async function addMemory(content: string, category?: string, source?: string): Promise<MemoryEntry> {
  const memories = await loadMemories();

  // Check for duplicates (case-insensitive)
  const lowerContent = content.toLowerCase();
  const isDuplicate = memories.some(m => m.content.toLowerCase() === lowerContent);

  if (isDuplicate) {
    // Return the existing memory
    return memories.find(m => m.content.toLowerCase() === lowerContent)!;
  }

  const entry: MemoryEntry = {
    content,
    category,
    timestamp: new Date().toISOString().split('T')[0],
    source: source || 'user',
  };

  memories.push(entry);
  await saveMemories(memories);

  return entry;
}

/**
 * Remove memories matching a pattern.
 */
export async function removeMemories(pattern: string): Promise<number> {
  const memories = await loadMemories();
  const lowerPattern = pattern.toLowerCase();

  const filtered = memories.filter(m =>
    !m.content.toLowerCase().includes(lowerPattern)
  );

  const removed = memories.length - filtered.length;
  if (removed > 0) {
    await saveMemories(filtered);
  }

  return removed;
}

/**
 * Search memories by content.
 */
export async function searchMemories(query: string): Promise<MemoryEntry[]> {
  const memories = await loadMemories();
  const lowerQuery = query.toLowerCase();

  return memories.filter(m =>
    m.content.toLowerCase().includes(lowerQuery) ||
    m.category?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get memories by category.
 */
export async function getMemoriesByCategory(category: string): Promise<MemoryEntry[]> {
  const memories = await loadMemories();
  return memories.filter(m =>
    m.category?.toLowerCase() === category.toLowerCase()
  );
}

/**
 * Clear all memories.
 */
export async function clearMemories(): Promise<number> {
  const memories = await loadMemories();
  const count = memories.length;

  if (count > 0) {
    await saveMemories([]);
  }

  return count;
}

/**
 * Generate context injection for system prompt.
 * Combines profile and relevant memories into a concise context block.
 */
export async function generateMemoryContext(projectPath?: string): Promise<string | null> {
  const profile = await loadProfile();
  const memories = await loadMemories();

  if (Object.keys(profile).length === 0 && memories.length === 0) {
    return null;
  }

  const lines: string[] = ['## User Context'];

  // Add profile info
  if (profile.name) {
    lines.push(`User: ${profile.name}`);
  }

  if (profile.preferences) {
    const prefs = Object.entries(profile.preferences)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (prefs) {
      lines.push(`Preferences: ${prefs}`);
    }
  }

  if (profile.expertise && profile.expertise.length > 0) {
    lines.push(`Expertise: ${profile.expertise.join(', ')}`);
  }

  if (profile.avoid && profile.avoid.length > 0) {
    lines.push(`Avoid: ${profile.avoid.join(', ')}`);
  }

  // Add relevant memories (limit to most recent/relevant)
  if (memories.length > 0) {
    lines.push('');
    lines.push('### Remembered Context');

    // Filter for project-relevant memories if path provided
    let relevantMemories = memories;
    if (projectPath) {
      const projectName = path.basename(projectPath).toLowerCase();
      const projectMemories = memories.filter(m =>
        m.content.toLowerCase().includes(projectName) ||
        m.category?.toLowerCase() === 'project'
      );
      if (projectMemories.length > 0) {
        relevantMemories = projectMemories;
      }
    }

    // Limit to 20 most recent memories
    const recentMemories = relevantMemories.slice(-20);
    for (const memory of recentMemories) {
      const prefix = memory.category ? `[${memory.category}] ` : '';
      lines.push(`- ${prefix}${memory.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Add session notes (temporary, for consolidation later).
 */
export async function addSessionNote(note: string): Promise<void> {
  ensureCodiDir();
  const timestamp = new Date().toISOString();
  const entry = `- ${note} (${timestamp})\n`;
  await appendFile(SESSION_NOTES_PATH, entry);
}

/**
 * Get session notes.
 */
export async function getSessionNotes(): Promise<string[]> {
  if (!existsSync(SESSION_NOTES_PATH)) {
    return [];
  }

  try {
    const content = await readFile(SESSION_NOTES_PATH, 'utf-8');
    return content.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.slice(1).trim());
  } catch (error) {
    logger.debug(`Failed to load session notes: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Clear session notes.
 */
export function clearSessionNotes(): void {
  if (existsSync(SESSION_NOTES_PATH)) {
    unlinkSync(SESSION_NOTES_PATH);
  }
}

/**
 * Consolidate session notes into permanent memories.
 * Returns the number of notes consolidated.
 */
export async function consolidateSessionNotes(): Promise<number> {
  const notes = await getSessionNotes();
  if (notes.length === 0) return 0;

  let consolidated = 0;
  for (const note of notes) {
    // Extract the actual note content (remove timestamp if present)
    const match = note.match(/^(.+?)(?:\s*\(\d{4}-\d{2}-\d{2}.*\))?$/);
    if (match) {
      await addMemory(match[1], undefined, 'auto');
      consolidated++;
    }
  }

  clearSessionNotes();
  return consolidated;
}

/**
 * Get memory file paths for display.
 */
export function getMemoryPaths(): { profile: string; memories: string } {
  return {
    profile: PROFILE_PATH,
    memories: MEMORIES_PATH,
  };
}

/**
 * Check if user has any memories or profile.
 */
export async function hasMemoryContext(): Promise<boolean> {
  const profile = await loadProfile();
  const memories = await loadMemories();
  return Object.keys(profile).length > 0 || memories.length > 0;
}
