#!/usr/bin/env node

import { createInterface } from 'readline';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

import { Agent } from './agent.js';
import { detectProvider, createProvider, type ProviderType } from './providers/index.js';
import { globalRegistry, registerDefaultTools } from './tools/index.js';

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

async function main() {
  console.log(chalk.bold.blue('\n🤖 AI Coding Assistant\n'));

  // Register default tools
  registerDefaultTools();
  console.log(chalk.dim(`Registered tools: ${globalRegistry.listTools().join(', ')}`));

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

  console.log(chalk.dim(`Using: ${provider.getName()} (${provider.getModel()})\n`));

  // Create agent
  const agent = new Agent({
    provider,
    toolRegistry: globalRegistry,
    onText: (text) => process.stdout.write(text),
    onToolCall: (name, input) => {
      console.log(chalk.yellow(`\n\n📎 Calling tool: ${name}`));
      console.log(chalk.dim(JSON.stringify(input, null, 2)));
    },
    onToolResult: (name, result, isError) => {
      if (isError) {
        console.log(chalk.red(`\n❌ Tool error: ${result}`));
      } else {
        const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
        console.log(chalk.green(`\n✓ ${name} completed`));
        console.log(chalk.dim(preview));
      }
      console.log(); // Blank line before model continues
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

      // Handle special commands
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
        console.log(chalk.dim(`
Commands:
  /exit, /quit  - Exit the assistant
  /clear        - Clear conversation history
  /help         - Show this help message
        `));
        prompt();
        return;
      }

      // Process with agent
      console.log(chalk.bold.magenta('\nAssistant: '));

      try {
        await agent.chat(trimmed);
        console.log(); // Newline after response
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
