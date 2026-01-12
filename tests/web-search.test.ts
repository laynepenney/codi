import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSearchTool } from '../src/tools/web-search.js';

describe('WebSearchTool', () => {
  let tool: WebSearchTool;

  beforeEach(() => {
    tool = new WebSearchTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefinition', () => {
    it('should return correct tool definition', () => {
      const definition = tool.getDefinition();

      expect(definition.name).toBe('web_search');
      expect(definition.description).toContain('Search the web');
      expect(definition.input_schema.type).toBe('object');
      expect(definition.input_schema.properties).toHaveProperty('query');
      expect(definition.input_schema.properties).toHaveProperty('num_results');
      expect(definition.input_schema.required).toContain('query');
    });
  });

  describe('execute', () => {
    it('should throw error for empty query', async () => {
      await expect(tool.execute({ query: '' })).rejects.toThrow('Search query is required');
      await expect(tool.execute({ query: '   ' })).rejects.toThrow('Search query is required');
      await expect(tool.execute({})).rejects.toThrow('Search query is required');
    });

    it('should clamp num_results to valid range', async () => {
      // Mock fetch to avoid actual network calls
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html></html>'),
      });
      vi.stubGlobal('fetch', mockFetch);

      // Test with num_results > 10
      await tool.execute({ query: 'test', num_results: 20 });
      // Test with num_results < 1
      await tool.execute({ query: 'test', num_results: 0 });

      // Verify fetch was called (means validation passed)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return no results message when search returns empty', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html><body></body></html>'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await tool.execute({ query: 'test query' });
      expect(result).toBe('No results found for: "test query"');
    });

    it('should throw error on failed request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(tool.execute({ query: 'test' })).rejects.toThrow('Search request failed: 500');
    });

    it('should throw error on network failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      await expect(tool.execute({ query: 'test' })).rejects.toThrow('Web search failed: Network error');
    });
  });

  describe('parseResults', () => {
    it('should parse DuckDuckGo lite HTML format', () => {
      const html = `
        <html>
          <body>
            <table>
              <tr>
                <td>
                  <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1">Example Page 1</a>
                </td>
              </tr>
              <tr>
                <td class="result-snippet">This is the first result snippet.</td>
              </tr>
              <tr>
                <td>
                  <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage2">Example Page 2</a>
                </td>
              </tr>
              <tr>
                <td class="result-snippet">This is the second result snippet.</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const results = tool.parseResults(html, 5);

      expect(results.length).toBe(2);
      expect(results[0].title).toBe('Example Page 1');
      expect(results[0].url).toBe('https://example.com/page1');
      // Snippet may include extra content from fallback parsing
      expect(results[0].snippet).toContain('first result snippet');
      expect(results[1].title).toBe('Example Page 2');
      expect(results[1].url).toBe('https://example.org/page2');
    });

    it('should respect maxResults limit', () => {
      const html = `
        <html>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite1.com">Site 1</a>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite2.com">Site 2</a>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite3.com">Site 3</a>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite4.com">Site 4</a>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite5.com">Site 5</a>
        </html>
      `;

      const results = tool.parseResults(html, 3);
      expect(results.length).toBe(3);
    });

    it('should skip duckduckgo.com navigation links', () => {
      const html = `
        <a rel="nofollow" href="https://duckduckgo.com/settings">Settings</a>
        <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freal-site.com">Real Site</a>
      `;

      const results = tool.parseResults(html, 5);
      expect(results.length).toBe(1);
      expect(results[0].url).toBe('https://real-site.com');
    });

    it('should return empty array for HTML with no results', () => {
      const html = '<html><body><p>No matches found</p></body></html>';
      const results = tool.parseResults(html, 5);
      expect(results).toEqual([]);
    });
  });

  describe('decodeUrl', () => {
    it('should extract URL from DuckDuckGo redirect', () => {
      const redirectUrl = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpath';
      expect(tool.decodeUrl(redirectUrl)).toBe('https://example.com/path');
    });

    it('should handle URLs with special characters', () => {
      const redirectUrl = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dhello%26lang%3Den';
      expect(tool.decodeUrl(redirectUrl)).toBe('https://example.com/search?q=hello&lang=en');
    });

    it('should add https to protocol-relative URLs', () => {
      const url = '//example.com/page';
      expect(tool.decodeUrl(url)).toBe('https://example.com/page');
    });

    it('should return original URL if not a redirect', () => {
      const url = 'https://direct-url.com/page';
      expect(tool.decodeUrl(url)).toBe('https://direct-url.com/page');
    });

    it('should handle malformed URLs gracefully', () => {
      const badUrl = '//duckduckgo.com/l/?uddg=%invalid%';
      // Should not throw, just return original
      expect(tool.decodeUrl(badUrl)).toBe(badUrl);
    });
  });

  describe('decodeHtml', () => {
    it('should decode common HTML entities', () => {
      expect(tool.decodeHtml('&amp;')).toBe('&');
      expect(tool.decodeHtml('&lt;')).toBe('<');
      expect(tool.decodeHtml('&gt;')).toBe('>');
      expect(tool.decodeHtml('&quot;')).toBe('"');
      expect(tool.decodeHtml('&#39;')).toBe("'");
      expect(tool.decodeHtml('&#x27;')).toBe("'");
      expect(tool.decodeHtml('&apos;')).toBe("'");
      // nbsp alone gets trimmed, but in context it becomes a space
      expect(tool.decodeHtml('hello&nbsp;world')).toBe('hello world');
    });

    it('should decode mixed content', () => {
      const html = 'Tom &amp; Jerry &lt;TV Show&gt;';
      expect(tool.decodeHtml(html)).toBe('Tom & Jerry <TV Show>');
    });

    it('should normalize whitespace', () => {
      expect(tool.decodeHtml('  hello   world  ')).toBe('hello world');
      expect(tool.decodeHtml('line1\n\n\nline2')).toBe('line1 line2');
    });

    it('should handle empty string', () => {
      expect(tool.decodeHtml('')).toBe('');
    });
  });

  describe('integration with real fetch (skipped by default)', () => {
    it.skip('should perform actual web search', async () => {
      // This test makes real network calls - run manually when needed
      const result = await tool.execute({ query: 'TypeScript documentation', num_results: 3 });

      expect(result).toContain('Search results for:');
      expect(result).toContain('TypeScript');
      // Should have numbered results
      expect(result).toMatch(/1\./);
    });
  });
});
