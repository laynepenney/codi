// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI utilities module.
 */

export {
  HISTORY_FILE,
  MAX_HISTORY_SIZE,
  loadHistory,
  saveToHistory,
} from './history.js';

export {
  type PipelineInputConfig,
  DEFAULT_PIPELINE_INPUT_CONFIG,
  isGlobOrFilePath,
  resolvePipelineInput,
  resolveFileList,
} from './pipeline-input.js';

export {
  type NonInteractiveResult,
  type NonInteractiveOptions,
  runNonInteractive,
} from './non-interactive.js';
