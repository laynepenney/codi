#!/usr/bin/env node

// Test script for workflow-build command
const { spawnSync } = require('child_process');

console.log('🧪 Testing workflow-build command...');

// Test 1: Show templates
const templatesResult = spawnSync('node', ['-e', `
  const { workflowBuildCommand } = require('./dist/src/commands/workflow-ai-builder.js');
  workflowBuildCommand.execute('template list', {}).then(console.log).catch(console.error);
`], { encoding: 'utf8' });

console.log('Template List Test:');
console.log(templatesResult.stdout || templatesResult.stderr);

// Test 2: Generate from template
const templateGenResult = spawnSync('node', ['-e', `
  const { workflowBuildCommand } = require('./dist/src/commands/workflow-ai-builder.js');
  workflowBuildCommand.execute('template deployment', {}).then(console.log).catch(console.error);
`], { encoding: 'utf8' });

console.log('Template Generation Test:');
console.log(templateGenResult.stdout || templateGenResult.stderr);

// List generated workflows
const fs = require('fs');
if (fs.existsSync('./workflows')) {
  console.log('Generated workflows:');
  console.log(fs.readdirSync('./workflows').join('\n'));
}