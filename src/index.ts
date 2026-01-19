#!/usr/bin/env node
// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { createInterface, type Interface } from 'readline';
import {
  createPasteInterceptor,
  enableBracketedPaste,
  disableBracketedPaste,
  consumePendingPaste,
} from './paste-debounce.js';
import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, appendFileSync, existsSync, statSync } from 'fs';
import { glob } from 'node:fs/promises';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { join } from 'path';

// History configuration - allow override for testing
const HISTORY_FILE = process.env.CODI_HISTORY_FILE || join(homedir(), '.codi_history');
const MAX_HISTORY_SIZE = 1000;

/**
 * Load command history from file.
 * Node.js readline shows index 0 first when pressing UP, so newest must be first.
 */
function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const content = readFileSync(HISTORY_FILE, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      // File has oldest first, newest last. Reverse so newest is at index 0.
      return lines.slice(-MAX_HISTORY_SIZE).reverse();
    }
  } catch {
    // Ignore errors reading history
  }
  return [];
}

/**
 * Append a command to history file.
 */
function saveToHistory(command: string): void {
  try {
    appendFileSync(HISTORY_FILE, command + '\n');
  } catch {
    // Ignore errors writing history
  }
}

/**
 * Configuration for pipeline input resolution.
 */
interface PipelineInputConfig {
  maxFiles: number;
  maxFileSize: number;
  maxTotalSize: number;
}

const DEFAULT_PIPELINE_INPUT_CONFIG: PipelineInputConfig = {
  maxFiles: 20,
  maxFileSize: 50000, // 50KB per file
  maxTotalSize: 200000, // 200KB total
};

/**
 * Check if a string looks like a glob pattern or file path.
 */
function isGlobOrFilePath(input: string): boolean {
  // Check for glob patterns
  if (input.includes('*') || input.includes('?')) {
    return true;
  }
  // Check if it looks like a file path (starts with ./ or / or contains file extensions)
  if (input.startsWith('./') || input.startsWith('/') || input.startsWith('src/')) {
    return true;
  }
  // Check for common file extensions
  if (/\.(ts|js|tsx|jsx|py|go|rs|java|md|json|yaml|yml)$/i.test(input)) {
    return true;
  }
  return false;
}

/**
 * Resolve pipeline input to actual file contents.
 * If input is a glob pattern or file path, reads the files and returns their contents.
 * Otherwise, returns the input as-is.
 */
async function resolvePipelineInput(
  input: string,
  config: PipelineInputConfig = DEFAULT_PIPELINE_INPUT_CONFIG
): Promise<{ resolvedInput: string; filesRead: number; truncated: boolean }> {
  if (!isGlobOrFilePath(input)) {
    return { resolvedInput: input, filesRead: 0, truncated: false };
  }

  const cwd = process.cwd();
  const files: string[] = [];

  // Check if it's a direct file path or a glob pattern
  if (input.includes('*') || input.includes('?')) {
    // It's a glob pattern
    for await (const file of glob(input, { cwd })) {
      files.push(file);
    }
  } else {
    // It's a direct file path
    const fullPath = input.startsWith('/') ? input : join(cwd, input);
    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          files.push(input);
        } else if (stat.isDirectory()) {
          // If it's a directory, glob for common code files
          for await (const file of glob(`${input}/**/*.{ts,js,tsx,jsx,py,go,rs,java,md,json,yaml,yml}`, { cwd })) {
            files.push(file);
          }
        }
      } catch {
        // Ignore stat errors
      }
    }
  }

  if (files.length === 0) {
    return { resolvedInput: `No files found matching: ${input}`, filesRead: 0, truncated: false };
  }

  // Sort files for consistent ordering
  files.sort();

  // Limit number of files
  const filesToRead = files.slice(0, config.maxFiles);
  const truncatedFiles = files.length > config.maxFiles;

  // Read file contents
  const contents: string[] = [];
  let totalSize = 0;
  let truncatedSize = false;

  for (const file of filesToRead) {
    const fullPath = file.startsWith('/') ? file : join(cwd, file);

    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;

      // Check file size
      if (stat.size > config.maxFileSize) {
        contents.push(`\n### File: ${file}\n\`\`\`\n[File too large: ${(stat.size / 1024).toFixed(1)}KB > ${(config.maxFileSize / 1024).toFixed(0)}KB limit]\n\`\`\`\n`);
        continue;
      }

      // Check total size limit
      if (totalSize + stat.size > config.maxTotalSize) {
        truncatedSize = true;
        contents.push(`\n### File: ${file}\n\`\`\`\n[Skipped: total size limit reached]\n\`\`\`\n`);
        continue;
      }

      const content = readFileSync(fullPath, 'utf-8');
      const ext = file.split('.').pop() || '';
      contents.push(`\n### File: ${file}\n\`\`\`${ext}\n${content}\n\`\`\`\n`);
      totalSize += stat.size;
    } catch (error) {
      contents.push(`\n### File: ${file}\n\`\`\`\n[Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}]\n\`\`\`\n`);
    }
  }

  // Build the resolved input
  let resolvedInput = `## Files matching: ${input}\n\nFound ${files.length} file(s)`;
  if (truncatedFiles) {
    resolvedInput += ` (showing first ${config.maxFiles})`;
  }
  resolvedInput += `:\n${contents.join('')}`;

  if (truncatedSize) {
    resolvedInput += `\n\n[Note: Some files skipped due to total size limit of ${(config.maxTotalSize / 1024).toFixed(0)}KB]`;
  }

  return {
    resolvedInput,
    filesRead: filesToRead.length,
    truncated: truncatedFiles || truncatedSize,
  };
}

/**
 * Resolve a glob pattern or file path to a list of files (without reading contents).
 * Used for iterative pipeline execution.
 */
async function resolveFileList(
  input: string,
  maxFileSize: number = DEFAULT_PIPELINE_INPUT_CONFIG.maxFileSize
): Promise<string[]> {
  if (!isGlobOrFilePath(input)) {
    return [];
  }

  const cwd = process.cwd();
  const files: string[] = [];

  if (input.includes('*') || input.includes('?')) {
    // Glob pattern
    for await (const file of glob(input, { cwd })) {
      const fullPath = join(cwd, file);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.size <= maxFileSize) {
          files.push(file);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } else {
    // Direct file path
    const fullPath = input.startsWith('/') ? input : join(cwd, input);
    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.size <= maxFileSize) {
          files.push(input);
        } else if (stat.isDirectory()) {
          // If directory, glob for code files
          for await (const file of glob(`${input}/**/*.{ts,js,tsx,jsx,py,go,rs,java,md,json,yaml,yml}`, { cwd })) {
            const filePath = join(cwd, file);
            try {
              const fileStat = statSync(filePath);
              if (fileStat.isFile() && fileStat.size <= maxFileSize) {
                files.push(file);
              }
            } catch {
              // Skip
            }
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  return files.sort();
}

import { Agent, type ToolConfirmation, type ConfirmationResult } from './agent.js';
import { detectProvider, createProvider, createSecondaryProvider } from './providers/index.js';
import { globalRegistry, registerDefaultTools } from './tools/index.js';
import { detectProject, formatProjectContext, loadContextFile } from './context.js';
import {
  isCommand,
  parseCommand,
  getCommand,
  getAllCommands,
  type CommandContext,
  type ProjectInfo,
} from './commands/index.js';
import { registerCodeCommands } from './commands/code-commands.js';
import { registerPromptCommands } from './commands/prompt-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerGitCommands } from './commands/git-commands.js';
import {
  registerSessionCommands,
  setSessionAgent,
  getCurrentSessionName,
  setCurrentSessionName,
} from './commands/session-commands.js';
import { registerConfigCommands } from './commands/config-commands.js';
import { registerCodiCommands } from './commands/codi-commands.js';
import { registerHistoryCommands } from './commands/history-commands.js';
import { registerPlanCommands } from './commands/plan-commands.js';
import { registerUsageCommands } from './commands/usage-commands.js';
import { registerPluginCommands } from './commands/plugin-commands.js';
import { registerModelCommands } from './commands/model-commands.js';
import { registerMemoryCommands } from './commands/memory-commands.js';
import { registerCompactCommands } from './commands/compact-commands.js';
import { registerRAGCommands, setRAGIndexer, setRAGConfig } from './commands/rag-commands.js';
import { registerApprovalCommands } from './commands/approval-commands.js';
import { registerSymbolCommands, setSymbolIndexService } from './commands/symbol-commands.js';
import { registerMCPCommands } from './commands/mcp-commands.js';
import { generateMemoryContext, consolidateSessionNotes } from './memory.js';
import {
  BackgroundIndexer,
  Retriever,
  createEmbeddingProvider,
  DEFAULT_RAG_CONFIG,
  type RAGConfig,
} from './rag/index.js';
import { registerRAGSearchTool, registerSymbolIndexTools } from './tools/index.js';
import { createCompleter } from './completions.js';
import { SymbolIndexService } from './symbol-index/index.js';
import { formatCost, formatTokens } from './usage.js';
import { loadPluginsFromDirectory, getPluginsDir } from './plugins.js';
import { loadSession } from './session.js';
import {
  loadWorkspaceConfig,
  loadLocalConfig,
  validateConfig,
  mergeConfig,
  getCustomDangerousPatterns,
  type ResolvedConfig,
} from './config.js';
import { initModelMap as loadModelMapFromDir, type ModelMap } from './model-map/index.js';
import { formatDiffForTerminal, truncateDiff } from './diff.js';
import { VERSION } from './version.js';
import { spinner } from './spinner.js';
import { logger, parseLogLevel, LogLevel } from './logger.js';
import { MCPClientManager, startMCPServer } from './mcp/index.js';
import { AuditLogger, initAuditLogger, getAuditLogger } from './audit.js';

// CLI setup
program
  .name('codi')
  .description('Your AI coding wingman')
  .version(VERSION, '-v, --version', 'Output the current version')
  .option('-p, --provider <type>', 'Provider to use (anthropic, openai, ollama, ollama-cloud, runpod)', 'auto')
  .option('-m, --model <name>', 'Model to use')
  .option('--base-url <url>', 'Base URL for API (for self-hosted models)')
  .option('--endpoint-id <id>', 'Endpoint ID (for RunPod serverless)')
  .option('--no-tools', "Disable tool use (for models that don't support it)")
  .option('-y, --yes', 'Auto-approve all tool operations (skip confirmation prompts)')
  .option('--verbose', 'Show detailed tool information')
  .option('--debug', 'Show API and context details')
  .option('--trace', 'Show full request/response payloads')
  .option('-s, --session <name>', 'Load a saved session on startup')
  .option('--no-compress', 'Disable context compression (enabled by default)')
  .option('--context-window <tokens>', 'Context window size (tokens) before compaction')
  .option('--summarize-model <name>', 'Model to use for summarization (default: primary model)')
  .option('--summarize-provider <type>', 'Provider for summarization model (default: primary provider)')
  .option('--mcp-server', 'Run as MCP server (stdio transport) - exposes tools to other MCP clients')
  .option('--no-mcp', 'Disable MCP server connections (ignore mcpServers in config)')
  .option('--audit', 'Enable audit logging (writes to ~/.codi/audit/)')
  .parse();

const options = program.opts();

/**
 * Builds the system prompt given to the agent.
 *
 * The prompt varies depending on whether tool-use is enabled, and optionally
 * includes detected project context to help the model tailor responses.
 *
 * @param projectInfo - Detected information about the current project, if any.
 * @param useTools - Whether the agent should be instructed to use tools.
 * @returns The complete system prompt.
 */
function generateSystemPrompt(projectInfo: ProjectInfo | null, useTools: boolean): string {
  let prompt: string;

  if (useTools) {
    prompt = `You are an expert AI coding assistant with deep knowledge of software development. You have access to tools that allow you to read, write, and edit files, search codebases, and execute commands.

## Your Capabilities
- Read and understand code in any language
- Write clean, well-documented code
- Debug issues and suggest fixes
- Refactor and optimize code
- Generate tests
- Explain complex code clearly

## Guidelines
1. **Read before writing**: Always read relevant files before making changes
2. **Minimal changes**: Make targeted edits rather than rewriting entire files
3. **Explain your work**: Briefly explain what you're doing and why
4. **Follow conventions**: Match the existing code style and patterns
5. **Handle errors**: Include appropriate error handling
6. **Test awareness**: Consider how changes affect tests

## Tool Use Rules
- The tool list below is authoritative for this run. Use only these tool names and their parameters.
- When you need a tool, emit a tool call (do not describe tool usage in plain text).
- Do not put tool-call syntax or commands in your normal response.
- Do not present shell commands in fenced code blocks like \`\`\`bash\`\`\`; use the bash tool instead.
- Wait for tool results before continuing; if a tool fails, explain and try a different tool.

## Available Tools

### File Operations
- **read_file**: Read file contents (params: path, offset, max_lines)
- **write_file**: Write/create file (params: path, content)
- **edit_file**: Replace text in file (params: path, old_string, new_string, replace_all)
- **insert_line**: Insert at line number (params: path, line, content)
- **patch_file**: Apply unified diff (params: path, patch)

### Code Search
- **glob**: Find files by pattern (params: pattern, cwd)
- **grep**: Search file contents (params: pattern, path, file_pattern, ignore_case)
- **list_directory**: List directory contents (params: path, show_hidden)
- **search_codebase**: Semantic code search via RAG (params: query)

### Symbol Navigation (for understanding code structure)
- **find_symbol**: Find function/class/interface definitions (params: name, kind, exact, exported_only)
- **find_references**: Find all usages of a symbol (params: name, file, include_imports)
- **goto_definition**: Jump to where a symbol is defined (params: name, from_file)
- **get_dependency_graph**: Show file imports/dependents (params: file, direction, depth)
- **get_inheritance**: Show class hierarchy (params: name, direction)
- **get_call_graph**: Show function callers (params: name, file)

### Other
- **bash**: Execute shell commands (params: command, cwd)
- **run_tests**: Run project tests (params: command, filter, timeout)
- **web_search**: Search the web (params: query, num_results)
- **analyze_image**: Analyze images with vision (params: path, question)

## Guidelines
- Use symbol navigation tools to understand code structure before making changes
- Use read_file with offset to read specific sections of large files
- WAIT for tool results before continuing - never make up file contents
- Use edit_file for targeted changes, write_file only for new files or complete rewrites

## Tool Call Format (for models without native tool support)
If you cannot make native tool calls, output tool requests in this JSON format:
\`\`\`json
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
\`\`\`

Examples:
- Read a file: \`{"name": "read_file", "arguments": {"path": "src/index.ts"}}\`
- Run a command: \`{"name": "bash", "arguments": {"command": "ls -la"}}\`
- Search code: \`{"name": "grep", "arguments": {"pattern": "function.*export", "path": "src"}}\`

Output ONE tool call at a time, wait for the result, then continue.`;
  } else {
    // Fallback mode for models without tool support
    prompt = `You are an expert AI coding assistant with deep knowledge of software development.

## Your Capabilities
- Read and understand code in any language
- Write clean, well-documented code
- Debug issues and suggest fixes
- Refactor and optimize code
- Generate tests
- Explain complex code clearly

## Guidelines
Since you cannot directly access the filesystem, please:
1. **Ask for file contents**: If you need to see code, ask the user to paste it
2. **Provide complete code**: When writing code, provide the complete file contents
3. **Give clear instructions**: Tell the user exactly what commands to run
4. **Be specific**: Reference exact file paths and line numbers when possible

When suggesting changes, format them clearly so the user can apply them manually.`;
  }

  if (projectInfo) {
    prompt += `\n\n## Current Project Context\n${formatProjectContext(projectInfo)}`;
    prompt += `\nAdapt your responses to this project's language, framework, and conventions.`;
  }

  return prompt;
}

/**
 * Prints the interactive CLI help text, including built-in commands, code
 * assistance commands, workflow commands, and (if available) detected project
 * info.
 *
 * @param projectInfo - Detected information about the current project, if any.
 */
function showHelp(projectInfo: ProjectInfo | null): void {
  console.log(chalk.bold('\nShortcuts:'));
  console.log(chalk.dim('  !<command>         - Run shell command directly (e.g., !ls, !git status)'));
  console.log(chalk.dim('  ?[topic]           - Show help, optionally filtered by topic'));

  console.log(chalk.bold('\nBuilt-in Commands:'));
  console.log(chalk.dim('  /help              - Show this help message'));
  console.log(chalk.dim('  /clear             - Clear conversation history'));
  console.log(chalk.dim('  /compact           - Summarize old messages to save context'));
  console.log(chalk.dim('  /status            - Show current context usage'));
  console.log(chalk.dim('  /context           - Show detected project context'));
  console.log(chalk.dim('  /exit              - Exit the assistant'));

  console.log(chalk.bold('\nCode Assistance:'));
  console.log(chalk.dim('  /explain <file>    - Explain code in a file'));
  console.log(chalk.dim('  /refactor <file>   - Suggest refactoring improvements'));
  console.log(chalk.dim('  /fix <file> <issue>- Fix a bug or issue'));
  console.log(chalk.dim('  /test <file>       - Generate tests'));
  console.log(chalk.dim('  /review <file>     - Code review'));
  console.log(chalk.dim('  /doc <file>        - Generate documentation'));
  console.log(chalk.dim('  /optimize <file>   - Optimize for performance'));

  console.log(chalk.bold('\nWorkflows:'));
  console.log(chalk.dim('  /new <type> <name> - Create new component/file'));
  console.log(chalk.dim('  /scaffold <feature>- Scaffold a complete feature'));
  console.log(chalk.dim('  /debug <issue>     - Help debug an issue'));
  console.log(chalk.dim('  /setup <tool>      - Set up project tooling'));
  console.log(chalk.dim('  /migrate <from> <to> - Migrate code patterns'));

  console.log(chalk.bold('\nGit:'));
  console.log(chalk.dim('  /commit [type]     - Generate commit message and commit'));
  console.log(chalk.dim('  /branch [action]   - Create, switch, list, delete branches'));
  console.log(chalk.dim('  /diff [target]     - Show and explain git differences'));
  console.log(chalk.dim('  /pr [base]         - Generate pull request description'));
  console.log(chalk.dim('  /stash [action]    - Manage git stash'));
  console.log(chalk.dim('  /log [target]      - Show and explain git history'));
  console.log(chalk.dim('  /gitstatus         - Detailed git status'));
  console.log(chalk.dim('  /undo [what]       - Safely undo git changes'));
  console.log(chalk.dim('  /merge <branch>    - Merge branches'));
  console.log(chalk.dim('  /rebase <branch>   - Rebase onto branch'));

  console.log(chalk.bold('\nSessions:'));
  console.log(chalk.dim('  /save [name]       - Save conversation to session'));
  console.log(chalk.dim('  /load <name>       - Load a saved session'));
  console.log(chalk.dim('  /sessions          - List saved sessions'));
  console.log(chalk.dim('  /sessions info     - Show current session info'));
  console.log(chalk.dim('  /sessions delete   - Delete a session'));

  console.log(chalk.bold('\nConfiguration:'));
  console.log(chalk.dim('  /config            - Show current workspace config'));
  console.log(chalk.dim('  /config init       - Create a .codi.json file'));
  console.log(chalk.dim('  /config example    - Show example configuration'));

  console.log(chalk.bold('\nPlugins:'));
  console.log(chalk.dim('  /plugins           - List loaded plugins'));
  console.log(chalk.dim('  /plugins info <n>  - Show details about a plugin'));
  console.log(chalk.dim('  /plugins dir       - Show plugins directory'));

  console.log(chalk.bold('\nUndo/History:'));
  console.log(chalk.dim('  /fileundo          - Undo the last file change'));
  console.log(chalk.dim('  /redo              - Redo an undone change'));
  console.log(chalk.dim('  /filehistory       - Show file change history'));
  console.log(chalk.dim('  /filehistory clear - Clear all history'));

  console.log(chalk.bold('\nMemory:'));
  console.log(chalk.dim('  /remember [cat:] <fact> - Remember a fact for future sessions'));
  console.log(chalk.dim('  /forget <pattern>  - Remove memories matching pattern'));
  console.log(chalk.dim('  /memories [query]  - List or search stored memories'));
  console.log(chalk.dim('  /profile [set k v] - View or update user profile'));

  console.log(chalk.bold('\nModels:'));
  console.log(chalk.dim('  /models [provider] - List available models'));
  console.log(chalk.dim('  /switch <model>    - Switch to a different model'));
  console.log(chalk.dim('  /modelmap          - Show model map configuration'));
  console.log(chalk.dim('  /pipeline [name]   - Execute multi-model pipeline'));

  console.log(chalk.bold('\nUsage & Cost:'));
  console.log(chalk.dim('  /usage [period]    - Show token usage and costs'));

  console.log(chalk.bold('\nCode Navigation:'));
  console.log(chalk.dim('  /symbols [action]  - Manage symbol index (rebuild, stats, search)'));
  console.log(chalk.dim('  /rag [action]      - Manage RAG semantic search index'));

  console.log(chalk.bold('\nImport:'));
  console.log(chalk.dim('  /import <file>     - Import ChatGPT conversation exports'));

  if (projectInfo) {
    console.log(chalk.bold('\nProject:'));
    console.log(
      chalk.dim(
        `  ${projectInfo.name} (${projectInfo.language}${projectInfo.framework ? ` / ${projectInfo.framework}` : ''})`,
      ),
    );
  }
}

/**
 * Format a tool confirmation for display.
 */
function formatConfirmation(confirmation: ToolConfirmation): string {
  const { toolName, input, isDangerous, dangerReason, diffPreview, approvalSuggestions } = confirmation;

  let display = '';

  if (isDangerous) {
    display += chalk.red.bold('⚠️  DANGEROUS OPERATION\n');
    display += chalk.red(`   Reason: ${dangerReason}\n\n`);
  }

  display += chalk.yellow(`Tool: ${toolName}\n`);

  // Format input based on tool type
  if (toolName === 'bash') {
    display += chalk.dim(`Command: ${input.command}\n`);

    // Show approval suggestions for non-dangerous bash commands
    if (!isDangerous && approvalSuggestions) {
      display += '\n' + chalk.cyan('Also approve similar commands?\n');
      display += chalk.dim(`  [p] Pattern: ${approvalSuggestions.suggestedPattern}\n`);

      approvalSuggestions.matchedCategories.forEach((cat, i) => {
        display += chalk.dim(`  [${i + 1}] Category: ${cat.name} - ${cat.description}\n`);
      });
    }
  } else if (toolName === 'write_file' || toolName === 'edit_file') {
    display += chalk.dim(`Path: ${input.path}\n`);

    // Show diff preview if available
    if (diffPreview) {
      display += chalk.dim(`Changes: ${diffPreview.summary}\n`);
      if (diffPreview.isNewFile) {
        display += chalk.green('(New file)\n');
      }
      display += '\n';

      // Format and display the diff
      const truncatedDiff = truncateDiff(diffPreview.unifiedDiff, 40);
      const formattedDiff = formatDiffForTerminal(truncatedDiff);
      display += formattedDiff + '\n';
    } else {
      // Fallback to old behavior if no diff preview
      if (toolName === 'write_file') {
        const content = input.content as string | undefined;
        if (content !== undefined) {
          const lines = content.split('\n').length;
          display += chalk.dim(`Content: ${lines} lines, ${content.length} chars\n`);
        } else {
          display += chalk.red(`Content: (missing - model did not provide content)\n`);
        }
      } else {
        const oldStr = input.old_string as string | undefined;
        const newStr = input.new_string as string | undefined;
        if (oldStr !== undefined) {
          display += chalk.dim(`Replace: "${oldStr.slice(0, 50)}${oldStr.length > 50 ? '...' : ''}"\n`);
        } else {
          display += chalk.red(`Replace: (missing)\n`);
        }
        if (newStr !== undefined) {
          display += chalk.dim(`With: "${newStr.slice(0, 50)}${newStr.length > 50 ? '...' : ''}"\n`);
        } else {
          display += chalk.red(`With: (missing)\n`);
        }
      }
    }

    // Show approval suggestions for file tools
    if (approvalSuggestions) {
      display += '\n' + chalk.cyan('Also approve similar file operations?\n');
      display += chalk.dim(`  [p] Pattern: ${approvalSuggestions.suggestedPattern}\n`);

      approvalSuggestions.matchedCategories.forEach((cat, i) => {
        display += chalk.dim(`  [${i + 1}] Category: ${cat.name} - ${cat.description}\n`);
      });
    }
  } else if (toolName === 'insert_line' || toolName === 'patch_file') {
    display += chalk.dim(`Path: ${input.path}\n`);

    // Show approval suggestions for other file tools
    if (approvalSuggestions) {
      display += '\n' + chalk.cyan('Also approve similar file operations?\n');
      display += chalk.dim(`  [p] Pattern: ${approvalSuggestions.suggestedPattern}\n`);

      approvalSuggestions.matchedCategories.forEach((cat, i) => {
        display += chalk.dim(`  [${i + 1}] Category: ${cat.name} - ${cat.description}\n`);
      });
    }
  } else {
    display += chalk.dim(JSON.stringify(input, null, 2).slice(0, 200) + '\n');
  }

  return display;
}

/**
 * Prompt user for confirmation using readline.
 */
function promptConfirmation(rl: ReturnType<typeof createInterface>, message: string): Promise<ConfirmationResult> {
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      const lower = (answer || '').toLowerCase().trim();
      if (lower === 'y' || lower === 'yes') {
        resolve('approve');
      } else if (lower === 'a' || lower === 'abort') {
        resolve('abort');
      } else {
        resolve('deny');
      }
    });
  });
}

/**
 * Prompt user for confirmation with approval suggestions.
 */
function promptConfirmationWithSuggestions(
  rl: ReturnType<typeof createInterface>,
  confirmation: ToolConfirmation
): Promise<ConfirmationResult> {
  const { isDangerous, approvalSuggestions } = confirmation;

  // Dangerous commands or no suggestions - simple prompt
  if (isDangerous || !approvalSuggestions) {
    const promptText = isDangerous
      ? chalk.red.bold('Approve? [y/N/abort] ')
      : chalk.yellow('Approve? [y/N/abort] ');
    return promptConfirmation(rl, promptText);
  }

  // Build dynamic prompt with options
  const categoryCount = approvalSuggestions.matchedCategories.length;
  let options = 'y/n';
  if (approvalSuggestions.suggestedPattern) {
    options += '/p';
  }
  if (categoryCount > 0) {
    options += categoryCount > 1 ? `/1-${categoryCount}` : '/1';
  }
  options += '/abort';

  const promptText = chalk.yellow(`Approve? [${options}] `);

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      const lower = (answer || '').toLowerCase().trim();

      if (lower === 'y' || lower === 'yes') {
        resolve('approve');
      } else if (lower === 'a' || lower === 'abort') {
        resolve('abort');
      } else if (lower === 'p' || lower === 'pattern') {
        resolve({
          type: 'approve_pattern',
          pattern: approvalSuggestions.suggestedPattern,
        });
      } else if (/^\d+$/.test(lower)) {
        const index = parseInt(lower, 10) - 1;
        if (index >= 0 && index < approvalSuggestions.matchedCategories.length) {
          resolve({
            type: 'approve_category',
            categoryId: approvalSuggestions.matchedCategories[index].id,
          });
        } else {
          resolve('deny');
        }
      } else {
        resolve('deny');
      }
    });
  });
}

/**
 * Handle session command output messages.
 */
function handleSessionOutput(output: string): void {
  const parts = output.split(':');
  const type = parts[0];

  switch (type) {
    case '__SESSION_SAVED__': {
      const name = parts[1];
      const status = parts[2];
      const count = parts[3];
      console.log(chalk.green(`\nSession ${status === 'new' ? 'saved' : 'updated'}: ${name}`));
      console.log(chalk.dim(`${count} messages saved.`));
      break;
    }

    case '__SESSION_LOADED__': {
      const name = parts[1];
      const count = parts[2];
      const hasSummary = parts[3] === 'yes';
      console.log(chalk.green(`\nSession loaded: ${name}`));
      console.log(chalk.dim(`${count} messages restored.`));
      if (hasSummary) {
        console.log(chalk.dim('Session includes conversation summary.'));
      }
      break;
    }

    case '__SESSION_NOT_FOUND__': {
      const name = parts[1];
      console.log(chalk.yellow(`\nSession not found: ${name}`));
      console.log(chalk.dim('Use /sessions to list available sessions.'));
      break;
    }

    case '__SESSION_LIST__': {
      const lines = output.split('\n').slice(1);
      console.log(chalk.bold('\nSaved Sessions:'));
      for (const line of lines) {
        console.log(chalk.dim(`  ${line}`));
      }
      break;
    }

    case '__SESSION_LIST_EMPTY__': {
      console.log(chalk.dim('\nNo saved sessions found.'));
      console.log(chalk.dim('Use /save [name] to save the current conversation.'));
      break;
    }

    case '__SESSION_MULTIPLE__': {
      const pattern = parts[1];
      const lines = output.split('\n').slice(1);
      console.log(chalk.yellow(`\nMultiple sessions match "${pattern}":`));
      for (const line of lines) {
        console.log(chalk.dim(`  ${line}`));
      }
      console.log(chalk.dim('\nPlease specify more precisely.'));
      break;
    }

    case '__SESSION_DELETED__': {
      const name = parts[1];
      console.log(chalk.green(`\nSession deleted: ${name}`));
      break;
    }

    case '__SESSION_DELETE_NO_NAME__': {
      console.log(chalk.yellow('\nPlease specify a session name to delete.'));
      console.log(chalk.dim('Usage: /sessions delete <name>'));
      break;
    }

    case '__SESSION_NO_CURRENT__': {
      console.log(chalk.dim('\nNo session currently loaded.'));
      console.log(chalk.dim('Use /load <name> to load a session.'));
      break;
    }

    case '__SESSION_INFO__': {
      const infoJson = parts.slice(1).join(':');
      try {
        const info = JSON.parse(infoJson);
        console.log(chalk.bold('\nSession Info:'));
        console.log(chalk.dim(`  Name: ${info.name}`));
        console.log(chalk.dim(`  Messages: ${info.messages}`));
        console.log(chalk.dim(`  Has summary: ${info.hasSummary ? 'yes' : 'no'}`));
        if (info.project) console.log(chalk.dim(`  Project: ${info.project}`));
        if (info.provider) console.log(chalk.dim(`  Provider: ${info.provider}`));
        if (info.model) console.log(chalk.dim(`  Model: ${info.model}`));
        console.log(chalk.dim(`  Created: ${new Date(info.created).toLocaleString()}`));
        console.log(chalk.dim(`  Updated: ${new Date(info.updated).toLocaleString()}`));
      } catch {
        console.log(chalk.dim('\nSession info unavailable.'));
      }
      break;
    }

    case '__SESSION_CLEARED__': {
      const count = parts[1];
      console.log(chalk.green(`\nCleared ${count} sessions.`));
      break;
    }

    case '__SESSION_DIR__': {
      const dir = parts.slice(1).join(':');
      console.log(chalk.dim(`\nSessions directory: ${dir}`));
      break;
    }

    case '__SESSION_UNKNOWN_ACTION__': {
      const action = parts[1];
      console.log(chalk.yellow(`\nUnknown sessions action: ${action}`));
      console.log(chalk.dim('Usage: /sessions [list|delete <name>|info <name>|clear|dir]'));
      break;
    }

    case '__CONFIG_HELP__': {
      console.log(chalk.bold('\nUsage:'));
      console.log(chalk.dim('  /config <subcommand>'));
      console.log(chalk.bold('\nSubcommands:'));
      console.log(chalk.dim('  init      Create a starter config file'));
      console.log(chalk.dim('  show      Display the current effective configuration'));
      console.log(chalk.dim('  example   Print an example configuration'));
      console.log(chalk.bold('\nOptions:'));
      console.log(chalk.dim('  -h, --help  Show this help'));
      break;
    }

    case '__CONFIG_UNKNOWN_OPTION__': {
      const option = parts.slice(1).join(':');
      console.log(chalk.red(`\nUnknown option: ${option}`));
      console.log(chalk.dim('Run /config --help for usage.'));
      break;
    }

    default:
      console.log(chalk.dim(output));
  }
}

/**
 * Handle config command output messages.
 */
function handleConfigOutput(output: string): void {
  const parts = output.split(':');
  const type = parts[0];

  switch (type) {
    case '__CONFIG_INIT__': {
      const path = parts.slice(1).join(':');
      console.log(chalk.green(`\nCreated config file: ${path}`));
      console.log(chalk.dim('Edit this file to customize Codi for your project.'));
      break;
    }

    case '__CONFIG_INIT_FAILED__': {
      const error = parts.slice(1).join(':');
      console.log(chalk.red(`\nFailed to create config: ${error}`));
      break;
    }

    case '__CONFIG_NOT_FOUND__': {
      console.log(chalk.yellow('\nNo workspace configuration found.'));
      console.log(chalk.dim('Run /config init to create a .codi.json file.'));
      break;
    }

    case '__CONFIG_EXAMPLE__': {
      const example = parts.slice(1).join(':');
      console.log(chalk.bold('\nExample configuration (.codi.json):'));
      console.log(chalk.dim(example));
      break;
    }

    case '__CONFIG_SHOW__': {
      const configPath = parts[1];
      const warnings = JSON.parse(parts[2]) as string[];
      const configJson = parts.slice(3).join(':');

      console.log(chalk.bold('\nWorkspace Configuration:'));
      console.log(chalk.dim(`File: ${configPath}`));

      if (warnings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        for (const w of warnings) {
          console.log(chalk.yellow(`  - ${w}`));
        }
      }

      console.log(chalk.dim('\nCurrent settings:'));
      console.log(chalk.dim(configJson));
      break;
    }

    default:
      // Handle __INIT_RESULT__ separately since it uses | delimiter
      if (output.startsWith('__INIT_RESULT__|')) {
        handleInitOutput(output);
      } else {
        console.log(chalk.dim(output));
      }
  }
}

/**
 * Handle init command output messages.
 */
function handleInitOutput(output: string): void {
  const parts = output.split('|');
  // Skip first part (__INIT_RESULT__)
  const results = parts.slice(1);

  console.log(chalk.bold('\nCodi Initialization:'));

  let createdCount = 0;
  let existsCount = 0;

  for (const result of results) {
    const [fileType, status, filePath] = result.split(':');
    const fileNames: Record<string, string> = {
      config: '.codi.json',
      modelmap: 'codi-models.yaml',
      context: 'CODI.md',
    };
    const fileName = fileNames[fileType] || fileType;

    switch (status) {
      case 'created':
        console.log(chalk.green(`  ✓ Created ${fileName}`));
        console.log(chalk.dim(`    ${filePath}`));
        createdCount++;
        break;
      case 'exists':
        console.log(chalk.yellow(`  ○ ${fileName} already exists`));
        console.log(chalk.dim(`    ${filePath}`));
        existsCount++;
        break;
      case 'error':
        console.log(chalk.red(`  ✗ Failed to create ${fileName}: ${filePath}`));
        break;
    }
  }

  if (createdCount > 0) {
    console.log(chalk.dim('\nEdit these files to customize Codi for your project.'));
  } else if (existsCount > 0 && createdCount === 0) {
    console.log(chalk.dim('\nAll config files already exist.'));
  }
}

/**
 * Handle history command output messages.
 */
function handleHistoryOutput(output: string): void {
  const parts = output.split(':');
  const type = parts[0];

  switch (type) {
    case '__UNDO_NOTHING__': {
      console.log(chalk.yellow('\nNothing to undo.'));
      console.log(chalk.dim('No file changes recorded in history.'));
      break;
    }

    case '__UNDO_SUCCESS__': {
      const fileName = parts[1];
      const operation = parts[2];
      const description = parts.slice(3).join(':');
      console.log(chalk.green(`\nUndone: ${operation} ${fileName}`));
      console.log(chalk.dim(description));
      break;
    }

    case '__REDO_NOTHING__': {
      console.log(chalk.yellow('\nNothing to redo.'));
      console.log(chalk.dim('No undone changes to restore.'));
      break;
    }

    case '__REDO_SUCCESS__': {
      const fileName = parts[1];
      const operation = parts[2];
      const description = parts.slice(3).join(':');
      console.log(chalk.green(`\nRedone: ${operation} ${fileName}`));
      console.log(chalk.dim(description));
      break;
    }

    case '__HISTORY_EMPTY__': {
      console.log(chalk.dim('\nNo file changes recorded.'));
      console.log(chalk.dim('Changes will be tracked when you use write, edit, or patch operations.'));
      break;
    }

    case '__HISTORY_LIST__': {
      const undoCount = parts[1];
      const redoCount = parts[2];
      const lines = output.split('\n').slice(1);
      console.log(chalk.bold('\nFile Change History:'));
      console.log(chalk.dim(`  ${undoCount} undo, ${redoCount} redo available`));
      console.log();
      for (const line of lines) {
        if (line.includes('(undone)')) {
          console.log(chalk.dim(`  ${line}`));
        } else {
          console.log(`  ${line}`);
        }
      }
      break;
    }

    case '__HISTORY_FILE__': {
      const fileName = parts[1];
      const lines = output.split('\n').slice(1);
      console.log(chalk.bold(`\nHistory for ${fileName}:`));
      for (const line of lines) {
        console.log(chalk.dim(`  ${line}`));
      }
      break;
    }

    case '__HISTORY_FILE_EMPTY__': {
      const fileName = parts[1];
      console.log(chalk.dim(`\nNo history for ${fileName}`));
      break;
    }

    case '__HISTORY_CLEARED__': {
      const count = parts[1];
      console.log(chalk.green(`\nCleared ${count} history entries.`));
      break;
    }

    case '__HISTORY_DIR__': {
      const dir = parts.slice(1).join(':');
      console.log(chalk.dim(`\nHistory directory: ${dir}`));
      break;
    }

    case '__HISTORY_STATUS__': {
      const undoCount = parts[1];
      const redoCount = parts[2];
      console.log(chalk.bold('\nHistory Status:'));
      console.log(chalk.dim(`  Undo available: ${undoCount}`));
      console.log(chalk.dim(`  Redo available: ${redoCount}`));
      break;
    }

    default:
      console.log(chalk.dim(output));
  }
}

/**
 * Handle usage command output messages.
 */
function handleUsageOutput(output: string): void {
  const lines = output.split('\n');
  const firstLine = lines[0];
  const parts = firstLine.split(':');
  const type = parts[0];

  switch (type) {
    case '__USAGE_RESET__': {
      console.log(chalk.green('\nSession usage reset.'));
      break;
    }

    case '__USAGE_CLEARED__': {
      const count = parts[1];
      console.log(chalk.green(`\nCleared ${count} usage records.`));
      break;
    }

    case '__USAGE_PATH__': {
      const path = parts.slice(1).join(':');
      console.log(chalk.dim(`\nUsage file: ${path}`));
      break;
    }

    case '__USAGE_SESSION__': {
      const inputTokens = parseInt(parts[1], 10);
      const outputTokens = parseInt(parts[2], 10);
      const cost = parseFloat(parts[3]);
      const requests = parseInt(parts[4], 10);
      const startTime = parts[5];

      console.log(chalk.bold('\nCurrent Session Usage:'));
      console.log(`  Requests:       ${chalk.cyan(requests.toString())}`);
      console.log(`  Input tokens:   ${chalk.cyan(formatTokens(inputTokens))}`);
      console.log(`  Output tokens:  ${chalk.cyan(formatTokens(outputTokens))}`);
      console.log(`  Total tokens:   ${chalk.cyan(formatTokens(inputTokens + outputTokens))}`);
      console.log(`  Estimated cost: ${chalk.yellow(formatCost(cost))}`);
      console.log(chalk.dim(`  Started: ${new Date(startTime).toLocaleString()}`));
      break;
    }

    case '__USAGE_STATS__': {
      const period = parts[1];
      console.log(chalk.bold(`\n${period} Usage:`));

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const lineParts = line.split(':');
        const lineType = lineParts[0];

        if (lineType === 'total') {
          const inputTokens = parseInt(lineParts[1], 10);
          const outputTokens = parseInt(lineParts[2], 10);
          const cost = parseFloat(lineParts[3]);
          const requests = parseInt(lineParts[4], 10);

          console.log(`  ${chalk.bold('Total:')}`);
          console.log(`    Requests:       ${chalk.cyan(requests.toString())}`);
          console.log(`    Input tokens:   ${chalk.cyan(formatTokens(inputTokens))}`);
          console.log(`    Output tokens:  ${chalk.cyan(formatTokens(outputTokens))}`);
          console.log(`    Estimated cost: ${chalk.yellow(formatCost(cost))}`);
        } else if (lineType === 'provider') {
          const provider = lineParts[1];
          const inputTokens = parseInt(lineParts[2], 10);
          const outputTokens = parseInt(lineParts[3], 10);
          const cost = parseFloat(lineParts[4]);
          const requests = parseInt(lineParts[5], 10);

          console.log(`  ${chalk.bold(provider + ':')}`);
          console.log(`    ${requests} requests, ${formatTokens(inputTokens + outputTokens)} tokens, ${formatCost(cost)}`);
        } else if (lineType === 'model') {
          const model = lineParts[1];
          const inputTokens = parseInt(lineParts[2], 10);
          const outputTokens = parseInt(lineParts[3], 10);
          const cost = parseFloat(lineParts[4]);
          const requests = parseInt(lineParts[5], 10);

          console.log(chalk.dim(`    ${model}: ${requests} req, ${formatTokens(inputTokens + outputTokens)} tok, ${formatCost(cost)}`));
        }
      }
      break;
    }

    case '__USAGE_RECENT__': {
      console.log(chalk.bold('\nRecent Usage:'));
      for (let i = 1; i < lines.length; i++) {
        console.log(`  ${lines[i]}`);
      }
      break;
    }

    case '__USAGE_RECENT_EMPTY__': {
      console.log(chalk.dim('\nNo usage records found.'));
      break;
    }

    default:
      console.log(chalk.dim(output));
  }
}

/**
 * Handle plugin command output messages.
 */
function handlePluginOutput(output: string): void {
  const lines = output.split('\n');
  const firstLine = lines[0];
  const parts = firstLine.split(':');
  const type = parts[0];

  switch (type) {
    case '__PLUGINS_EMPTY__': {
      const pluginsDir = parts.slice(1).join(':');
      console.log(chalk.dim('\nNo plugins loaded.'));
      console.log(chalk.dim(`Plugin directory: ${pluginsDir}`));
      break;
    }

    case '__PLUGINS_DIR__': {
      const pluginsDir = parts.slice(1).join(':');
      console.log(chalk.dim(`\nPlugins directory: ${pluginsDir}`));
      break;
    }

    case '__PLUGINS_LIST__': {
      console.log(chalk.bold('\nLoaded Plugins:'));
      for (let i = 1; i < lines.length; i++) {
        const lineParts = lines[i].split(':');
        const name = lineParts[0];
        const version = lineParts[1];
        const toolCount = parseInt(lineParts[2], 10);
        const commandCount = parseInt(lineParts[3], 10);
        const providerCount = parseInt(lineParts[4], 10);

        console.log(`  ${chalk.cyan(name)} v${version}`);
        const features = [];
        if (toolCount > 0) features.push(`${toolCount} tools`);
        if (commandCount > 0) features.push(`${commandCount} commands`);
        if (providerCount > 0) features.push(`${providerCount} providers`);
        if (features.length > 0) {
          console.log(chalk.dim(`    ${features.join(', ')}`));
        }
      }
      break;
    }

    case '__PLUGIN_NOT_FOUND__': {
      const name = parts[1];
      console.log(chalk.yellow(`\nPlugin not found: ${name}`));
      console.log(chalk.dim('Use /plugins to list loaded plugins.'));
      break;
    }

    case '__PLUGIN_INFO__': {
      const name = parts[1];
      const version = parts[2];
      const description = parts[3] || '(no description)';
      const toolCount = parseInt(parts[4], 10);
      const commandCount = parseInt(parts[5], 10);
      const providerCount = parseInt(parts[6], 10);
      const pluginPath = parts[7];
      // ISO timestamp contains colons, so join remaining parts
      const loadedAt = parts.slice(8).join(':');

      console.log(chalk.bold(`\nPlugin: ${name}`));
      console.log(chalk.dim(`  Version: ${version}`));
      console.log(chalk.dim(`  Description: ${description}`));
      console.log(chalk.dim(`  Tools: ${toolCount}`));
      console.log(chalk.dim(`  Commands: ${commandCount}`));
      console.log(chalk.dim(`  Providers: ${providerCount}`));
      console.log(chalk.dim(`  Path: ${pluginPath}`));
      console.log(chalk.dim(`  Loaded at: ${new Date(loadedAt).toLocaleString()}`));
      break;
    }

    default:
      console.log(chalk.dim(output));
  }
}

/**
 * Handle models command output messages.
 */
function handleModelsOutput(output: string): void {
  const lines = output.split('\n');
  const notes: string[] = [];

  // First pass: collect notes
  for (const line of lines) {
    if (line.startsWith('note|')) {
      notes.push(line.slice(5));
    }
  }

  // Print header
  console.log(chalk.bold('\nAvailable Models:'));

  // Second pass: print models by provider
  for (const line of lines) {
    if (line === '__MODELS__') continue;

    if (line.startsWith('provider|')) {
      const providerName = line.slice(9);
      console.log();
      console.log(chalk.bold.cyan(providerName));
      console.log(chalk.dim('─'.repeat(75)));

      // Header row
      const header = `${'Model'.padEnd(30)} ${'Vision'.padEnd(8)} ${'Tools'.padEnd(8)} ${'Context'.padEnd(10)} ${'Input'.padEnd(10)} Output`;
      console.log(chalk.dim(header));
    } else if (line.startsWith('model|')) {
      const parts = line.slice(6).split('|');
      const id = parts[0];
      const name = parts[1];
      const vision = parts[2] === '1' ? chalk.green('✓') : chalk.red('✗');
      const tools = parts[3] === '1' ? chalk.green('✓') : chalk.red('✗');
      const contextWindow = parseInt(parts[4], 10);
      const inputPrice = parseFloat(parts[5]);
      const outputPrice = parseFloat(parts[6]);

      // Format context window
      let contextStr = '-';
      if (contextWindow > 0) {
        if (contextWindow >= 1000000) {
          contextStr = `${(contextWindow / 1000000).toFixed(1)}M`;
        } else if (contextWindow >= 1000) {
          contextStr = `${Math.round(contextWindow / 1000)}K`;
        } else {
          contextStr = contextWindow.toString();
        }
      }

      // Format pricing
      let inputStr = 'free';
      let outputStr = 'free';
      if (inputPrice > 0) {
        inputStr = `$${inputPrice.toFixed(2)}`;
      }
      if (outputPrice > 0) {
        outputStr = `$${outputPrice.toFixed(2)}`;
      }

      // Determine display name (use ID if shorter or same as name)
      const displayName = id.length <= 30 ? id : name;

      console.log(
        `${displayName.padEnd(30)} ${vision.padEnd(8 + vision.length - 1)} ${tools.padEnd(8 + tools.length - 1)} ${contextStr.padEnd(10)} ${inputStr.padEnd(10)} ${outputStr}`
      );
    }
  }

  // Print notes/warnings
  if (notes.length > 0) {
    console.log();
    for (const note of notes) {
      console.log(chalk.dim(`  ${note}`));
    }
  }

  console.log(chalk.dim('\n  Pricing is per million tokens (MTok)'));
}

/**
 * Handle switch command output messages.
 */
function handleSwitchOutput(output: string): void {
  const parts = output.split('|');
  const type = parts[0];

  switch (type) {
    case '__SWITCH_SUCCESS__': {
      const provider = parts[1];
      const model = parts[2];
      // Check for named model info (e.g., "named:haiku")
      const namedPart = parts.find(p => p.startsWith('named:'));
      const namedModel = namedPart ? namedPart.replace('named:', '') : null;

      if (namedModel) {
        console.log(chalk.green(`\nSwitched to ${chalk.bold(namedModel)} → ${provider} (${chalk.cyan(model)})`));
      } else {
        console.log(chalk.green(`\nSwitched to ${chalk.bold(provider)} (${chalk.cyan(model)})`));
      }
      break;
    }

    case '__SWITCH_ERROR__': {
      const message = parts.slice(1).join('|');
      console.log(chalk.red(`\nFailed to switch: ${message}`));
      break;
    }

    case '__SWITCH_CURRENT__': {
      const provider = parts[1];
      const model = parts[2];
      const availableProviders = parts[3];
      const namedModels = parts[4] || '';

      console.log(chalk.bold('\nCurrent Model:'));
      console.log(`  Provider: ${chalk.cyan(provider)}`);
      console.log(`  Model: ${chalk.cyan(model)}`);

      // Show named models from model map if available
      if (namedModels) {
        console.log(chalk.bold('\nNamed Models') + chalk.dim(' (from codi-models.yaml):'));
        console.log(`  ${chalk.cyan(namedModels)}`);
        console.log(chalk.dim('\nUsage: /switch <name>  (e.g., /switch haiku)'));
      }

      console.log(chalk.dim(`\nProviders: ${availableProviders}`));
      console.log(chalk.dim('Usage: /switch <provider> [model]'));
      break;
    }

    default:
      console.log(chalk.dim(output));
  }
}

/**
 * Handle modelmap command output messages.
 */
function handleModelMapOutput(output: string): void {
  const lines = output.split('\n');
  const firstLine = lines[0];

  if (firstLine === '__MODELMAP_NOTFOUND__') {
    console.log(chalk.yellow('\nNo model map configuration found.'));
    console.log(chalk.dim('Create codi-models.yaml with /modelmap init'));
    return;
  }

  if (firstLine.startsWith('__MODELMAP_ERROR__|')) {
    const error = firstLine.slice('__MODELMAP_ERROR__|'.length);
    console.log(chalk.red(`\nModel map error: ${error}`));
    return;
  }

  if (firstLine.startsWith('__MODELMAP_INVALID__|')) {
    const errors = firstLine.slice('__MODELMAP_INVALID__|'.length);
    console.log(chalk.red('\nModel map validation failed:'));
    console.log(chalk.red(`  ${errors}`));
    return;
  }

  if (firstLine.startsWith('__MODELMAP_INIT__|')) {
    const path = firstLine.slice('__MODELMAP_INIT__|'.length);
    console.log(chalk.green(`\nCreated model map: ${path}`));
    console.log(chalk.dim('Edit this file to configure multi-model orchestration.'));
    return;
  }

  if (firstLine.startsWith('__MODELMAP_EXAMPLE__|')) {
    const example = lines.slice(0).join('\n').slice('__MODELMAP_EXAMPLE__|'.length);
    console.log(chalk.bold('\nExample codi-models.yaml:'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log(chalk.dim(example));
    return;
  }

  if (firstLine === '__MODELMAP_SHOW__') {
    console.log(chalk.bold('\nModel Map Configuration:'));

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split('|');
      const type = parts[0];

      switch (type) {
        case 'path':
          console.log(chalk.dim(`File: ${parts[1]}`));
          break;
        case 'version':
          console.log(chalk.dim(`Version: ${parts[1]}`));
          console.log();
          break;
        case 'models':
          console.log(chalk.bold.cyan(`Models (${parts[1]}):`));
          break;
        case 'model':
          console.log(`  ${chalk.cyan(parts[1])}: ${parts[2]}/${parts[3]}${parts[4] ? chalk.dim(` - ${parts[4]}`) : ''}`);
          break;
        case 'tasks':
          console.log(chalk.bold.green(`\nTasks (${parts[1]}):`));
          break;
        case 'task':
          console.log(`  ${chalk.green(parts[1])}: → ${parts[2]}${parts[3] ? chalk.dim(` - ${parts[3]}`) : ''}`);
          break;
        case 'pipelines':
          if (parseInt(parts[1]) > 0) {
            console.log(chalk.bold.magenta(`\nPipelines (${parts[1]}):`));
          }
          break;
        case 'pipeline':
          console.log(`  ${chalk.magenta(parts[1])}: ${parts[2]} steps${parts[3] ? chalk.dim(` - ${parts[3]}`) : ''}`);
          break;
        case 'fallbacks':
          if (parseInt(parts[1]) > 0) {
            console.log(chalk.bold.yellow(`\nFallback Chains (${parts[1]}):`));
          }
          break;
        case 'fallback':
          console.log(`  ${chalk.yellow(parts[1])}: ${parts[2]}`);
          break;
        case 'commands':
          console.log(chalk.bold.blue(`\nCommand Overrides (${parts[1]}):`));
          break;
        case 'command':
          console.log(`  /${chalk.blue(parts[1])}: ${parts[2]} → ${parts[3]}`);
          break;
      }
    }

    console.log(chalk.dim('\nUse /modelmap example to see configuration format.'));
    return;
  }

  // Fallback
  console.log(output);
}

/**
 * Handle pipeline command output messages.
 * Note: __PIPELINE_EXECUTE__ is handled separately in the main loop.
 */
function handlePipelineOutput(output: string): void {
  const lines = output.split('\n');
  const firstLine = lines[0];

  if (firstLine.startsWith('__PIPELINE_ERROR__|')) {
    const error = firstLine.slice('__PIPELINE_ERROR__|'.length);
    console.log(chalk.red(`\nPipeline error: ${error}`));
    return;
  }

  if (firstLine === '__PIPELINE_LIST__') {
    console.log(chalk.bold('\nAvailable Pipelines:'));
    console.log();

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('|');
      if (parts[0] === 'pipeline') {
        const [, name, stepCount, modelsOrRoles, desc, defaultProvider] = parts;
        console.log(`  ${chalk.magenta.bold(name)}`);
        console.log(chalk.dim(`    ${stepCount} steps using: ${modelsOrRoles}`));
        if (defaultProvider) {
          console.log(chalk.dim(`    Default provider: ${defaultProvider}`));
        }
        if (desc) {
          console.log(chalk.dim(`    ${desc}`));
        }
        console.log();
      } else if (parts[0] === 'roles') {
        console.log(chalk.dim(`Available roles: ${parts[1]}`));
      }
    }

    console.log(chalk.dim('Run a pipeline with: /pipeline <name> <input>'));
    console.log(chalk.dim('Override provider with: /pipeline --provider <context> <name> <input>'));
    return;
  }

  if (firstLine.startsWith('__PIPELINE_INFO__|')) {
    const name = firstLine.slice('__PIPELINE_INFO__|'.length);
    console.log(chalk.bold.magenta(`\nPipeline: ${name}`));
    console.log();

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('|');
      const type = parts[0];

      switch (type) {
        case 'description':
          console.log(chalk.dim(`Description: ${parts[1]}`));
          break;
        case 'provider':
          console.log(chalk.dim(`Default provider: ${parts[1]}`));
          break;
        case 'steps':
          console.log(chalk.bold(`\nSteps (${parts[1]}):`));
          break;
        case 'step': {
          const modelOrRole = parts[2];
          const isRole = modelOrRole.startsWith('role:');
          const label = isRole ? 'role' : 'model';
          const value = isRole ? modelOrRole.slice(5) : modelOrRole;
          console.log(`  ${chalk.cyan(parts[1])} → ${label}: ${chalk.yellow(value)}, output: ${chalk.green(parts[3])}`);
          break;
        }
        case 'result':
          console.log(chalk.dim(`\nResult template: ${parts[1]}`));
          break;
        case 'usage':
          console.log(chalk.dim(`\n${parts[1]}`));
          break;
      }
    }
    return;
  }

  // Fallback
  console.log(output);
}

/**
 * Handle import command output messages.
 */
function handleImportOutput(output: string): void {
  // Check for simple prefixed outputs
  if (output.startsWith('__IMPORT_ERROR__|')) {
    const message = output.slice('__IMPORT_ERROR__|'.length);
    console.log(chalk.red(`\nImport error: ${message}`));
    return;
  }

  if (output.startsWith('__IMPORT_SUCCESS__')) {
    // Multi-line success output
    const lines = output.split('\n').slice(1); // Skip the marker
    console.log(chalk.green('\n' + lines[0])); // "Imported X conversations"
    for (const line of lines.slice(1)) {
      if (line.startsWith('✓')) {
        console.log(chalk.green(line));
      } else if (line.startsWith('✗')) {
        console.log(chalk.red(line));
      } else if (line.startsWith('Use /')) {
        console.log(chalk.dim(line));
      } else {
        console.log(line);
      }
    }
    return;
  }

  if (output.startsWith('__IMPORT_LIST__')) {
    // Multi-line list output
    const lines = output.split('\n').slice(1); // Skip the marker
    console.log(chalk.bold('\n' + lines[0])); // "Found X conversations"
    for (const line of lines.slice(1)) {
      if (line.startsWith('─')) {
        console.log(chalk.dim(line));
      } else if (line.startsWith('Use /')) {
        console.log(chalk.dim(line));
      } else if (line.match(/^\s*\d+\./)) {
        console.log(chalk.cyan(line));
      } else {
        console.log(line);
      }
    }
    return;
  }

  // Fallback
  console.log(output);
}

/**
 * Handle memory command output messages.
 */
function handleMemoryOutput(output: string): void {
  if (output.startsWith('__MEMORY_ERROR__|')) {
    const message = output.slice('__MEMORY_ERROR__|'.length);
    console.log(chalk.red(`\n${message}`));
    return;
  }

  if (output.startsWith('__MEMORY_ADDED__|')) {
    const parts = output.split('|');
    const content = parts[1];
    const category = parts[2];
    console.log(chalk.green(`\n✓ Remembered: ${content}`));
    if (category) {
      console.log(chalk.dim(`  Category: ${category}`));
    }
    return;
  }

  if (output.startsWith('__MEMORY_REMOVED__|')) {
    const parts = output.split('|');
    const count = parts[1];
    const pattern = parts[2];
    console.log(chalk.yellow(`\nRemoved ${count} memory(s) matching "${pattern}"`));
    return;
  }

  if (output.startsWith('__MEMORY_NOTFOUND__|')) {
    const pattern = output.slice('__MEMORY_NOTFOUND__|'.length);
    console.log(chalk.yellow(`\nNo memories found matching "${pattern}"`));
    return;
  }

  if (output.startsWith('__MEMORY_CLEARED__|')) {
    const count = output.slice('__MEMORY_CLEARED__|'.length);
    console.log(chalk.yellow(`\nCleared ${count} memories`));
    return;
  }

  if (output.startsWith('__MEMORY_CONSOLIDATED__|')) {
    const count = output.slice('__MEMORY_CONSOLIDATED__|'.length);
    if (count === '0') {
      console.log(chalk.dim('\nNo session notes to consolidate'));
    } else {
      console.log(chalk.green(`\n✓ Consolidated ${count} session notes into memories`));
    }
    return;
  }

  if (output.startsWith('__MEMORIES_LIST__|')) {
    const parts = output.split('|');
    const memories = JSON.parse(parts[1]);
    const filePath = parts[2];

    if (memories.length === 0) {
      console.log(chalk.dim('\nNo memories stored. Use /remember <fact> to add one.'));
    } else {
      console.log(chalk.bold(`\n${memories.length} memories:`));

      // Group by category
      const byCategory = new Map<string, Array<{ content: string; timestamp: string }>>();
      const uncategorized: Array<{ content: string; timestamp: string }> = [];

      for (const memory of memories) {
        if (memory.category) {
          const list = byCategory.get(memory.category) || [];
          list.push(memory);
          byCategory.set(memory.category, list);
        } else {
          uncategorized.push(memory);
        }
      }

      for (const [category, items] of byCategory) {
        console.log(chalk.cyan(`\n[${category}]`));
        for (const item of items) {
          console.log(chalk.dim(`  - ${item.content}`));
        }
      }

      if (uncategorized.length > 0) {
        if (byCategory.size > 0) console.log(chalk.cyan('\n[General]'));
        for (const item of uncategorized) {
          console.log(chalk.dim(`  - ${item.content}`));
        }
      }
    }

    console.log(chalk.dim(`\nStored in: ${filePath}`));
    return;
  }

  if (output.startsWith('__PROFILE_SHOW__|')) {
    const parts = output.split('|');
    const profile = JSON.parse(parts[1]);
    const filePath = parts[2];

    if (Object.keys(profile).length === 0) {
      console.log(chalk.dim('\nNo profile set. Use /profile set <key> <value> to add information.'));
    } else {
      console.log(chalk.bold('\nUser Profile:'));

      if (profile.name) {
        console.log(`  Name: ${chalk.cyan(profile.name)}`);
      }

      if (profile.preferences) {
        console.log('  Preferences:');
        for (const [key, value] of Object.entries(profile.preferences)) {
          if (value) console.log(`    ${key}: ${chalk.cyan(value)}`);
        }
      }

      if (profile.expertise && profile.expertise.length > 0) {
        console.log(`  Expertise: ${chalk.cyan(profile.expertise.join(', '))}`);
      }

      if (profile.avoid && profile.avoid.length > 0) {
        console.log(`  Avoid: ${chalk.yellow(profile.avoid.join(', '))}`);
      }
    }

    console.log(chalk.dim(`\nStored in: ${filePath}`));
    return;
  }

  if (output.startsWith('__PROFILE_UPDATED__|')) {
    const parts = output.split('|');
    const key = parts[1];
    const value = parts[2];
    console.log(chalk.green(`\n✓ Profile updated: ${key} = ${value}`));
    return;
  }

  // Fallback
  console.log(output);
}

/**
 * Handle compression command output.
 */
function handleCompressionOutput(output: string): void {
  if (output.startsWith('COMPRESS_ERROR:')) {
    const message = output.slice('COMPRESS_ERROR:'.length);
    console.log(chalk.red(`\n${message}`));
    return;
  }

  if (output.startsWith('COMPRESS_TOGGLE:')) {
    const state = output.slice('COMPRESS_TOGGLE:'.length);
    if (state === 'on') {
      console.log(chalk.green('\n✓ Context compression enabled'));
      console.log(chalk.dim('  Repeated entities will be replaced with short references to reduce token usage.'));
    } else {
      console.log(chalk.yellow('\n✓ Context compression disabled'));
    }
    return;
  }

  if (output.startsWith('COMPRESS_STATUS:')) {
    const data = JSON.parse(output.slice('COMPRESS_STATUS:'.length));
    console.log(chalk.bold('\nCompression Status:'));
    console.log(`  Enabled: ${data.enabled ? chalk.green('yes') : chalk.dim('no')}`);
    if (data.stats) {
      console.log(`  Last savings: ${chalk.cyan(data.stats.savings)} chars (${data.stats.savingsPercent.toFixed(1)}%)`);
      console.log(`  Entities tracked: ${chalk.cyan(data.stats.entityCount)}`);
    } else {
      console.log(chalk.dim('  No compression stats yet (need more conversation)'));
    }
    console.log(chalk.dim('\n  Use /compress on|off to toggle, /compress --preview for analysis'));
    return;
  }

  if (output.startsWith('COMPRESS_STATS:')) {
    const json = output.slice('COMPRESS_STATS:'.length);
    const data = JSON.parse(json);
    const stats = data.stats;

    const statusBadge = data.enabled
      ? chalk.green(' [ENABLED]')
      : chalk.dim(' [DISABLED]');
    console.log(chalk.bold('\n📊 Compression Analysis') + statusBadge + '\n');

    // Size stats
    console.log(chalk.dim('─'.repeat(50)));
    console.log(`  Original size:   ${chalk.cyan(stats.originalChars.toLocaleString())} chars`);
    console.log(`  Compressed size: ${chalk.cyan(stats.compressedChars.toLocaleString())} chars`);
    console.log(`  Legend overhead: ${chalk.yellow(stats.legendChars.toLocaleString())} chars`);
    console.log(`  Net size:        ${chalk.cyan(stats.netChars.toLocaleString())} chars`);
    console.log(chalk.dim('─'.repeat(50)));

    if (stats.savings > 0) {
      console.log(chalk.green(`  Savings:         ${stats.savings.toLocaleString()} chars (${stats.savingsPercent.toFixed(1)}%)`));
    } else {
      console.log(chalk.yellow(`  Savings:         ${stats.savings} chars (compression not beneficial)`));
    }

    console.log(`  Entities found:  ${chalk.cyan(stats.entityCount)}`);

    // Top entities
    if (stats.topEntities && stats.topEntities.length > 0) {
      console.log(chalk.bold('\n  Top Entities by Savings:'));
      for (const entity of stats.topEntities.slice(0, 5)) {
        const truncatedValue = entity.value.length > 40
          ? entity.value.slice(0, 37) + '...'
          : entity.value;
        console.log(`    ${chalk.cyan(entity.id)}: ${truncatedValue} ${chalk.dim(`(${entity.savings} chars saved)`)}`);
      }
    }

    // Preview if requested
    if (data.preview) {
      console.log(chalk.bold('\n  Entity Legend:'));
      const legendLines = data.preview.legend.split('\n').slice(0, 15);
      for (const line of legendLines) {
        console.log(`    ${chalk.dim(line)}`);
      }
      if (data.preview.legend.split('\n').length > 15) {
        console.log(chalk.dim('    ... (truncated)'));
      }
    }

    console.log('');
    return;
  }

  console.log(output);
}

/**
 * Handle compact command output.
 */
function handleCompactOutput(output: string): void {
  if (output.startsWith('COMPACT_ERROR:')) {
    const message = output.slice('COMPACT_ERROR:'.length);
    console.log(chalk.red(`\nCompaction failed: ${message}`));
    return;
  }

  if (output.startsWith('COMPACT_SKIP:')) {
    const data = JSON.parse(output.slice('COMPACT_SKIP:'.length));
    console.log(chalk.yellow(`\n${data.reason}`));
    console.log(chalk.dim(`  Current: ${data.current.tokens} tokens, ${data.current.messages} messages`));
    if (data.current.hasSummary) {
      console.log(chalk.dim('  (already has summary from previous compaction)'));
    }
    return;
  }

  if (output.startsWith('COMPACT_SUCCESS:')) {
    const data = JSON.parse(output.slice('COMPACT_SUCCESS:'.length));
    console.log(chalk.green(`\n✓ Compacted: ${data.before.tokens} → ${data.after.tokens} tokens`));
    console.log(chalk.dim(`  Messages: ${data.before.messages} → ${data.after.messages}`));
    console.log(chalk.dim(`  Saved: ${data.tokensSaved} tokens`));
    if (data.summary) {
      console.log(chalk.dim(`\nSummary: ${data.summary.slice(0, 200)}${data.summary.length > 200 ? '...' : ''}`));
    }
    return;
  }

  console.log(output);
}

/**
 * Handle approval command output.
 */
function handleApprovalOutput(output: string): void {
  const parts = output.split(':');
  const type = parts[0];

  switch (type) {
    case '__APPROVALS_LIST__': {
      const data = JSON.parse(parts.slice(1).join(':'));

      console.log(chalk.bold('\n=== Bash Command Approvals ==='));

      console.log(chalk.bold('\nApproved Command Patterns:'));
      if (data.patterns.length === 0) {
        console.log(chalk.dim('  No patterns configured'));
      } else {
        for (const p of data.patterns) {
          console.log(chalk.green(`  ${p.pattern}`));
          if (p.description) {
            console.log(chalk.dim(`    ${p.description}`));
          }
          console.log(chalk.dim(`    Added: ${new Date(p.approvedAt).toLocaleDateString()}`));
        }
      }

      console.log(chalk.bold('\nApproved Categories:'));
      if (data.categories.length === 0) {
        console.log(chalk.dim('  No categories configured'));
      } else {
        for (const c of data.categories) {
          console.log(chalk.green(`  ${c.name} (${c.id})`));
          console.log(chalk.dim(`    ${c.description}`));
        }
      }

      console.log(chalk.bold('\n=== File Path Approvals ==='));

      console.log(chalk.bold('\nApproved Path Patterns:'));
      if (!data.pathPatterns || data.pathPatterns.length === 0) {
        console.log(chalk.dim('  No path patterns configured'));
      } else {
        for (const p of data.pathPatterns) {
          const toolInfo = p.toolName === '*' ? '(all tools)' : `(${p.toolName})`;
          console.log(chalk.green(`  ${p.pattern} ${chalk.dim(toolInfo)}`));
          if (p.description) {
            console.log(chalk.dim(`    ${p.description}`));
          }
          console.log(chalk.dim(`    Added: ${new Date(p.approvedAt).toLocaleDateString()}`));
        }
      }

      console.log(chalk.bold('\nApproved Path Categories:'));
      if (!data.pathCategories || data.pathCategories.length === 0) {
        console.log(chalk.dim('  No path categories configured'));
      } else {
        for (const c of data.pathCategories) {
          console.log(chalk.green(`  ${c.name} (${c.id})`));
          console.log(chalk.dim(`    ${c.description}`));
        }
      }
      break;
    }

    case '__APPROVAL_CATEGORIES__': {
      const categories = JSON.parse(parts.slice(1).join(':'));
      console.log(chalk.bold('\nAvailable Command Categories:'));
      for (const c of categories) {
        console.log(chalk.cyan(`  ${c.id}`));
        console.log(chalk.white(`    ${c.name}`));
        console.log(chalk.dim(`    ${c.description}`));
      }
      break;
    }

    case '__APPROVAL_PATH_CATEGORIES__': {
      const pathCategories = JSON.parse(parts.slice(1).join(':'));
      console.log(chalk.bold('\nAvailable Path Categories:'));
      for (const c of pathCategories) {
        console.log(chalk.cyan(`  ${c.id}`));
        console.log(chalk.white(`    ${c.name}`));
        console.log(chalk.dim(`    ${c.description}`));
      }
      break;
    }

    case '__APPROVAL_ADDED__': {
      const [, addType, value] = parts;
      console.log(chalk.green(`\nAdded ${addType}: ${value}`));
      break;
    }

    case '__APPROVAL_REMOVED__': {
      const [, removeType, value] = parts;
      console.log(chalk.yellow(`\nRemoved ${removeType}: ${value}`));
      break;
    }

    case '__APPROVAL_NOT_FOUND__': {
      const [, notFoundType, value] = parts;
      console.log(chalk.dim(`\n${notFoundType} not found: ${value}`));
      break;
    }

    case '__APPROVAL_ERROR__': {
      console.log(chalk.red(`\nError: ${parts.slice(1).join(':')}`));
      break;
    }

    case '__APPROVAL_USAGE__': {
      console.log(chalk.yellow(`\nUsage: /approvals ${parts.slice(1).join(':')}`));
      break;
    }

    default:
      console.log(output);
  }
}

/**
 * Handle symbols command output messages.
 */
function handleSymbolsOutput(output: string): void {
  const parts = output.split(':');
  const type = parts[0];

  switch (type) {
    case '__SYMBOLS_REBUILD__': {
      const filesProcessed = parts[1];
      const symbolsExtracted = parts[2];
      const duration = parts[3];
      const errors = parts.slice(4).join(':');
      console.log(chalk.bold('\nSymbol Index Rebuilt'));
      console.log(chalk.green(`  Files: ${filesProcessed}`));
      console.log(chalk.green(`  Symbols: ${symbolsExtracted}`));
      console.log(chalk.dim(`  Duration: ${duration}s`));
      if (errors) {
        console.log(chalk.yellow(errors));
      }
      break;
    }

    case '__SYMBOLS_UPDATE__': {
      const added = parts[1];
      const modified = parts[2];
      const removed = parts[3];
      const duration = parts[4];
      console.log(chalk.bold('\nSymbol Index Updated'));
      if (added !== '0') console.log(chalk.green(`  Added: ${added} files`));
      if (modified !== '0') console.log(chalk.yellow(`  Modified: ${modified} files`));
      if (removed !== '0') console.log(chalk.red(`  Removed: ${removed} files`));
      if (added === '0' && modified === '0' && removed === '0') {
        console.log(chalk.dim('  No changes detected'));
      }
      console.log(chalk.dim(`  Duration: ${duration}s`));
      break;
    }

    case '__SYMBOLS_STATS__': {
      const stats = JSON.parse(parts.slice(1).join(':'));
      console.log(chalk.bold('\nSymbol Index Statistics'));
      console.log(`  Files: ${chalk.cyan(stats.totalFiles)}`);
      console.log(`  Symbols: ${chalk.cyan(stats.totalSymbols)}`);
      console.log(`  Imports: ${chalk.cyan(stats.totalImports)}`);
      console.log(`  Dependencies: ${chalk.cyan(stats.totalDependencies)}`);
      console.log(`  Size: ${chalk.dim(stats.sizeKb + ' KB')}`);
      if (stats.lastFullRebuild) {
        console.log(`  Last rebuild: ${chalk.dim(stats.lastFullRebuild)}`);
      }
      if (stats.lastUpdate) {
        console.log(`  Last update: ${chalk.dim(stats.lastUpdate)}`);
      }
      console.log(chalk.dim(`  Location: ${stats.indexDir}`));
      break;
    }

    case '__SYMBOLS_SEARCH__': {
      const query = parts[1];
      const results = JSON.parse(parts.slice(2).join(':'));
      console.log(chalk.bold(`\nSymbols matching "${query}":`));
      for (const r of results) {
        const visStr = r.visibility === 'internal' ? '' : chalk.dim(` [${r.visibility}]`);
        console.log(`  ${chalk.cyan(r.name)} (${r.kind})${visStr}`);
        console.log(chalk.dim(`    ${r.file}:${r.line}`));
        if (r.signature) {
          console.log(chalk.dim(`    ${r.signature}`));
        }
      }
      break;
    }

    case '__SYMBOLS_SEARCH_EMPTY__': {
      const query = parts[1];
      console.log(chalk.yellow(`\nNo symbols found matching "${query}".`));
      console.log(chalk.dim('Try a different search term or run /symbols rebuild to index the codebase.'));
      break;
    }

    case '__SYMBOLS_CLEAR__': {
      console.log(chalk.green('\nSymbol index cleared.'));
      console.log(chalk.dim('Run /symbols rebuild to create a new index.'));
      break;
    }

    case '__SYMBOLS_CLEAR_NOT_FOUND__': {
      console.log(chalk.dim('\nNo symbol index to clear.'));
      break;
    }

    case '__SYMBOLS_UNKNOWN__': {
      const action = parts[1];
      console.log(chalk.red(`\nUnknown action: ${action}`));
      console.log(chalk.dim('Usage: /symbols [rebuild|update|stats|search <name>|clear]'));
      break;
    }

    case '__SYMBOLS_ERROR__': {
      console.log(chalk.red(`\n${parts.slice(1).join(':')}`));
      break;
    }

    default:
      console.log(output);
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
    console.warn(chalk.yellow(`Model map error: ${err instanceof Error ? err.message : err}`));
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
    console.warn(chalk.yellow('Invalid --context-window value; expected a positive number.'));
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
    localConfig
  );

  // Register tools and commands
  registerDefaultTools();
  registerCodeCommands();
  registerPromptCommands();
  registerWorkflowCommands();
  registerGitCommands();
  registerSessionCommands();
  registerConfigCommands();
  registerCodiCommands();
  registerHistoryCommands();
  registerPlanCommands();
  registerUsageCommands();
  registerPluginCommands();
  registerModelCommands();
  registerMemoryCommands();
  registerCompactCommands();
  registerRAGCommands();
  registerApprovalCommands();
  registerSymbolCommands();
  registerMCPCommands();

  // Plugin system disabled pending further investigation
  // See: https://github.com/laynepenney/codi/issues/17
  // const loadedPlugins = await loadPluginsFromDirectory();
  // if (loadedPlugins.length > 0) {
  //   console.log(chalk.dim(`Plugins: ${loadedPlugins.length} loaded (${loadedPlugins.map(p => p.plugin.name).join(', ')})`));
  // }

  // Initialize MCP clients if configured and not disabled
  let mcpManager: MCPClientManager | null = null;
  if (options.mcp !== false && workspaceConfig?.mcpServers) {
    const serverConfigs = Object.entries(workspaceConfig.mcpServers)
      .filter(([_, config]) => config.enabled !== false);

    if (serverConfigs.length > 0) {
      mcpManager = new MCPClientManager();
      let connectedCount = 0;

      for (const [name, config] of serverConfigs) {
        try {
          await mcpManager.connect({
            name,
            command: config.command,
            args: config.args,
            env: config.env,
            cwd: config.cwd,
          });
          connectedCount++;
        } catch (err) {
          console.error(chalk.yellow(`MCP '${name}': ${err instanceof Error ? err.message : err}`));
        }
      }

      if (connectedCount > 0) {
        // Get tools from MCP servers and register them
        const mcpTools = await mcpManager.getAllTools();
        for (const tool of mcpTools) {
          globalRegistry.register(tool);
        }
        console.log(chalk.dim(`MCP: ${connectedCount} server(s), ${mcpTools.length} tool(s)`));
      }
    }
  }

  // Initialize RAG system (enabled by default unless explicitly disabled)
  let ragIndexer: BackgroundIndexer | null = null;
  let ragRetriever: Retriever | null = null;
  let ragEmbeddingProvider: import('./rag/embeddings/base.js').BaseEmbeddingProvider | null = null;

  // RAG is enabled by default - only skip if explicitly disabled
  const ragEnabled = workspaceConfig?.rag?.enabled !== false;

  if (ragEnabled) {
    try {
      // Build RAG config from workspace config (or use defaults)
      const ragConfig: RAGConfig = {
        ...DEFAULT_RAG_CONFIG,
        enabled: true,
        embeddingProvider: workspaceConfig?.rag?.embeddingProvider ?? DEFAULT_RAG_CONFIG.embeddingProvider,
        openaiModel: workspaceConfig?.rag?.openaiModel ?? DEFAULT_RAG_CONFIG.openaiModel,
        ollamaModel: workspaceConfig?.rag?.ollamaModel ?? DEFAULT_RAG_CONFIG.ollamaModel,
        ollamaBaseUrl: workspaceConfig?.rag?.ollamaBaseUrl ?? DEFAULT_RAG_CONFIG.ollamaBaseUrl,
        topK: workspaceConfig?.rag?.topK ?? DEFAULT_RAG_CONFIG.topK,
        minScore: workspaceConfig?.rag?.minScore ?? DEFAULT_RAG_CONFIG.minScore,
        includePatterns: workspaceConfig?.rag?.includePatterns ?? DEFAULT_RAG_CONFIG.includePatterns,
        excludePatterns: workspaceConfig?.rag?.excludePatterns ?? DEFAULT_RAG_CONFIG.excludePatterns,
        autoIndex: workspaceConfig?.rag?.autoIndex ?? DEFAULT_RAG_CONFIG.autoIndex,
        watchFiles: workspaceConfig?.rag?.watchFiles ?? DEFAULT_RAG_CONFIG.watchFiles,
        parallelJobs: workspaceConfig?.rag?.parallelJobs,
      };

      ragEmbeddingProvider = createEmbeddingProvider(ragConfig);
      console.log(chalk.dim(`RAG: ${ragEmbeddingProvider.getName()} (${ragEmbeddingProvider.getModel()})`));

      ragIndexer = new BackgroundIndexer(process.cwd(), ragEmbeddingProvider, ragConfig);
      ragRetriever = new Retriever(process.cwd(), ragEmbeddingProvider, ragConfig);

      // Share vector store between indexer and retriever
      ragRetriever.setVectorStore(ragIndexer.getVectorStore());

      // Initialize asynchronously
      ragIndexer.initialize().catch((err) => {
        console.error(chalk.red(`RAG indexer error: ${err.message}`));
      });

      // Set up progress callback using spinner for clean single-line output
      ragIndexer.onProgress = (current, total, file) => {
        if (current === 1 || current === total || current % 10 === 0) {
          spinner.indexing(current, total, file.slice(0, 40));
        }
      };
      ragIndexer.onComplete = (stats) => {
        spinner.indexingDone(stats.totalFiles, stats.totalChunks);
      };
      ragIndexer.onError = (error) => {
        spinner.fail(chalk.red(`RAG indexer: ${error.message}`));
      };

      // Register with commands and tool
      setRAGIndexer(ragIndexer);
      setRAGConfig(ragConfig);
      registerRAGSearchTool(ragRetriever);
    } catch (err) {
      // Gracefully handle missing embedding provider
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('No embedding provider') || errMsg.includes('OPENAI_API_KEY') || errMsg.includes('Ollama')) {
        console.log(chalk.dim(`RAG: disabled (no embedding provider available)`));
      } else {
        console.error(chalk.red(`Failed to initialize RAG: ${errMsg}`));
      }
    }
  }

  // Initialize Symbol Index for AST-based navigation tools
  try {
    const symbolIndexService = new SymbolIndexService(process.cwd());
    await symbolIndexService.initialize();
    setSymbolIndexService(symbolIndexService);
    registerSymbolIndexTools(symbolIndexService);

    // Show status if index exists
    if (symbolIndexService.hasIndex()) {
      const stats = symbolIndexService.getStats();
      console.log(chalk.dim(`Symbol index: ${stats.totalSymbols} symbols in ${stats.totalFiles} files`));
    }
  } catch (err) {
    // Non-fatal - symbol tools just won't be available
    console.error(chalk.yellow(`Symbol index: ${err instanceof Error ? err.message : err}`));
  }

  const useTools = !resolvedConfig.noTools; // Disabled via config or --no-tools

  if (useTools) {
    console.log(chalk.dim(`Tools: ${globalRegistry.listTools().length} registered`));
    if (resolvedConfig.autoApprove.length > 0) {
      console.log(chalk.dim(`Auto-approve: ${resolvedConfig.autoApprove.join(', ')}`));
    }
  } else {
    console.log(chalk.yellow('Tools: disabled (--no-tools mode)'));
  }
  console.log(chalk.dim(`Commands: ${getAllCommands().length} available`));

  // Create provider using resolved config
  let provider;
  if (resolvedConfig.provider === 'auto') {
    provider = detectProvider();
  } else {
    provider = createProvider({
      type: resolvedConfig.provider,
      model: resolvedConfig.model,
      baseUrl: resolvedConfig.baseUrl,
      endpointId: resolvedConfig.endpointId,
      cleanHallucinatedTraces: resolvedConfig.cleanHallucinatedTraces,
    });
  }

  console.log(chalk.dim(`Model: ${provider.getName()} (${provider.getModel()})`));

  // Show audit log path if enabled
  if (auditLogger.isEnabled()) {
    console.log(chalk.dim(`Audit log: ${auditLogger.getLogFile()}`));
    auditLogger.sessionStart(provider.getName(), provider.getModel(), process.cwd(), process.argv.slice(2));
  }

  // Create secondary provider for summarization if configured
  let secondaryProvider = null;
  if (resolvedConfig.summarizeProvider || resolvedConfig.summarizeModel) {
    secondaryProvider = createSecondaryProvider({
      provider: resolvedConfig.summarizeProvider,
      model: resolvedConfig.summarizeModel,
    });
    if (secondaryProvider) {
      console.log(chalk.dim(`Summarize model: ${secondaryProvider.getName()} (${secondaryProvider.getModel()})`));
    }
  }
  console.log();

  // Enable bracketed paste mode for better paste detection
  enableBracketedPaste();

  // Create paste interceptor to capture paste markers before readline strips them
  const pasteInterceptor = createPasteInterceptor();
  process.stdin.pipe(pasteInterceptor);

  // Create readline interface with history and tab completion
  const history = loadHistory();
  const completer = createCompleter();
  const rl = createInterface({
    input: pasteInterceptor, // Use interceptor instead of raw stdin
    output: process.stdout,
    history,
    historySize: MAX_HISTORY_SIZE,
    terminal: true,
    prompt: chalk.bold.cyan('\nYou: '),
    completer,
  });

  // Track if readline is closed (for piped input)
  let rlClosed = false;
  rl.on('close', () => {
    rlClosed = true;
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
    console.log(chalk.dim('\nGoodbye!'));
    process.exit(0);
  });

  // Handle readline errors
  rl.on('error', (err) => {
    logger.error(`Readline error: ${err.message}`, err);
  });

  // Session name tracking for prompt display
  let currentSession: string | null = null;

  // Command context for slash commands (will be updated with agent after creation)
  const commandContext: CommandContext = {
    projectInfo,
    setSessionName: (name: string | null) => {
      currentSession = name;
      setCurrentSessionName(name);
      if (commandContext.sessionState) {
        commandContext.sessionState.currentName = name;
      }
    },
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
  const memoryContext = generateMemoryContext(process.cwd());
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

  // Track if we've received streaming output (to manage spinner)
  let isStreaming = false;
  let isReasoningStreaming = false;

  // Track tool start times for duration logging
  const toolStartTimes = new Map<string, number>();

  // Create agent with enhanced system prompt
  const agent = new Agent({
    provider,
    secondaryProvider,
    modelMap,
    auditLogger: auditLogger.isEnabled() ? auditLogger : null,
    toolRegistry: globalRegistry,
    systemPrompt,
    useTools,
    extractToolsFromText: resolvedConfig.extractToolsFromText,
    autoApprove: resolvedConfig.autoApprove.length > 0 ? resolvedConfig.autoApprove : options.yes,
    approvedPatterns: resolvedConfig.approvedPatterns,
    approvedCategories: resolvedConfig.approvedCategories,
    approvedPathPatterns: resolvedConfig.approvedPathPatterns,
    approvedPathCategories: resolvedConfig.approvedPathCategories,
    customDangerousPatterns,
    logLevel,
    enableCompression: options.compress ?? resolvedConfig.enableCompression,
    maxContextTokens: resolvedConfig.maxContextTokens,
    onText: (text) => {
      // Stop spinner when we start receiving text
      if (!isStreaming) {
        isStreaming = true;
        spinner.stop();
      }
      process.stdout.write(text);
    },
    onReasoning: (reasoning) => {
      spinner.stop();
      console.log(chalk.dim.italic('\n💭 Thinking...'));
      console.log(chalk.dim(reasoning));
      console.log(chalk.dim.italic('---\n'));
    },
    onReasoningChunk: (chunk) => {
      if (!isReasoningStreaming) {
        isReasoningStreaming = true;
        spinner.stop();
        console.log(chalk.dim.italic('\n💭 Thinking...'));
      }
      process.stdout.write(chalk.dim(chunk));
    },
    onToolCall: (name, input) => {
      // Stop any spinner and record start time
      spinner.stop();
      isStreaming = false;
      const toolId = `tool_${Date.now()}`;
      toolStartTimes.set(name, Date.now());

      // Audit log
      auditLogger.toolCall(name, input as Record<string, unknown>, toolId);

      // Log tool input based on verbosity level
      if (logLevel >= LogLevel.VERBOSE) {
        logger.toolInput(name, input as Record<string, unknown>);
      } else {
        // Normal mode: show simple tool call info
        console.log(chalk.yellow(`\n\n📎 ${name}`));
        const preview = JSON.stringify(input);
        console.log(chalk.dim(preview.length > 100 ? preview.slice(0, 100) + '...' : preview));
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
    },
    onConfirm: async (confirmation) => {
      // Stop spinner during confirmation
      spinner.stop();

      console.log('\n' + formatConfirmation(confirmation));

      // File tools that support path-based approval
      const FILE_TOOLS = new Set(['write_file', 'edit_file', 'insert_line', 'patch_file']);

      // Use extended prompt for bash commands or file tools with suggestions
      const hasApprovalSuggestions = confirmation.approvalSuggestions &&
        (confirmation.toolName === 'bash' || FILE_TOOLS.has(confirmation.toolName));

      if (hasApprovalSuggestions) {
        const result = await promptConfirmationWithSuggestions(rl, confirmation);

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

      const result = await promptConfirmation(rl, promptText);
      return result;
    },
  });

  // Add agent and session state to command context
  commandContext.agent = agent;
  commandContext.sessionState = {
    currentName: null,
    provider: provider.getName(),
    model: provider.getModel(),
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

  // Deprecated: setSessionAgent is now a no-op
  // Agent reference is passed via commandContext

  // Load session from command line or config default
  const sessionToLoad = options.session || resolvedConfig.defaultSession;
  if (sessionToLoad) {
    const session = loadSession(sessionToLoad);
    if (session) {
      agent.loadSession(session.messages, session.conversationSummary);
      currentSession = session.name;
      setCurrentSessionName(session.name);
      if (commandContext.sessionState) {
        commandContext.sessionState.currentName = session.name;
      }
      console.log(chalk.green(`Loaded session: ${session.name} (${session.messages.length} messages)`));
      if (session.conversationSummary) {
        console.log(chalk.dim('Session has conversation summary from previous compaction.'));
      }
    } else {
      console.log(chalk.yellow(`Session not found: ${sessionToLoad}`));
    }
  }

  /**
   * Handle a single line of user input.
   */
  const handleInput = async (input: string) => {
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Save to history file
    saveToHistory(trimmed);

    // Audit log user input
    auditLogger.userInput(trimmed);

    // Handle ! prefix for direct shell commands
    if (trimmed.startsWith('!')) {
      const shellCommand = trimmed.slice(1).trim();
      if (!shellCommand) {
        console.log(chalk.dim('Usage: !<command> - run a shell command directly'));
        rl.prompt();
        return;
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
        rl.prompt();
      });

      child.on('error', (err) => {
        console.log(chalk.red(`Error: ${err.message}`));
        rl.prompt();
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
      rl.prompt();
      return;
    }

    // Handle built-in commands
    if (trimmed === '/exit' || trimmed === '/quit') {
      console.log(chalk.dim('\nGoodbye!'));
      // Log session end
      auditLogger.sessionEnd();
      // Cleanup MCP connections
      if (mcpManager) {
        await mcpManager.disconnectAll();
      }
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/clear') {
      agent.clearHistory();
      console.log(chalk.dim('Conversation cleared.'));
      rl.prompt();
      return;
    }

    if (trimmed === '/help') {
      showHelp(projectInfo);
      rl.prompt();
      return;
    }

    if (trimmed === '/context') {
      if (projectInfo) {
        console.log(chalk.bold('\nProject Context:'));
        console.log(formatProjectContext(projectInfo));
      } else {
        console.log(chalk.dim('\nNo project detected in current directory.'));
      }
      rl.prompt();
      return;
    }

    if (trimmed === '/status') {
      const info = agent.getContextInfo();
      const usedPercent = Math.min(100, (info.tokens / info.contextWindow) * 100);
      const budgetPercent = (info.maxTokens / info.contextWindow) * 100;

      console.log(chalk.bold('\n📊 Context Status'));
      console.log(chalk.dim('─'.repeat(50)));

      // Visual bar for context usage
      const barWidth = 40;
      const usedWidth = Math.round((usedPercent / 100) * barWidth);
      const budgetWidth = Math.round((budgetPercent / 100) * barWidth);
      const bar = chalk.green('█'.repeat(Math.min(usedWidth, budgetWidth))) +
                  chalk.yellow('█'.repeat(Math.max(0, usedWidth - budgetWidth))) +
                  chalk.dim('░'.repeat(Math.max(0, barWidth - usedWidth)));

      console.log(`\n  ${bar} ${usedPercent.toFixed(1)}%`);
      console.log(chalk.dim(`  ${formatTokens(info.tokens)} / ${formatTokens(info.contextWindow)} tokens`));

      // Token breakdown
      console.log(chalk.bold('\n  Token Breakdown:'));
      console.log(chalk.cyan(`    Messages:     ${formatTokens(info.messageTokens).padStart(8)}`));
      console.log(chalk.blue(`    System:       ${formatTokens(info.systemPromptTokens).padStart(8)}`));
      console.log(chalk.magenta(`    Tools:        ${formatTokens(info.toolDefinitionTokens).padStart(8)}`));
      console.log(chalk.dim(`    ─────────────────────`));
      console.log(chalk.white(`    Total:        ${formatTokens(info.tokens).padStart(8)}`));

      // Budget info
      console.log(chalk.bold('\n  Context Budget:'));
      console.log(chalk.dim(`    Window:       ${formatTokens(info.contextWindow).padStart(8)}  (${info.tierName} tier)`));
      console.log(chalk.dim(`    Output rsv:   ${formatTokens(info.outputReserve).padStart(8)}`));
      console.log(chalk.dim(`    Safety:       ${formatTokens(info.safetyBuffer).padStart(8)}`));
      console.log(chalk.green(`    Available:    ${formatTokens(info.maxTokens).padStart(8)}`));

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
      rl.prompt();
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

            const result = await command.execute(parsed.args, commandContext);

            if (needsSpinner) {
              spinner.stop();
            }
            if (result) {
              // Handle session command outputs (special format)
              if (result.startsWith('__SESSION_')) {
                handleSessionOutput(result);
                rl.prompt();
                return;
              }
              // Handle config command outputs
              if (result.startsWith('__CONFIG_') || result.startsWith('__INIT_RESULT__')) {
                handleConfigOutput(result);
                rl.prompt();
                return;
              }
              // Handle history command outputs
              if (result.startsWith('__UNDO_') || result.startsWith('__REDO_') || result.startsWith('__HISTORY_')) {
                handleHistoryOutput(result);
                rl.prompt();
                return;
              }
              // Handle usage command outputs
              if (result.startsWith('__USAGE_')) {
                handleUsageOutput(result);
                rl.prompt();
                return;
              }
              // Handle plugin command outputs
              if (result.startsWith('__PLUGIN')) {
                handlePluginOutput(result);
                rl.prompt();
                return;
              }
              // Handle models command outputs
              if (result.startsWith('__MODELS__')) {
                handleModelsOutput(result);
                rl.prompt();
                return;
              }
              // Handle switch command outputs
              if (result.startsWith('__SWITCH_')) {
                handleSwitchOutput(result);
                // Update session state on successful switch
                if (result.startsWith('__SWITCH_SUCCESS__') && commandContext.sessionState) {
                  const switchParts = result.split('|');
                  commandContext.sessionState.provider = switchParts[1];
                  commandContext.sessionState.model = switchParts[2];
                }
                rl.prompt();
                return;
              }
              // Handle modelmap command outputs
              if (result.startsWith('__MODELMAP_')) {
                handleModelMapOutput(result);
                rl.prompt();
                return;
              }
              // Handle pipeline command outputs
              if (result.startsWith('__PIPELINE_')) {
                // Special case: actually execute the pipeline
                if (result.startsWith('__PIPELINE_EXECUTE__|')) {
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
                    rl.prompt();
                    return;
                  }

                  const pipeline = modelMap.config.pipelines?.[pipelineName];
                  if (!pipeline) {
                    console.log(chalk.red(`\nPipeline error: Unknown pipeline "${pipelineName}"`));
                    rl.prompt();
                    return;
                  }

                  const effectiveProvider = providerContext || pipeline.provider || 'openai';

                  // Handle iterative mode
                  if (iterativeMode) {
                    const files = await resolveFileList(input);

                    if (files.length === 0) {
                      console.log(chalk.red(`\nNo files found matching: ${input}`));
                      rl.prompt();
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
                          rl.prompt();
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

                    rl.prompt();
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

                  rl.prompt();
                  return;
                }

                // Other pipeline outputs (list, info, error)
                handlePipelineOutput(result);
                rl.prompt();
                return;
              }
              // Handle import command outputs
              if (result.startsWith('__IMPORT_')) {
                handleImportOutput(result);
                rl.prompt();
                return;
              }
              // Handle memory command outputs
              if (result.startsWith('__MEMORY_') || result.startsWith('__MEMORIES_') || result.startsWith('__PROFILE_')) {
                handleMemoryOutput(result);
                rl.prompt();
                return;
              }
              // Handle compression command outputs
              if (result.startsWith('COMPRESS_')) {
                handleCompressionOutput(result);
                rl.prompt();
                return;
              }
              // Handle compact command outputs
              if (result.startsWith('COMPACT_')) {
                handleCompactOutput(result);
                rl.prompt();
                return;
              }
              // Handle approval command outputs
              if (result.startsWith('__APPROVAL')) {
                handleApprovalOutput(result);
                rl.prompt();
                return;
              }
              // Handle symbols command outputs
              if (result.startsWith('__SYMBOLS_')) {
                handleSymbolsOutput(result);
                rl.prompt();
                return;
              }
              // Clear history for slash commands - they should start fresh
              agent.clearHistory();

              // Check if command has a pipeline override in model map
              const modelMap = agent.getModelMap();
              if (modelMap) {
                try {
                  const routing = modelMap.router.routeCommand(command.name);
                  if (routing.type === 'pipeline') {
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
                    rl.prompt();
                    return;
                  }
                } catch (routingError) {
                  // Routing failed, fall through to normal chat
                  logger.debug(`Command routing failed: ${routingError instanceof Error ? routingError.message : String(routingError)}`);
                }
              }

              // Command returned a prompt - send to agent
              console.log(chalk.bold.magenta('\nAssistant: '));
              isStreaming = false;
              spinner.thinking();
              const startTime = Date.now();
              await agent.chat(result, { taskType: command.taskType });
              if (isReasoningStreaming) {
                console.log(chalk.dim.italic('\n---\n'));
                isReasoningStreaming = false;
              }
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              console.log(chalk.dim(`\n(${elapsed}s)`));
            }
          } catch (error) {
            spinner.stop();
            logger.error(`Command error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error : undefined);
          }
          rl.prompt();
          return;
        } else {
          console.log(chalk.yellow(`Unknown command: /${parsed.name}. Type /help for available commands.`));
          rl.prompt();
          return;
        }
      }
    }

    // Regular message - send to agent
    console.log(chalk.bold.magenta('\nAssistant: '));
    isStreaming = false;
    spinner.thinking();

    try {
      const startTime = Date.now();
      await agent.chat(trimmed);
      if (isReasoningStreaming) {
        console.log(chalk.dim.italic('\n---\n'));
        isReasoningStreaming = false;
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(chalk.dim(`\n(${elapsed}s)`));
    } catch (error) {
      spinner.stop();
      logger.error(error instanceof Error ? error.message : String(error), error instanceof Error ? error : undefined);
    }

    rl.prompt();
  };

  // Paste detection via debouncing
  // When lines arrive rapidly (within debounce window), they're buffered
  // Line handler that checks for pasted content
  const onLine = (line: string) => {
    if (rlClosed) return;

    // Check if there's pending paste content (captured by PasteInterceptor)
    const pastedContent = consumePendingPaste();
    if (pastedContent !== null) {
      // Use the full paste content instead of the empty line
      handleInput(pastedContent);
    } else {
      // Normal typed input
      handleInput(line);
    }
  };

  // Set up line handler for REPL
  rl.on('line', onLine);

  console.log(chalk.dim('Type /help for commands, /exit to quit.\n'));
  rl.prompt();
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

main().catch(console.error);
