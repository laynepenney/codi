/**
 * Test V4 pipeline with concurrency=4
 */
import { glob } from 'glob';
import { initModelMap } from '../src/model-map/index.js';
import type { IterativeResult, SymbolicationResult, TriageResult } from '../src/model-map/types.js';

async function main() {
  const CONCURRENCY = 4;

  console.log('V4 Pipeline Test - Full src/** (concurrency=' + CONCURRENCY + ')');
  console.log();

  // Load model map
  const modelMap = initModelMap('.');
  if (!modelMap) {
    console.error('Failed to load model map');
    process.exit(1);
  }
  const { executor, registry } = modelMap;

  // Get files
  const files = await glob('src/**/*.ts', { ignore: ['**/node_modules/**'] });
  console.log(`Files: ${files.length}`);
  console.log();

  const startTime = Date.now();
  let symbolicationTime = 0;
  let triageTime = 0;
  let processingStartTime = 0;

  // Execute V4
  const result: IterativeResult = await executor.executeIterativeV4('code-review', files, {
    providerContext: 'ollama-cloud',
    concurrency: CONCURRENCY,
    enableTriage: true,
    enableSymbolication: true,
    includeNavigationContext: true,
    includeRelatedContext: true,
    triage: {
      role: 'fast',
      deepThreshold: 6,
      skipThreshold: 3,
    },
    callbacks: {
      onSymbolicationStart: (totalFiles: number) => {
        console.log(`Phase 0: Symbolicating ${totalFiles} files...`);
      },
      onSymbolicationComplete: (result: SymbolicationResult) => {
        const meta = result.structure.metadata;
        console.log(`  Files: ${meta.totalFiles}`);
        console.log(`  Symbols: ${meta.totalSymbols}`);
        console.log(`  Entry points: ${result.structure.dependencyGraph.entryPoints.length}`);
        console.log(`  Barrel files: ${result.structure.barrelFiles.length}`);
        console.log(`  Cycles: ${result.structure.dependencyGraph.cycles.length}`);
        console.log(`  Time: ${(result.duration / 1000).toFixed(1)}s`);
        symbolicationTime = result.duration;
        console.log();
      },
      onTriageStart: (totalFiles: number) => {
        console.log(`Phase 1: Triaging ${totalFiles} files (with connectivity)...`);
      },
      onTriageComplete: (triageResult: TriageResult) => {
        console.log(`  Critical: ${triageResult.criticalPaths.length}`);
        console.log(`  Normal: ${triageResult.normalPaths.length}`);
        console.log(`  Skip: ${triageResult.skipPaths.length}`);
        console.log(`  Time: ${((triageResult.duration || 0) / 1000).toFixed(1)}s`);
        triageTime = triageResult.duration || 0;
        console.log();
        console.log(`Phase 2: Processing files (concurrency=${CONCURRENCY})...`);
        processingStartTime = Date.now();
      },
      onFileStart: (file: string, index: number, total: number) => {
        process.stdout.write(`  [${index + 1}/${total}] ${file.split('/').pop()}\r`);
      },
      onFileComplete: (file: string, _result: string) => {
        // Clear line
      },
      onError: (file: string, error: Error) => {
        console.log(`  SKIP ${file.split('/').pop()}: ${error.message.slice(0, 60)}`);
      },
    },
  });

  const processingTime = Date.now() - processingStartTime;
  const totalTime = Date.now() - startTime;

  console.log();
  console.log(`Phase 3: Aggregating results...`);
  console.log();
  console.log();
  console.log('========== V4 RESULTS ==========');
  const skippedCount = result.skippedFiles?.length || 0;
  console.log(`Files processed: ${result.filesProcessed}/${result.totalFiles}`);
  console.log(`Skipped (errors): ${skippedCount}`);
  console.log(`Models used: ${result.modelsUsed.join(', ')}`);
  console.log();
  console.log('Timing:');
  console.log(`  Symbolication: ${(symbolicationTime / 1000).toFixed(1)}s`);
  console.log(`  Triage: ${(triageTime / 1000).toFixed(1)}s`);
  console.log(`  Processing: ${(processingTime / 1000).toFixed(1)}s`);
  const aggregationTime = result.timing?.aggregation || 0;
  console.log(`  Aggregation: ${(aggregationTime / 1000).toFixed(1)}s`);
  console.log(`  TOTAL: ${(totalTime / 1000).toFixed(1)}s (${(totalTime / 60000).toFixed(1)} min)`);
  console.log();
  console.log('========== AGGREGATED OUTPUT ==========');
  const output = result.aggregatedOutput || '(no aggregated output)';
  console.log(output.slice(0, 3000));
  if (output.length > 3000) {
    console.log(`\n... (${output.length - 3000} more chars)`);
  }
  console.log();

  // Cleanup
  modelMap.shutdown();
}

main().catch(console.error);
