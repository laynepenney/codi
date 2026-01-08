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
  .name('ai-assistant')
  .description('A hybrid AI coding assistant')
  .version('0.1.0')
  .option('-p, --provider <type>', 'Provider to use (anthropic, openai, ollama)', 'auto')
  .option('-m, --model <name>', 'Model to use')
  .option('--base-url <url>', 'Base URL for API (for self-hosted models)')
  .parse();

const options = program.opts();

function generateSystemPrompt(projectInfo: ProjectInfo | null): string {
  let prompt = `You are an expert AI coding assistant with deep knowledge of software development. You have access to tools that allow you to read, write, and edit files, search codebases, and execute commands.

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

## Available Tools
- \`read_file\`: Read file contents
- \`write_file\`: Create or overwrite files
- \`edit_file\`: Make targeted search/replace edits
- \`patch_file\`: Apply unified diff patches
- \`glob\`: Find files by pattern
- \`grep\`: Search file contents
- \`list_directory\`: List directory contents
- \`bash\`: Execute shell commands

Always use tools to interact with the filesystem rather than asking the user to do it.`;

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
  console.log(chalk.bold.blue('\n🤖 AI Coding Assistant\n'));

  // Detect project context
  const projectInfo = await detectProject();
  if (projectInfo) {
    console.log(chalk.dim(`Project: ${projectInfo.name} (${projectInfo.language}${projectInfo.framework ? ` / ${projectInfo.framework}` : ''})`));
  }

  // Register tools and commands
  registerDefaultTools();
  registerCodeCommands();
  registerWorkflowCommands();

  console.log(chalk.dim(`Tools: ${globalRegistry.listTools().length} registered`));
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
    systemPrompt: generateSystemPrompt(projectInfo),
    onText: (text) => process.stdout.write(text),
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
                await agent.chat(result);
                console.log();
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
        await agent.chat(trimmed);
        console.log();
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
