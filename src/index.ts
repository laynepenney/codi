#!/usr/bin/env node

import { createInterface, type Interface } from 'readline';
import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, appendFileSync, existsSync, statSync } from 'fs';
import { glob } from 'node:fs/promises';
import { homedir } from 'os';
import { join } from 'path';

// History configuration
const HISTORY_FILE = join(homedir(), '.codi_history');
const MAX_HISTORY_SIZE = 1000;

/**
 * Load command history from file.
 * Returns array with most recent entries first (required by readline).
 */
function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const content = readFileSync(HISTORY_FILE, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      // Return most recent entries first (readline expects newest at index 0)
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
import { detectProject, formatProjectContext } from './context.js';
import {
  isCommand,
  parseCommand,
  getCommand,
  getAllCommands,
  type CommandContext,
  type ProjectInfo,
} from './commands/index.js';
import { registerCodeCommands } from './commands/code-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerGitCommands } from './commands/git-commands.js';
import {
  registerSessionCommands,
  setSessionAgent,
  getCurrentSessionName,
  setCurrentSessionName,
} from './commands/session-commands.js';
import { registerConfigCommands } from './commands/config-commands.js';
import { registerHistoryCommands } from './commands/history-commands.js';
import { registerUsageCommands } from './commands/usage-commands.js';
import { registerPluginCommands } from './commands/plugin-commands.js';
import { registerModelCommands } from './commands/model-commands.js';
import { registerImportCommands } from './commands/import-commands.js';
import { registerMemoryCommands } from './commands/memory-commands.js';
import { registerCompressionCommands } from './commands/compression-commands.js';
import { registerRAGCommands, setRAGIndexer, setRAGConfig } from './commands/rag-commands.js';
import { generateMemoryContext, consolidateSessionNotes } from './memory.js';
import {
  BackgroundIndexer,
  Retriever,
  createEmbeddingProvider,
  DEFAULT_RAG_CONFIG,
  type RAGConfig,
} from './rag/index.js';
import { registerRAGSearchTool } from './tools/index.js';
import { formatCost, formatTokens } from './usage.js';
import { loadPluginsFromDirectory, getPluginsDir } from './plugins.js';
import { loadSession } from './session.js';
import {
  loadWorkspaceConfig,
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

// CLI setup
program
  .name('codi')
  .description('Your AI coding wingman')
  .version(VERSION, '-v, --version', 'Output the current version')
  .option('-p, --provider <type>', 'Provider to use (anthropic, openai, ollama, ollama-native, runpod)', 'auto')
  .option('-m, --model <name>', 'Model to use')
  .option('--base-url <url>', 'Base URL for API (for self-hosted models)')
  .option('--endpoint-id <id>', 'Endpoint ID (for RunPod serverless)')
  .option('--no-tools', "Disable tool use (for models that don't support it)")
  .option('-y, --yes', 'Auto-approve all tool operations (skip confirmation prompts)')
  .option('--verbose', 'Show detailed tool information')
  .option('--debug', 'Show API and context details')
  .option('--trace', 'Show full request/response payloads')
  .option('-s, --session <name>', 'Load a saved session on startup')
  .option('-c, --compress', 'Enable context compression (reduces token usage)')
  .option('--summarize-model <name>', 'Model to use for summarization (default: primary model)')
  .option('--summarize-provider <type>', 'Provider for summarization model (default: primary provider)')
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

## Available Tools (use ONLY these exact parameter names)

| Tool | Parameters | Example |
|------|------------|---------|
| read_file | path | {"name":"read_file","arguments":{"path":"src/index.ts"}} |
| write_file | path, content | {"name":"write_file","arguments":{"path":"file.ts","content":"..."}} |
| insert_line | path, line, content | {"name":"insert_line","arguments":{"path":"file.ts","line":5,"content":"// comment"}} |
| edit_file | path, old_string, new_string | {"name":"edit_file","arguments":{"path":"file.ts","old_string":"old","new_string":"new"}} |
| glob | pattern | {"name":"glob","arguments":{"pattern":"src/**/*.ts"}} |
| grep | pattern, path (optional) | {"name":"grep","arguments":{"pattern":"TODO","path":"src"}} |
| list_directory | path (optional) | {"name":"list_directory","arguments":{"path":"src"}} |
| bash | command | {"name":"bash","arguments":{"command":"npm test"}} |

## CRITICAL RULES
1. To use a tool, output ONLY this exact JSON format in a code block:
\`\`\`json
{"name": "read_file", "arguments": {"path": "src/index.ts"}}
\`\`\`
2. WAIT for the tool result before continuing. Do NOT make up file contents.
3. Use ONLY these tools: read_file, write_file, edit_file, insert_line, glob, grep, list_directory, bash
4. Use ONLY the parameters listed in the table above. Do NOT invent parameters.
5. NEVER pretend to read a file - you MUST use read_file and wait for the actual contents.
6. NEVER output code as text. ALWAYS use write_file or edit_file to save changes.`;
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
  console.log(chalk.bold('\nBuilt-in Commands:'));
  console.log(chalk.dim('  /help              - Show this help message'));
  console.log(chalk.dim('  /clear             - Clear conversation history'));
  console.log(chalk.dim('  /compact           - Summarize old messages to save context'));
  console.log(chalk.dim('  /status            - Show current context usage'));
  console.log(chalk.dim('  /context           - Show detected project context'));
  console.log(chalk.dim('  /exit, /quit       - Exit the assistant'));

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
  const { toolName, input, isDangerous, dangerReason, diffPreview } = confirmation;

  let display = '';

  if (isDangerous) {
    display += chalk.red.bold('⚠️  DANGEROUS OPERATION\n');
    display += chalk.red(`   Reason: ${dangerReason}\n\n`);
  }

  display += chalk.yellow(`Tool: ${toolName}\n`);

  // Format input based on tool type
  if (toolName === 'bash') {
    display += chalk.dim(`Command: ${input.command}\n`);
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
      console.log(chalk.dim(output));
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
      console.log(chalk.green(`\nSwitched to ${chalk.bold(provider)} (${chalk.cyan(model)})`));
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
      console.log(chalk.bold('\nCurrent Model:'));
      console.log(`  Provider: ${chalk.cyan(provider)}`);
      console.log(`  Model: ${chalk.cyan(model)}`);
      console.log(chalk.dim(`\nAvailable providers: ${availableProviders}`));
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

  // Merge workspace config with CLI options
  const resolvedConfig = mergeConfig(workspaceConfig, {
    provider: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    endpointId: options.endpointId,
    yes: options.yes,
    tools: options.tools,
    session: options.session,
    summarizeProvider: options.summarizeProvider,
    summarizeModel: options.summarizeModel,
  });

  // Register tools and commands
  registerDefaultTools();
  registerCodeCommands();
  registerWorkflowCommands();
  registerGitCommands();
  registerSessionCommands();
  registerConfigCommands();
  registerHistoryCommands();
  registerUsageCommands();
  registerPluginCommands();
  registerModelCommands();
  registerImportCommands();
  registerMemoryCommands();
  registerCompressionCommands();
  registerRAGCommands();

  // Load plugins from ~/.codi/plugins/
  const loadedPlugins = await loadPluginsFromDirectory();
  if (loadedPlugins.length > 0) {
    console.log(chalk.dim(`Plugins: ${loadedPlugins.length} loaded (${loadedPlugins.map(p => p.plugin.name).join(', ')})`));
  }

  // Initialize RAG system if enabled
  let ragIndexer: BackgroundIndexer | null = null;
  let ragRetriever: Retriever | null = null;

  if (workspaceConfig?.rag?.enabled) {
    try {
      // Build RAG config from workspace config
      const ragConfig: RAGConfig = {
        ...DEFAULT_RAG_CONFIG,
        enabled: true,
        embeddingProvider: workspaceConfig.rag.embeddingProvider ?? DEFAULT_RAG_CONFIG.embeddingProvider,
        openaiModel: workspaceConfig.rag.openaiModel ?? DEFAULT_RAG_CONFIG.openaiModel,
        ollamaModel: workspaceConfig.rag.ollamaModel ?? DEFAULT_RAG_CONFIG.ollamaModel,
        ollamaBaseUrl: workspaceConfig.rag.ollamaBaseUrl ?? DEFAULT_RAG_CONFIG.ollamaBaseUrl,
        topK: workspaceConfig.rag.topK ?? DEFAULT_RAG_CONFIG.topK,
        minScore: workspaceConfig.rag.minScore ?? DEFAULT_RAG_CONFIG.minScore,
        includePatterns: workspaceConfig.rag.includePatterns ?? DEFAULT_RAG_CONFIG.includePatterns,
        excludePatterns: workspaceConfig.rag.excludePatterns ?? DEFAULT_RAG_CONFIG.excludePatterns,
        autoIndex: workspaceConfig.rag.autoIndex ?? DEFAULT_RAG_CONFIG.autoIndex,
        watchFiles: workspaceConfig.rag.watchFiles ?? DEFAULT_RAG_CONFIG.watchFiles,
      };

      const embeddingProvider = createEmbeddingProvider(ragConfig);
      console.log(chalk.dim(`RAG: ${embeddingProvider.getName()} (${embeddingProvider.getModel()})`));

      ragIndexer = new BackgroundIndexer(process.cwd(), embeddingProvider, ragConfig);
      ragRetriever = new Retriever(process.cwd(), embeddingProvider, ragConfig);

      // Share vector store between indexer and retriever
      ragRetriever.setVectorStore(ragIndexer.getVectorStore());

      // Initialize asynchronously
      ragIndexer.initialize().catch((err) => {
        console.error(chalk.red(`RAG indexer error: ${err.message}`));
      });

      // Set up progress callback
      ragIndexer.onProgress = (current, total, file) => {
        if (current === 1 || current === total || current % 10 === 0) {
          process.stdout.write(chalk.dim(`\rIndexing: ${current}/${total} - ${file.slice(0, 40)}...`.padEnd(60)));
        }
      };
      ragIndexer.onComplete = (stats) => {
        console.log(chalk.dim(`\nRAG index: ${stats.totalChunks} chunks from ${stats.totalFiles} files`));
      };

      // Register with commands and tool
      setRAGIndexer(ragIndexer);
      setRAGConfig(ragConfig);
      registerRAGSearchTool(ragRetriever);
    } catch (err) {
      console.error(chalk.red(`Failed to initialize RAG: ${err instanceof Error ? err.message : err}`));
    }
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
    });
  }

  console.log(chalk.dim(`Model: ${provider.getName()} (${provider.getModel()})`));

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

  // Create readline interface with history (needed for confirmation prompts)
  const history = loadHistory();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    history,
    historySize: MAX_HISTORY_SIZE,
    terminal: true,
    prompt: chalk.bold.cyan('\nYou: '),
  });

  // Track if readline is closed (for piped input)
  let rlClosed = false;
  rl.on('close', () => {
    rlClosed = true;
    // Shutdown RAG indexer if running
    if (ragIndexer) {
      ragIndexer.shutdown();
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

  // Track tool start times for duration logging
  const toolStartTimes = new Map<string, number>();

  // Create agent with enhanced system prompt
  const agent = new Agent({
    provider,
    secondaryProvider,
    modelMap,
    toolRegistry: globalRegistry,
    systemPrompt,
    useTools,
    extractToolsFromText: resolvedConfig.extractToolsFromText,
    autoApprove: resolvedConfig.autoApprove.length > 0 ? resolvedConfig.autoApprove : options.yes,
    customDangerousPatterns,
    logLevel,
    enableCompression: options.compress || resolvedConfig.enableCompression,
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
    onToolCall: (name, input) => {
      // Stop any spinner and record start time
      spinner.stop();
      isStreaming = false;
      toolStartTimes.set(name, Date.now());

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
      const duration = (Date.now() - startTime) / 1000;
      toolStartTimes.delete(name);

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

    // Handle built-in commands
    if (trimmed === '/exit' || trimmed === '/quit') {
      console.log(chalk.dim('\nGoodbye!'));
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

    if (trimmed === '/compact') {
      const info = agent.getContextInfo();
      console.log(chalk.dim(`\nCurrent context: ${info.tokens} tokens, ${info.messages} messages`));
      if (info.messages <= 6) {
        console.log(chalk.yellow('Not enough messages to compact (need >6).'));
        rl.prompt();
        return;
      }
      console.log(chalk.dim('Compacting...'));
      try {
        const result = await agent.forceCompact();
        console.log(chalk.green(`Compacted: ${result.before} → ${result.after} tokens`));
        if (result.summary) {
          console.log(
            chalk.dim(
              `Summary: ${result.summary.slice(0, 200)}${result.summary.length > 200 ? '...' : ''}`,
            ),
          );
        }
      } catch (error) {
        if (options.debug && error instanceof Error) {
          console.error(chalk.red(`Compaction failed: ${error.message}`));
          console.error(chalk.dim(error.stack || 'No stack trace available'));
        } else {
          console.error(chalk.red(`Compaction failed: ${error instanceof Error ? error.message : error}`));
        }
      }
      rl.prompt();
      return;
    }

    if (trimmed === '/status') {
      const info = agent.getContextInfo();
      console.log(chalk.bold('\nContext Status:'));
      console.log(chalk.dim(`  Tokens: ${info.tokens} / 8000`));
      console.log(chalk.dim(`  Messages: ${info.messages}`));
      console.log(chalk.dim(`  Has summary: ${info.hasSummary ? 'yes' : 'no'}`));
      console.log(chalk.dim(`  Compression: ${info.compressionEnabled ? 'enabled' : 'disabled'}`));
      if (info.compression) {
        console.log(chalk.dim(`  Compression savings: ${info.compression.savings} chars (${info.compression.savingsPercent.toFixed(1)}%)`));
        console.log(chalk.dim(`  Entities tracked: ${info.compression.entityCount}`));
      }
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
            const result = await command.execute(parsed.args, commandContext);
            if (result) {
              // Handle session command outputs (special format)
              if (result.startsWith('__SESSION_')) {
                handleSessionOutput(result);
                rl.prompt();
                return;
              }
              // Handle config command outputs
              if (result.startsWith('__CONFIG_')) {
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
                  let inputStartIndex = 1;

                  // Check for provider context
                  if (parts[inputStartIndex]?.startsWith('provider:')) {
                    providerContext = parts[inputStartIndex].slice('provider:'.length);
                    inputStartIndex++;
                  }

                  // Check for iterative mode
                  if (parts[inputStartIndex]?.startsWith('iterative:')) {
                    iterativeMode = parts[inputStartIndex].slice('iterative:'.length) === 'true';
                    inputStartIndex++;
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

                    console.log(chalk.bold.magenta(`\nExecuting pipeline: ${pipelineName} (iterative mode)`));
                    console.log(chalk.dim(`Provider: ${effectiveProvider}`));
                    console.log(chalk.dim(`Files: ${files.length} total`));
                    console.log();

                    try {
                      const iterativeResult = await modelMap.executor.executeIterative(pipeline, files, {
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
                            // Don't stream text in iterative mode to reduce noise
                          },
                          onError: (stepName: string, error: Error) => {
                            console.log(chalk.red(`    ✗ ${stepName}: ${error.message}`));
                          },
                        },
                        aggregation: {
                          enabled: true,
                          role: 'capable',
                          batchSize: 15,  // Aggregate every 15 files
                        },
                      });

                      console.log(chalk.bold.green('\n\nPipeline complete!'));
                      console.log(chalk.dim(`Files processed: ${iterativeResult.filesProcessed}/${iterativeResult.totalFiles}`));
                      if (iterativeResult.batchSummaries && iterativeResult.batchSummaries.length > 0) {
                        console.log(chalk.dim(`Batches aggregated: ${iterativeResult.batchSummaries.length}`));
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
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(chalk.dim(`\n(${elapsed}s)`));
    } catch (error) {
      spinner.stop();
      logger.error(error instanceof Error ? error.message : String(error), error instanceof Error ? error : undefined);
    }

    rl.prompt();
  };

  // Set up line handler for REPL
  rl.on('line', (input) => {
    // Don't process if readline was closed
    if (rlClosed) return;
    handleInput(input);
  });

  console.log(chalk.dim('Type /help for commands, /exit to quit.\n'));
  rl.prompt();
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error(chalk.red(`\nUncaught exception: ${error.message}`));
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red(`\nUnhandled rejection: ${reason}`));
  process.exit(1);
});

main().catch(console.error);
