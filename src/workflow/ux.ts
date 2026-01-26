// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workflow user experience enhancements
 * Progress indicators, completion summaries, and improved feedback
 */

import type { Workflow, WorkflowState, StepExecution } from './types.js';

/**
 * Progress bar for workflow execution
 */
export function getProgressBar(
  completed: number,
  total: number,
  width: number = 30
): string {
  if (total === 0) return '█'.repeat(width);
  
  const progress = completed / total;
  const filled = Math.floor(progress * width);
  const empty = width - filled;
  
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get step status emoji
 */
export function getStepEmoji(status: string): string {
  switch (status) {
    case 'completed': return '✅';
    case 'running': return '🔄';
    case 'failed': return '❌';
    case 'pending': return '⏸️ ';
    default: return '⏸️ ';
  }
}

/**
 * Get action emoji for step type
 */
export function getActionEmoji(action: string): string {
  const actionEmojis: Record<string, string> = {
    'switch-model': '🤖',
    'conditional': '🔀',
    'loop': '↻',
    'interactive': '💬',
    'shell': '💻',
    'ai-prompt': '🧠',
    'create-pr': '📝',
    'review-pr': '👀',
    'merge-pr': '🔀',
    'commit': '📦',
    'push': '⬆️',
    'pull': '⬇️',
    'sync': '🔄'
  };
  
  return actionEmojis[action] || '⚙️';
}

/**
 * Format workflow execution progress
 */
export function formatWorkflowProgress(
  workflow: Workflow,
  state: WorkflowState,
  verbose: boolean = false
): string {
  let output = '';
  
  const totalSteps = workflow.steps.length;
  const completedSteps = state.history.filter(h => h.status === 'completed').length;
  const failedStep = state.history.find(h => h.status === 'failed');
  
  // Progress bar
  const progress = completedSteps / totalSteps;
  const percentage = Math.round(progress * 100);
  const progressBar = getProgressBar(completedSteps, totalSteps);
  
  output += `\n${getStepEmoji(state.completed ? 'completed' : failedStep?.status || 'running')} `;
  output += `${workflow.name}\n`;
  
  if (state.completed) {
    output += `✅ Completed (${percentage}%)\n`;
  } else if (failedStep) {
    output += `❌ Failed at step: ${failedStep.step}\n`;
    output += `Progress: ${percentage}%\n`;
  } else {
    output += `Progress: ${percentage}%\n`;
  }
  
  output += `${progressBar} ${completedSteps}/${totalSteps} steps\n\n`;
  
  // Current step
  if (state.currentStep && !state.completed) {
    const currentStep = workflow.steps.find(s => s.id === state.currentStep);
    if (currentStep) {
      const actionEmoji = getActionEmoji(currentStep.action);
      output += `📍 Current Step: [${currentStep.id}] ${actionEmoji} ${currentStep.action}\n`;
      if (currentStep.description) {
        output += `   ${currentStep.description}\n`;
      }
      output += '\n';
    }
  }
  
  // Detailed step list (verbose mode)
  if (verbose || state.completed || failedStep) {
    output += `📋 Step Execution:\n`;
    output += `─`.repeat(50) + '\n';
    
    workflow.steps.forEach((step, index) => {
      const execution = state.history.find(h => h.step === step.id);
      const status = execution?.status || 'pending';
      const statusEmoji = getStepEmoji(status);
      const actionEmoji = getActionEmoji(step.action);
      
      output += `${index + 1}. ${statusEmoji} [${step.id}] ${actionEmoji} ${step.action}`;
      
      if (step.description && (verbose || state.completed)) {
        output += `\n   └─ ${step.description}`;
      }
      
      if (execution?.result && status === 'completed' && verbose) {
        const resultPreview = String(execution.result).substring(0, 100);
        if (resultPreview.length > 0) {
          output += `\n   └─ Result: ${resultPreview}${resultPreview.length >= 100 ? '...' : ''}`;
        }
      }
      
      if (execution?.result && status === 'failed') {
        output += `\n   └─ ❌ Error: ${String(execution.result).substring(0, 100)}`;
      }
      
      output += '\n';
    });
    output += `─`.repeat(50) + '\n\n';
  }
  
  return output;
}

/**
 * Generate workflow completion summary
 */
export function generateCompletionSummary(
  workflow: Workflow,
  state: WorkflowState,
  startTime?: number
): string {
  let output = '';
  
  if (state.completed) {
    output += `\n${'='.repeat(50)}\n`;
    output += `✅ WORKFLOW COMPLETED: ${workflow.name}\n`;
    output += `${'='.repeat(50)}\n\n`;
    
    // Overall stats
    const totalSteps = workflow.steps.length;
    const completedSteps = state.history.filter(h => h.status === 'completed').length;
    const duration = startTime ? (Date.now() - startTime) / 1000 : undefined;
    
    output += `📊 Statistics:\n`;
    output += `   Total steps: ${totalSteps}\n`;
    output += `   Completed: ${completedSteps}\n`;
    output += `   Success rate: ${Math.round((completedSteps / totalSteps) * 100)}%\n`;
    
    if (duration) {
      output += `   Duration: ${formatDuration(duration)}\n`;
    }
    
    // Variables collected
    if (Object.keys(state.variables).length > 0) {
      output += `\n🔧 Variables Collected:\n`;
      Object.entries(state.variables).forEach(([key, value]) => {
        const valuePreview = String(value).substring(0, 60);
        output += `   ${key}: ${valuePreview}${valuePreview.length >= 60 ? '...' : ''}\n`;
      });
    }
    
    // Step highlights
    output += `\n📋 Execution Summary:\n`;
    state.history.forEach((execution, index) => {
      const step = workflow.steps.find(s => s.id === execution.step);
      const statusEmoji = getStepEmoji(execution.status);
      const actionEmoji = step ? getActionEmoji(step.action) : '⚙️';
      
      output += `   ${index + 1}. ${statusEmoji} ${actionEmoji} [${execution.step}]`;
      
      if (execution.status === 'completed' && execution.result) {
        const resultStr = String(execution.result).substring(0, 80);
        if (resultStr.length > 0) {
          output += ` → ${resultStr}${resultStr.length >= 80 ? '...' : ''}`;
        }
      }
      
      output += '\n';
    });
    
    // Workflow-specific insights
    const insights = generateWorkflowInsights(workflow, state);
    if (insights.length > 0) {
      output += `\n💡 Insights:\n`;
      insights.forEach(insight => {
        output += `   • ${insight}\n`;
      });
    }
    
    output += `\n${'='.repeat(50)}\n`;
    
  } else if (state.history.some(h => h.status === 'failed')) {
    output += `\n${'='.repeat(50)}\n`;
    output += `❌ WORKFLOW FAILED: ${workflow.name}\n`;
    output += `${'='.repeat(50)}\n\n`;
    
    const failedStep = state.history.find(h => h.status === 'failed');
    if (failedStep) {
      const step = workflow.steps.find(s => s.id === failedStep.step);
      output += `❌ Failed Step: [${failedStep.step}]\n`;
      if (step?.description) {
        output += `   ${step.description}\n`;
      }
      output += `   Action: ${step?.action || 'unknown'}\n`;
      output += `   Error: ${failedStep.result}\n\n`;
    }
    
    const completedSteps = state.history.filter(h => h.status === 'completed').length;
    output += `📊 Progress: ${completedSteps}/${workflow.steps.length} steps completed\n\n`;
    
    output += `🔍 Troubleshooting:\n`;
    output += `   1. Review the failed step above for specific error details\n`;
    output += `   2. Fix the underlying issue (configuration, permissions, etc.)\n`;
    output += `   3. Resume the workflow with: /workflow-run ${workflow.name}\n`;
    
    output += `\n${'='.repeat(50)}\n`;
  }
  
  return output;
}

/**
 * Generate insights from workflow execution
 */
function generateWorkflowInsights(workflow: Workflow, state: WorkflowState): string[] {
  const insights: string[] = [];
  
  // Model switching insights
  const modelSwitches = state.history.filter(h => {
    const step = workflow.steps.find(s => s.id === h.step);
    return step?.action === 'switch-model' && h.status === 'completed';
  });
  
  if (modelSwitches.length > 0) {
    insights.push(`Workflow switched between ${modelSwitches.length} different AI models`);
  }
  
  // Conditional logic insights
  const conditions = state.history.filter(h => {
    const step = workflow.steps.find(s => s.id === h.step);
    return step?.action === 'conditional' && h.status === 'completed';
  });
  
  if (conditions.length > 0) {
    insights.push(`Workflow made ${conditions.length} conditional decisions during execution`);
  }
  
  // Loop insights
  const loops = state.history.filter(h => {
    const step = workflow.steps.find(s => s.id === h.step);
    return step?.action === 'loop' && h.status === 'completed';
  });
  
  if (loops.length > 0) {
    insights.push('Workflow included iterative processing with loops');
  }
  
  // Git operations insights
  const gitOps = state.history.filter(h => {
    const step = workflow.steps.find(s => s.id === h.step);
    return step?.action && ['commit', 'push', 'pull', 'sync'].includes(step.action);
  });
  
  if (gitOps.length > 0) {
    insights.push(`Workflow performed ${gitOps.length} git operations`);
  }
  
  // PR operations insights
  const prOps = state.history.filter(h => {
    const step = workflow.steps.find(s => s.id === h.step);
    return step?.action && ['create-pr', 'review-pr', 'merge-pr'].includes(step.action);
  });
  
  if (prOps.length > 0) {
    insights.push(`Workflow automated ${prOps.length} PR lifecycle operations`);
  }
  
  // Interactive steps handled
  const interactiveSteps = state.history.filter(h => {
    const step = workflow.steps.find(s => s.id === h.step);
    return step?.action === 'interactive' && h.status === 'completed';
  });
  
  if (interactiveSteps.length > 0) {
    insights.push(`Workflow required ${interactiveSteps.length} interactive inputs from you`);
  }
  
  return insights;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)}ms`;
  } else if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Get workflow execution hint
 */
export function getExecutionHint(workflow: Workflow): string {
  const hints: string[] = [];
  
  // Interactive workflow hint
  if (workflow.interactive) {
    hints.push('💡 This workflow requires interactive input - stay near your terminal');
  }
  
  // Persistent workflow hint
  if (workflow.persistent) {
    hints.push('💾 This workflow saves state - you can interrupt and resume later');
  }
  
  // Check for loops
  const hasLoops = workflow.steps.some(s => s.action === 'loop');
  if (hasLoops) {
    hints.push('🔄 This workflow contains loops - may take multiple iterations');
  }
  
  // Check for model switching
  const hasModelSwitch = workflow.steps.some(s => s.action === 'switch-model');
  if (hasModelSwitch) {
    hints.push('🤖 This workflow switches AI models - ensure all are configured');
  }
  
  // Check for git operations
  const hasGitOps = workflow.steps.some(s => 
    s.action && ['commit', 'push', 'pull', 'sync'].includes(s.action)
  );
  if (hasGitOps) {
    hints.push('📝 This workflow modifies git - ensure working tree is clean');
  }
  
  // Check for PR operations
  const hasPROps = workflow.steps.some(s => 
    s.action && ['create-pr', 'review-pr', 'merge-pr'].includes(s.action)
  );
  if (hasPROps) {
    hints.push('🔀 This workflow automates PR operations - may require code review');
  }
  
  // Check for shell commands
  const hasShell = workflow.steps.some(s => s.action === 'shell');
  if (hasShell) {
    hints.push('💻 This workflow executes shell commands - review before running');
  }
  
  // Estimated duration hint
  const totalSteps = workflow.steps.length;
  if (totalSteps > 10) {
    hints.push(`⏱️ This workflow has ${totalSteps} steps - may take several minutes`);
  } else if (totalSteps > 5) {
    hints.push(`⏱️ This workflow has ${totalSteps} steps - expect moderate run time`);
  }
  
  return hints.join('\n');
}

/**
 * Format workflow start message
 */
export function formatWorkflowStart(workflow: Workflow, resume: boolean = false): string {
  const title = resume ? '🔄 Resuming' : '🚀 Starting';
  const emoji = resume ? '▶️' : '▶️';
  
  let output = `\n${'='.repeat(50)}\n`;
  output += `${title}: ${workflow.name}\n`;
  output += `${'='.repeat(50)}\n\n`;
  
  if (workflow.description) {
    output += `📝 ${workflow.description}\n\n`;
  }
  
  output += `📊 Workflow: ${workflow.name}\n`;
  output += `📋 Total Steps: ${workflow.steps.length}\n`;
  output += `💬 Interactive: ${workflow.interactive ? 'Yes' : 'No'}\n`;
  output += `💾 Persistent: ${workflow.persistent ? 'Yes' : 'No'}\n`;
  output += `\n`;
  
  const hint = getExecutionHint(workflow);
  if (hint) {
    output += `${hint}\n\n`;
  }
  
  output += `${emoji} Execution starting...\n`;
  
  return output;
}