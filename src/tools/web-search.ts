// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Web Search Tool
 *
 * Searches the web using DuckDuckGo and returns results with titles, URLs, and snippets.
 * No API key required - uses DuckDuckGo's public lite interface.
 */

import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool extends BaseTool {
  private readonly SEARCH_URL = 'https://lite.duckduckgo.com/lite/';
  private readonly USER_AGENT = 'Mozilla/5.0 (compatible; Codi/1.0; +https://github.com/laynepenney/codi)';

  getDefinition(): ToolDefinition {
    return {
      name: 'web_search',
      description:
        'Search the web for current information, documentation, or answers. ' +
        'Returns titles, URLs, and snippets from search results. ' +
        'Use this when you need up-to-date information or external documentation.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          num_results: {
            type: 'number',
            description: 'Number of results to return (1-10, default: 5)',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = input.query as string;
    let numResults = (input.num_results as number) || 5;

    if (!query?.trim()) {
      throw new Error('Search query is required');
    }

    numResults = Math.min(Math.max(numResults, 1), 10);

    try {
      const results = await this.search(query, numResults);

      if (results.length === 0) {
        return `No results found for: "${query}"`;
      }

      return this.formatResults(query, results);
    } catch (error) {
      throw new Error(`Web search failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async search(query: string, numResults: number): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      kl: 'us-en', // US English results
    });

    const response = await fetch(this.SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.USER_AGENT,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, numResults);
  }

  /**
   * Parse DuckDuckGo lite HTML results.
   * The lite version uses a simple table format with predictable structure.
   */
  parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo lite returns results in table rows
    // Each result has a link and a snippet in subsequent cells

    // Match result links - they appear as plain <a> tags with the result URL
    // The structure is: <a rel="nofollow" href="redirect_url">Title</a>
    const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;

    // Match snippets - they appear in <td> cells after the link row
    // Look for text content that's not a link or navigation element
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/td>/gi;

    const links: { url: string; title: string }[] = [];
    const snippets: string[] = [];

    let match;

    // Extract links
    while ((match = linkRegex.exec(html)) !== null) {
      const url = this.decodeUrl(match[1]);
      const title = this.decodeHtml(match[2].trim());

      // Skip navigation links and empty titles
      if (url && title && !url.includes('duckduckgo.com') && title.length > 0) {
        links.push({ url, title });
        if (links.length >= maxResults) break;
      }
    }

    // Extract snippets
    while ((match = snippetRegex.exec(html)) !== null) {
      const snippet = this.decodeHtml(match[1].replace(/<[^>]+>/g, ' ').trim());
      if (snippet) {
        snippets.push(snippet);
        if (snippets.length >= maxResults) break;
      }
    }

    // If no snippets found with class, try alternate parsing
    if (snippets.length === 0) {
      // Look for text between result links
      const textRegex = /<td[^>]*>\s*(?!<a)([^<]{20,})<\/td>/gi;
      while ((match = textRegex.exec(html)) !== null && snippets.length < maxResults) {
        const text = this.decodeHtml(match[1].trim());
        if (text && text.length > 20) {
          snippets.push(text);
        }
      }
    }

    // Combine links with snippets
    for (let i = 0; i < links.length && i < maxResults; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || '',
      });
    }

    return results;
  }

  /**
   * Decode DuckDuckGo redirect URL to get the actual destination.
   */
  decodeUrl(url: string): string {
    // DuckDuckGo wraps URLs in a redirect like //duckduckgo.com/l/?uddg=...
    const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        return decodeURIComponent(uddgMatch[1]);
      } catch {
        return url;
      }
    }

    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      return 'https:' + url;
    }

    return url;
  }

  /**
   * Decode HTML entities to plain text.
   */
  decodeHtml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Format search results for display.
   */
  private formatResults(query: string, results: SearchResult[]): string {
    let output = `Search results for: "${query}"\n\n`;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      output += `${i + 1}. ${r.title}\n`;
      output += `   ${r.url}\n`;
      if (r.snippet) {
        output += `   ${r.snippet}\n`;
      }
      output += '\n';
    }

    return output.trim();
  }
}
