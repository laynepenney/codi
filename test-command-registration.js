// Test workflow command registration
import { getCommand, getAllCommands } from './dist/commands/index.js';

console.log('Testing command registration...\n');

// Get workflow-run command
const workflowRun = getCommand('workflow-run');
console.log('workflow-run command:', workflowRun ? '✅ Found' : '❌ Not found');
if (workflowRun) {
  console.log('  Name:', workflowRun.name);
  console.log('  Aliases:', workflowRun.aliases || 'none');
  console.log('  Description:', workflowRun.description);
}

// Get workflow command
const workflow = getCommand('workflow');
console.log('\nworkflow command:', workflow ? '✅ Found' : '❌ Not found');
if (workflow) {
  console.log('  Name:', workflow.name);
  console.log('  Description:', workflow.description);
}

// List all commands
console.log('\nAll command names:');
const allCommands = getAllCommands();
const workflowCommands = allCommands.filter(cmd => cmd.name.includes('workflow'));
workflowCommands.forEach(cmd => {
  console.log(`  ${cmd.name} - ${cmd.description}`);
});

console.log('\nTotal commands:', allCommands.length);
console.log('Workflow-related commands:', workflowCommands.length);