// Test workflow system programmatically
import { WorkflowManager } from './dist/workflow/index.js';
import { loadWorkflow, getWorkflowByName } from './dist/workflow/index.js';

async function testWorkflowSystem() {
  console.log('Testing Workflow System...\n');

  // Test 1: List available workflows
  const manager = new WorkflowManager();
  const workflows = manager.listAvailableWorkflows();
  
  console.log('Available workflows:');
  workflows.forEach(wf => {
    const status = wf.valid ? '✅' : '❌';
    console.log(`${status} ${wf.name} - ${wf.file}`);
  });

  // Test 2: Validate a workflow
  try {
    const workflow = getWorkflowByName('test-switch-demo');
    console.log('\n✅ Workflow "test-switch-demo" is valid');
    console.log(`Steps: ${workflow.steps.length}`);
    
    console.log('\nWorkflow steps:');
    workflow.steps.forEach((step, index) => {
      console.log(`${index + 1}. [${step.id}] ${step.action}`);
      if (step.action === 'switch-model' && step.model) {
        console.log(`   Model: ${step.model}`);
      }
    });
  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  // Test 3: Try to validate non-existent workflow
  try {
    const workflow = getWorkflowByName('non-existent');
    console.log('\n❌ Should not reach here');
  } catch (error) {
    console.log('\n✅ Correctly rejected non-existent workflow');
  }

  console.log('\n✅ Workflow system tests completed');
}

testWorkflowSystem().catch(console.error);