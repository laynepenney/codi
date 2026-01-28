#!/usr/bin/env node
// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createInterface, type Interface } from 'readline';
import {
  createPasteInterceptor,
  enableBracketedPaste,
  disableBracketedPaste,
  consumePendingPaste,
} from './paste-debounce.js';
import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { glob } from 'node:fs/promises';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { format as formatUtil } from 'util';
import { getInterruptHandler, destroyInterruptHandler } from './interrupt.js';
import { parseCommandChain, requestPermissionForChainedCommands } from './bash-utils.js';
import {
  HISTORY_FILE,
  MAX_HISTORY_SIZE,
  loadHistory,
  saveToHistory,
  type PipelineInputConfig,
  DEFAULT_PIPELINE_INPUT_CONFIG,
  isGlobOrFilePath,
  resolvePipelineInput,
  resolveFileList,
  type NonInteractiveResult,
  type NonInteractiveOptions,
  runNonInteractive,
} from './cli/index.js';

import { Agent, type ToolConfirmation, type ConfirmationResult, type SecurityWarning } from './agent.js';
import { SecurityValidator, createSecurityValidator } from './security-validator.js';
// Provider creation helpers now in cli/initialization.ts
import { shutdownAllRateLimiters } from './providers/rate-limiter.js';
import { globalRegistry, registerDefaultTools, ToolRegistry } from './tools/index.js';
import { detectProject, formatProjectContext, loadContextFile } from './context.js';
import { generateSystemPrompt } from './cli/system-prompt.js';
import { showHelp } from './cli/help.js';
import { OpenFilesManager } from './open-files.js';
import {
  isCommand,
  parseCommand,
  getCommand,
  getAllCommands,
  type CommandContext,
  type ProjectInfo,
} from './commands/index.js';
import {
  getCurrentSessionName,
  setCurrentSessionName,
} from './commands/session-commands.js';
import { getSymbolIndexService } from './commands/symbol-commands.js';
import { setOrchestrator, getOrchestratorInstance } from './commands/orchestrate-commands.js';
import { generateMemoryContext, consolidateSessionNotes } from './memory.js';
import { registerOrchestrationTools, registerContextStatusTool } from './tools/index.js';
import { createCompleter } from './completions.js';
// SymbolIndexService init now in cli/initialization.ts
import { formatCost, formatTokens } from './usage.js';
import { dispatch as dispatchOutput } from './cli/output-handlers.js';
import { loadPluginsFromDirectory, getPluginsDir } from './plugins.js';
import {
  loadSession,
  saveSession,
  listSessions,
  findSessions,
  generateSessionName,
  formatSessionInfo,
  type SessionInfo,
} from './session.js';
import { promptSessionSelection } from './session-selection.js';
import { runChildAgent } from './orchestrate/child-agent.js';
import { Orchestrator } from './orchestrate/commander.js';
import { READER_ALLOWED_TOOLS } from './orchestrate/types.js';
import { WorkerStatusUI } from './orchestrate/worker-status-ui.js';
import { runInkUi } from './ui/ink/run-ink-ui.js';
import { InkUiController } from './ui/ink/controller.js';
import { attachInkTranscriptWriter } from './ui/ink/transcript.js';
import {
  loadWorkspaceConfig,
  loadLocalConfig,
  loadGlobalConfig,
  validateConfig,
  mergeConfig,
  getCustomDangerousPatterns,
  type ResolvedConfig,
} from './config.js';
import { initModelMap as loadModelMapFromDir, type ModelMap } from './model-map/index.js';
import { VERSION } from './version.js';
import {
  formatConfirmation,
  formatConfirmationDetail,
  stripAnsi,
  promptConfirmation,
  promptConfirmationWithSuggestions,
} from './cli/confirmation.js';
import {
  registerToolsAndCommands,
  createPrimaryProvider,
  createSummarizeProvider,
  initializeMCP,
  initializeRAG,
  initializeSymbolIndex,
  logToolSummary,
} from './cli/initialization.js';
import { spinner } from './spinner.js';
import { logger, parseLogLevel, LogLevel } from './logger.js';
import { MCPClientManager, startMCPServer } from './mcp/index.js';
import { AuditLogger, initAuditLogger, getAuditLogger } from './audit.js';
import { initDebugBridge, getDebugBridge, isDebugBridgeEnabled } from './debug-bridge.js';

// CLI setup
program
  .name('codi')
  .description('Your AI coding wingman')
  .version(VERSION, '-v, --version', 'Output the current version')
  .option('-p, --provider <type>', 'Provider to use (anthropic, openai, ollama, runpod)', 'auto')
  .option('-m, --model <name>', 'Model to use')
  .option('--base-url <url>', 'Base URL for API (for self-hosted models)')
  .option('--endpoint-id <id>', 'Endpoint ID (for RunPod serverless)')
  .option('--no-tools', "Disable tool use (for models that don't support it)")
  .option('-y, --yes', 'Auto-approve all tool operations (skip confirmation prompts)')
  .option('--verbose', 'Show detailed tool information')
  .option('--debug', 'Show API and context details')
  .option('--trace', 'Show full request/response payloads')
  .option('-s, --session <name>', 'Load a saved session on startup')
  .option('--resume [name]', 'Resume the most recent session for this directory (or a specific session name)')
  .option('--no-compress', 'Disable context compression (enabled by default)')
  .option('--context-window <tokens>', 'Context window size (tokens) before compaction')
  .option('--summarize-model <name>', 'Model to use for summarization (default: primary model)')
  .option('--summarize-provider <type>', 'Provider for summarization model (default: primary provider)')
  .option('--mcp-server', 'Run as MCP server (stdio transport) - exposes tools to other MCP clients')
  .option('--no-mcp', 'Disable MCP server connections (ignore mcpServers in config)')
  .option('--audit', 'Enable audit logging (writes to ~/.codi/audit/)')
  .option('--debug-bridge', 'Enable debug bridge for live debugging (writes to ~/.codi/debug/)')
  // Non-interactive mode options
  .option('-P, --prompt <text>', 'Run a single prompt and exit (non-interactive mode)')
  .option('-f, --output-format <format>', 'Output format: text or json (default: text)', 'text')
  .option('-q, --quiet', 'Suppress spinners and progress output (for scripting)')
  .option('--ui <mode>', 'UI mode: classic or ink (default: ink)', 'ink')
  // Child mode options (for multi-agent orchestration)
  .option('--child-mode', 'Run as child agent (connects to commander via IPC)')
  .option('--reader-mode', 'Run as reader agent (read-only tools only)')
  .option('--socket-path <path>', 'IPC socket path (for child mode)')
  .option('--child-id <id>', 'Unique child identifier (for child mode)')
  .option('--child-task <task>', 'Task to execute (for child mode)')
  .parse(
    (() => {
      const rawArgv = process.argv.slice(2);
      const cleanedArgv = rawArgv[0] === '--' ? rawArgv.slice(1) : rawArgv;
      return ['node', 'codi', ...cleanedArgv];
    })(),
    { from: 'node' }
  );

const options = program.opts();
const requestedUiMode = String(options.ui || 'ink').toLowerCase();
const supportedUiModes = new Set(['classic', 'ink']);
if (!supportedUiModes.has(requestedUiMode)) {
  logger.error(`Unknown UI mode: ${requestedUiMode}. Use "classic" or "ink".`);
  process.exit(1);
}


function startConsoleCapture(): {
  stdout: string[];
  stderr: string[];
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const capture = (target: string[], args: unknown[]) => {
    const line = stripAnsi(formatUtil(...args));
    for (const part of line.split('\n')) {
      target.push(part);
    }
  };

  console.log = (...args: unknown[]) => capture(stdout, args);
  console.info = (...args: unknown[]) => capture(stdout, args);
  console.warn = (...args: unknown[]) => capture(stderr, args);
  console.error = (...args: unknown[]) => capture(stderr, args);

  const restore = () => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  };

  return { stdout, stderr, restore };
}

function startWriteCapture(): {
  stdout: string[];
  stderr: string[];
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const captureWrite = (target: string[]) => {
    return (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
      callback?: (err?: Error | null) => void
    ): boolean => {
      let encoding: BufferEncoding | undefined;
      let cb = callback;
      if (typeof encodingOrCallback === 'function') {
        cb = encodingOrCallback;
      } else {
        encoding = encodingOrCallback;
      }

      let text = '';
      if (typeof chunk === 'string') {
        text = chunk;
      } else if (chunk) {
        text = Buffer.from(chunk).toString(encoding ?? 'utf8');
      }
      if (text) {
        target.push(text);
      }
      if (typeof cb === 'function') {
        cb();
      }
      return true;
    };
  };

  (process.stdout.write as unknown as typeof process.stdout.write) = captureWrite(stdout);
  (process.stderr.write as unknown as typeof process.stderr.write) = captureWrite(stderr);

  const restore = () => {
    (process.stdout.write as unknown as typeof process.stdout.write) = originalStdoutWrite;
    (process.stderr.write as unknown as typeof process.stderr.write) = originalStderrWrite;
  };

  return { stdout, stderr, restore };
}

function emitCapturedOutput(
  inkController: InkUiController | null,
  captured: { stdout: string[]; stderr: string[] }
): void {
  if (!inkController) return;
  const stdoutText = captured.stdout.join('\n');
  const stderrText = captured.stderr.join('\n');
  if (stdoutText.trim()) {
    inkController.addMessage('system', `Output:\n${stdoutText}`);
  }
  if (stderrText.trim()) {
    inkController.addMessage('system', `Error:\n${stderrText}`);
  }
}

function emitCapturedWrites(
  inkController: InkUiController | null,
  captured: { stdout: string[]; stderr: string[] }
): void {
  if (!inkController) return;
  const stdoutText = captured.stdout.join('');
  const stderrText = captured.stderr.join('');
  if (stdoutText.trim()) {
    inkController.addMessage('system', `Output:\n${stdoutText}`);
  }
  if (stderrText.trim()) {
    inkController.addMessage('system', `Error:\n${stderrText}`);
  }
}

async function renderCommandOutput(
  inkController: InkUiController | null,
  handler: () => void | Promise<void>
): Promise<void> {
  if (!inkController) {
    await handler();
    return;
  }
  const captured = startConsoleCapture();
  const capturedWrites = startWriteCapture();
  try {
    await handler();
  } finally {
    captured.restore();
    capturedWrites.restore();
    emitCapturedOutput(inkController, captured);
    emitCapturedWrites(inkController, capturedWrites);
  }
}

function normalizeSessionProjectPath(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return resolve(value);
  } catch {
    return null;
  }
}

function filterSessionsByProjectPath(sessions: SessionInfo[], projectPath: string): SessionInfo[] {
  const normalized = normalizeSessionProjectPath(projectPath);
  if (!normalized) return [];
  return sessions.filter((session) => normalizeSessionProjectPath(session.projectPath) === normalized);
}

async function resolveResumeSessionName(
  resumeOption: string | boolean,
  cwd: string,
  rl: Interface | null,
  interactive: boolean,
  inkController?: InkUiController | null
): Promise<string | null> {
  const trimmed = typeof resumeOption === 'string' ? resumeOption.trim() : '';
  const canPrompt = Boolean(interactive && rl && process.stdin.isTTY && process.stdout.isTTY);
  const canInkPrompt = Boolean(interactive && inkController && process.stdin.isTTY && process.stdout.isTTY);

  if (trimmed) {
    const exact = listSessions().find((session) => session.name === trimmed);
    if (exact) {
      return exact.name;
    }

    const matches = findSessions(trimmed);
    if (matches.length === 1) {
      return matches[0].name;
    }
    if (matches.length > 1) {
      if (canInkPrompt && inkController) {
        const selection = await inkController.requestSessionSelection(matches);
        return selection?.name ?? matches[0].name;
      }
      if (canPrompt && rl) {
        const selection = await promptSessionSelection(rl, matches);
        return selection?.name ?? matches[0].name;
      }
      return matches[0].name;
    }
    return trimmed;
  }

  const candidates = filterSessionsByProjectPath(listSessions(), cwd);
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0].name;
  }
  if (canInkPrompt && inkController) {
    const selection = await inkController.requestSessionSelection(candidates);
    return selection?.name ?? candidates[0].name;
  }
  if (canPrompt && rl) {
    const selection = await promptSessionSelection(rl, candidates);
    return selection?.name ?? candidates[0].name;
  }
  return candidates[0].name;
}

function autoSaveSession(context: CommandContext, agent: Agent): void {
  const messages = agent.getHistory();
  if (messages.length === 0) return;

  let sessionName = context.sessionState?.currentName || getCurrentSessionName();
  if (!sessionName) {
    sessionName = generateSessionName();
    context.setSessionName?.(sessionName);
  }

  const provider = agent.getProvider();
  try {
    saveSession(sessionName, messages, agent.getSummary(), {
      projectPath: process.cwd(),
      projectName: context.projectInfo?.name || '',
      provider: provider.getName(),
      model: provider.getModel(),
      label: context.sessionState?.label || undefined,
      openFilesState: context.openFilesManager?.toJSON(),
    });
  } catch (error) {
    logger.debug(`Auto-save failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * CLI entrypoint.
 *
 * Initializes project context, registers tools and slash-commands, creates the
 * selected LLM provider and the agent, then starts an interactive readline loop
 * that routes either built-in commands, slash commands, or free-form chat to the
 * agent.
 *
 * @returns A promise that resolves when the interactive loop exits.
 */
async function main() {
  // Check if running as MCP server (stdio transport)
  if (options.mcpServer) {
    // Register tools so they can be exposed
    registerDefaultTools();

    // Start MCP server (blocks until connection closes)
    await startMCPServer();
    return;
  }

  // Initialize audit logger (--audit flag or CODI_AUDIT env var)
  const auditEnabled = options.audit || process.env.CODI_AUDIT === 'true';
  const auditLogger = initAuditLogger(auditEnabled);

  // Initialize debug bridge (--debug-bridge flag or CODI_DEBUG_BRIDGE env var)
  const debugBridgeEnabled = options.debugBridge || process.env.CODI_DEBUG_BRIDGE === 'true';
  if (debugBridgeEnabled) {
    initDebugBridge();
  }

  console.log(chalk.bold.blue('\n🤖 Codi - Your AI Coding Wingman\n'));

  // Detect project context
  const projectInfo = await detectProject();
  if (projectInfo) {
    console.log(
      chalk.dim(
        `Project: ${projectInfo.name} (${projectInfo.language}${projectInfo.framework ? ` / ${projectInfo.framework}` : ''})`,
      ),
    );
  }

  // Load global configuration (~/.codi/config.json)
  const { config: globalConfig, configPath: globalConfigPath } = loadGlobalConfig();
  if (globalConfig && globalConfigPath) {
    console.log(chalk.dim(`Global config: ${globalConfigPath}`));
    const warnings = validateConfig(globalConfig);
    if (warnings.length > 0) {
      console.log(chalk.yellow('Global config warnings:'));
      for (const w of warnings) {
        console.log(chalk.yellow(`  - ${w}`));
      }
    }
  }

  // Load workspace configuration
  const { config: workspaceConfig, configPath } = loadWorkspaceConfig();
  if (workspaceConfig && configPath) {
    const warnings = validateConfig(workspaceConfig);
    if (warnings.length > 0) {
      console.log(chalk.yellow('Config warnings:'));
      for (const w of warnings) {
        console.log(chalk.yellow(`  - ${w}`));
      }
    }
    console.log(chalk.dim(`Config: ${configPath}`));
  }

  // Load model map configuration (codi-models.yaml)
  let modelMap: ModelMap | null = null;
  try {
    modelMap = loadModelMapFromDir(process.cwd());
    if (modelMap) {
      const modelCount = Object.keys(modelMap.config.models).length;
      const taskCount = Object.keys(modelMap.config.tasks || {}).length;
      const pipelineCount = Object.keys(modelMap.config.pipelines || {}).length;
      console.log(chalk.dim(`Model map: ${modelCount} models, ${taskCount} tasks, ${pipelineCount} pipelines`));
      if (modelMap.configPath) {
        console.log(chalk.dim(`Model map file: ${modelMap.configPath}`));
      }
    }
  } catch (err) {
    logger.warn(`Model map error: ${err instanceof Error ? err.message : err}`);
  }

  // Check for context file (CODI.md)
  const { content: contextFileContent, path: contextFilePath } = loadContextFile();
  if (contextFilePath) {
    console.log(chalk.dim(`Context: ${contextFilePath}`));
  }

  // Merge workspace config with CLI options
  const parsedContextWindow = options.contextWindow ? Number(options.contextWindow) : NaN;
  const contextWindowTokens = Number.isFinite(parsedContextWindow) && parsedContextWindow > 0
    ? Math.floor(parsedContextWindow)
    : undefined;

  if (options.contextWindow && contextWindowTokens === undefined) {
    logger.warn('Invalid --context-window value; expected a positive number.');
  }

  // Load local config (gitignored, user-specific approvals)
  const localConfig = loadLocalConfig();

  const resolvedConfig = mergeConfig(
    workspaceConfig,
    {
      provider: options.provider,
      model: options.model,
      baseUrl: options.baseUrl,
      endpointId: options.endpointId,
      yes: options.yes,
      tools: options.tools,
      session: options.session,
      summarizeProvider: options.summarizeProvider,
      summarizeModel: options.summarizeModel,
      maxContextTokens: contextWindowTokens,
    },
    localConfig,
    globalConfig
  );

  // Register tools and commands
  registerToolsAndCommands();

  // Load plugins from ~/.codi/plugins/
  // Security: Plugins can execute arbitrary code - only install trusted plugins
  const loadedPlugins = await loadPluginsFromDirectory();
  if (loadedPlugins.length > 0) {
    console.log(chalk.dim(`Plugins: ${loadedPlugins.length} loaded (${loadedPlugins.map(p => p.plugin.name).join(', ')})`));
  }

  // Initialize MCP clients if configured and not disabled
  const mcpResult = await initializeMCP(workspaceConfig, options.mcp !== false);
  const mcpManager = mcpResult.manager;

  // Initialize RAG system (enabled by default unless explicitly disabled)
  const ragResult = await initializeRAG(process.cwd(), workspaceConfig, modelMap);
  const ragIndexer = ragResult.indexer;
  const ragRetriever = ragResult.retriever;
  const ragEmbeddingProvider = ragResult.embeddingProvider;

  // Initialize Symbol Index for AST-based navigation tools
  const symbolResult = await initializeSymbolIndex(process.cwd());

  // Log tool summary
  logToolSummary(resolvedConfig);
  const useTools = !resolvedConfig.noTools; // Disabled via config or --no-tools
  console.log(chalk.dim(`Commands: ${getAllCommands().length} available`));

  // Create provider using resolved config
  const provider = createPrimaryProvider({
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    baseUrl: resolvedConfig.baseUrl,
    endpointId: resolvedConfig.endpointId,
    cleanHallucinatedTraces: resolvedConfig.cleanHallucinatedTraces,
  });

  console.log(chalk.dim(`Model: ${provider.getName()} (${provider.getModel()})`));

  // Show audit log path if enabled
  if (auditLogger.isEnabled()) {
    console.log(chalk.dim(`Audit log: ${auditLogger.getLogFile()}`));
    auditLogger.sessionStart(provider.getName(), provider.getModel(), process.cwd(), process.argv.slice(2));
  }

  // Emit debug bridge session start
  if (isDebugBridgeEnabled()) {
    getDebugBridge().sessionStart(provider.getName(), provider.getModel());
  }

  // Create secondary provider for summarization if configured
  const secondaryProvider = createSummarizeProvider({
    summarizeProvider: resolvedConfig.summarizeProvider,
    summarizeModel: resolvedConfig.summarizeModel,
  });
  if (secondaryProvider) {
    console.log(chalk.dim(`Summarize model: ${secondaryProvider.getName()} (${secondaryProvider.getModel()})`));
  }
  console.log();

  // =========================================================================
  // CHILD MODE - Run as child agent for multi-agent orchestration
  // =========================================================================
  if (options.childMode) {
    // Validate required options
    if (!options.socketPath) {
      logger.error('--socket-path is required for child mode');
      process.exit(1);
    }
    if (!options.childId) {
      logger.error('--child-id is required for child mode');
      process.exit(1);
    }
    if (!options.childTask) {
      logger.error('--child-task is required for child mode');
      process.exit(1);
    }

    // Get current branch
    const { execSync } = await import('child_process');
    let currentBranch = 'unknown';
    try {
      currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    } catch {
      // Ignore git errors
    }

    // Build system prompt with worker-specific additions
    let systemPrompt = generateSystemPrompt(projectInfo, useTools);

    // Add worker-specific context
    systemPrompt += `

## Worker Agent Context

You are a **delegated worker agent** running in an isolated git worktree.

**Your Assignment:**
- Branch: \`${currentBranch}\`
- Task: Complete the specific task assigned to you (see first message)

**Important Guidelines:**
1. **Focus on the task**: Complete only what is asked. Do not add extra features or refactoring.
2. **Be autonomous**: Do not ask clarifying questions. Make reasonable assumptions and proceed.
3. **Complete the work**: When the task is done, summarize what you accomplished.
4. **Tool permissions**: Your tool requests are routed to the commander for approval. Wait for results.
5. **Stay in scope**: Work only within this worktree. Do not reference or modify files outside.

**Workflow:**
1. Understand the task from the first message
2. Use tools to explore the codebase if needed
3. Implement the required changes
4. Verify your work (read files back, run tests if applicable)
5. Provide a brief summary of what was done

Begin by analyzing the task and planning your approach.`;

    console.log(chalk.dim(`Running as child agent: ${options.childId}`));
    console.log(chalk.dim(`Task: ${options.childTask}`));
    console.log(chalk.dim(`Socket: ${options.socketPath}`));

    // Run child agent and exit
    await runChildAgent({
      socketPath: options.socketPath,
      childId: options.childId,
      worktree: process.cwd(),
      branch: currentBranch,
      task: options.childTask,
      provider,
      toolRegistry: globalRegistry,
      systemPrompt,
      model: provider.getModel(),
      providerName: provider.getName(),
      autoApprove: resolvedConfig.autoApprove,
    });
    return;
  }

  // =========================================================================
  // READER MODE - Run as reader agent (read-only tools) for orchestration
  // =========================================================================
  if (options.readerMode) {
    // Validate required options
    if (!options.socketPath) {
      logger.error('--socket-path is required for reader mode');
      process.exit(1);
    }
    if (!options.childId) {
      logger.error('--child-id is required for reader mode');
      process.exit(1);
    }
    if (!options.childTask) {
      logger.error('--child-task is required for reader mode');
      process.exit(1);
    }

    // Build system prompt with reader-specific additions
    let systemPrompt = generateSystemPrompt(projectInfo, useTools);

    // Add reader-specific context
    systemPrompt += `

## Reader Agent Context

You are a **read-only research agent** helping gather information and analyze code.

**Your Assignment:**
- Query: ${options.childTask}

**Important Guidelines:**
1. **Read-only access**: You only have access to read files, search, and analyze. You cannot modify files.
2. **Be thorough**: Search comprehensively to find all relevant information.
3. **Be autonomous**: Do not ask clarifying questions. Use available tools to find answers.
4. **Complete the research**: When done, provide a clear summary of your findings.
5. **Stay focused**: Answer only what is asked. Do not speculate beyond the evidence.

**Available Tools:**
- read_file: Read file contents
- glob: Find files by pattern
- grep: Search file contents
- list_directory: List directory contents
- analyze_image: Analyze images
- print_tree: Show directory structure
- rag_search: Semantic code search
- Symbol index tools: find_symbol, find_references, goto_definition, etc.

**Workflow:**
1. Understand the query
2. Use search tools to find relevant files and code
3. Read and analyze the relevant content
4. Provide a comprehensive answer with specific references

Begin by analyzing the query and planning your research approach.`;

    console.log(chalk.dim(`Running as reader agent: ${options.childId}`));
    console.log(chalk.dim(`Query: ${options.childTask}`));
    console.log(chalk.dim(`Socket: ${options.socketPath}`));

    // Filter tool registry to only read-only tools
    const readerToolRegistry = new ToolRegistry();
    for (const toolName of READER_ALLOWED_TOOLS) {
      const tool = globalRegistry.get(toolName);
      if (tool) {
        readerToolRegistry.register(tool);
      }
    }

    // Run reader agent and exit
    await runChildAgent({
      socketPath: options.socketPath,
      childId: options.childId,
      worktree: process.cwd(),
      branch: 'reader', // Readers don't use branches but need a value
      task: options.childTask,
      provider,
      toolRegistry: readerToolRegistry,
      systemPrompt,
      model: provider.getModel(),
      providerName: provider.getName(),
      autoApprove: READER_ALLOWED_TOOLS as unknown as string[], // Auto-approve all reader tools
    });
    return;
  }

  const canUseInkUi =
    requestedUiMode === 'ink' &&
    process.stdout.isTTY &&
    process.stdin.isTTY &&
    !options.prompt;
  const useInkUi = canUseInkUi;
  if (requestedUiMode === 'ink' && !useInkUi && !options.prompt) {
    console.log(chalk.dim('Ink UI requires a TTY. Falling back to classic.'));
  }

  const inkController = useInkUi ? new InkUiController() : null;
  if (inkController) {
    inkController.setStatus({
      provider: provider.getName(),
      model: provider.getModel(),
      activity: 'idle',
    });
  }
  const transcriptWriter = inkController
    ? attachInkTranscriptWriter({
        controller: inkController,
        status: inkController.getStatus(),
        projectName: projectInfo?.name,
        projectPath: projectInfo?.rootPath,
      })
    : null;

  // Session name tracking for prompt display
  let currentSession: string | null = null;

  // Conversation label for context reminder
  let currentLabel: string | null = null;

  // Dynamic prompt mode tracking
  type PromptMode = 'normal' | 'shell' | 'help';
  let currentPromptMode: PromptMode = 'normal';

  // Get the base prompt text without colors
  const getBasePromptText = (mode: PromptMode): string => {
    switch (mode) {
      case 'shell':
        return 'Shell';
      case 'help':
        return 'Help';
      default:
        return 'You';
    }
  };

  // Get the colored prompt
  const getPromptText = (mode: PromptMode): string => {
    const baseText = getBasePromptText(mode);
    let colorFn = chalk.bold.cyan;

    // Use different colors for different modes
    if (mode === 'shell') {
      colorFn = chalk.bold.yellow;
    } else if (mode === 'help') {
      colorFn = chalk.bold.green;
    }

    // Show label as a prefix if set (only in normal mode)
    // Truncate long labels to keep prompt compact
    let displayLabel = currentLabel;
    if (displayLabel && displayLabel.length > 15) {
      displayLabel = displayLabel.slice(0, 14) + '…';
    }
    const labelPrefix = displayLabel && mode === 'normal'
      ? chalk.dim(`[${displayLabel}] `)
      : '';

    return `\n${labelPrefix}${colorFn(`${baseText}: `)}`;
  };

  // Update the readline prompt
  const updatePrompt = (mode: PromptMode) => {
    currentPromptMode = mode;
    rl?.setPrompt(getPromptText(mode));
  };

  // Reset prompt to normal mode
  const resetPrompt = () => {
    updatePrompt('normal');
  };

  // Create OpenFilesManager instance for tracking working set
  const openFilesManager = new OpenFilesManager();

  // Command context for slash commands (will be updated with agent after creation)
  const commandContext: CommandContext = {
    projectInfo,
    setSessionName: (name: string | null) => {
      currentSession = name;
      setCurrentSessionName(name);
      inkController?.setStatus({ sessionName: name });
      if (commandContext.sessionState) {
        commandContext.sessionState.currentName = name;
      }
    },
    setLabel: (label: string | null) => {
      currentLabel = label;
      updatePrompt(currentPromptMode);
      if (commandContext.sessionState) {
        commandContext.sessionState.label = label;
      }
    },
    selectSession: inkController
      ? (sessions, prompt) => inkController.requestSessionSelection(sessions, prompt)
      : undefined,
    openFilesManager, // Add OpenFilesManager to command context
  };

  // Build system prompt with config additions
  let systemPrompt = generateSystemPrompt(projectInfo, useTools);
  if (resolvedConfig.projectContext) {
    systemPrompt += `\n\n## Project-Specific Guidelines\n${resolvedConfig.projectContext}`;
  }
  if (resolvedConfig.systemPromptAdditions) {
    systemPrompt += `\n\n${resolvedConfig.systemPromptAdditions}`;
  }

  // Inject memory context (profile + memories)
  const memoryContext = await generateMemoryContext(process.cwd());
  if (memoryContext) {
    systemPrompt += `\n\n${memoryContext}`;
  }

  // Add project context file content (CODI.md) if loaded earlier
  if (contextFileContent && contextFilePath) {
    const fileName = contextFilePath.split('/').pop() || 'CODI.md';
    systemPrompt += `\n\n## Project Context (from ${fileName})\n\n${contextFileContent}`;
  }

  // Get custom dangerous patterns from config
  const customDangerousPatterns = getCustomDangerousPatterns(resolvedConfig);

  // Create security validator if configured
  let securityValidator: SecurityValidator | null = null;
  if (resolvedConfig.securityModel?.enabled) {
    securityValidator = createSecurityValidator(resolvedConfig.securityModel);
    logger.verbose(`Security model enabled: ${resolvedConfig.securityModel.model}`);
  }

  let rl: Interface | null = null;
  let workerStatusUI: WorkerStatusUI | null = null;
  let rlClosed = false;
  let promptUser: (preserveCursor?: boolean) => void = () => {};
  let exitApp: () => void = () => {};
  let inkUiPromise: Promise<void> | null = null;
  let inkSubmitHandler: ((input: string) => Promise<void>) | null = null;
  const pendingInkInputs: string[] = [];
  const interruptHandler = getInterruptHandler();
  const handleInkSubmit = async (input: string) => {
    if (inkSubmitHandler) {
      await inkSubmitHandler(input);
    } else {
      pendingInkInputs.push(input);
    }
  };

  const shutdown = () => {
    workerStatusUI?.clear();
    transcriptWriter?.dispose();
    // Disable bracketed paste mode before exit
    disableBracketedPaste();
    // Shutdown RAG indexer if running
    if (ragIndexer) {
      ragIndexer.shutdown();
    }
    // Cleanup MCP connections
    if (mcpManager) {
      mcpManager.disconnectAll().catch(() => {});
    }
    // Cleanup orchestrator (stop IPC server, cleanup worktrees)
    const orch = getOrchestratorInstance();
    if (orch) {
      orch.stop().catch(() => {});
    }
    // Close symbol index database
    const symbolIndex = getSymbolIndexService();
    if (symbolIndex) {
      symbolIndex.close();
    }
    // Shutdown all rate limiters
    shutdownAllRateLimiters();
    // Shutdown debug bridge (writes session_end event)
    if (isDebugBridgeEnabled()) {
      getDebugBridge().shutdown();
    }
  };
  const handleExit = () => {
    auditLogger.sessionEnd();
    shutdown();
    console.log(chalk.dim('\nGoodbye!'));
  };

  // Skip readline creation for non-interactive mode
  const isNonInteractive = Boolean(options.prompt);

  if (!useInkUi && !isNonInteractive) {
    // Enable bracketed paste mode for better paste detection
    enableBracketedPaste();

    // Create paste interceptor to capture paste markers before readline strips them
    const pasteInterceptor = createPasteInterceptor();
    process.stdin.pipe(pasteInterceptor);

    // Create readline interface with history and tab completion
    const history = loadHistory();
    const completer = createCompleter();
    rl = createInterface({
      input: pasteInterceptor, // Use interceptor instead of raw stdin
      output: process.stdout,
      history,
      historySize: MAX_HISTORY_SIZE,
      terminal: true,
      prompt: chalk.bold.cyan('\nYou: '),
      completer,
    });

    workerStatusUI = process.stdout.isTTY ? new WorkerStatusUI(rl) : null;
    promptUser = (preserveCursor?: boolean) => {
      rl?.prompt(preserveCursor);
      workerStatusUI?.setPromptActive(true);
      spinner.setPromptActive(true); // Disable spinner while user is typing
    };
    exitApp = () => {
      rl?.close();
    };

    // Initialize interrupt handler for ESC key cancellation
    interruptHandler.initialize(rl);
    interruptHandler.setCallback(() => {
      console.log(chalk.yellow('\n\n🚫 Interrupted!'));
      console.log(chalk.dim('Press Ctrl+C to exit or continue typing...\n'));
      spinner.stop();
      isStreaming = false;
      resetPrompt();
      promptUser();
    });

    // Track if readline is closed (for piped input)
    rl.on('close', () => {
      rlClosed = true;
      destroyInterruptHandler();
      handleExit();
      process.exit(0);
    });

    // Handle readline errors
    rl.on('error', (err) => {
      logger.error(`Readline error: ${err.message}`, err);
    });
  } else if (useInkUi) {
    exitApp = () => {
      inkController?.requestExit();
    };
  }

  // Initialize logger with level from CLI options
  const logLevel = parseLogLevel({
    verbose: options.verbose,
    debug: options.debug,
    trace: options.trace,
  });
  logger.setLevel(logLevel);

  // Disable spinner when verbose/debug/trace mode is enabled
  // Spinners conflict with verbose output and can interfere with readline
  if (logLevel > LogLevel.NORMAL) {
    spinner.setEnabled(false);
  }
  if (useInkUi) {
    spinner.setEnabled(false);
  }

  if (useInkUi && inkController) {
    const history = loadHistory();
    inkUiPromise = runInkUi({
      controller: inkController,
      onSubmit: handleInkSubmit,
      onExit: () => {
        handleExit();
      },
      history,
    });
  }

  // Track if we've received streaming output (to manage spinner)
  let isStreaming = false;
  let isReasoningStreaming = false;
  let currentAssistantMessageId: string | null = null;

  // Track tool start times for duration logging
  const toolStartTimes = new Map<string, number>();

  // =========================================================================
  // ORCHESTRATOR - Initialize for multi-agent orchestration
  // =========================================================================
  const orchestrator = new Orchestrator({
    repoRoot: process.cwd(),
    readline: rl ?? undefined,
    // Pass current provider/model so spawned agents inherit them
    // Provider names must be lowercase for createProvider()
    defaultProvider: provider.getName().toLowerCase(),
    defaultModel: provider.getModel(),

    // Provide background context for spawned agents
    contextProvider: async (_childId, _task) => {
      const parts: string[] = [];

      // Add project info
      if (projectInfo) {
        parts.push(`## Project: ${projectInfo.name}`);
        parts.push(`- Language: ${projectInfo.language}`);
        if (projectInfo.framework) {
          parts.push(`- Framework: ${projectInfo.framework}`);
        }
        parts.push('');
      }

      // Add project context file (CODI.md)
      if (contextFileContent) {
        parts.push('## Project Context');
        parts.push(contextFileContent.slice(0, 4000)); // Limit size
        parts.push('');
      }

      // Add memory context (profile + memories)
      const memoryCtx = await generateMemoryContext(process.cwd());
      if (memoryCtx) {
        parts.push('## User Context');
        parts.push(memoryCtx.slice(0, 2000)); // Limit size
        parts.push('');
      }

      return parts.length > 0 ? parts.join('\n') : undefined;
    },

    onPermissionRequest: useInkUi
      ? async (workerId, confirmation) => {
          if (!inkController) {
            return 'deny';
          }
          return inkController.requestConfirmation('worker', confirmation, workerId);
        }
      : async (workerId, confirmation) => {
          workerStatusUI?.setPromptActive(false, { preservePrompt: false });
          workerStatusUI?.pause();
          try {
            // Display worker context
            console.log(chalk.yellow(`\n[Worker: ${workerId}] Permission request:`));
            console.log(chalk.dim(`  Tool: ${confirmation.toolName}`));
            if (confirmation.input.command) {
              console.log(chalk.dim(`  Command: ${confirmation.input.command}`));
            } else if (confirmation.input.file_path) {
              console.log(chalk.dim(`  File: ${confirmation.input.file_path}`));
            }
            // Use existing prompt confirmation
            return promptConfirmationWithSuggestions(rl!, confirmation);
          } finally {
            if (!rlClosed) {
              promptUser(true);
            }
            workerStatusUI?.resume();
          }
        },
  });

  // Start orchestrator and make it available to commands
  try {
    await orchestrator.start();
    setOrchestrator(orchestrator);
    // Register orchestration tools for AI-driven multi-agent workflows
    const { workerResultTool, readerResultTool } = registerOrchestrationTools();

    // Wire up orchestrator events to store worker/reader results
    orchestrator.on('workerCompleted', (_workerId, result) => {
      workerResultTool.storeResult(result);
    });
    orchestrator.on('readerCompleted', (_readerId, result) => {
      readerResultTool.storeResult(result);
    });

    if (useInkUi && inkController) {
      orchestrator.on('workerStarted', (workerId) => {
        const state = orchestrator.getWorker(workerId);
        if (state) {
          inkController.updateWorker(state);
          inkController.addMessage('worker', 'Started.', workerId);
        }
      });
      orchestrator.on('workerStatus', (_workerId, state) => {
        inkController.updateWorker(state);
      });
      orchestrator.on('workerCompleted', (workerId, result) => {
        const state = orchestrator.getWorker(workerId);
        if (state) {
          inkController.updateWorker(state);
        }
        inkController.updateWorkerResult(result);
        const response = result.response?.trimEnd();
        if (response) {
          inkController.addMessage('worker', `Completed.\n\n${response}`, workerId);
        } else if (result.error) {
          inkController.addMessage('worker', `Failed: ${result.error}`, workerId);
        } else {
          inkController.addMessage('worker', 'Completed.', workerId);
        }
      });
      orchestrator.on('workerFailed', (workerId) => {
        const state = orchestrator.getWorker(workerId);
        if (state) {
          inkController.updateWorker(state);
          const message = state.error ? `Failed: ${state.error}` : 'Failed.';
          inkController.addMessage('worker', message, workerId);
        } else {
          inkController.addMessage('worker', 'Failed.', workerId);
        }
      });
      orchestrator.on('workerLog', (workerId, log) => {
        inkController.addWorkerLog(workerId, log);
      });
      orchestrator.on('readerStarted', (readerId) => {
        const state = orchestrator.getReader(readerId);
        if (state) {
          inkController.updateReader(state);
        }
      });
      orchestrator.on('readerStatus', (_readerId, state) => {
        inkController.updateReader(state);
      });
      orchestrator.on('readerCompleted', (readerId, result) => {
        const state = orchestrator.getReader(readerId);
        if (state) {
          inkController.updateReader(state);
        }
        inkController.updateReaderResult(result);
      });
      orchestrator.on('readerFailed', (readerId) => {
        const state = orchestrator.getReader(readerId);
        if (state) {
          inkController.updateReader(state);
        }
      });
      orchestrator.on('readerLog', (readerId, log) => {
        inkController.addReaderLog(readerId, log);
      });
    } else if (workerStatusUI) {
      orchestrator.on('workerStarted', (workerId) => {
        const state = orchestrator.getWorker(workerId);
        if (state) {
          workerStatusUI.updateWorkerState(state);
        }
      });
      orchestrator.on('workerStatus', (_workerId, state) => {
        workerStatusUI.updateWorkerState(state);
      });
      orchestrator.on('workerCompleted', (workerId, result) => {
        const state = orchestrator.getWorker(workerId);
        if (state) {
          workerStatusUI.updateWorkerState(state);
        }

        const response = result.response || '';
        if (response.trim()) {
          workerStatusUI?.setPromptActive(false, { preservePrompt: false });
          workerStatusUI?.pause();
          try {
            const branch = result.branch || state?.config.branch || workerId;
            console.log(chalk.green(`\n[Worker: ${branch}] Completed`));
            console.log(response.trimEnd());
          } finally {
            if (!rlClosed) {
              promptUser(true);
            }
            workerStatusUI?.resume();
          }
        }
      });
      orchestrator.on('workerFailed', (workerId) => {
        const state = orchestrator.getWorker(workerId);
        if (state) {
          workerStatusUI.updateWorkerState(state);
        }
      });
      orchestrator.on('workerLog', (workerId, log) => {
        workerStatusUI.updateWorkerLog(workerId, log);
      });
      orchestrator.on('readerStarted', (readerId) => {
        const state = orchestrator.getReader(readerId);
        if (state) {
          workerStatusUI.updateReaderState(state);
        }
      });
      orchestrator.on('readerStatus', (_readerId, state) => {
        workerStatusUI.updateReaderState(state);
      });
      orchestrator.on('readerCompleted', (readerId, result) => {
        const state = orchestrator.getReader(readerId);
        if (state) {
          workerStatusUI.updateReaderState(state);
        }
        workerStatusUI.updateReaderResult(result);
      });
      orchestrator.on('readerFailed', (readerId) => {
        const state = orchestrator.getReader(readerId);
        if (state) {
          workerStatusUI.updateReaderState(state);
        }
      });
      orchestrator.on('readerLog', (readerId, log) => {
        workerStatusUI.updateReaderLog(readerId, log);
      });
    }
    console.log(chalk.dim('Orchestrator: ready'));
  } catch (err) {
    // Non-fatal - orchestrator commands will show appropriate errors
    console.log(chalk.dim(`Orchestrator: disabled (${err instanceof Error ? err.message : err})`));
  }

  // Create agent with enhanced system prompt
  const agent = new Agent({
    provider,
    secondaryProvider,
    modelMap,
    auditLogger: auditLogger.isEnabled() ? auditLogger : null,
    toolRegistry: globalRegistry,
    systemPrompt,
    contextOptimization: resolvedConfig.contextOptimization,
    useTools,
    extractToolsFromText: resolvedConfig.extractToolsFromText,
    autoApprove: resolvedConfig.autoApprove.length > 0 ? resolvedConfig.autoApprove : options.yes,
    approvedPatterns: resolvedConfig.approvedPatterns,
    approvedCategories: resolvedConfig.approvedCategories,
    approvedPathPatterns: resolvedConfig.approvedPathPatterns,
    approvedPathCategories: resolvedConfig.approvedPathCategories,
    customDangerousPatterns,
    securityValidator,
    logLevel,
    enableCompression: options.compress ?? resolvedConfig.enableCompression,
    maxContextTokens: resolvedConfig.maxContextTokens,
    onProviderChange: (newProvider) => {
      // Update ink UI status when provider changes (e.g., during workflow model switch)
      if (useInkUi && inkController) {
        inkController.setStatus({
          provider: newProvider.getName(),
          model: newProvider.getModel()
        });
      }
    },
    onText: (text) => {
      // Stop spinner when we start receiving text
      if (!isStreaming) {
        isStreaming = true;
        spinner.stop();
        if (useInkUi && inkController) {
          inkController.setStatus({ activity: 'responding', activityDetail: null });
        } else if (workerStatusUI) {
          workerStatusUI.setAgentActivity('responding', null);
        }
      }
      if (useInkUi && inkController) {
        if (!currentAssistantMessageId) {
          currentAssistantMessageId = inkController.startAssistantMessage();
        }
        inkController.appendToMessage(currentAssistantMessageId, text);
      }
      if (!useInkUi) {
        process.stdout.write(text);
      }
    },
    onReasoning: (reasoning) => {
      spinner.stop();
      if (useInkUi && inkController) {
        inkController.setStatus({ activity: 'thinking', activityDetail: null });
      } else if (workerStatusUI) {
        workerStatusUI.setAgentActivity('thinking', null);
      }
      if (!useInkUi) {
        console.log(chalk.dim.italic('\n💭 Thinking...'));
        console.log(chalk.dim(reasoning));
        console.log(chalk.dim.italic('---\n'));
      }
    },
    onReasoningChunk: (chunk) => {
      if (!isReasoningStreaming) {
        isReasoningStreaming = true;
        spinner.stop();
        if (useInkUi && inkController) {
          inkController.setStatus({ activity: 'thinking', activityDetail: null });
        } else if (workerStatusUI) {
          workerStatusUI.setAgentActivity('thinking', null);
        }
        if (!useInkUi) {
          console.log(chalk.dim.italic('\n💭 Thinking...'));
        }
      }
      if (!useInkUi) {
        process.stdout.write(chalk.dim(chunk));
      }
    },
    onToolCall: (name, input) => {
      // Stop any spinner and record start time
      spinner.stop();
      isStreaming = false;
      const toolId = `tool_${Date.now()}`;
      toolStartTimes.set(name, Date.now());

      // Audit log
      auditLogger.toolCall(name, input as Record<string, unknown>, toolId);

      if (!useInkUi) {
        // Log tool input based on verbosity level
        if (logLevel >= LogLevel.VERBOSE) {
          logger.toolInput(name, input as Record<string, unknown>);
        } else {
          // Normal mode: show simple tool call info
          console.log(chalk.yellow(`\n\n📎 ${name}`));
          const preview = JSON.stringify(input);
          console.log(chalk.dim(preview.length > 100 ? preview.slice(0, 100) + '...' : preview));
        }
      }

      if (useInkUi && inkController) {
        inkController.addToolCall(name, input as Record<string, unknown>);
        inkController.setStatus({ activity: 'tool', activityDetail: name });
      } else if (workerStatusUI) {
        workerStatusUI.setAgentActivity('tool', name);
      }

      // Start spinner for tool execution
      spinner.toolStart(name);
    },
    onToolResult: (name, result, isError) => {
      // Calculate duration
      const startTime = toolStartTimes.get(name) || Date.now();
      const durationMs = Date.now() - startTime;
      const duration = durationMs / 1000;
      toolStartTimes.delete(name);

      // Audit log
      auditLogger.toolResult(name, `tool_${startTime}`, result, isError, durationMs);

      // Stop spinner
      spinner.stop();

      if (!useInkUi) {
        // Log tool result based on verbosity level
        if (logLevel >= LogLevel.VERBOSE) {
          logger.toolOutput(name, result, duration, isError);
        } else {
          // Normal mode: show simple result
          if (isError) {
            console.log(chalk.red(`\n❌ Error: ${result.slice(0, 200)}`));
          } else {
            const lines = result.split('\n').length;
            console.log(chalk.green(`\n✓ ${name} (${lines} lines)`));
          }
        }
        console.log();
      } else if (inkController) {
        inkController.addToolResult(name, result, isError, durationMs);
        inkController.setStatus({ activity: 'thinking', activityDetail: null });
      }
      if (!useInkUi && workerStatusUI) {
        workerStatusUI.setAgentActivity('thinking', null);
      }
    },
    onConfirm: async (confirmation) => {
      // Stop spinner during confirmation
      spinner.stop();
      const isMockProvider = provider.getName().toLowerCase() === 'mock';
      const nonInteractive = !process.stdin.isTTY;

      if (
        isMockProvider &&
        nonInteractive &&
        process.env.CI === '1' &&
        confirmation.toolName === 'bash'
      ) {
        return 'approve';
      }

      if (useInkUi && inkController) {
        inkController.setStatus({ activity: 'confirm', activityDetail: confirmation.toolName });
        const result = await inkController.requestConfirmation('agent', confirmation);
        inkController.setStatus({ activity: 'thinking', activityDetail: null });
        return result;
      }

      workerStatusUI?.setAgentActivity('confirm', confirmation.toolName);
      const confirmationDetail = formatConfirmationDetail(confirmation);
      workerStatusUI?.setConfirmation({
        source: 'agent',
        toolName: confirmation.toolName,
        detail: confirmationDetail ?? undefined,
      });

      try {
        console.log('\n' + formatConfirmation(confirmation));

        // File tools that support path-based approval
        const FILE_TOOLS = new Set(['write_file', 'edit_file', 'insert_line', 'patch_file']);

        // Use extended prompt for bash commands or file tools with suggestions
        const hasApprovalSuggestions = confirmation.approvalSuggestions &&
          (confirmation.toolName === 'bash' || FILE_TOOLS.has(confirmation.toolName));

        if (hasApprovalSuggestions) {
          const result = await promptConfirmationWithSuggestions(rl!, confirmation);

          // Show feedback when pattern/category is saved
          if (typeof result === 'object') {
            if (result.type === 'approve_pattern') {
              if (FILE_TOOLS.has(confirmation.toolName)) {
                console.log(chalk.green(`\nSaved path pattern: ${result.pattern}`));
              } else {
                console.log(chalk.green(`\nSaved pattern: ${result.pattern}`));
              }
            } else if (result.type === 'approve_category') {
              const cat = confirmation.approvalSuggestions!.matchedCategories.find(
                (c) => c.id === result.categoryId
              );
              if (FILE_TOOLS.has(confirmation.toolName)) {
                console.log(chalk.green(`\nSaved path category: ${cat?.name || result.categoryId}`));
              } else {
                console.log(chalk.green(`\nSaved category: ${cat?.name || result.categoryId}`));
              }
            }
          }

          return result;
        }

        // Standard confirmation for other tools
        const promptText = confirmation.isDangerous
          ? chalk.red.bold('Approve? [y/N/abort] ')
          : chalk.yellow('Approve? [y/N/abort] ');

        const result = await promptConfirmation(rl!, promptText);
        return result;
      } finally {
        workerStatusUI?.setConfirmation(null);
        workerStatusUI?.setAgentActivity('thinking', null);
      }
    },
    onCompaction: (status) => {
      if (status === 'start') {
        spinner.toolStart('compacting context');
        if (useInkUi && inkController) {
          inkController.setStatus({ activity: 'tool', activityDetail: 'compacting' });
        } else if (workerStatusUI) {
          workerStatusUI.setAgentActivity('tool', 'compacting');
        }
      } else {
        spinner.stop();
        if (useInkUi && inkController) {
          inkController.setStatus({ activity: 'thinking', activityDetail: null });
        } else if (workerStatusUI) {
          workerStatusUI.setAgentActivity('thinking', null);
        }
      }
    },
  });

  // Add agent and session state to command context
  commandContext.agent = agent;
  commandContext.sessionState = {
    currentName: null,
    provider: provider.getName(),
    model: provider.getModel(),
    label: currentLabel,
  };

  // Set indexed files from RAG for code relevance scoring
  if (ragRetriever) {
    try {
      const indexedFiles = await ragRetriever.getIndexedFiles();
      agent.setIndexedFiles(indexedFiles);
      logger.debug(`RAG: ${indexedFiles.length} indexed files available for relevance scoring`);
    } catch (err) {
      logger.debug(`RAG: Could not get indexed files: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Set embedding provider for semantic deduplication during compaction
  if (ragEmbeddingProvider) {
    agent.setEmbeddingProvider(ragEmbeddingProvider);
    logger.debug(`RAG: Embedding provider set for semantic message deduplication`);
  }

  // Set up context status tool with agent as provider
  const contextStatusTool = registerContextStatusTool();
  contextStatusTool.setContextProvider(agent);
  logger.debug(`Context status tool registered`);

  // Deprecated: setSessionAgent is now a no-op
  // Agent reference is passed via commandContext

  // Load session from command line, resume flag, or config default
  const resumeArg = typeof options.resume === 'string' ? options.resume.trim() : '';
  let sessionToLoad: string | null = null;

  if (options.session) {
    sessionToLoad = options.session;
  } else if (options.resume) {
    sessionToLoad = await resolveResumeSessionName(
      options.resume,
      process.cwd(),
      rl,
      !options.prompt,
      inkController
    );
    if (!sessionToLoad && !resumeArg && !options.prompt && process.stdout.isTTY) {
      console.log(chalk.dim('\nNo saved sessions found for this working directory.'));
    }
  } else if (resolvedConfig.defaultSession) {
    sessionToLoad = resolvedConfig.defaultSession;
  }

  if (sessionToLoad) {
    await renderCommandOutput(inkController, () => {
      const session = loadSession(sessionToLoad);
      if (session) {
        agent.loadSession(session.messages, session.conversationSummary);
        currentSession = session.name;
        setCurrentSessionName(session.name);
        inkController?.setStatus({ sessionName: session.name });
        if (commandContext.sessionState) {
          commandContext.sessionState.currentName = session.name;
        }

        // Restore label if it exists in the session
        if (session.label) {
          currentLabel = session.label;
          if (commandContext.sessionState) {
            commandContext.sessionState.label = session.label;
          }
        }

        // Restore working set if it exists in the session
        if (session.openFilesState && commandContext.openFilesManager) {
          const restoredManager = OpenFilesManager.fromJSON(session.openFilesState);
          // Update the existing manager with restored state by clearing and repopulating
          commandContext.openFilesManager.clear();
          const restoredState = restoredManager.toJSON();
          if (restoredState.files) {
            for (const [filePath, meta] of Object.entries(restoredState.files)) {
              commandContext.openFilesManager.open(filePath, { pinned: meta.pinned });
            }
          }
        }

        console.log(chalk.green(`Loaded session: ${session.name} (${session.messages.length} messages)`));
        if (session.conversationSummary) {
          console.log(chalk.dim('Session has conversation summary from previous compaction.'));
        }
      } else {
        console.log(chalk.yellow(`Session not found: ${sessionToLoad}`));
      }
    });
  }

  // =========================================================================
  // DEBUG BRIDGE COMMAND HANDLER (Phase 2)
  // =========================================================================
  if (isDebugBridgeEnabled()) {
    getDebugBridge().startCommandWatcher(async (cmd) => {
      switch (cmd.type) {
        case 'pause':
          agent.setDebugPaused(true);
          break;
        case 'resume':
          agent.setDebugPaused(false);
          break;
        case 'step':
          agent.setDebugStep();
          break;
        case 'inspect': {
          const what = cmd.data.what as 'messages' | 'context' | 'tools' | 'all' | undefined;
          const snapshot = agent.getStateSnapshot(what ?? 'all');
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'inspect',
            data: snapshot,
          });
          break;
        }
        case 'inject_message': {
          const role = cmd.data.role as 'user' | 'assistant';
          const content = cmd.data.content as string;
          if (role && content) {
            agent.injectMessage(role, content);
            getDebugBridge().emit('command_response', {
              commandId: cmd.id,
              type: 'inject_message',
              success: true,
            });
          }
          break;
        }
        // Phase 4: Breakpoint commands
        case 'breakpoint_add': {
          const bpType = cmd.data.type as 'tool' | 'iteration' | 'pattern' | 'error';
          const condition = cmd.data.condition as string | number | undefined;
          const bpId = agent.addBreakpoint(bpType, condition);
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'breakpoint_add',
            data: { id: bpId, bpType, condition },
          });
          break;
        }
        case 'breakpoint_remove': {
          const bpId = cmd.data.id as string;
          const removed = agent.removeBreakpoint(bpId);
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'breakpoint_remove',
            data: { id: bpId, removed },
          });
          break;
        }
        case 'breakpoint_clear': {
          agent.clearBreakpoints();
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'breakpoint_clear',
            data: { cleared: true },
          });
          break;
        }
        case 'breakpoint_list': {
          const breakpoints = agent.listBreakpoints();
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'breakpoint_list',
            data: { breakpoints },
          });
          break;
        }
        // Phase 4: Checkpoint commands
        case 'checkpoint_create': {
          const label = cmd.data.label as string | undefined;
          const checkpoint = agent.createCheckpoint(label);
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'checkpoint_create',
            data: checkpoint,
          });
          break;
        }
        case 'checkpoint_list': {
          const checkpoints = agent.listCheckpoints();
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'checkpoint_list',
            data: { checkpoints },
          });
          break;
        }
        // Phase 5: Time travel commands
        case 'rewind': {
          const checkpointId = cmd.data.checkpointId as string;
          const success = agent.rewind(checkpointId);
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'rewind',
            data: { checkpointId, success },
          });
          break;
        }
        case 'branch_create': {
          const cpId = cmd.data.checkpointId as string;
          const branchName = cmd.data.name as string;
          const success = agent.createBranch(cpId, branchName);
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'branch_create',
            data: { checkpointId: cpId, name: branchName, success },
          });
          break;
        }
        case 'branch_switch': {
          const branchName = cmd.data.name as string;
          const success = agent.switchBranch(branchName);
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'branch_switch',
            data: { name: branchName, success },
          });
          break;
        }
        case 'branch_list': {
          const branches = agent.listBranches();
          const currentBranch = agent.getCurrentBranch();
          getDebugBridge().emit('command_response', {
            commandId: cmd.id,
            type: 'branch_list',
            data: { branches, currentBranch },
          });
          break;
        }
        default:
          getDebugBridge().emit('error', {
            message: `Unknown command type: ${cmd.type}`,
            context: 'command_handler',
          });
      }
    });
  }

  // =========================================================================
  // NON-INTERACTIVE MODE - Run single prompt and exit without readline
  // =========================================================================
  if (options.prompt) {
    await runNonInteractive(agent, options.prompt, {
      outputFormat: options.outputFormat || 'text',
      quiet: options.quiet || false,
      auditLogger,
      ragIndexer,
      mcpManager,
      autoSave: () => autoSaveSession(commandContext, agent),
    });
    return;
  }

  /**
   * Handle a single line of user input.
   */
  const handleInput = async (input: string) => {
    const trimmed = input.trim();
    workerStatusUI?.setPromptActive(false, { preservePrompt: true });

    if (!trimmed) {
      promptUser();
      return;
    }

    inkController?.addMessage('user', trimmed);

    // Save to history file
    saveToHistory(trimmed);

    // Audit log user input
    auditLogger.userInput(trimmed);

    // Debug bridge user input
    if (isDebugBridgeEnabled()) {
      const isCommand = trimmed.startsWith('/') || trimmed.startsWith('!');
      getDebugBridge().userInput(trimmed, isCommand);
    }

    // Set appropriate prompt for prefix commands
    if (trimmed.startsWith('!')) {
      updatePrompt('shell');
    } else if (trimmed === '?' || trimmed.startsWith('?')) {
      updatePrompt('help');
    }

    // Handle ! prefix for direct shell commands
    if (trimmed.startsWith('!')) {
      const shellCommand = trimmed.slice(1).trim();
      if (!shellCommand) {
        console.log(chalk.cyan('\n⚡ Shell Command Shortcuts\n'));
        console.log(chalk.dim('Run shell commands directly without going through the AI:\n'));
        console.log(chalk.dim('  Examples:'));
        console.log(chalk.dim('    !ls                 - List files'));
        console.log(chalk.dim('    !git status         - Check git status'));
        console.log(chalk.dim('    !npm test           - Run tests'));
        console.log(chalk.dim('    !docker ps          - List containers'));
        console.log(chalk.dim('    !pwd                - Show current directory\n'));
        console.log(chalk.dim('  Tip: Use ! for quick commands, /ask the AI for help with commands.\n'));
        resetPrompt();
        promptUser();
        return;
      }

      // Parse and check all commands in the chain for permission
      const commands = parseCommandChain(shellCommand);
      if (commands.length > 1) {
        if (!rl) {
          console.log(chalk.yellow('Chained commands require confirmation in classic mode.'));
          resetPrompt();
          promptUser();
          return;
        }
        const allowed = await requestPermissionForChainedCommands(rl, commands);
        if (!allowed) {
          console.log(chalk.yellow('Command execution cancelled.'));
          resetPrompt();
          promptUser();
          return;
        }
      }

      // Execute command with inherited stdio for real-time output
      const child = spawn(shellCommand, [], {
        shell: true,
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      child.on('close', (code) => {
        if (code !== 0) {
          console.log(chalk.dim(`Exit code: ${code}`));
        }
        resetPrompt();
        promptUser();
      });

      child.on('error', (err) => {
        console.log(chalk.red(`Error: ${err.message}`));
        resetPrompt();
        promptUser();
      });

      return;
    }

    // Handle ? prefix for help
    if (trimmed === '?' || trimmed.startsWith('?')) {
      const topic = trimmed.slice(1).trim();
      if (topic) {
        // Search for commands matching the topic
        const allCommands = getAllCommands();
        const topicLower = topic.toLowerCase();
        const matches = allCommands.filter(
          (cmd) =>
            cmd.name.includes(topicLower) ||
            cmd.description.toLowerCase().includes(topicLower) ||
            cmd.aliases?.some((a: string) => a.includes(topicLower))
        );

        if (matches.length > 0) {
          console.log(chalk.bold(`\nCommands matching "${topic}":\n`));
          for (const cmd of matches) {
            const aliases = cmd.aliases?.length ? chalk.dim(` (${cmd.aliases.join(', ')})`) : '';
            console.log(`  ${chalk.cyan('/' + cmd.name)}${aliases}`);
            console.log(chalk.dim(`    ${cmd.description}`));
            if (cmd.usage) {
              console.log(chalk.dim(`    Usage: ${cmd.usage}`));
            }
          }
        } else {
          console.log(chalk.dim(`No commands found matching "${topic}"`));
        }
      } else {
        showHelp(projectInfo);
      }
      resetPrompt();
      promptUser();
      return;
    }

    // Handle built-in commands
    if (trimmed === '/exit' || trimmed === '/quit') {
      exitApp();
      return;
    }

    if (trimmed === '/clear' || trimmed.startsWith('/clear ')) {
      const subcommand = trimmed.slice(6).trim().toLowerCase();

      if (subcommand === '' || subcommand === 'all') {
        // /clear or /clear all - clear everything
        agent.clearHistory();
        console.log(chalk.dim('Conversation cleared (history, summary, and working set).'));
      } else if (subcommand === 'context' || subcommand === 'history') {
        // /clear context or /clear history - clear messages and summary only
        agent.clearContext();
        console.log(chalk.dim('Context cleared (history and summary). Working set preserved.'));
      } else if (subcommand === 'workingset' || subcommand === 'files') {
        // /clear workingset or /clear files - clear only the working set
        agent.clearWorkingSet();
        console.log(chalk.dim('Working set cleared. Conversation history preserved.'));
      } else {
        console.log(chalk.yellow(`Unknown /clear subcommand: ${subcommand}`));
        console.log(chalk.dim('Usage: /clear [all|context|history|workingset|files]'));
        console.log(chalk.dim('  all, (default) - Clear everything'));
        console.log(chalk.dim('  context, history - Clear messages and summary'));
        console.log(chalk.dim('  workingset, files - Clear tracked files'));
      }
      promptUser();
      return;
    }

    if (trimmed === '/help') {
      showHelp(projectInfo);
      promptUser();
      return;
    }

    if (trimmed === '/context') {
      if (projectInfo) {
        console.log(chalk.bold('\nProject Context:'));
        console.log(formatProjectContext(projectInfo));
      } else {
        console.log(chalk.dim('\nNo project detected in current directory.'));
      }
      promptUser();
      return;
    }

    if (trimmed === '/label' || trimmed.startsWith('/label ')) {
      const labelArg = trimmed.slice(6).trim();

      if (labelArg === '' || labelArg === 'show') {
        // Show current label
        if (currentLabel) {
          console.log(chalk.dim(`\nLabel: ${chalk.cyan(currentLabel)}`));
        } else {
          console.log(chalk.dim('\nNo label set. Use /label <text> to set one.'));
        }
      } else if (labelArg === 'clear' || labelArg === 'reset') {
        // Clear the label
        currentLabel = null;
        updatePrompt(currentPromptMode);
        console.log(chalk.dim('Label cleared.'));
      } else if (labelArg === 'update' || labelArg === 'refresh' || labelArg === 'auto') {
        // Regenerate label from conversation
        if (agent.getHistory().length < 2) {
          console.log(chalk.dim('\nNeed at least one exchange to generate a label.'));
        } else {
          console.log(chalk.dim('\nGenerating label...'));
          const newLabel = await agent.generateAutoLabel();
          if (newLabel) {
            currentLabel = newLabel;
            updatePrompt(currentPromptMode);
            if (commandContext.sessionState) {
              commandContext.sessionState.label = newLabel;
            }
            autoSaveSession(commandContext, agent);
            console.log(chalk.dim(`Label updated to: ${chalk.cyan(newLabel)}`));
          } else {
            console.log(chalk.dim('Could not generate a label.'));
          }
        }
      } else {
        // Set the label
        currentLabel = labelArg;
        updatePrompt(currentPromptMode);
        console.log(chalk.dim(`Label set to: ${chalk.cyan(currentLabel)}`));
      }
      promptUser();
      return;
    }

    if (trimmed === '/status') {
      const info = agent.getContextInfo();
      // Use effectiveLimit which always returns the correct limit to calculate against
      const usedPercent = (info.tokens / info.effectiveLimit) * 100; // Removed Math.min(100, ...) to show actual overage
      const budgetPercent = (info.maxTokens / info.effectiveLimit) * 100;

      console.log(chalk.bold('\n📊 Context Status'));
      console.log(chalk.dim('─'.repeat(50)));

      // Visual bar for context usage
      const barWidth = 40;
      const usedWidth = Math.round((usedPercent / 100) * barWidth);
      const budgetWidth = Math.round((budgetPercent / 100) * barWidth);
      const bar = chalk.green('█'.repeat(Math.min(usedWidth, budgetWidth))) +
                  chalk.yellow('█'.repeat(Math.max(0, usedWidth - budgetWidth))) +
                  chalk.dim('░'.repeat(Math.max(0, barWidth - usedWidth)));

      // Color based on usage level
      const percentColor = usedPercent >= 100 ? chalk.redBright : (usedPercent >= 75 ? chalk.yellow : chalk.green);
      console.log(`\n  ${bar} ${percentColor(usedPercent.toFixed(1) + '%')}`);
      console.log(chalk.dim(`  ${formatTokens(info.tokens)} / ${formatTokens(info.effectiveLimit)} tokens`));

      // Token breakdown
      console.log(chalk.bold('\n  Token Breakdown:'));
      console.log(chalk.cyan(`    Messages:     ${formatTokens(info.messageTokens).padStart(8)}`));
      console.log(chalk.blue(`    System:       ${formatTokens(info.systemPromptTokens).padStart(8)}`));
      console.log(chalk.magenta(`    Tools:        ${formatTokens(info.toolDefinitionTokens).padStart(8)}`));
      console.log(chalk.dim(`    ─────────────────────`));
      console.log(chalk.white(`    Total:        ${formatTokens(info.tokens).padStart(8)}`));

      // Budget info
      console.log(chalk.bold('\n  Context Budget:'));
      // Show effective context window and tier info
      if (info.effectiveLimit !== info.contextWindow) {
        console.log(chalk.dim(`    Window:         ${formatTokens(info.effectiveLimit).padStart(8)}  (${info.tierName} tier)`));
        console.log(chalk.dim(`    Original:       ${formatTokens(info.contextWindow).padStart(8)}  (provider limit)`));
      } else {
        console.log(chalk.dim(`    Window:         ${formatTokens(info.contextWindow).padStart(8)}  (${info.tierName} tier)`));
      }
      console.log(chalk.dim(`    Output rsv:     ${formatTokens(info.outputReserve).padStart(8)}`));
      console.log(chalk.dim(`    Safety:         ${formatTokens(info.safetyBuffer).padStart(8)}`));
      
      // Calculate truly available tokens (what's left after current usage)
      const trulyAvailable = Math.max(0, info.effectiveLimit - info.tokens);
      console.log(chalk.green(`    Available:      ${formatTokens(trulyAvailable).padStart(8)}`));
      
      // Show override info if effectiveLimit differs from contextWindow
      if (info.effectiveLimit !== info.contextWindow) {
        console.log(chalk.dim(`    Override:       Effective limit ${formatTokens(info.effectiveLimit)} tokens`));
      }

      // Message breakdown
      console.log(chalk.bold('\n  Messages:'));
      console.log(chalk.dim(`    User:         ${String(info.userMessages).padStart(8)}`));
      console.log(chalk.dim(`    Assistant:    ${String(info.assistantMessages).padStart(8)}`));
      console.log(chalk.dim(`    Tool results: ${String(info.toolResultMessages).padStart(8)}`));
      console.log(chalk.dim(`    Total:        ${String(info.messages).padStart(8)}`));

      // State
      console.log(chalk.bold('\n  State:'));
      console.log(chalk.dim(`    Summary:      ${info.hasSummary ? chalk.green('yes') : 'no'}`));
      console.log(chalk.dim(`    Compression:  ${info.compressionEnabled ? chalk.green('enabled') : 'disabled'}`));
      if (info.compression) {
        console.log(chalk.dim(`    Savings:      ${info.compression.savings} chars (${info.compression.savingsPercent.toFixed(1)}%)`));
        console.log(chalk.dim(`    Entities:     ${info.compression.entityCount}`));
      }
      console.log(chalk.dim(`    Working set:  ${info.workingSetFiles} files`));

      console.log('');
      promptUser();
      return;
    }

    // Handle slash commands
    if (isCommand(trimmed)) {
      const parsed = parseCommand(trimmed);
      if (parsed) {
        const command = getCommand(parsed.name);
        if (command) {
          try {
            // Show spinner for commands that may take a while
            const needsSpinner = ['compact', 'summarize'].includes(parsed.name);
            if (needsSpinner) {
              spinner.start(chalk.cyan('Compacting context...'));
            }

            let result: string | null = null;
            let capturedOutput: ReturnType<typeof startConsoleCapture> | null = null;
            let capturedWrites: ReturnType<typeof startWriteCapture> | null = null;
            try {
              if (useInkUi && inkController) {
                capturedOutput = startConsoleCapture();
                capturedWrites = startWriteCapture();
              }
              result = await command.execute(parsed.args, commandContext);
            } finally {
              if (capturedOutput) {
                capturedOutput.restore();
                emitCapturedOutput(inkController, capturedOutput);
              }
              if (capturedWrites) {
                capturedWrites.restore();
                emitCapturedWrites(inkController, capturedWrites);
              }
            }

            if (needsSpinner) {
              spinner.stop();
            }
            if (result) {
              // Try centralized output handler first for most command outputs
              // Handles: __SESSION_, __CONFIG_, __INIT_RESULT__, __UNDO_, __REDO_, __HISTORY_,
              // __USAGE_, __PLUGIN, __MODELS__, __SWITCH_, __MODELMAP_, __PIPELINE_ (list/info/error),
              // __IMPORT_, __MEMORY_, __MEMORIES_, __PROFILE_, COMPRESS_, COMPACT_, __APPROVAL, __SYMBOLS_
              if (!result.startsWith('__PIPELINE_EXECUTE__|')) {
                let wasHandled = false;
                await renderCommandOutput(inkController, () => {
                  wasHandled = dispatchOutput(result);
                });
                if (wasHandled) {
                  // Handle special post-display logic for switch command
                  if (result.startsWith('__SWITCH_SUCCESS__') && commandContext.sessionState) {
                    const switchParts = result.split('|');
                    commandContext.sessionState.provider = switchParts[1];
                    commandContext.sessionState.model = switchParts[2];
                  }
                  promptUser();
                  return;
                }
              }
              // Handle pipeline command outputs
              if (result.startsWith('__PIPELINE_')) {
                // Special case: actually execute the pipeline
                if (result.startsWith('__PIPELINE_EXECUTE__|')) {
                  await renderCommandOutput(inkController, async () => {
                    const parts = result.slice('__PIPELINE_EXECUTE__|'.length).split('|');
                    const pipelineName = parts[0];

                    // Parse optional flags from parts
                    let providerContext: string | undefined;
                    let iterativeMode = false;
                    let useTriage = false;
                    let triageOnly = false;
                    let concurrency = 4;
                    let inputStartIndex = 1;
  
                    // Parse all optional flags
                    while (inputStartIndex < parts.length) {
                      const part = parts[inputStartIndex];
                      if (part?.startsWith('provider:')) {
                        providerContext = part.slice('provider:'.length);
                        inputStartIndex++;
                      } else if (part?.startsWith('iterative:')) {
                        iterativeMode = part.slice('iterative:'.length) === 'true';
                        inputStartIndex++;
                      } else if (part?.startsWith('triage:')) {
                        useTriage = part.slice('triage:'.length) === 'true';
                        inputStartIndex++;
                      } else if (part?.startsWith('triageOnly:')) {
                        triageOnly = part.slice('triageOnly:'.length) === 'true';
                        inputStartIndex++;
                      } else if (part?.startsWith('concurrency:')) {
                        concurrency = parseInt(part.slice('concurrency:'.length), 10) || 4;
                        inputStartIndex++;
                      } else {
                        break; // No more flags, rest is input
                      }
                    }
  
                    const input = parts.slice(inputStartIndex).join('|');
                    const modelMap = agent.getModelMap();
  
                    if (!modelMap) {
                      console.log(chalk.red('\nPipeline error: No model map loaded'));
                      promptUser();
                      return;
                    }
  
                    const pipeline = modelMap.config.pipelines?.[pipelineName];
                    if (!pipeline) {
                      console.log(chalk.red(`\nPipeline error: Unknown pipeline "${pipelineName}"`));
                      promptUser();
                      return;
                    }
  
                    const effectiveProvider = providerContext || pipeline.provider || 'openai';
  
                    // Handle iterative mode
                    if (iterativeMode) {
                      const files = await resolveFileList(input);
  
                      if (files.length === 0) {
                        console.log(chalk.red(`\nNo files found matching: ${input}`));
                        promptUser();
                        return;
                      }
  
                      const modeLabel = triageOnly ? 'triage only' : useTriage ? 'with triage' : 'sequential';
                      console.log(chalk.bold.magenta(`\nExecuting pipeline: ${pipelineName} (${modeLabel})`));
                      console.log(chalk.dim(`Provider: ${effectiveProvider}`));
                      console.log(chalk.dim(`Files: ${files.length} total`));
                      if (useTriage || triageOnly) {
                        console.log(chalk.dim(`Concurrency: ${concurrency}`));
                        console.log(chalk.dim(`Triage: enabled`));
                      }
                      console.log();
  
                      try {
                        // Choose triage or sequential algorithm
                        let iterativeResult: import('./model-map/types.js').IterativeResult;
  
                        if (useTriage || triageOnly) {
                          // Triage mode: score and prioritize files before processing
                          iterativeResult = await modelMap.executor.executeIterativeV3(pipeline, files, {
                            providerContext: effectiveProvider,
                            concurrency,
                            enableTriage: true,
                            triage: {
                              role: 'fast',
                              deepThreshold: 6,
                              skipThreshold: 3,
                            },
                            callbacks: {
                              onTriageStart: (totalFiles: number) => {
                                console.log(chalk.yellow(`  🔍 Triaging ${totalFiles} files...`));
                              },
                              onTriageComplete: (triageResult: import('./model-map/types.js').TriageResult) => {
                                console.log(chalk.green(`  ✓ Triage complete`));
                                console.log(chalk.dim(`    Critical: ${triageResult.criticalPaths.length} files`));
                                console.log(chalk.dim(`    Normal: ${triageResult.normalPaths.length} files`));
                                console.log(chalk.dim(`    Quick scan: ${triageResult.skipPaths.length} files`));
                                if (triageResult.duration) {
                                  console.log(chalk.dim(`    Time: ${(triageResult.duration / 1000).toFixed(1)}s`));
                                }
                                // Show top critical files
                                if (triageResult.criticalPaths.length > 0) {
                                  console.log(chalk.yellow(`\n  Critical files:`));
                                  for (const file of triageResult.criticalPaths.slice(0, 5)) {
                                    const score = triageResult.scores.find(s => s.file === file);
                                    if (score) {
                                      console.log(chalk.dim(`    - ${file} [${score.risk}] ${score.reasoning}`));
                                    }
                                  }
                                  if (triageResult.criticalPaths.length > 5) {
                                    console.log(chalk.dim(`    ... and ${triageResult.criticalPaths.length - 5} more`));
                                  }
                                }
  
                                // If triage-only mode, stop here
                                if (triageOnly) {
                                  console.log(chalk.bold('\n## Full Triage Results\n'));
                                  console.log(chalk.bold(`Summary: ${triageResult.summary}\n`));
                                  for (const score of triageResult.scores) {
                                    const risk = score.risk === 'critical' ? chalk.red(score.risk) :
                                                score.risk === 'high' ? chalk.yellow(score.risk) :
                                                score.risk === 'medium' ? chalk.cyan(score.risk) :
                                                chalk.dim(score.risk);
                                    console.log(`${risk.padEnd(12)} ${score.file}`);
                                    console.log(chalk.dim(`  complexity: ${score.complexity}, importance: ${score.importance}`));
                                    console.log(chalk.dim(`  ${score.reasoning}`));
                                    console.log();
                                  }
                                }
                              },
                              onFileStart: (file: string, index: number, total: number) => {
                                if (!triageOnly) {
                                  console.log(chalk.dim(`    ▸ [${index + 1}/${total}] ${file}`));
                                }
                              },
                              onFileComplete: (_file: string, _result: string) => {
                                // Minimal output
                              },
                              onAggregationStart: () => {
                                if (!triageOnly) {
                                  console.log(chalk.yellow('\n  🔗 Synthesizing results...'));
                                }
                              },
                              onStepStart: (stepName: string, modelName: string) => {
                                if (!triageOnly && stepName === 'v3-synthesis') {
                                  console.log(chalk.dim(`    ▶ ${stepName} (${modelName})`));
                                }
                              },
                              onStepComplete: (stepName: string, _output: string) => {
                                if (!triageOnly && stepName === 'v3-synthesis') {
                                  console.log(chalk.dim(`    ✓ ${stepName}`));
                                }
                              },
                              onStepText: (_stepName: string, _text: string) => {
                                // Don't stream in iterative mode
                              },
                              onError: (stepName: string, error: Error) => {
                                console.log(chalk.red(`    ✗ ${stepName}: ${error.message}`));
                              },
                              onToolCall: (stepName: string, toolName: string, _input: unknown) => {
                                console.log(chalk.dim(`    🔧 ${stepName} calling ${toolName}`));
                              },
                              onToolResult: (stepName: string, toolName: string, result: string) => {
                                console.log(chalk.dim(`    ✓ ${stepName}/${toolName}: ${result.substring(0, 50)}...`));
                              },
                            },
                            aggregation: {
                              enabled: !triageOnly,
                              role: 'capable',
                            },
                          });
  
                          // If triage-only, we're done
                          if (triageOnly) {
                            promptUser();
                            return;
                          }
                        } else {
                          // V1: sequential with batched aggregation
                          iterativeResult = await modelMap.executor.executeIterative(pipeline, files, {
                            providerContext: effectiveProvider,
                            callbacks: {
                              onFileStart: (file: string, index: number, total: number) => {
                                console.log(chalk.cyan(`\n  [${index + 1}/${total}] ${file}`));
                              },
                              onFileComplete: (file: string, _result: string) => {
                                console.log(chalk.green(`  ✓ ${file}`));
                              },
                              onBatchStart: (batchIndex: number, totalBatches: number, filesInBatch: number) => {
                                console.log(chalk.yellow(`\n  📦 Batch ${batchIndex + 1}/${totalBatches} aggregation (${filesInBatch} files)...`));
                              },
                              onBatchComplete: (batchIndex: number, _summary: string) => {
                                console.log(chalk.green(`  ✓ Batch ${batchIndex + 1} summarized`));
                              },
                              onMetaAggregationStart: (batchCount: number) => {
                                console.log(chalk.yellow(`\n  🔗 Meta-aggregating ${batchCount} batch summaries...`));
                              },
                              onAggregationStart: () => {
                                console.log(chalk.yellow('\nAggregating results...'));
                              },
                              onStepStart: (stepName: string, modelName: string) => {
                                console.log(chalk.dim(`    ▶ ${stepName} (${modelName})`));
                              },
                              onStepComplete: (stepName: string, _output: string) => {
                                console.log(chalk.dim(`    ✓ ${stepName}`));
                              },
                              onStepText: (_stepName: string, _text: string) => {
                                // Don't stream text in iterative mode
                              },
                              onError: (stepName: string, error: Error) => {
                                console.log(chalk.red(`    ✗ ${stepName}: ${error.message}`));
                              },
                            },
                            aggregation: {
                              enabled: true,
                              role: 'capable',
                              batchSize: 15,
                            },
                          });
                        }
  
                        console.log(chalk.bold.green('\n\nPipeline complete!'));
                        console.log(chalk.dim(`Files processed: ${iterativeResult.filesProcessed}/${iterativeResult.totalFiles}`));
  
                        // Show triage results if available
                        if (iterativeResult.triageResult) {
                          const tr = iterativeResult.triageResult;
                          console.log(chalk.dim(`Triage: ${tr.criticalPaths.length} critical, ${tr.normalPaths.length} normal, ${tr.skipPaths.length} quick`));
                        }
  
                        // Show grouping/batching info if available
                        if (iterativeResult.groups && iterativeResult.groups.length > 0) {
                          console.log(chalk.dim(`Groups: ${iterativeResult.groups.length}`));
                        }
                        if (iterativeResult.batchSummaries && iterativeResult.batchSummaries.length > 0) {
                          console.log(chalk.dim(`Batches aggregated: ${iterativeResult.batchSummaries.length}`));
                        }
                        if (iterativeResult.timing) {
                          const t = iterativeResult.timing;
                          const triageStr = t.triage ? `${(t.triage / 1000).toFixed(1)}s triage, ` : '';
                          console.log(chalk.dim(`Time: ${(t.total / 1000).toFixed(1)}s total (${triageStr}${(t.processing / 1000).toFixed(1)}s processing, ${((t.aggregation || 0) / 1000).toFixed(1)}s aggregation)`));
                        }
                        console.log(chalk.dim(`Models used: ${iterativeResult.modelsUsed.join(', ')}`));
  
                        if (iterativeResult.skippedFiles && iterativeResult.skippedFiles.length > 0) {
                          console.log(chalk.yellow(`\nSkipped ${iterativeResult.skippedFiles.length} file(s):`));
                          for (const { file, reason } of iterativeResult.skippedFiles.slice(0, 5)) {
                            console.log(chalk.dim(`  - ${file}: ${reason}`));
                          }
                          if (iterativeResult.skippedFiles.length > 5) {
                            console.log(chalk.dim(`  ... and ${iterativeResult.skippedFiles.length - 5} more`));
                          }
                        }
  
                        console.log(chalk.bold('\n## Aggregated Results\n'));
                        console.log(iterativeResult.aggregatedOutput || '(No output)');
                      } catch (error) {
                        console.log(chalk.red(`\nIterative pipeline failed: ${error instanceof Error ? error.message : String(error)}`));
                      }
  
                      promptUser();
                      return;
                    }
  
                    // Standard (non-iterative) execution
                    console.log(chalk.bold.magenta(`\nExecuting pipeline: ${pipelineName}`));
                    console.log(chalk.dim(`Provider: ${effectiveProvider}`));
                    console.log(chalk.dim(`Input: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`));
  
                    // Resolve file content if input looks like a glob pattern or file path
                    const { resolvedInput, filesRead, truncated } = await resolvePipelineInput(input);
                    if (filesRead > 0) {
                      console.log(chalk.dim(`Files resolved: ${filesRead}${truncated ? ' (truncated)' : ''}`));
                    }
                    console.log();
  
                    try {
                      const pipelineResult = await modelMap.executor.execute(pipeline, resolvedInput, {
                        providerContext: effectiveProvider,
                        callbacks: {
                          onStepStart: (stepName: string, modelName: string) => {
                            console.log(chalk.cyan(`  ▶ ${stepName} (${modelName})`));
                          },
                          onStepComplete: (stepName: string, _output: string) => {
                            console.log(chalk.green(`  ✓ ${stepName} complete`));
                          },
                          onStepText: (_stepName: string, text: string) => {
                            process.stdout.write(chalk.dim(text));
                          },
                          onError: (stepName: string, error: Error) => {
                            console.log(chalk.red(`  ✗ ${stepName} failed: ${error.message}`));
                          },
                        },
                      });
  
                      console.log(chalk.bold.green('\n\nPipeline complete!'));
                      console.log(chalk.dim(`Models used: ${pipelineResult.modelsUsed.join(', ')}`));
                      console.log(chalk.bold('\nResult:'));
                      console.log(pipelineResult.output);
                    } catch (error) {
                      console.log(chalk.red(`\nPipeline execution failed: ${error instanceof Error ? error.message : String(error)}`));
                    }
                    promptUser();
                    return;
                  });
                  return;
                }

              }
              // Clear history for slash commands - they should start fresh
              agent.clearHistory();

              // Check if command has a pipeline override in model map
              const modelMap = agent.getModelMap();
              if (modelMap) {
                try {
                  const routing = modelMap.router.routeCommand(command.name);
                  if (routing.type === 'pipeline') {
                    await renderCommandOutput(inkController, async () => {
                      // Execute pipeline instead of sending to agent
                      console.log(chalk.bold.magenta(`\nExecuting pipeline: ${routing.pipelineName}`));
                      console.log(chalk.dim(`Input: ${result.substring(0, 100)}${result.length > 100 ? '...' : ''}`));
                      console.log();

                      const startTime = Date.now();
                      const pipelineResult = await modelMap.executor.execute(routing.pipeline, result, {
                        onStepStart: (stepName: string, modelName: string) => {
                          console.log(chalk.cyan(`  ▶ ${stepName} (${modelName})`));
                        },
                        onStepComplete: (stepName: string, _output: string) => {
                          console.log(chalk.green(`  ✓ ${stepName} complete`));
                        },
                        onStepText: (_stepName: string, text: string) => {
                          process.stdout.write(chalk.dim(text));
                        },
                        onError: (stepName: string, error: Error) => {
                          console.log(chalk.red(`  ✗ ${stepName} failed: ${error.message}`));
                        },
                      });

                      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                      console.log(chalk.bold.green('\n\nPipeline complete!'));
                      console.log(chalk.dim(`Models used: ${pipelineResult.modelsUsed.join(', ')} (${elapsed}s)`));
                      console.log(chalk.bold('\nResult:'));
                      console.log(pipelineResult.output);
                      promptUser();
                    });
                    return;
                  }
                } catch (routingError) {
                  // Routing failed, fall through to normal chat
                  logger.debug(`Command routing failed: ${routingError instanceof Error ? routingError.message : String(routingError)}`);
                }
              }

              // Command returned a prompt - send to agent
              if (!useInkUi) {
                console.log(chalk.bold.magenta('\nAssistant: '));
              }
              isStreaming = false;
              spinner.thinking();
              if (useInkUi && inkController) {
                inkController.setStatus({ activity: 'thinking', activityDetail: null });
              } else if (workerStatusUI) {
                workerStatusUI.setAgentActivity('thinking', null);
              }
              currentAssistantMessageId = inkController?.startAssistantMessage() ?? null;
              const assistantMessageId = currentAssistantMessageId;
              const startTime = Date.now();
              try {
                await agent.chat(result, { taskType: command.taskType });
              } finally {
                const finalizedId = assistantMessageId ?? currentAssistantMessageId;
                if (finalizedId) {
                  inkController?.completeAssistantMessage(finalizedId);
                }
                if (useInkUi && inkController) {
                  inkController.setStatus({ activity: 'idle', activityDetail: null });
                } else if (workerStatusUI) {
                  workerStatusUI.setAgentActivity('idle', null);
                }
                currentAssistantMessageId = null;
              }
              if (isReasoningStreaming) {
                console.log(chalk.dim.italic('\n---\n'));
                isReasoningStreaming = false;
              }
              if (!useInkUi) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(chalk.dim(`\n(${elapsed}s)`));
              }
              autoSaveSession(commandContext, agent);
            }
          } catch (error) {
            spinner.stop();
            logger.error(`Command error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error : undefined);
          }
          promptUser();
          return;
        } else {
          console.log(chalk.yellow(`Unknown command: /${parsed.name}. Type /help for available commands.`));
          promptUser();
          return;
        }
      }
    }

    // Regular message - send to agent
    if (!useInkUi) {
      console.log(chalk.bold.magenta('\nAssistant: '));
    }
    isStreaming = false;
    spinner.thinking();
    if (useInkUi && inkController) {
      inkController.setStatus({ activity: 'thinking', activityDetail: null });
    } else if (workerStatusUI) {
      workerStatusUI.setAgentActivity('thinking', null);
    }
    currentAssistantMessageId = inkController?.startAssistantMessage() ?? null;
    const assistantMessageId = currentAssistantMessageId;

    // Mark the start of agent processing for interrupt detection
    interruptHandler.startProcessing();
    
    try {
      // Check if user pressed ESC before we started processing
      if (interruptHandler.wasInterrupted()) {
        console.log(chalk.yellow('\n⚠️ Operation cancelled'));
        resetPrompt();
        promptUser();
        return;
      }
      
      const startTime = Date.now();
      
      await agent.chat(trimmed);
      
      if (isReasoningStreaming) {
        console.log(chalk.dim.italic('\n---\n'));
        isReasoningStreaming = false;
      }
      if (!useInkUi) {
        // Check if operation was interrupted during processing
        if (interruptHandler.wasInterrupted()) {
          console.log(chalk.dim('\n⚠️ Operation interrupted'));
        } else {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(chalk.dim(`\n(${elapsed}s)`));
        }
      }
      autoSaveSession(commandContext, agent);

      // Auto-generate label after first exchange if not set
      if (!currentLabel && agent.getHistory().length >= 2) {
        const autoLabel = await agent.generateAutoLabel();
        if (autoLabel) {
          currentLabel = autoLabel;
          updatePrompt(currentPromptMode);
          if (commandContext.sessionState) {
            commandContext.sessionState.label = autoLabel;
          }
          // Save again to persist the auto-generated label
          autoSaveSession(commandContext, agent);
        }
      }
    } catch (error) {
      spinner.stop();
      logger.error(error instanceof Error ? error.message : String(error), error instanceof Error ? error : undefined);
    } finally {
      // Always mark processing as complete
      interruptHandler.endProcessing();
      const finalizedId = assistantMessageId ?? currentAssistantMessageId;
      if (finalizedId) {
        inkController?.completeAssistantMessage(finalizedId);
      }
      if (useInkUi && inkController) {
        inkController.setStatus({ activity: 'idle', activityDetail: null });
      } else if (workerStatusUI) {
        workerStatusUI.setAgentActivity('idle', null);
      }
      currentAssistantMessageId = null;
    }

    promptUser();
  };

  if (useInkUi && inkController) {
    inkSubmitHandler = handleInput;
    while (pendingInkInputs.length > 0) {
      const nextInput = pendingInkInputs.shift();
      if (nextInput) {
        // eslint-disable-next-line no-await-in-loop
        await handleInput(nextInput);
      }
    }
    if (inkUiPromise) {
      await inkUiPromise;
    }
    process.exit(0);
  }

  // Paste detection via debouncing
  // When lines arrive rapidly (within debounce window), they're buffered
  // Line handler that checks for pasted content
  const debugPaste = process.env.DEBUG_PASTE === '1';
  const onLine = (line: string) => {
    if (rlClosed) return;

    // Re-enable spinner now that user has submitted input
    spinner.setPromptActive(false);

    // Check if there's pending paste data (captured by PasteInterceptor)
    const pasteData = consumePendingPaste();

    // Debug logging (always show with DEBUG_PASTE=1)
    if (debugPaste) {
      // eslint-disable-next-line no-console
      console.error(`[PASTE_DEBUG onLine] line=${JSON.stringify(line)}, pasteData=${JSON.stringify(pasteData)}`);
    }
    if (logLevel >= LogLevel.DEBUG) {
      logger.debug(`[onLine] line=${JSON.stringify(line)}, pasteData=${JSON.stringify(pasteData)}`);
    }

    if (pasteData !== null) {
      // Use readline's line (typed content) + paste content
      // e.g., user types "/command " then pastes "args" -> "/command args"
      // Note: readline's line buffer has the typed content; pasteData.prefix is unreliable
      const combined = line + pasteData.content;
      if (debugPaste) {
        // eslint-disable-next-line no-console
        console.error(`[PASTE_DEBUG onLine] combined=${JSON.stringify(combined)}`);
      }
      if (logLevel >= LogLevel.DEBUG) {
        logger.debug(`[onLine] combined=${JSON.stringify(combined)}`);
      }
      handleInput(combined);
    } else {
      // Normal typed input
      handleInput(line);
    }
  };

  // Set up line handler for REPL
  rl?.on('line', onLine);

  console.log(
    chalk.dim('Tips: ') +
      chalk.cyan('!<command>') + chalk.dim(' to run shell directly, ') +
      chalk.cyan('?topic') + chalk.dim(' for help, ') +
      chalk.cyan('/help') + chalk.dim(' for commands, ') +
      chalk.cyan('/exit') + chalk.dim(' to quit, ') +
      chalk.cyan('ESC') + chalk.dim(' to interrupt.\n')
  );
  promptUser();
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  disableBracketedPaste();
  console.error(chalk.red(`\nUncaught exception: ${error.message}`));
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  disableBracketedPaste();
  console.error(chalk.red(`\nUnhandled rejection: ${reason}`));
  process.exit(1);
});

// Graceful shutdown on SIGTERM/SIGINT
const gracefulShutdown = (signal: string) => {
  console.log(chalk.dim(`\nReceived ${signal}, shutting down gracefully...`));
  disableBracketedPaste();

  // Cleanup interrupt handler
  destroyInterruptHandler();

  // Set a timeout to force exit if cleanup takes too long
  const forceExitTimeout = setTimeout(() => {
    logger.warn('\nForce exiting after cleanup timeout');
    process.exit(1);
  }, 5000);
  forceExitTimeout.unref(); // Don't prevent exit if cleanup finishes

  // Close symbol index database to prevent corruption
  const symbolIndex = getSymbolIndexService();
  if (symbolIndex) {
    symbolIndex.close();
  }

  // Shutdown all rate limiters (clears intervals and rejects pending)
  shutdownAllRateLimiters();

  // Shutdown debug bridge (writes session_end event)
  if (isDebugBridgeEnabled()) {
    getDebugBridge().shutdown();
  }

  // Cleanup orchestrator (stops IPC server, cleans up worktrees)
  const orch = getOrchestratorInstance();
  if (orch) {
    orch.stop().catch(() => {});
  }

  clearTimeout(forceExitTimeout);
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

main().catch(console.error);
