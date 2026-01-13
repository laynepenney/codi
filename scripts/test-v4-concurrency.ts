/**
 * Test V4 pipeline with retry-until-100% success
 */
import { glob } from 'glob';
import { initModelMap } from '../src/model-map/index.js';
import type { IterativeResult, SymbolicationResult, TriageResult, CodebaseStructure } from '../src/model-map/types.js';

const CONCURRENCY = 2; // Conservative for Ollama rate limits
const MAX_RETRY_ROUNDS = 10; // Maximum retry rounds
const COOLDOWN_MS = 30000; // 30 second cooldown between retry rounds

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('V4 Pipeline Test - Retry Until 100%');
  console.log(`Concurrency: ${CONCURRENCY}, Max Rounds: ${MAX_RETRY_ROUNDS}`);
  console.log();

  // Load model map
  const modelMap = initModelMap('.');
  if (!modelMap) {
    console.error('Failed to load model map');
    process.exit(1);
  }
  const { executor } = modelMap;

  // Get all files
  const allFiles = await glob('src/**/*.ts', { ignore: ['**/node_modules/**'] });
  console.log(`Total files: ${allFiles.length}`);
  console.log();

  const globalStartTime = Date.now();

  // Track results across all rounds
  const allResults = new Map<string, string>(); // file -> output
  let filesToProcess = [...allFiles];
  let structure: CodebaseStructure | undefined;
  let round = 0;

  // Initial symbolication (only once, on all files)
  console.log('Phase 0: Building codebase structure...');
  const symbStartTime = Date.now();

  // Import Phase0Symbolication to build structure without processing
  const { Phase0Symbolication } = await import('../src/model-map/symbols/index.js');
  const phase0 = new Phase0Symbolication({ projectRoot: '.' });
  const symbResult = await phase0.buildStructure({
    files: allFiles,
    criticalFiles: phase0.selectCriticalFiles(allFiles),
    buildDependencyGraph: true,
    resolveBarrels: true,
  });
  structure = symbResult.structure;
  const meta = structure.metadata;
  console.log(`  Files: ${meta.totalFiles}, Symbols: ${meta.totalSymbols}`);
  console.log(`  Entry points: ${structure.dependencyGraph.entryPoints.length}`);
  console.log(`  Barrel files: ${structure.barrelFiles.length}`);
  console.log(`  Time: ${(symbResult.duration / 1000).toFixed(1)}s`);
  console.log();

  // Process in rounds until 100% or max rounds reached
  while (filesToProcess.length > 0 && round < MAX_RETRY_ROUNDS) {
    round++;
    console.log(`\n========== ROUND ${round}/${MAX_RETRY_ROUNDS} ==========`);
    console.log(`Files to process: ${filesToProcess.length}`);
    console.log();

    const roundStartTime = Date.now();
    const roundSuccesses: string[] = [];
    const roundFailures: string[] = [];

    // Process files in this round
    console.log(`Processing (concurrency=${CONCURRENCY})...`);

    const result: IterativeResult = await executor.executeIterativeV4('code-review', filesToProcess, {
      providerContext: 'ollama-cloud',
      concurrency: CONCURRENCY,
      enableTriage: round === 1, // Only triage on first round
      enableSymbolication: false, // Already done
      structure, // Pass pre-built structure
      includeNavigationContext: true,
      includeRelatedContext: true,
      triage: {
        role: 'fast',
        deepThreshold: 6,
        skipThreshold: 3,
      },
      aggregation: {
        enabled: false, // We'll aggregate at the end
      },
      callbacks: {
        onTriageStart: (totalFiles: number) => {
          console.log(`  Triaging ${totalFiles} files...`);
        },
        onTriageComplete: (triageResult: TriageResult) => {
          console.log(`  Critical: ${triageResult.criticalPaths.length}, Normal: ${triageResult.normalPaths.length}, Skip: ${triageResult.skipPaths.length}`);
        },
        onFileStart: (file: string, index: number, total: number) => {
          process.stdout.write(`  [${index + 1}/${total}] ${file.split('/').pop()}        \r`);
        },
        onFileComplete: (file: string, output: string) => {
          roundSuccesses.push(file);
          allResults.set(file, output);
        },
        onError: (file: string, error: Error) => {
          roundFailures.push(file);
          console.log(`  FAIL ${file.split('/').pop()}: ${error.message.slice(0, 50)}`);
        },
      },
    });

    const roundTime = Date.now() - roundStartTime;

    console.log();
    console.log(`Round ${round} complete:`);
    console.log(`  Succeeded: ${roundSuccesses.length}`);
    console.log(`  Failed: ${roundFailures.length}`);
    console.log(`  Time: ${(roundTime / 1000).toFixed(1)}s`);
    console.log(`  Total progress: ${allResults.size}/${allFiles.length} (${Math.round(allResults.size / allFiles.length * 100)}%)`);

    // Update files to process for next round
    filesToProcess = roundFailures;

    // If there are still failures and we have more rounds, wait for cooldown
    if (filesToProcess.length > 0 && round < MAX_RETRY_ROUNDS) {
      console.log(`\nCooldown: waiting ${COOLDOWN_MS / 1000}s before retry...`);
      await sleep(COOLDOWN_MS);
    }
  }

  const totalTime = Date.now() - globalStartTime;

  // Final results
  console.log('\n\n========== FINAL RESULTS ==========');
  console.log(`Files processed: ${allResults.size}/${allFiles.length} (${Math.round(allResults.size / allFiles.length * 100)}%)`);
  console.log(`Rounds used: ${round}`);
  console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s (${(totalTime / 60000).toFixed(1)} min)`);

  if (filesToProcess.length > 0) {
    console.log(`\nStill failed (${filesToProcess.length}):`);
    filesToProcess.slice(0, 10).forEach(f => console.log(`  - ${f}`));
    if (filesToProcess.length > 10) {
      console.log(`  ... and ${filesToProcess.length - 10} more`);
    }
  } else {
    console.log('\n✓ 100% SUCCESS!');
  }

  // Aggregate all results
  if (allResults.size > 0) {
    console.log('\nPhase 3: Aggregating all results...');
    const aggStartTime = Date.now();

    // Convert results to the format expected by aggregation
    const fileResults = new Map<string, { output: string }>();
    for (const [file, output] of allResults) {
      fileResults.set(file, { output });
    }

    // Run aggregation only
    const aggResult = await executor.executeIterativeV4('code-review', Array.from(allResults.keys()).slice(0, 1), {
      providerContext: 'ollama-cloud',
      concurrency: 1,
      enableTriage: false,
      enableSymbolication: false,
      structure,
      aggregation: {
        enabled: true,
      },
    });

    // Actually we need to aggregate manually since the results are spread across rounds
    // For now just show summary
    console.log(`  Time: ${((Date.now() - aggStartTime) / 1000).toFixed(1)}s`);
    console.log(`  Results collected: ${allResults.size} files`);
  }

  // Cleanup
  modelMap.shutdown();
}

main().catch(console.error);
