// Test workflow commands in app context
import { registerWorkflowCommands } from './dist/commands/workflow-commands.js';
import { getCommand, getAllCommands } from './dist/commands/index.js';

console.log('Registering workflow commands...\n');
registerWorkflowCommands();

console.log('Command counts after registration:');
const allCommands = getAllCommands();
console.log('Total commands:', allCommands.length);

// Check specific commands
const workflow = getCommand('workflow');
const workflowRun = getCommand('workflow-run');
const workflowAlias = getCommand('wr');

console.log('\nWorkflow commands:');
console.log('  workflow:', workflow ? '✅ Found' : '❌ Not found');
console.log('  workflow-run:', workflowRun ? '✅ Found' : '❌ Not found');
console.log('  wr (alias):', workflowAlias ? '✅ Found' : '❌ Not found');

if (workflow) {
  console.log('\nworkflow command details:');
  console.log('  Description:', workflow.description);
  console.log('  Usage:', workflow.usage);
}

if (workflowRun) {
  console.log('\nworkflow-run command details:');
  console.log('  Description:', workflowRun.description);
  console.log('  Usage:', workflowRun.usage);
}