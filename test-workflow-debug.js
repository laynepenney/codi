// Test workflow system programmatically
import { WorkflowManager } from './dist/workflow/index.js';
import { getWorkflowByName, loadWorkflow } from './dist/workflow/index.js';

async function testWorkflowSystem() {
  console.log('Testing Workflow System...\n');

  const manager = new WorkflowManager();
  
  // List available workflows
  const workflows = manager.listAvailableWorkflows();
  console.log('Available workflows:');
  workflows.forEach(wf => {
    console.log(`${wf.name} - ${wf.file} - Valid: ${wf.valid}`);
  });

  // Debug: Try loading workflow manually
  console.log('\nDebug loading workflows:');
  try {
    const manualLoad = loadWorkflow('workflows/test-switch-demo.yaml');
    console.log('✅ Manual load successful:', manualLoad.name);
  } catch (error) {
    console.log('❌ Manual load failed:', error.message);
  }

  try {
    const manualLoad2 = loadWorkflow('workflows/test-model-switch.yaml');
    console.log('✅ Manual load2 successful:', manualLoad2.name);
  } catch (error) {
    console.log('❌ Manual load2 failed:', error.message);
  }

  // Try getWorkflowByName
  console.log('\nTesting getWorkflowByName:');
  try {
    const workflow = getWorkflowByName('test-model-switch');
    console.log('✅ Found workflow:', workflow?.name);
    console.log('Steps:', workflow?.steps?.length);
  } catch (error) {
    console.log('❌ Not found:', error.message);
  }

  console.log('\nDone');
}

testWorkflowSystem().catch(console.error);