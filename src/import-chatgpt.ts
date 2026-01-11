/**
 * ChatGPT conversation import module.
 * Converts ChatGPT exported conversations to Codi session format.
 */
import * as fs from 'fs';
import * as path from 'path';
import { saveSession } from './session.js';
import type { Message } from './types.js';

/**
 * ChatGPT export format types.
 */
interface ChatGPTMessage {
  id: string;
  author: {
    role: 'user' | 'assistant' | 'system' | 'tool';
    name?: string;
  };
  content: {
    content_type: string;
    parts?: string[];
    text?: string;
  };
  create_time?: number;
  metadata?: Record<string, unknown>;
}

interface ChatGPTMapping {
  [key: string]: {
    id: string;
    message?: ChatGPTMessage;
    parent?: string | null;
    children: string[];
  };
}

interface ChatGPTConversation {
  title: string;
  create_time: number;
  update_time: number;
  mapping: ChatGPTMapping;
  conversation_id?: string;
}

/**
 * Result of parsing a ChatGPT conversation.
 */
export interface ParsedConversation {
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Message[];
  messageCount: number;
}

/**
 * Import result for a single conversation.
 */
export interface ImportResult {
  title: string;
  sessionName: string;
  messageCount: number;
  success: boolean;
  error?: string;
}

/**
 * Extract message text from ChatGPT message content.
 */
function extractMessageText(content: ChatGPTMessage['content']): string {
  if (content.parts && content.parts.length > 0) {
    return content.parts.join('\n');
  }
  if (content.text) {
    return content.text;
  }
  return '';
}

/**
 * Traverse the mapping tree to get messages in order.
 * ChatGPT stores messages as a tree structure with parent/children links.
 */
function traverseMessages(mapping: ChatGPTMapping): ChatGPTMessage[] {
  const messages: ChatGPTMessage[] = [];

  // Find the root node (no parent or parent is null)
  let currentId: string | null = null;
  for (const [id, node] of Object.entries(mapping)) {
    if (!node.parent) {
      currentId = node.children[0] || null;
      break;
    }
  }

  // Traverse the tree following the first child path
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = mapping[currentId];
    if (node?.message && node.message.author.role !== 'system') {
      messages.push(node.message);
    }
    // Follow the first child (main conversation path)
    currentId = node?.children?.[0] || null;
  }

  return messages;
}

/**
 * Convert ChatGPT messages to Codi message format.
 */
function convertMessages(chatgptMessages: ChatGPTMessage[]): Message[] {
  const messages: Message[] = [];

  for (const msg of chatgptMessages) {
    const text = extractMessageText(msg.content);
    if (!text.trim()) continue;

    // Map ChatGPT roles to Codi roles
    let role: 'user' | 'assistant';
    if (msg.author.role === 'user') {
      role = 'user';
    } else if (msg.author.role === 'assistant') {
      role = 'assistant';
    } else {
      // Skip system and tool messages
      continue;
    }

    messages.push({
      role,
      content: text,
    });
  }

  return messages;
}

/**
 * Parse a single ChatGPT conversation.
 */
export function parseConversation(conversation: ChatGPTConversation): ParsedConversation {
  const chatgptMessages = traverseMessages(conversation.mapping);
  const messages = convertMessages(chatgptMessages);

  return {
    title: conversation.title || 'Untitled Conversation',
    createdAt: new Date(conversation.create_time * 1000),
    updatedAt: new Date(conversation.update_time * 1000),
    messages,
    messageCount: messages.length,
  };
}

/**
 * Generate a safe session name from conversation title.
 */
function generateSessionName(title: string, date: Date): string {
  // Sanitize title for filesystem
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);

  const dateStr = date.toISOString().split('T')[0];
  return `chatgpt-${dateStr}-${safeTitle || 'conversation'}`;
}

/**
 * Generate a summary of the conversation for context.
 */
export function generateConversationSummary(parsed: ParsedConversation): string {
  const lines: string[] = [
    `Imported from ChatGPT: "${parsed.title}"`,
    `Date: ${parsed.createdAt.toLocaleDateString()}`,
    `Messages: ${parsed.messageCount}`,
    '',
    'Key topics discussed:',
  ];

  // Extract first few user messages as topic indicators
  const userMessages = parsed.messages
    .filter(m => m.role === 'user')
    .slice(0, 5);

  for (const msg of userMessages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const preview = content.slice(0, 100).replace(/\n/g, ' ');
    lines.push(`- ${preview}${content.length > 100 ? '...' : ''}`);
  }

  return lines.join('\n');
}

/**
 * Load and parse ChatGPT export file.
 */
export function loadChatGPTExport(filePath: string): ChatGPTConversation[] {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const data = JSON.parse(content);

  // Handle both array format and single conversation
  if (Array.isArray(data)) {
    return data;
  } else if (data.mapping) {
    return [data];
  } else {
    throw new Error('Invalid ChatGPT export format');
  }
}

/**
 * List conversations in a ChatGPT export file.
 */
export function listConversations(filePath: string): ParsedConversation[] {
  const conversations = loadChatGPTExport(filePath);
  return conversations.map(parseConversation);
}

/**
 * Import a single conversation as a Codi session.
 */
export function importConversation(
  conversation: ChatGPTConversation,
  options: {
    summaryOnly?: boolean;
    sessionName?: string;
  } = {}
): ImportResult {
  try {
    const parsed = parseConversation(conversation);
    const sessionName = options.sessionName || generateSessionName(parsed.title, parsed.createdAt);
    const summary = generateConversationSummary(parsed);

    // If summaryOnly, save with empty messages but include summary
    const messages = options.summaryOnly ? [] : parsed.messages;

    saveSession(sessionName, messages, summary, {
      projectPath: process.cwd(),
      projectName: `ChatGPT Import: ${parsed.title}`,
      provider: 'chatgpt-import',
      model: 'gpt-4',
    });

    return {
      title: parsed.title,
      sessionName,
      messageCount: parsed.messageCount,
      success: true,
    };
  } catch (error) {
    return {
      title: conversation.title || 'Unknown',
      sessionName: '',
      messageCount: 0,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Import all conversations from a ChatGPT export file.
 */
export function importAllConversations(
  filePath: string,
  options: {
    summaryOnly?: boolean;
    limit?: number;
  } = {}
): ImportResult[] {
  const conversations = loadChatGPTExport(filePath);
  const results: ImportResult[] = [];

  const toImport = options.limit
    ? conversations.slice(0, options.limit)
    : conversations;

  for (const conversation of toImport) {
    results.push(importConversation(conversation, { summaryOnly: options.summaryOnly }));
  }

  return results;
}

/**
 * Import specific conversations by index.
 */
export function importConversationsByIndex(
  filePath: string,
  indices: number[],
  options: {
    summaryOnly?: boolean;
  } = {}
): ImportResult[] {
  const conversations = loadChatGPTExport(filePath);
  const results: ImportResult[] = [];

  for (const index of indices) {
    if (index >= 0 && index < conversations.length) {
      results.push(importConversation(conversations[index], { summaryOnly: options.summaryOnly }));
    }
  }

  return results;
}

/**
 * Search conversations by title or content.
 */
export function searchConversations(
  filePath: string,
  query: string
): { index: number; conversation: ParsedConversation }[] {
  const conversations = loadChatGPTExport(filePath);
  const results: { index: number; conversation: ParsedConversation }[] = [];
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < conversations.length; i++) {
    const parsed = parseConversation(conversations[i]);

    // Search in title
    if (parsed.title.toLowerCase().includes(lowerQuery)) {
      results.push({ index: i, conversation: parsed });
      continue;
    }

    // Search in message content
    const hasMatch = parsed.messages.some(msg => {
      const content = typeof msg.content === 'string' ? msg.content : '';
      return content.toLowerCase().includes(lowerQuery);
    });

    if (hasMatch) {
      results.push({ index: i, conversation: parsed });
    }
  }

  return results;
}
