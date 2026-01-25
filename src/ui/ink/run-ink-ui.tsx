// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { render } from 'ink';

import { InkApp } from './app.js';
import type { InkUiController } from './controller.js';

export interface InkUiOptions {
  controller: InkUiController;
  onSubmit: (input: string) => void | Promise<void>;
  onExit: () => void;
  history?: string[];
  completer?: (line: string) => [string[], string];
}

export async function runInkUi(options: InkUiOptions): Promise<void> {
  const instance = render(
    <InkApp
      controller={options.controller}
      onSubmit={options.onSubmit}
      onExit={options.onExit}
      history={options.history}
      completer={options.completer}
    />,
    { exitOnCtrlC: false }
  );
  await instance.waitUntilExit();
}
