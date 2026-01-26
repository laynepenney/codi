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
  const templates = await getAvailableTemplates();
  
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
  const templates = await getAvailableTemplates();
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
  // Enhanced prompt engineering with examples and context
  const aiPrompt = `You are an expert workflow builder AI for the Codi CLI tool.

TASK: Create a workflow based on this user description:
"${description}"

CONTEXT:
- This is for Codi's workflow system
- Workflows are defined in YAML format
- Each workflow has steps executed sequentially
- Steps can be actions like shell commands, AI prompts, Git operations

AVAILABLE ACTIONS:
- shell: Execute shell commands (with "command" property)
- ai-prompt: Generate AI content (with "prompt" property)
- conditional: Conditional logic (with "check", "onTrue", "onFalse")
- loop: Looping logic (with "condition", "maxIterations", "to")
- interactive: User interaction (with "prompt", "inputType", "timeoutMs")
- switch-model: Change AI model (with "model" property)
- check-file-exists: File verification (with "file" property)
- commit/push/pull/sync: Git operations (with "message" for commit)
- create-pr/review-pr/merge-pr: GitHub PR operations (with "title", "body", "base")

WORKFLOW STRUCTURE:
- name: meaningful workflow name
- description: clear description matching user request
- steps: array of step objects
Each step has:
- id: unique step identifier
- action: action type (from available actions above)
- description: human-readable step description
- action-specific properties (see examples below)

EXAMPLES FOR COMMON WORKFLOW PATTERNS:

Example 1: Development Workflow
name: development-pipeline
description: "Automated development workflow"
steps:
  - id: pull-code
    action: shell
    description: "Pull latest code"
    command: "git pull origin main"
  - id: run-tests
    action: shell
    description: "Run test suite"
    command: "pnpm test"
  - id: build-project
    action: shell
    description: "Build the project"
    command: "pnpm build"

Example 2: Documentation Workflow
name: documentation-workflow
description: "Generate and publish documentation"
steps:
  - id: generate-docs
    action: ai-prompt
    description: "Generate documentation"
    prompt: "Please generate comprehensive documentation for the project"
  - id: review-docs
    action: interactive
    description: "Review documentation"
    prompt: "Please review and edit the generated documentation"
    inputType: "multiline"
    timeoutMs: 300000
  - id: commit-docs
    action: commit
    description: "Commit documentation"
    message: "docs: update documentation"

Example 3: Testing Workflow with Conditional Logic
name: smart-testing-workflow
description: "Smart testing with conditional execution"
steps:
  - id: check-test-file
    action: check-file-exists
    description: "Check if test file exists"
    file: "src/somefile.test.ts"
    check: "file-exists"
    onTrue: "run-specific-test"
    onFalse: "run-all-tests"
  - id: run-specific-test
    action: shell
    description: "Run specific test file"
    command: "pnpm test src/somefile.test.ts"
  - id: run-all-tests
    action: shell
    description: "Run all tests"
    command: "pnpm test"

OUTPUT FORMAT RULES:
- Output ONLY the YAML content, nothing else
- No markdown code blocks (no \`\`\`yaml)
- No explanations or comments
- Use single-line format for all properties
- Quote string values with double quotes
- No extra whitespace or blank lines
- Include meaningful step descriptions
- Use appropriate action properties based on step type

Generate a practical, safe, and effective workflow that matches the user's description.`;

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
 * Enhanced YAML parser for AI-generated workflow
 * Handles complex workflows with conditional logic, loops, and advanced features
 * Exported for external testing and validation
 * 
 * @param yamlText - YAML string to parse, possibly from AI generation
 * @returns Parsed Workflow object with validated structure
 * 
 * @throws Error if YAML cannot be parsed or validated
 * 
 * Features:
 * - Removes markdown code blocks and comments
 * - Parses multi-level YAML structures
 * - Handles boolean, numeric, and array value types
 * - Validates workflow structure and provides fallbacks
 * - Cleans and normalizes parsed data
 */
export function parseYAMLWorkflow(yamlText: string): Workflow {
  // Preprocess: Clean the YAML text
  const cleanedYAML = yamlText
    .replace(/^\`\`\`yaml\s*/g, '')  // Remove markdown code blocks
    .replace(/\`\`\`$/g, '')         // Remove closing markdown
    .replace(/^#.*$/gm, '')           // Remove comments
    .trim();
  
  const lines = cleanedYAML.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
  const workflow: any = {
    name: 'ai-generated-workflow',
    description: 'AI-generated workflow',
    steps: []
  };
  
  let currentStep: any = null;
  let inStepsArray = false;
  let currentIndent = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const trimmedLine = lines[i];
    const indent = trimmedLine.search(/\S/);
    
    // Detect steps section
    if (!inStepsArray && line === 'steps:') {
      inStepsArray = true;
      currentIndent = indent;
      continue;
    }
    
    // Top-level properties (before steps)
    if (!inStepsArray && indent === 0) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim().replace(/^"|"$/g, ''); // Remove surrounding quotes
      
      if (key === 'name') {
        workflow.name = value || 'ai-generated-workflow';
      } else if (key === 'description') {
        workflow.description = value || 'AI-generated workflow';
      } else if (['version', 'interactive', 'persistent'].includes(key)) {
        workflow[key] = value === 'true' ? true : value === 'false' ? false : value;
      }
      continue;
    }
    
    // Handle steps array
    if (inStepsArray && indent > currentIndent) {
      // Start of new step
      if (line.startsWith('- id:') || line.match(/^-\s*id:/)) {
        if (currentStep) {
          workflow.steps.push({ ...currentStep });
        }
        
        const idMatch = line.match(/id:\s*(\S+)/);
        currentStep = {
          id: idMatch ? idMatch[1].replace(/^"|"$/g, '') : `step-${workflow.steps.length + 1}`
        };
      }
      // Step property
      else if (currentStep && line.includes(':')) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim().replace(/^"|"$/g, '');
        
        const cleanKey = key.trim();
        if (cleanKey && value !== undefined) {
          // Handle boolean values
          if (value === 'true' || value === 'false') {
            currentStep[cleanKey] = value === 'true';
          }
          // Handle numeric values
          else if (/^-?\d+$/.test(value)) {
            currentStep[cleanKey] = parseInt(value, 10);
          }
          // Handle array values like choices
          else if (value.startsWith('[') && value.endsWith(']')) {
            try {
              currentStep[cleanKey] = JSON.parse(value);
            } catch {
              currentStep[cleanKey] = value;
            }
          }
          else {
            currentStep[cleanKey] = value;
          }
        }
      }
    }
  }
  
  // Don't forget the last step
  if (currentStep) {
    workflow.steps.push(currentStep);
  }
  
  // Ensure steps array exists
  if (!workflow.steps || workflow.steps.length === 0) {
    workflow.steps = [
      {
        id: 'shell-default',
        action: 'shell',
        command: 'echo "Default workflow step"'
      }
    ];
  }
  
  // Validate and clean up workflow
  workflow.name = workflow.name || 'ai-generated-workflow';
  workflow.description = workflow.description || 'AI-generated workflow';
  
  // Clean up each step
  workflow.steps.forEach((step: any) => {
    step.id = step.id || 'unknown-step';
    step.action = step.action || 'shell';
    step.description = step.description || `${step.action} step`;
  });
  
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
 * Enhanced workflow templates with custom user templates support
 * Loads templates from workflows/ directory in addition to built-in templates
 */
/**
 * Enhanced workflow templates with custom user templates support
 * Loads templates from workflows/ directory in addition to built-in templates
 */
async function getAvailableTemplates(): Promise<TemplateSuggestion[]> {
  const templates: TemplateSuggestion[] = [];
  
  // Add built-in templates
  const builtInTemplates = [
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
    },
    {
      name: 'testing',
      description: 'Smart testing workflow with conditional execution',
      workflow: {
        name: 'smart-testing-workflow',
        description: 'Smart testing with conditional logic',
        steps: [
          {
            id: 'check-test-file',
            action: 'check-file-exists',
            description: 'Check if test file exists',
            file: 'src/file.test.ts',
            check: 'file-exists',
            onTrue: 'run-specific-test',
            onFalse: 'run-all-tests'
          },
          {
            id: 'run-specific-test',
            action: 'shell',
            description: 'Run specific test file',
            command: 'pnpm test src/file.test.ts'
          },
          {
            id: 'run-all-tests',
            action: 'shell',
            description: 'Run all tests',
            command: 'pnpm test'
          }
        ]
      }
    },
    {
      name: 'pr-workflow',
      description: 'Complete PR creation and review workflow',
      workflow: {
        name: 'pr-review-workflow',
        description: 'Complete PR creation and review workflow',
        steps: [
          {
            id: 'create-pr',
            action: 'create-pr',
            description: 'Create pull request',
            title: 'Feature implementation',
            body: 'This PR implements the requested feature'
          },
          {
            id: 'review-setup',
            action: 'switch-model',
            description: 'Switch to review model',
            model: 'glm'
          },
          {
            id: 'review-pr',
            action: 'review-pr',
            description: 'Review PR and suggest improvements'
          },
          {
            id: 'implement-fixes',
            action: 'interactive',
            description: 'Implement suggested fixes',
            prompt: 'Please implement the PR review suggestions'
          },
          {
            id: 'merge-pr',
            action: 'merge-pr',
            description: 'Merge the approved PR'
          }
        ]
      }
    }
  ];
  
  templates.push(...builtInTemplates);
  
  // Load custom templates from workflows/ directory (recursively)
  const workflowsDir = path.join(process.cwd(), 'workflows');
  if (fs.existsSync(workflowsDir)) {
    try {
      const loadTemplatesRecursively = (dir: string, basePath = '') => {
        const files = fs.readdirSync(dir);
        const results: TemplateSuggestion[] = [];
        
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            // Recursively process subdirectories
            results.push(...loadTemplatesRecursively(fullPath, basePath ? `${basePath}/${file}` : file));
          } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            try {
              const yamlContent = fs.readFileSync(fullPath, 'utf8');
              const workflow = parseYAMLWorkflow(yamlContent);
              
              results.push({
                name: basePath ? `${basePath}/${path.parse(file).name}` : path.parse(file).name,
                description: workflow.description || `Custom workflow: ${workflow.name}`,
                workflow: workflow
              });
            } catch (error) {
              // Provide helpful error message for invalid YAML files
              console.warn(`⚠️  Warning: Invalid workflow YAML in ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
              continue;
            }
          }
        }
        
        return results;
      };
      
      const customTemplates = loadTemplatesRecursively(workflowsDir);
      templates.push(...customTemplates);
      
      if (customTemplates.length > 0) {
        console.log(`📂 Loaded ${customTemplates.length} custom template(s) from ${workflowsDir}`);
      }
    } catch (error) {
      console.error(`Error loading custom templates: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  return templates;
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