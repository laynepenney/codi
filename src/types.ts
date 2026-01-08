// Core message types
/**
 * Represents a single message in the conversation.
 *
 * @interface Message
 * @property {('user' | 'assistant')} role - The role of the message sender ('user' or 'assistant').
 * @property {(string | ContentBlock[])} content - The content of the message, which can be plain text or a block of content.
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/**
 * Represents a block of content within a message.
 *
 * @interface ContentBlock
 * @property {('text' | 'tool_use' | 'tool_result')} type - The type of the content block ('text', 'tool_use', or 'tool_result').
 * @property {string} [text] - The text content if the type is 'text'.
 * @property {string} [id] - A unique identifier for the content block.
 * @property {string} [name] - The name of the tool or block.
 * @property {{[key: string]: unknown}} [input] - Input parameters for a tool call.
 * @property {string} [tool_use_id] - The ID of the tool use within a provider response.
 * @property {string} [content] - Additional content within the block.
 */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

// Tool definitions
/**
 * Represents a definition of a tool that can be invoked.
 *
 * @interface ToolDefinition
 * @property {string} name - The name of the tool.
 * @property {string} description - A brief description of what the tool does.
 * @property {Object<string, unknown>} input_schema - JSON schema describing the input parameters for the tool.
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
 * Represents a call to a tool within the conversation.
 *
 * @interface ToolCall
 * @property {string} id - A unique identifier for this tool call.
 * @property {string} name - The name of the tool being called.
 * @property {{[key: string]: unknown}} input - Input parameters for the tool call.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Represents a result from invoking a tool.
 *
 * @interface ToolResult
 * @property {string} tool_use_id - The ID of the tool use within a provider response for which this is a result.
 * @property {string} content - The content of the tool result, which could be an error message or the output of the tool.
 * @property {boolean} [is_error] - Indicates if the tool invocation resulted in an error (default: false).
 */
export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// Provider response
/**
 * Represents a complete response from the provider, including the content of what was generated,
 * the tool calls made during the generation process, and the reason for stopping.
 *
 * @interface ProviderResponse
 * @property {string} content - The actual content generated as part of the user's response or the model's text.
 * @property {ToolCall[]} toolCalls - A list of tool calls that were made within this context.
 * @property {('end_turn' | 'tool_use' | 'max_tokens')} stopReason - The reason for terminating the generation process.
 */
export interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

// Provider configuration
/**
 * Represents configuration options for the provider, mainly dealing with API credentials and preferences.
 *
 * @interface ProviderConfig
 * @property {string} [apiKey] - The API key used to authenticate requests to the provider's service.
 * @property {string} [baseUrl] - The base URL of the provider's service.
 * @property {string} [model] - The specific model or preset that should be used for generating content.
 */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}