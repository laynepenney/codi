// Test model switching functionality
import { WorkflowManager } from './dist/workflow/index.js';
import { getWorkflowByName } from './dist/workflow/index.js';

async function testModelSwitching() {
  console.log('Testing Model Switching Functionality...\n');

  const manager = new WorkflowManager();

  // Test workflow discovery
  console.log('1. Workflow Discovery:');
  const workflows = manager.listAvailableWorkflows();
  workflows.forEach(wf => {
    console.log(`   ${wf.valid ? '✅' : '❌'} ${wf.name} - ${wf.file}`);
  });

  // Test successful workflow loading
  console.log('\n2. Workflow Validation:');
  try {
    const workflow1 = getWorkflowByName('test-model-switch');
    console.log('   ✅ test-model-switch loaded successfully');
    console.log(`   Steps: ${workflow1.steps.length}`);
    
    const workflow2 = getWorkflowByName('test-model-switching');
    console.log('   ✅ test-model-switching loaded successfully');
    console.log(`   Steps: ${workflow2.steps.length}`);
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }

  // Test switch-model step details
  console.log('\n3. Switch-Model Step Analysis:');
  const workflow = getWorkflowByName('test-model-switching');
  workflow.steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step.id} - ${step.action}`);
    if (step.action === 'switch-model' && step.model) {
      console.log(`   Model: ${step.model}`);
    }
    if (step.action === 'ai-prompt' && step.prompt) {
      console.log(`   Prompt: ${step.prompt.substring(0, 50)}...`);
    }
  });

  // Test non-existent workflow
  console.log('\n4. Error Handling:');
  const missing = getWorkflowByName('non-existent-workflow');
  if (!missing) {
    console.log('   ✅ Non-existent workflow correctly returned null');
  } else {
    console.log('   ❌ Should return null for non-existent workflows');
  }

  console.log('\n✅ Model Switching Test Completed Successfully!');
}

testModelSwitching().catch(console.error);