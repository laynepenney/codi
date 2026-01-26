// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerCommand, type Command, type CommandContext } from './index.js';
import type { Workflow, WorkflowStep } from '../workflow/types.js';
import fs from 'node:fs';
import path from 'node:path';

// Type definitions for AI-generated workflow
interface TemplateSuggestion {
  name: string;
  description: string;
  workflow: Workflow;
}

/**
 * AI-powered workflow builder command
 */
export const workflowBuildCommand: Command = {
  name: 'workflow-build',
  aliases: ['wbuild'],
  description: 'AI-assisted workflow creation',
  usage: '/workflow-build "natural language description" OR /workflow-build template <name>',
  taskType: 'complex',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    
    if (subcommand === 'template' || subcommand === 'example') {
      const templateName = parts[1] || 'list';
      
      if (templateName === 'list') {
        return await showTemplates();
      } else {
        return await generateFromTemplate(templateName, context);
      }
    }
    
    if (!args.trim()) {
      return getUsage();
    }
    
    // AI-assisted building with actual agent integration
    return await buildWorkflowFromDescription(args, context);
  },
};

/**
 * Show available workflow templates
 */
async function showTemplates(): Promise<string> {
  const templates = getAvailableTemplates();
  
  let output = 'Available workflow templates:\n\n';
  templates.forEach(template => {
    output += `📋 ${template.name}\n`;
    output += `   ${template.description}\n`;
    output += `   Steps: ${template.workflow.steps.length} ${template.workflow.interactive ? '• Interactive' : ''}\n\n`;
  });
  
  output += 'Usage: /workflow-build template <template-name>\n';
  output += 'Example: /workflow-build template deployment\n';
  
  return output;
}

/**
 * Generate a workflow from a template
 */
async function generateFromTemplate(
  templateName: string, 
  context: CommandContext
): Promise<string> {
  const templates = getAvailableTemplates();
  const template = templates.find(t => t.name.toLowerCase() === templateName.toLowerCase());
  
  if (!template) {
    return `Template "${templateName}" not found. Use /workflow-build template list to see available templates.`;
  }
  
  // Save the template as a new workflow with unique name
  const workflowsDir = path.join(process.cwd(), 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }
  
  const timestamp = Date.now();
  const workflowName = `generated-${templateName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}`;
  const workflowPath = path.join(workflowsDir, `${workflowName}.yaml`);
  
  // Generate YAML content
  const yamlContent = workflowToYAML(template.workflow);
  fs.writeFileSync(workflowPath, yamlContent);
  
  return `✅ Generated workflow from template "${template.name}"\n` +
         `📁 File: ${workflowPath}\n` +
         `📝 Steps: ${template.workflow.steps.length}\n` +
         `✨ Description: ${template.description}\n\n` +
         `Use /workflow-run ${workflowName} to execute it.`;
}

/**
 * Build workflow from natural language description using AI
 */
async function buildWorkflowFromDescription(
  description: string, 
  context: CommandContext
): Promise<string> {
  const aiPrompt = `You are a workflow builder AI. Create a workflow based on this description:

${description}

Generate a YAML workflow file with the following structure:
- Name: descriptive workflow name
- Description: clear description
- Steps: sequential workflow steps

Use these available actions:
- shell: Execute shell commands
- ai-prompt: Generate AI content
- conditional: Conditional logic
- loop: Looping logic
- interactive: User interaction
- switch-model: Change AI model
- check-file-exists: File verification
- commit/push/pull/sync: Git operations
- create-pr/review-pr/merge-pr: GitHub PR operations

The workflow should be practical, safe, and effective.

Important formatting rules:
- Do NOT use markdown code blocks (like \`\`\`yaml)
- Do NOT include explanations
- Output ONLY the YAML content
- Use single-line format for all properties
- Quote string values with double quotes
- No extra whitespace or blank lines

Example of expected format:
name: workflow-name
description: \"Workflow description\"
steps:
  - id: step1
    action: shell
    description: \"Step description\"
    command: \"echo hello\"
`;

  // Try to use actual AI from agent context
  let workflow: Workflow;
  
  if (context?.agent) {
    try {
      const response = await context.agent.chat(aiPrompt);
      const responseText = (response as any)?.text || (response as any)?.response || '';
      
      // Parse the AI-generated YAML
      workflow = parseYAMLWorkflow(responseText);
    } catch (error) {
      // Fallback to scaffold if AI fails
      workflow = createScaffoldWorkflow(description);
    }
  } else {
    // No agent available, use scaffold
    workflow = createScaffoldWorkflow(description);
  }
  
  // Save the workflow with unique timestamp
  const workflowsDir = path.join(process.cwd(), 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }
  
  const timestamp = Date.now();
  const workflowName = `ai-generated-${timestamp}-workflow`;
  const workflowPath = path.join(workflowsDir, `${workflowName}.yaml`);
  
  const yamlContent = workflowToYAML(workflow);
  fs.writeFileSync(workflowPath, yamlContent);
  
  return `✅ Generated workflow from your description\n` +
         `📁 File: ${workflowPath}\n` +
         `📝 Steps: ${workflow.steps.length}\n\n` +
         `Use /workflow-run ${workflowName} to test it.\n` +
         `Use /workflow show ${workflowName} to review the workflow.`;
}

/**
 * Simple YAML parser for AI-generated workflow
 */
function parseYAMLWorkflow(yamlText: string): Workflow {
  // Very simple YAML parser - handles key-value pairs and arrays
  const lines = yamlText.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
  const workflow: any = {
    name: 'ai-generated-workflow',
    description: 'AI-generated workflow',
    steps: []
  };
  
  let currentStep: any = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const indent = lines[i].search(/\S/);
    
    // Top-level properties
    if (indent === 0) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      
      if (key === 'steps') {
        continue; // Array handling below
      } else if (key === 'name') {
        workflow.name = value.replace(/"/g, '');
      } else if (key === 'description') {
        workflow.description = value.replace(/"/g, '');
      }
    }
    
    // Array items (steps)
    if (line.startsWith('- id:')) {
      if (currentStep) {
        workflow.steps.push({ ...currentStep });
      }
      currentStep = {
        id: line.split(':')[1].trim().replace(/"/g, '')
      };
    } else if (currentStep && indent > 0) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim().replace(/"/g, '');
      currentStep[key.trim()] = value;
    }
  }
  
  if (currentStep) {
    workflow.steps.push(currentStep);
  }
  
  return workflow as Workflow;
}

/**
 * Convert workflow to YAML
 */
function workflowToYAML(workflow: Workflow): string {
  let yaml = `name: ${workflow.name}\n`;
  
  if (workflow.description) {
    yaml += `description: "${workflow.description}"\n`;
  }
  
  if (workflow.version) {
    yaml += `version: ${workflow.version}\n`;
  }
  
  if (workflow.interactive !== undefined) {
    yaml += `interactive: ${workflow.interactive}\n`;
  }
  
  if (workflow.persistent !== undefined) {
    yaml += `persistent: ${workflow.persistent}\n`;
  }
  
  yaml += '\nsteps:\n';
  
  workflow.steps.forEach(step => {
    yaml += `  - id: ${step.id}\n`;
    yaml += `    action: ${step.action}\n`;
    
    if (step.description) {
      yaml += `    description: "${step.description}"\n`;
    }
    
    // Add step-specific properties
    Object.keys(step).forEach(key => {
      if (!['id', 'action', 'description'].includes(key)) {
        const value = (step as any)[key];
        if (value !== undefined && value !== null) {
          if (typeof value === 'string') {
            yaml += `    ${key}: "${value.replace(/"/g, '\\"')}"\n`;
          } else {
            yaml += `    ${key}: ${JSON.stringify(value)}\n`;
          }
        }
      }
    });
  });
  
  return yaml;
}

/**
 * Create a scaffold workflow from description
 */
function createScaffoldWorkflow(description: string): Workflow {
  return {
    name: `workflow-${Date.now()}`,
    description: `Generated from: ${description}`,
    steps: [
      {
        id: 'shell-welcome',
        action: 'shell',
        description: 'Welcome message',
        command: 'echo "Starting AI-generated workflow"'
      },
      {
        id: 'prompt-analyze',
        action: 'ai-prompt',
        description: 'Analyze the task',
        prompt: `Please analyze and help me with: ${description}`
      },
      {
        id: 'shell-complete',
        action: 'shell',
        description: 'Completion message',
        command: 'echo "Workflow completed successfully"'
      }
    ]
  };
}

/**
 * Get available workflow templates
 */
function getAvailableTemplates(): TemplateSuggestion[] {
  return [
    {
      name: 'deployment',
      description: 'Git deployment workflow with testing and deployment',
      workflow: {
        name: 'git-deployment',
        description: 'Automated Git deployment workflow',
        steps: [
          {
            id: 'pull-changes',
            action: 'shell',
            description: 'Pull latest changes',
            command: 'git pull origin main'
          },
          {
            id: 'run-tests',
            action: 'shell',
            description: 'Run test suite',
            command: 'pnpm test'
          },
          {
            id: 'build-project',
            action: 'shell',
            description: 'Build the project',
            command: 'pnpm build'
          },
          {
            id: 'deploy-step',
            action: 'shell',
            description: 'Deploy the project',
            command: 'echo "Deploying..."'
          }
        ]
      }
    },
    {
      name: 'documentation',
      description: 'Generate and review documentation',
      workflow: {
        name: 'documentation-workflow',
        description: 'Documentation generation workflow',
        steps: [
          {
            id: 'generate-docs',
            action: 'ai-prompt',
            description: 'Generate documentation',
            prompt: 'Please generate comprehensive documentation for this project'
          },
          {
            id: 'review-docs',
            action: 'interactive',
            description: 'Review generated documentation',
            prompt: 'Please review and edit the generated documentation',
            inputType: 'multiline'
          },
          {
            id: 'commit-docs',
            action: 'commit',
            description: 'Commit documentation',
            message: 'docs: update documentation'
          }
        ]
      }
    },
    {
      name: 'refactor',
      description: 'Code refactoring workflow',
      workflow: {
        name: 'refactor-workflow',
        description: 'Code refactoring assistance',
        steps: [
          {
            id: 'analyze-code',
            action: 'ai-prompt',
            description: 'Analyze code for refactoring',
            prompt: 'Please analyze this code and suggest refactoring opportunities'
          },
          {
            id: 'implement-refactor',
            action: 'interactive',
            description: 'Interactive refactoring',
            prompt: 'Please implement the refactoring suggestions step by step',
            inputType: 'multiline'
          },
          {
            id: 'run-tests',
            action: 'shell',
            description: 'Verify refactoring',
            command: 'pnpm test'
          }
        ]
      }
    }
  ];
}

/**
 * Get command usage information
 */
function getUsage(): string {
  return `📋 AI-Assisted Workflow Builder

Usage:
  /workflow-build "natural language description"
    Generate a workflow from a description using AI

  /workflow-build template list
    Show available templates

  /workflow-build template <name>
    Generate workflow from a template

Examples:
  /workflow-build "create a deployment workflow with testing"
  /workflow-build template deployment
  /workflow-build "generate documentation and commit it"`;
}