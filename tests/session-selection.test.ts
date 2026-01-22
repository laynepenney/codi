import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionSelector } from '../src/session-selection.js';
import { SessionInfo } from '../src/session.js';
import { Interface as ReadlineInterface } from 'readline';

// Mock readline interface
const mockReadline = {
  pause: vi.fn(),
  resume: vi.fn(),
  removeAllListeners: vi.fn(),
  on: vi.fn(),
  isPaused: vi.fn().mockReturnValue(false),
  question: vi.fn(),
} as unknown as ReadlineInterface;

// Mock session data
const mockSessions: SessionInfo[] = [
  {
    name: 'session1',
    messages: [],
    updatedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
    messageCount: 5,
    hasSummary: false,
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    projectPath: '/path/to/project1',
  },
  {
    name: 'session2',
    messages: [],
    updatedAt: Date.now() - 1000 * 60 * 30, // 30 minutes ago
    messageCount: 10,
    hasSummary: true,
    provider: 'openai',
    model: 'gpt-4',
    projectPath: '/path/to/project2',
  },
];

describe('SessionSelector', () => {
  beforeEach(() => {
    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a SessionSelector instance', () => {
    const selector = new SessionSelector(mockReadline, mockSessions);
    expect(selector).toBeInstanceOf(SessionSelector);
  });

  it('should use simple selection when navigation is disabled', async () => {
    const selector = new SessionSelector(mockReadline, mockSessions, { useNavigation: false });
    
    // Mock the readline question method to simulate user input
    mockReadline.question = vi.fn().mockImplementation((_, callback) => {
      callback('1'); // Select first session
    });
    
    const result = await selector.selectSession();
    expect(result.session).toEqual(mockSessions[0]);
    expect(result.cancelled).toBe(false);
  });

  it('should handle empty sessions array', async () => {
    const selector = new SessionSelector(mockReadline, []);
    
    // Mock the readline question method
    mockReadline.question = vi.fn().mockImplementation((_, callback) => {
      callback('');
    });
    
    const result = await selector.selectSession();
    expect(result.session).toBeNull();
    expect(result.cancelled).toBe(false);
  });
});