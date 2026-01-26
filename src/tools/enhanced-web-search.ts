// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Enhanced Web Search Tool
 * 
 * Multi-engine web search with caching, fallback, and enhanced result processing.
 * Uses Brave Search API as primary, with fallback to Google Custom Search and Bing API.
 */

import { BaseTool } from './base.js';
import type { ToolDefinition } from '../types.js';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  source?: string;
}

interface SearchEngine {
  name: string;
  search(query: string, config: WebSearchConfig): Promise<SearchResult[]>;
  isAvailable(config: WebSearchConfig): Promise<boolean>;
}

interface WebSearchConfig {
  braveApiKey?: string;
  googleApiKey?: string;
  googleSearchEngineId?: string;
  bingApiKey?: string;
  maxResults: number;
  cacheEnabled: boolean;
  enginePriority: string[];
  template?: 'docs' | 'pricing' | 'errors' | 'general';
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
}

class BraveEngine implements SearchEngine {
  name = 'brave';

  async isAvailable(config: WebSearchConfig): Promise<boolean> {
    return !!config.braveApiKey;
  }

  async search(query: string, config: WebSearchConfig): Promise<SearchResult[]> {
    if (!config.braveApiKey) {
      throw new Error('Brave API key required');
    }

    const params = new URLSearchParams({
      q: query,
      count: Math.max(config.maxResults, 20).toString(),
      search_lang: 'en',
      safe_search: 'moderate',
    });

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': config.braveApiKey,
      },
      signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Brave API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.web?.results || []).map((result: any) => ({
      title: result.title,
      url: result.url,
      snippet: result.description || '',
      score: result.score,
      source: 'Brave',
    }));
  }
}

class GoogleEngine implements SearchEngine {
  name = 'google';

  async isAvailable(config: WebSearchConfig): Promise<boolean> {
    return !!(config.googleApiKey && config.googleSearchEngineId);
  }

  async search(query: string, config: WebSearchConfig): Promise<SearchResult[]> {
    if (!config.googleApiKey || !config.googleSearchEngineId) {
      throw new Error('Google API key and search engine ID required');
    }

    const params = new URLSearchParams({
      q: query,
      key: config.googleApiKey,
      cx: config.googleSearchEngineId,
      num: Math.min(config.maxResults, 10).toString(), // Google max is 10
    });

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
      signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
    });
    
    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet || '',
      source: 'Google',
    }));
  }
}

class BingEngine implements SearchEngine {
  name = 'bing';

  async isAvailable(config: WebSearchConfig): Promise<boolean> {
    return !!config.bingApiKey;
  }

  async search(query: string, config: WebSearchConfig): Promise<SearchResult[]> {
    if (!config.bingApiKey) {
      throw new Error('Bing API key required');
    }

    const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${config.maxResults}`, {
      headers: {
        'Ocp-Apim-Subscription-Key': config.bingApiKey,
      },
      signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Bing API error: ${response.status}`);
    }

    const data = await response.json();
    return (data.webPages?.value || []).map((page: any) => ({
      title: page.name,
      url: page.url,
      snippet: page.snippet || '',
      source: 'Bing',
    }));
  }
}

class DuckDuckGoEngine implements SearchEngine {
  name = 'duckduckgo';
  private readonly SEARCH_URL = 'https://lite.duckduckgo.com/lite/';

  async isAvailable(): Promise<boolean> {
    return true; // Always available (no API key)
  }

  async search(query: string, config: WebSearchConfig): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      kl: 'us-en',
    });

    const response = await fetch(this.SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; Codi/1.0; +https://github.com/laynepenney/codi)',
      },
      body: params.toString(),
      signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo request failed: ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, config.maxResults);
  }

  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo lite HTML parsing
    const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/td>/gi;

    const links: { url: string; title: string }[] = [];
    const snippets: string[] = [];
    let match;

    // Extract links
    while ((match = linkRegex.exec(html)) !== null && links.length < maxResults) {
      const url = this.decodeUrl(match[1]);
      const title = this.decodeHtml(match[2].trim());

      if (url && title && !url.includes('duckduckgo.com') && title.length > 0) {
        links.push({ url, title });
      }
    }

    // Extract snippets
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
      const snippet = this.decodeHtml(match[1].replace(/<[^>]+>/g, ' ').trim());
      if (snippet) snippets.push(snippet);
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

  private decodeUrl(url: string): string {
    const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        return decodeURIComponent(uddgMatch[1]);
      } catch {}
    }
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }

  private decodeHtml(text: string): string {
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
}

class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const firstEntry = this.cache.entries().next();
      if (!firstEntry.done) {
        const [firstKey, _] = firstEntry.value;
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

export class EnhancedWebSearchTool extends BaseTool {
  private engines: Map<string, SearchEngine>;
  private cache: LRUCache<string, SearchResult[]>;
  private config: WebSearchConfig;

  constructor() {
    super();
    
    this.engines = new Map();
    this.engines.set('brave', new BraveEngine());
    this.engines.set('google', new GoogleEngine());
    this.engines.set('bing', new BingEngine());
    this.engines.set('duckduckgo', new DuckDuckGoEngine());
    
    this.cache = new LRUCache(1000); // Max 1000 entries
    this.config = {
      maxResults: 15,
      cacheEnabled: true,
      enginePriority: ['brave', 'google', 'bing', 'duckduckgo'],
    };
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'web_search', // Same name for backward compatibility
      description:
        'Enhanced web search with multi-engine support, caching, and improved reliability. ' +
        'Returns titles, URLs, and snippets from search results. ' +
        'Supports Brave API (primary), Google Custom Search, Bing API, and DuckDuckGo as fallback.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          num_results: {
            type: 'number',
            description: 'Number of results to return (1-20, default: 15)',
          },
          engine: {
            type: 'string',
            enum: ['auto', 'brave', 'google', 'bing', 'duckduckgo'],
            description: 'Preferred search engine (auto uses fallback order)',
          },
          template: {
            type: 'string',
            enum: ['docs', 'pricing', 'errors', 'general'],
            description: 'Search template for domain-specific optimization',
          },
          date_range: {
            type: 'string',
            enum: ['week', 'month', 'year', 'all'],
            description: 'Date range filter (Google/Bing API only)',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = input.query as string;
    const numResults = Math.min(Math.max((input.num_results as number) || 15, 1), 20);
    const preferredEngine = (input.engine as string) || 'auto';
    const template = input.template as string;

    if (!query?.trim()) {
      throw new Error('Search query is required');
    }

    // Update config
    this.config.maxResults = numResults;

    // Try cache first
    const cacheKey = this.getCacheKey(query, numResults, template);
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return this.formatResults(query, cached, 'Cached');
      }
    }

    try {
      const results = await this.performSearch(query, preferredEngine);
      
      if (this.config.cacheEnabled) {
        this.cache.set(cacheKey, results);
      }

      if (results.length === 0) {
        return `No results found for: "${query}"`;
      }

      return this.formatResults(query, results);
    } catch (error) {
      throw new Error(`Web search failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private getCacheKey(query: string, numResults: number, template?: string): string {
    return `${query}:${numResults}:${template || 'general'}`;
  }

  private async performSearch(query: string, preferredEngine: string): Promise<SearchResult[]> {
    const engines = preferredEngine === 'auto' ? this.config.enginePriority : [preferredEngine];
    
    for (const engineName of engines) {
      const engine = this.engines.get(engineName);
      if (!engine) continue;

      try {
        if (!await engine.isAvailable(this.config)) continue;
        
        const results = await engine.search(query, this.config);
        if (results.length > 0) {
          console.log(`Successfully used ${engine.name} engine`);
          return results;
        }
      } catch (error) {
        console.warn(`Engine ${engineName} failed: ${error}`);
        continue;
      }
    }

    throw new Error('All search engines failed');
  }

  private formatResults(query: string, results: SearchResult[], source?: string): string {
    let output = `Search results for: "${query}"`;
    if (source) output += ` (${source})`;
    output += '\n\n';

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      output += `${i + 1}. ${r.title}\n`;
      output += `   ${r.url}\n`;
      if (r.source) output += `   [${r.source}] `;
      if (r.snippet) output += `${r.snippet}`;
      output += '\n\n';
    }

    return output.trim();
  }

  // Configuration methods (to be called from tool registry)
  setConfig(config: Partial<WebSearchConfig>) {
    this.config = { ...this.config, ...config };
  }
}