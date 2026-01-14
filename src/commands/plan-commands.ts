// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

/**
 * Plan Commands
 *
 * Commands for creating and managing step-by-step plans.
 * Similar to Claude Code's plan mode.
 */

import * as fs from 'fs';
import * as path from 'path';
import { registerCommand, type Command, type CommandContext } from './index.js';

const PLANS_DIR = '.codi/plans';

/**
 * Generate a unique plan ID.
 */
let planIdCounter = 0;
function generatePlanId(): string {
  // Use timestamp + counter + random for uniqueness
  const timestamp = Date.now().toString(36);
  const counter = (planIdCounter++).toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `plan-${timestamp}-${counter}-${random}`;
}

/**
 * Ensure the plans directory exists.
 */
function ensurePlansDir(cwd: string = process.cwd()): string {
  const dir = path.join(cwd, PLANS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * /plan command - Create and execute a step-by-step plan.
 */
export const planCommand: Command = {
  name: 'plan',
  aliases: ['p'],
  description: 'Create and execute a step-by-step plan for a complex task',
  usage: '/plan <task_description>',
  taskType: 'complex',
  execute: async (args: string, _context: CommandContext): Promise<string | null> => {
    const trimmed = args.trim();

    // Handle help
    if (trimmed === '-h' || trimmed === '--help') {
      console.log(`
Usage: /plan <task_description>

Create a detailed plan for accomplishing a task, save it to a file,
and execute it step by step.

Examples:
  /plan Add user authentication to the app
  /plan Refactor the database layer to use connection pooling
  /plan Implement dark mode support

The plan will be saved to .codi/plans/ and you'll be guided through
exploration, planning, and execution phases.
`);
      return null;
    }

    if (!trimmed) {
      return 'Please describe what you want to accomplish: /plan <task_description>';
    }

    // Create plan file
    const planId = generatePlanId();
    const plansDir = ensurePlansDir();
    const planPath = path.join(plansDir, `${planId}.md`);

    // Initialize plan file
    const initialPlan = `# Plan: ${trimmed}

**Created:** ${new Date().toISOString()}
**Status:** Planning

## Task
${trimmed}

## Analysis
<!-- AI will fill this in during exploration -->

## Steps
<!-- AI will create numbered steps -->

## Progress
<!-- AI will track progress here -->
`;

    fs.writeFileSync(planPath, initialPlan);

    return `You are now in PLAN MODE for task: "${trimmed}"

A plan file has been created at: ${planPath}

Follow these phases:

## Phase 1: Exploration
- Use read_file, glob, grep to understand the codebase
- Identify relevant files and existing patterns
- Note any dependencies or constraints

## Phase 2: Planning
- Create a detailed step-by-step plan
- Update the plan file (${planPath}) with your analysis and steps
- Each step should be specific and actionable
- Identify which tools you'll need for each step

## Phase 3: Confirmation
- Present the plan to the user
- Ask if they want to proceed, modify, or cancel

## Phase 4: Execution
- Execute each step one at a time
- After each step, update the Progress section in the plan file
- Report what was accomplished before moving to the next step

## Phase 5: Summary
- When complete, update the plan status to "Complete"
- Provide a summary of what was accomplished

START with Phase 1: Explore the codebase to understand what's needed for this task.
Use read_file, glob, and grep to gather context before proposing a plan.`;
  },
};

/**
 * /plans command - List saved plans.
 */
export const planListCommand: Command = {
  name: 'plans',
  aliases: ['plan-list'],
  description: 'List saved plans',
  usage: '/plans',
  execute: async (_args: string, _context: CommandContext): Promise<string | null> => {
    const plansDir = path.join(process.cwd(), PLANS_DIR);

    if (!fs.existsSync(plansDir)) {
      console.log('\nNo plans found. Create one with /plan <task>\n');
      return null;
    }

    const files = fs.readdirSync(plansDir).filter((f) => f.endsWith('.md'));

    if (files.length === 0) {
      console.log('\nNo plans found. Create one with /plan <task>\n');
      return null;
    }

    console.log('\n**Saved Plans:**\n');
    for (const file of files) {
      const content = fs.readFileSync(path.join(plansDir, file), 'utf-8');
      const titleMatch = content.match(/^# Plan: (.+)$/m);
      const statusMatch = content.match(/\*\*Status:\*\* (.+)$/m);
      const title = titleMatch ? titleMatch[1] : 'Untitled';
      const status = statusMatch ? statusMatch[1] : 'Unknown';
      console.log(`  ${file.replace('.md', '')}: ${title} [${status}]`);
    }
    console.log(`\nPlans directory: ${plansDir}\n`);
    return null;
  },
};

/**
 * Register all plan commands.
 */
export function registerPlanCommands(): void {
  registerCommand(planCommand);
  registerCommand(planListCommand);
}
