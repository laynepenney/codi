// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mock HTTP Server for E2E Testing
 *
 * A simple HTTP server that mimics the OpenAI API format.
 * Can be used for more realistic E2E testing where you want
 * to test actual HTTP communication.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { ToolCall } from '../../src/types.js';

/**
 * Mock response for the HTTP server.
 */
export interface MockServerResponse {
  /** Text content to return */
  content?: string;
  /** Tool calls to return (OpenAI format) */
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  /** Finish reason */
  finishReason?: 'stop' | 'tool_calls' | 'length';
  /** Simulate an error response */
  error?: {
    message: string;
    type: string;
    code?: string;
  };
  /** Delay before responding (ms) */
  delay?: number;
}

/**
 * Recorded request from the server.
 */
export interface MockServerRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  timestamp: Date;
}

/**
 * Mock server options.
 */
export interface MockServerOptions {
  /** Port to listen on (0 for random) */
  port?: number;
  /** Whether to stream responses */
  stream?: boolean;
  /** Delay between streaming chunks (ms) */
  streamDelay?: number;
}

/**
 * Convert our internal ToolCall format to OpenAI format.
 */
function toOpenAIToolCall(call: ToolCall): MockServerResponse['toolCalls'][0] {
  return {
    id: call.id,
    type: 'function',
    function: {
      name: call.name,
      arguments: JSON.stringify(call.input),
    },
  };
}

/**
 * Mock OpenAI-compatible HTTP server.
 */
export class MockServer {
  private server: Server | null = null;
  private responseQueue: MockServerResponse[] = [];
  private defaultResponse: MockServerResponse = { content: 'Mock response' };
  private requestHistory: MockServerRequest[] = [];
  private port: number = 0;
  private stream: boolean = false;
  private streamDelay: number = 10;

  constructor(options: MockServerOptions = {}) {
    this.port = options.port || 0;
    this.stream = options.stream || false;
    this.streamDelay = options.streamDelay || 10;
  }

  /**
   * Start the mock server.
   * @returns The URL to use as baseUrl for the provider
   */
  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', reject);

      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
          resolve(`http://127.0.0.1:${this.port}`);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  /**
   * Stop the mock server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the server URL.
   */
  getUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Add responses to the queue.
   */
  addResponses(responses: MockServerResponse[]): void {
    this.responseQueue.push(...responses);
  }

  /**
   * Set the default response.
   */
  setDefaultResponse(response: MockServerResponse): void {
    this.defaultResponse = response;
  }

  /**
   * Get request history.
   */
  getRequestHistory(): MockServerRequest[] {
    return [...this.requestHistory];
  }

  /**
   * Get the last request.
   */
  getLastRequest(): MockServerRequest | undefined {
    return this.requestHistory[this.requestHistory.length - 1];
  }

  /**
   * Reset the server state.
   */
  reset(): void {
    this.responseQueue = [];
    this.requestHistory = [];
  }

  /**
   * Handle an incoming request.
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Collect body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    // Record request
    let parsedBody: unknown;
    try {
      parsedBody = body ? JSON.parse(body) : undefined;
    } catch {
      parsedBody = body;
    }

    this.requestHistory.push({
      method: req.method || 'GET',
      path: req.url || '/',
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: parsedBody,
      timestamp: new Date(),
    });

    // Get response
    const mockResponse = this.responseQueue.length > 0
      ? this.responseQueue.shift()!
      : this.defaultResponse;

    // Apply delay
    if (mockResponse.delay) {
      await new Promise(r => setTimeout(r, mockResponse.delay));
    }

    // Handle error response
    if (mockResponse.error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: mockResponse.error }));
      return;
    }

    // Determine if streaming was requested
    const isStreaming = this.stream || (parsedBody && typeof parsedBody === 'object' && (parsedBody as Record<string, unknown>).stream === true);

    if (isStreaming) {
      await this.sendStreamingResponse(res, mockResponse);
    } else {
      this.sendNonStreamingResponse(res, mockResponse);
    }
  }

  /**
   * Send a non-streaming response.
   */
  private sendNonStreamingResponse(res: ServerResponse, mock: MockServerResponse): void {
    const response = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: mock.content || null,
          tool_calls: mock.toolCalls,
        },
        finish_reason: mock.finishReason || (mock.toolCalls ? 'tool_calls' : 'stop'),
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * Send a streaming response.
   */
  private async sendStreamingResponse(res: ServerResponse, mock: MockServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendChunk = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Stream content
    if (mock.content) {
      const chunks = mock.content.match(/.{1,10}/g) || [];
      for (const chunk of chunks) {
        sendChunk({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'mock-model',
          choices: [{
            index: 0,
            delta: { content: chunk },
            finish_reason: null,
          }],
        });
        await new Promise(r => setTimeout(r, this.streamDelay));
      }
    }

    // Send tool calls if present
    if (mock.toolCalls && mock.toolCalls.length > 0) {
      for (const toolCall of mock.toolCalls) {
        sendChunk({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'mock-model',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: toolCall.id,
                type: toolCall.type,
                function: toolCall.function,
              }],
            },
            finish_reason: null,
          }],
        });
      }
    }

    // Send finish
    sendChunk({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-model',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: mock.finishReason || (mock.toolCalls ? 'tool_calls' : 'stop'),
      }],
    });

    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/**
 * Helper to create a text response.
 */
export function serverTextResponse(content: string, delay?: number): MockServerResponse {
  return { content, delay };
}

/**
 * Helper to create a tool call response.
 */
export function serverToolResponse(toolCalls: ToolCall[], delay?: number): MockServerResponse {
  return {
    toolCalls: toolCalls.map(toOpenAIToolCall),
    finishReason: 'tool_calls',
    delay,
  };
}

/**
 * Helper to create an error response.
 */
export function serverErrorResponse(message: string, type: string = 'invalid_request_error'): MockServerResponse {
  return { error: { message, type } };
}
