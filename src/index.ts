#!/usr/bin/env node

import { createInterface } from 'readline';
import { program } from 'commander';
import chalk from 'chalk';

import { Agent } from './agent.js';
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

// CLI setup
program
  .name('codi')
  .description('Your AI coding wingman')
  .version('0.1.0')
  .option('-p, --provider <type>', 'Provider to use (anthropic, openai, ollama, runpod)', 'auto')
  .option('-m, --model <name>', 'Model to use')
  .option('--base-url <url>', 'Base URL for API (for self-hosted models)')
  .option('--endpoint-id <id>', 'Endpoint ID (for RunPod serverless)')
  .option('--no-tools', 'Disable tool use (for models that don\'t support it)')
  .option('--debug', 'Show messages sent to the model')
  .parse();

const options = program.opts();

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
1. Output tools as JSON in a code block. Example:
\`\`\`json
{"name": "read_file", "arguments": {"path": "src/index.ts"}}
\`\`\`
2. Use ONLY the parameters listed above. Do NOT invent new parameters.
3. NEVER output code as text. ALWAYS use write_file or edit_file to save changes.
4. NEVER ask the user for file contents - use read_file.`;
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

  if (projectInfo) {
    console.log(chalk.bold('\nProject:'));
    console.log(chalk.dim(`  ${projectInfo.name} (${projectInfo.language}${projectInfo.framework ? ` / ${projectInfo.framework}` : ''})`));
  }
}

async function main() {
  console.log(chalk.bold.blue('\n🤖 Codi - Your AI Coding Wingman\n'));

  // Detect project context
  const projectInfo = await detectProject();
  if (projectInfo) {
    console.log(chalk.dim(`Project: ${projectInfo.name} (${projectInfo.language}${projectInfo.framework ? ` / ${projectInfo.framework}` : ''})`));
  }

  // Register tools and commands
  registerDefaultTools();
  registerCodeCommands();
  registerWorkflowCommands();

  const useTools = options.tools !== false; // --no-tools sets this to false

  if (useTools) {
    console.log(chalk.dim(`Tools: ${globalRegistry.listTools().length} registered`));
  } else {
    console.log(chalk.yellow('Tools: disabled (--no-tools mode)'));
  }
  console.log(chalk.dim(`Commands: ${getAllCommands().length} available`));

  // Create provider
  let provider;
  if (options.provider === 'auto') {
    provider = detectProvider();
  } else {
    provider = createProvider({
      type: options.provider as ProviderType,
      model: options.model,
      baseUrl: options.baseUrl,
      endpointId: options.endpointId,
    });
  }

  console.log(chalk.dim(`Model: ${provider.getName()} (${provider.getModel()})\n`));

  // Command context for slash commands
  const commandContext: CommandContext = {
    projectInfo,
  };

  // Create agent with enhanced system prompt
  const agent = new Agent({
    provider,
    toolRegistry: globalRegistry,
    systemPrompt: generateSystemPrompt(projectInfo, useTools),
    useTools,
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
  });

  // Create readline interface
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(chalk.bold.cyan('\nYou: '), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

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
            console.log(chalk.dim(`Summary: ${result.summary.slice(0, 200)}${result.summary.length > 200 ? '...' : ''}`));
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
