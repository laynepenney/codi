import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnhancedWebSearchTool } from '../dist/tools/enhanced-web-search.js';

describe('EnhancedWebSearchTool', () => {
  let tool: EnhancedWebSearchTool;

  beforeEach(() => {
    tool = new EnhancedWebSearchTool();
  });

  it('should have correct tool definition', () => {
    const definition = tool.getDefinition();
    expect(definition.name).toBe('web_search');
    expect(definition.description).toContain('Enhanced web search');
    expect(definition.input_schema.properties.engine.enum).toEqual([
      'auto', 'brave', 'google', 'bing', 'duckduckgo'
    ]);
  });

  it('should handle empty query error', async () => {
    await expect(tool.execute({ query: '' })).rejects.toThrow('Search query is required');
  });

  it('should validate num_results range', async () => {
    const mockSearch = vi.spyOn(tool as any, 'performSearch').mockResolvedValue([]);
    
    // Test lower bound
    await tool.execute({ query: 'test', num_results: -5 });
    expect(mockSearch).toHaveBeenCalledWith('test', 'auto');
    
    // Test upper bound
    await tool.execute({ query: 'test', num_results: 25 });
    expect(mockSearch).toHaveBeenCalledWith('test', 'auto');
    
    mockSearch.mockRestore();
  });

  it('should support preferred engine selection', async () => {
    const mockSearch = vi.spyOn(tool as any, 'performSearch').mockResolvedValue([]);
    
    await tool.execute({ query: 'test', engine: 'auto' });
    expect(mockSearch).toHaveBeenCalledWith('test', 'auto');
    
    await tool.execute({ query: 'test', engine: 'brave' });
    expect(mockSearch).toHaveBeenCalledWith('test', 'auto');
    
    mockSearch.mockRestore();
  });

  it('should apply template optimizations', () => {
    const tool = new EnhancedWebSearchTool();
    
    // Test docs template adds keywords
    const docsQuery = (tool as any).applyTemplate('typescript interface', 'docs');
    expect(docsQuery).toContain('syntax');
    expect(docsQuery).toContain('example');
    
    // Test pricing template adds keywords
    const pricingQuery = (tool as any).applyTemplate('api pricing', 'pricing');
    expect(pricingQuery).toContain('pricing');
    expect(pricingQuery).toContain('cost');
    
    // Test errors template adds keywords
    const errorsQuery = (tool as any).applyTemplate('error message', 'errors');
    expect(errorsQuery).toContain('error');
    expect(errorsQuery).toContain('solution');
    
    // Test general template doesn't modify query
    const generalQuery = (tool as any).applyTemplate('test query', 'general');
    expect(generalQuery).toBe('test query');
  });

  it('should calculate relevance scores', () => {
    const tool = new EnhancedWebSearchTool();

    const result = {
      title: 'Stack Overflow: TypeScript Interface Example',
      url: 'https://stackoverflow.com/questions/123',
      snippet: 'Learn how to create TypeScript interfaces with examples',
      source: 'StackOverflow'
    };

    const score = (tool as any).calculateRelevanceScore(result, 'typescript interface');
    expect(score).toBeGreaterThan(0.5); // Should be higher due to domain and content match

    const lowRelevance = {
      title: 'Unrelated Page',
      url: 'https://example.com/unrelated',
      snippet: 'Some random content',
      source: 'General'
    };

    const lowScore = (tool as any).calculateRelevanceScore(lowRelevance, 'typescript interface');
    expect(lowScore).toBeLessThanOrEqual(0.5); // Base score is 0.5
  });

  it('should enforce rate limiting for engines', () => {
    const tool = new EnhancedWebSearchTool();

    // Initial state - no rate limits
    expect((tool as any).canMakeRequest('brave')).toBe(true);

    // Record 5 requests (the limit)
    for (let i = 0; i < 5; i++) {
      (tool as any).recordRequest('brave');
    }

    // Should now be rate limited
    expect((tool as any).canMakeRequest('brave')).toBe(false);

    // Other engines should not be affected
    expect((tool as any).canMakeRequest('google')).toBe(true);

    // Record one more for google
    (tool as any).recordRequest('google');
    expect((tool as any).canMakeRequest('google')).toBe(true);
  });

  it('should reset rate limits after time period', () => {
    const tool = new EnhancedWebSearchTool();

    // Record requests to reach limit
    for (let i = 0; i < 5; i++) {
      (tool as any).recordRequest('brave');
    }

    // Simulate time passed by manipulating the rate limit timestamp
    const rateLimit = (tool as any).rateLimits.get('brave');
    if (rateLimit) {
      rateLimit.lastRequest = Date.now() - 70000; // 70 seconds ago
      (tool as any).rateLimits.set('brave', rateLimit);
    }

    // Should now be allowed again
    expect((tool as any).canMakeRequest('brave')).toBe(true);
  });
});