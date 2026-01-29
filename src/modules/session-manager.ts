// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Message } from '../../../types.js';

export class SessionManager {
  private messages: Message[] = [];
  private conversationSummary: string | null = null;
  private workingSet: any;

  /**
   * Set the message history
   */
  setHistory(messages: Message[]): void {
    this.messages = [...messages];
  }

  /**
   * Get the message history
   */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /**
   * Set the conversation summary
   */
  setSummary(summary: string | null): void {
    this.conversationSummary = summary;
  }

  /**
   * Get the conversation summary
   */
  getSummary(): string | null {
    return this.conversationSummary;
  }

  /**
   * Set the working set
   */
  setWorkingSet(workingSet: any): void {
    this.workingSet = workingSet;
  }

  /**
   * Get the working set
   */
  getWorkingSet(): any {
    return this.workingSet;
  }

  /**
   * Load a session with messages and summary
   */
  loadSession(messages: Message[], summary: string | null): void {
    this.setHistory(messages);
    this.setSummary(summary);
  }

  /**
   * Clear the history
   */
  clearHistory(): void {
    this.messages = [];
    this.conversationSummary = null;
  }

  /**
   * Clear context (messages and summary)
   */
  clearContext(): void {
    this.clearHistory();
  }

  /**
   * Clear working set
   */
  clearWorkingSet(): void {
    this.workingSet = createWorkingSet();
  }

  /**
   * Get a summary of recent context
   */
  getRecentContext(): string {
    if (this.messages.length < 2) {
      return 'No recent messages.';
    }

    const firstUserMsg = this.messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return 'No user messages yet.';
    }

    const recentMsgs = this.messages.slice(-3);
    const parts: string[] = [];

    for (const msg of recentMsgs) {
      if (msg.role === 'user') {
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textBlocks = msg.content.filter(b => b.type === 'text' && b.text);
          content = textBlocks.map(b => b.text).join('\n');
        }
        if (content.trim()) {
          parts.push(`<user> ${content.trim()}`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n') : 'No recent user messages.';
  }

  /**
   * Get conversation label
   */
  getConversationLabel(): string {
    if (this.messages.length < 2) {
      return '';
    }

    const firstUserMsg = this.messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return '';
    }

    let content = '';
    if (typeof firstUserMsg.content === 'string') {
      content = firstUserMsg.content;
    } else if (Array.isArray(firstUserMsg.content)) {
      const textBlocks = firstUserMsg.content.filter(b => b.type === 'text' && b.text);
      content = textBlocks.map(b => b.text).join('\n');
    }

    // Take first 40 characters
    let label = content.trim().slice(0, 40);
    if (content.length > 40) {
      label += '...';
    }

    return label;
  }

  /**
   * Inject context into the session
   */
  injectContext(context: string): void {
    if (!context) return;

    this.messages.push({
      role: 'user',
      content: context
    });
  }

  /**
   * Get index of files referenced in conversation
   */
  getIndexedFiles(): Set<string> | null {
    return null; // Would be populated by RAG system
  }

  /**
   * Get embedding provider reference
   */
  getEmbeddingProvider(): any {
    return null; // Would be populated by RAG system
  }

  /**
   * Get all messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Inject a message
   */
  injectMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({
      role,
      content
    });
  }
}

function createWorkingSet(): any {
  return {
    // Will be implemented based on actual working set structure
    files: new Set(),
    commands: new Set()
  };
}