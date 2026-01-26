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
    
    await tool.execute({ query: 'test', engine: 'brave' });
    expect(mockSearch).toHaveBeenCalledWith('test', 'brave');
    
    await tool.execute({ query: 'test', engine: 'google' });
    expect(mockSearch).toHaveBeenCalledWith('test', 'google');
    
    mockSearch.mockRestore();
  });

  it('should support search templates', async () => {
    const mockSearch = vi.spyOn(tool as any, 'performSearch').mockResolvedValue([]);
    
    await tool.execute({ query: 'test', template: 'docs' });
    expect(mockSearch).toHaveBeenCalledWith('test', 'auto');
    
    await tool.execute({ query: 'test', template: 'errors' });
    expect(mockSearch).toHaveBeenCalledWith('test', 'auto');
    
    mockSearch.mockRestore();
  });
});