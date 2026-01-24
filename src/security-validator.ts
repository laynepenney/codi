// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Security Validator
 *
 * Validates tool calls (especially bash commands) using a local AI model
 * before execution. Provides an additional layer of security analysis
 * beyond pattern-based checks.
 *
 * Uses Ollama's generate API to work with both chat and completion-only models.
 */

import type { ToolCall } from './types.js';

/**
 * Result of security validation.
 */
export interface SecurityValidationResult {
  /** Whether the tool call is allowed to proceed */
  allowed: boolean;
  /** Risk score from 0 (safe) to 10 (extremely dangerous) */
  riskScore: number;
  /** List of identified security threats */
  threats: string[];
  /** Explanation of the assessment */
  reasoning: string;
  /** Recommended action */
  recommendation: 'allow' | 'warn' | 'block';
  /** Time taken for validation in milliseconds */
  latencyMs: number;
}

/**
 * Configuration for the security validator.
 */
export interface SecurityValidatorConfig {
  /** Whether security validation is enabled */
  enabled: boolean;
  /** Ollama model to use for validation (default: llama3.2) */
  model: string;
  /** Risk score threshold for blocking (7-10, default: 8) */
  blockThreshold: number;
  /** Risk score threshold for warning (4-6, default: 5) */
  warnThreshold: number;
  /** Tools to validate (default: ['bash']) */
  tools: string[];
  /** Ollama base URL (default: http://localhost:11434) */
  baseUrl: string;
  /** Timeout for validation in milliseconds (default: 10000) */
  timeout: number;
}

const DEFAULT_CONFIG: SecurityValidatorConfig = {
  enabled: false,
  model: 'llama3.2',
  blockThreshold: 8,
  warnThreshold: 5,
  tools: ['bash'],
  baseUrl: 'http://localhost:11434',
  timeout: 10000,
};

const SECURITY_PROMPT = `You are a security analyst evaluating commands for potential risks.
Analyze the following command and respond with ONLY a JSON object (no markdown, no explanation, just pure JSON):

{
  "riskScore": <0-10, where 0 is completely safe and 10 is extremely dangerous>,
  "threats": [<list of specific security threats identified>],
  "recommendation": "<allow|warn|block>",
  "reasoning": "<brief explanation of your assessment>"
}

Risk Score Guidelines:
- 0-3: Safe commands (file listing, version checks, safe reads, build commands)
- 4-6: Potentially risky (network downloads, permission changes, package installs)
- 7-10: Dangerous (destructive operations, privilege escalation, remote code execution)

Recommendation Guidelines:
- "allow": Safe to execute without warning
- "warn": Show warning but allow execution with user approval
- "block": Should not be executed, too dangerous

Command to analyze:`;

interface SecurityResponse {
  riskScore: number;
  threats: string[];
  recommendation: 'allow' | 'warn' | 'block';
  reasoning?: string;
}

/**
 * Parse AI model response into SecurityResponse.
 * Handles malformed JSON gracefully.
 */
function parseSecurityResponse(content: string): SecurityResponse | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let jsonStr = jsonMatch[0];

    // Fix common JSON issues from LLMs
    const openBraces = (jsonStr.match(/\{/g) || []).length;
    const closeBraces = (jsonStr.match(/\}/g) || []).length;
    const openBrackets = (jsonStr.match(/\[/g) || []).length;
    const closeBrackets = (jsonStr.match(/\]/g) || []).length;

    // Add missing closing brackets/braces
    if (openBrackets > closeBrackets) {
      jsonStr += ']'.repeat(openBrackets - closeBrackets);
    }
    if (openBraces > closeBraces) {
      jsonStr += '}'.repeat(openBraces - closeBraces);
    }

    // Remove trailing commas
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Fallback: extract values with regex
      const riskMatch = content.match(/riskScore['":\s]+(\d+)/i);
      const recMatch = content.match(/recommendation['":\s]+(allow|warn|block)/i);

      if (riskMatch) {
        return {
          riskScore: parseInt(riskMatch[1], 10),
          threats: [],
          recommendation: (recMatch?.[1] as 'allow' | 'warn' | 'block') || 'warn',
          reasoning: 'Parsed from malformed JSON',
        };
      }
      return null;
    }

    return {
      riskScore: typeof parsed.riskScore === 'number' ? parsed.riskScore : 5,
      threats: Array.isArray(parsed.threats) ? parsed.threats : [],
      recommendation: ['allow', 'warn', 'block'].includes(parsed.recommendation as string)
        ? (parsed.recommendation as 'allow' | 'warn' | 'block')
        : 'warn',
      reasoning: (parsed.reasoning as string) || '',
    };
  } catch {
    return null;
  }
}

/**
 * Security Validator for tool calls.
 * Uses a local Ollama model to analyze commands for security risks.
 */
export class SecurityValidator {
  private config: SecurityValidatorConfig;
  private available: boolean | null = null;

  constructor(config: Partial<SecurityValidatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if Ollama is running and the model is available.
   */
  async checkAvailability(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.available = false;
        return false;
      }

      const data = (await response.json()) as { models: Array<{ name: string }> };
      this.available = data.models.some((m) => m.name.includes(this.config.model));
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  /**
   * Check if a tool should be validated.
   */
  shouldValidate(toolName: string): boolean {
    return this.config.enabled && this.config.tools.includes(toolName);
  }

  /**
   * Validate a tool call for security risks.
   */
  async validate(toolCall: ToolCall): Promise<SecurityValidationResult> {
    const startTime = Date.now();

    // Check if validation is enabled and applicable
    if (!this.config.enabled || !this.shouldValidate(toolCall.name)) {
      return {
        allowed: true,
        riskScore: 0,
        threats: [],
        reasoning: 'Validation not enabled for this tool',
        recommendation: 'allow',
        latencyMs: Date.now() - startTime,
      };
    }

    // Check availability
    const isAvailable = await this.checkAvailability();
    if (!isAvailable) {
      return {
        allowed: true,
        riskScore: 0,
        threats: [],
        reasoning: 'Security model not available - falling back to pattern-based checks',
        recommendation: 'allow',
        latencyMs: Date.now() - startTime,
      };
    }

    // Build the prompt based on tool type
    let commandToAnalyze: string;
    if (toolCall.name === 'bash') {
      commandToAnalyze = toolCall.input.command as string || '';
    } else {
      // For other tools, serialize the input
      commandToAnalyze = `${toolCall.name}: ${JSON.stringify(toolCall.input)}`;
    }

    if (!commandToAnalyze) {
      return {
        allowed: true,
        riskScore: 0,
        threats: [],
        reasoning: 'No command to analyze',
        recommendation: 'allow',
        latencyMs: Date.now() - startTime,
      };
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: `${SECURITY_PROMPT}\n\n\`${commandToAnalyze}\``,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          allowed: true,
          riskScore: 0,
          threats: [],
          reasoning: `Security model returned error: ${response.status}`,
          recommendation: 'allow',
          latencyMs,
        };
      }

      const data = (await response.json()) as { response: string };
      const parsed = parseSecurityResponse(data.response);

      if (!parsed) {
        return {
          allowed: true,
          riskScore: 0,
          threats: [],
          reasoning: 'Could not parse security model response',
          recommendation: 'allow',
          latencyMs,
        };
      }

      // Determine if allowed based on thresholds
      const allowed = parsed.riskScore < this.config.blockThreshold;
      const recommendation: 'allow' | 'warn' | 'block' =
        parsed.riskScore >= this.config.blockThreshold
          ? 'block'
          : parsed.riskScore >= this.config.warnThreshold
            ? 'warn'
            : 'allow';

      return {
        allowed,
        riskScore: parsed.riskScore,
        threats: parsed.threats,
        reasoning: parsed.reasoning || '',
        recommendation,
        latencyMs,
      };
    } catch (error) {
      return {
        allowed: true,
        riskScore: 0,
        threats: [],
        reasoning: `Security validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        recommendation: 'allow',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): SecurityValidatorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<SecurityValidatorConfig>): void {
    this.config = { ...this.config, ...config };
    // Reset availability check if model or baseUrl changed
    if (config.model || config.baseUrl) {
      this.available = null;
    }
  }

  /**
   * Check if security validation is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

/**
 * Create a SecurityValidator instance from workspace config.
 */
export function createSecurityValidator(
  config?: Partial<SecurityValidatorConfig>
): SecurityValidator {
  return new SecurityValidator(config);
}
