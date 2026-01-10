// Core message types
/**
 * Represents a message with role and content.
 * @property {('user' | 'assistant')} role - The role of the sender.
 * @property {(string | ContentBlock[])} content - The content of the message.
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** Supported image media types for vision */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Image source data for vision content blocks */
export interface ImageSource {
  type: 'base64';
  media_type: ImageMediaType;
  data: string;
}

/**
 * Represents a block of content within a message.
 * @property {('text' | 'tool_use' | 'tool_result' | 'image')} type - The type of the content block.
 * @property {{string}} [text] - The text content if available.
 * @property {{string}} [id] - The ID of the content block if it's a tool use or result.
 * @property {{string}} [name] - The name of the content block if it's a tool use.
 * @property {Record<string, unknown>} [input] - Input parameters for the content block if it's a tool call.
 * @property {{string}} [tool_use_id] - The ID of the associated tool use if available.
 * @property {string} [content] - Additional content within the block.
 * @property {boolean} [is_error] - Indicates if there was an error in processing the content block.
 * @property {ImageSource} [image] - Image data for vision content blocks.
 */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  image?: ImageSource;
}

// Tool definitions
/**
 * Represents a definition of a tool.
 * @property {string} name - The name of the tool.
 * @property {string} description - A description of what the tool does.
 * @property {{type: 'object', properties: Record<string, unknown>, required?: string[]}} input_schema - Schema for the input parameters of the tool.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Represents a call to a tool.
 * @property {string} id - Unique identifier for the tool call.
 * @property {string} name - The name of the tool being called.
 * @property {{Record<string, unknown>}} input - Input parameters for the tool.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Represents a result from a tool call.
 * @property {string} tool_use_id - Unique identifier of the tool use associated with this result.
 * @property {string} content - The output content from the tool.
 * @property {boolean} [is_error] - Indicates if there was an error during the tool execution.
 */
export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Token usage information from a provider response.
 */
export interface TokenUsage {
  /** Number of tokens in the input/prompt */
  inputTokens: number;
  /** Number of tokens in the output/completion */
  outputTokens: number;
  /** Tokens used to create cache (Anthropic) */
  cacheCreationInputTokens?: number;
  /** Tokens read from cache (Anthropic) */
  cacheReadInputTokens?: number;
  /** Tokens served from cache (OpenAI) */
  cachedInputTokens?: number;
}

// Provider response
/**
 * Represents a response from a provider, likely containing messages and tool calls.
 * @property {string} content - The main content of the response.
 * @property {ToolCall[]} toolCalls - List of tool calls made within this response.
 * @property {{'end_turn' | 'tool_use' | 'max_tokens'}} stopReason - Reason for stopping the response generation.
 * @property {string} [reasoningContent] - Optional reasoning/thinking content from reasoning models.
 * @property {TokenUsage} [usage] - Token usage information if available.
 */
export interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  reasoningContent?: string;
  usage?: TokenUsage;
}

// Provider configuration
/**
 * Represents configuration settings for a provider, such as API keys and model details.
 * @property {string} [apiKey] - Optional API key for authentication.
 * @property {string} [baseUrl] - Optional base URL for the provider's API.
 * @property {string} [model] - The AI model to use, if applicable.
 */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
