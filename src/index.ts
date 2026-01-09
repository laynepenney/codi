#!/usr/bin/env node

import { createInterface, type Interface } from 'readline';
import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// History configuration
const HISTORY_FILE = join(homedir(), '.codi_history');
const MAX_HISTORY_SIZE = 1000;

/**
 * Load command history from file.
 */
function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const content = readFileSync(HISTORY_FILE, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      // Return most recent entries up to MAX_HISTORY_SIZE
      return lines.slice(-MAX_HISTORY_SIZE);
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

import { Agent, type ToolConfirmation, type ConfirmationResult } from './agent.js';
import { detectProvider, createProvider, type ProviderType } from './providers/index.js';
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
import { loadSession } from './session.js';
import {
  loadWorkspaceConfig,
  validateConfig,
  mergeConfig,
  getCustomDangerousPatterns,
  type ResolvedConfig,
} from './config.js';

// CLI setup
program
  .name('codi')
  .description('Your AI coding wingman')
  .version('0.1.0')
  .option('-p, --provider <type>', 'Provider to use (anthropic, openai, ollama, runpod)', 'auto')
  .option('-m, --model <name>', 'Model to use')
  .option('--base-url <url>', 'Base URL for API (for self-hosted models)')
  .option('--endpoint-id <id>', 'Endpoint ID (for RunPod serverless)')
  .option('--no-tools', "Disable tool use (for models that don't support it)")
  .option('-y, --yes', 'Auto-approve all tool operations (skip confirmation prompts)')
  .option('--debug', 'Show messages sent to the model')
  .option('-s, --session <name>', 'Load a saved session on startup')
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
  const { toolName, input, isDangerous, dangerReason } = confirmation;

  let display = '';

  if (isDangerous) {
    display += chalk.red.bold('⚠️  DANGEROUS OPERATION\n');
    display += chalk.red(`   Reason: ${dangerReason}\n\n`);
  }

  display += chalk.yellow(`Tool: ${toolName}\n`);

  // Format input based on tool type
  if (toolName === 'bash') {
    display += chalk.dim(`Command: ${input.command}\n`);
  } else if (toolName === 'write_file') {
    const content = input.content as string;
    const lines = content.split('\n').length;
    display += chalk.dim(`Path: ${input.path}\n`);
    display += chalk.dim(`Content: ${lines} lines, ${content.length} chars\n`);
  } else if (toolName === 'edit_file') {
    display += chalk.dim(`Path: ${input.path}\n`);
    display += chalk.dim(`Replace: "${(input.old_string as string).slice(0, 50)}${(input.old_string as string).length > 50 ? '...' : ''}"\n`);
    display += chalk.dim(`With: "${(input.new_string as string).slice(0, 50)}${(input.new_string as string).length > 50 ? '...' : ''}"\n`);
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
      const lower = answer.toLowerCase().trim();
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

  // Merge workspace config with CLI options
  const resolvedConfig = mergeConfig(workspaceConfig, {
    provider: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    endpointId: options.endpointId,
    yes: options.yes,
    tools: options.tools,
    session: options.session,
  });

  // Register tools and commands
  registerDefaultTools();
  registerCodeCommands();
  registerWorkflowCommands();
  registerGitCommands();
  registerSessionCommands();
  registerConfigCommands();

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
      type: resolvedConfig.provider as ProviderType,
      model: resolvedConfig.model,
      baseUrl: resolvedConfig.baseUrl,
      endpointId: resolvedConfig.endpointId,
    });
  }

  console.log(chalk.dim(`Model: ${provider.getName()} (${provider.getModel()})\n`));

  // Create readline interface with history (needed for confirmation prompts)
  const history = loadHistory();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    history,
    historySize: MAX_HISTORY_SIZE,
  });

  // Command context for slash commands
  const commandContext: CommandContext = {
    projectInfo,
  };

  // Build system prompt with config additions
  let systemPrompt = generateSystemPrompt(projectInfo, useTools);
  if (resolvedConfig.projectContext) {
    systemPrompt += `\n\n## Project-Specific Guidelines\n${resolvedConfig.projectContext}`;
  }
  if (resolvedConfig.systemPromptAdditions) {
    systemPrompt += `\n\n${resolvedConfig.systemPromptAdditions}`;
  }

  // Get custom dangerous patterns from config
  const customDangerousPatterns = getCustomDangerousPatterns(resolvedConfig);

  // Create agent with enhanced system prompt
  const agent = new Agent({
    provider,
    toolRegistry: globalRegistry,
    systemPrompt,
    useTools,
    autoApprove: resolvedConfig.autoApprove.length > 0 ? resolvedConfig.autoApprove : options.yes,
    customDangerousPatterns,
    debug: options.debug,
    onText: (text) => process.stdout.write(text),
    onReasoning: (reasoning) => {
      console.log(chalk.dim.italic('\n💭 Thinking...'));
      console.log(chalk.dim(reasoning));
      console.log(chalk.dim.italic('---\n'));
    },
    onToolCall: (name, input) => {
      console.log(chalk.yellow(`\n\n📎 ${name}`));
      const preview = JSON.stringify(input);
      console.log(chalk.dim(preview.length > 100 ? preview.slice(0, 100) + '...' : preview));
    },
    onToolResult: (name, result, isError) => {
      if (isError) {
        console.log(chalk.red(`\n❌ Error: ${result.slice(0, 200)}`));
      } else {
        const lines = result.split('\n').length;
        console.log(chalk.green(`\n✓ ${name} (${lines} lines)`));
      }
      console.log();
    },
    onConfirm: async (confirmation) => {
      console.log('\n' + formatConfirmation(confirmation));
      const promptText = confirmation.isDangerous
        ? chalk.red.bold('Approve? [y/N/abort] ')
        : chalk.yellow('Approve? [y/N/abort] ');
      return promptConfirmation(rl, promptText);
    },
  });

  // Set up session commands with agent reference
  setSessionAgent(
    agent,
    provider.getName(),
    provider.getModel(),
    projectInfo?.name
  );

  // Load session from command line or config default
  const sessionToLoad = options.session || resolvedConfig.defaultSession;
  if (sessionToLoad) {
    const session = loadSession(sessionToLoad);
    if (session) {
      agent.loadSession(session.messages, session.conversationSummary);
      setCurrentSessionName(session.name);
      console.log(chalk.green(`Loaded session: ${session.name} (${session.messages.length} messages)`));
      if (session.conversationSummary) {
        console.log(chalk.dim('Session has conversation summary from previous compaction.'));
      }
    } else {
      console.log(chalk.yellow(`Session not found: ${sessionToLoad}`));
    }
  }

  /**
   * Prompts for user input and handles a single interaction turn.
   *
   * This function re-invokes itself after each handled command/message to keep
   * the CLI session running.
   */
  const prompt = () => {
    rl.question(chalk.bold.cyan('\nYou: '), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
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
        prompt();
        return;
      }

      if (trimmed === '/help') {
        showHelp(projectInfo);
        prompt();
        return;
      }

      if (trimmed === '/context') {
        if (projectInfo) {
          console.log(chalk.bold('\nProject Context:'));
          console.log(formatProjectContext(projectInfo));
        } else {
          console.log(chalk.dim('\nNo project detected in current directory.'));
        }
        prompt();
        return;
      }

      if (trimmed === '/compact') {
        const info = agent.getContextInfo();
        console.log(chalk.dim(`\nCurrent context: ${info.tokens} tokens, ${info.messages} messages`));
        if (info.messages <= 6) {
          console.log(chalk.yellow('Not enough messages to compact (need >6).'));
          prompt();
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
          console.error(chalk.red(`Compaction failed: ${error instanceof Error ? error.message : error}`));
        }
        prompt();
        return;
      }

      if (trimmed === '/status') {
        const info = agent.getContextInfo();
        console.log(chalk.bold('\nContext Status:'));
        console.log(chalk.dim(`  Tokens: ${info.tokens} / 8000`));
        console.log(chalk.dim(`  Messages: ${info.messages}`));
        console.log(chalk.dim(`  Has summary: ${info.hasSummary ? 'yes' : 'no'}`));
        prompt();
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
                  prompt();
                  return;
                }
                // Handle config command outputs
                if (result.startsWith('__CONFIG_')) {
                  handleConfigOutput(result);
                  prompt();
                  return;
                }
                // Clear history for slash commands - they should start fresh
                agent.clearHistory();
                // Command returned a prompt - send to agent
                console.log(chalk.bold.magenta('\nAssistant: '));
                const startTime = Date.now();
                await agent.chat(result);
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(chalk.dim(`\n(${elapsed}s)`));
              }
            } catch (error) {
              console.error(chalk.red(`Command error: ${error instanceof Error ? error.message : error}`));
            }
            prompt();
            return;
          } else {
            console.log(chalk.yellow(`Unknown command: /${parsed.name}. Type /help for available commands.`));
            prompt();
            return;
          }
        }
      }

      // Regular message - send to agent
      console.log(chalk.bold.magenta('\nAssistant: '));

      try {
        const startTime = Date.now();
        await agent.chat(trimmed);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(chalk.dim(`\n(${elapsed}s)`));
      } catch (error) {
        console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      }

      prompt();
    });
  };

  console.log(chalk.dim('Type /help for commands, /exit to quit.\n'));
  prompt();
}

main().catch(console.error);
