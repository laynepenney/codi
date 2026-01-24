// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { validateSwitchModelStep } from '../dist/workflow/steps/switch-model.js';

describe('Model Switching Validation', () => {
  describe('validateSwitchModelStep', () => {
    it('validates switch-model step with model', () => {
      const step = {
        id: 'switch-1',
        action: 'switch-model',
        model: 'llama3.2'
      };
      
      expect(() => validateSwitchModelStep(step)).not.toThrow();
    });

    it('throws error when model is missing', () => {
      const step = {
        id: 'switch-1',
        action: 'switch-model'
        // Missing model
      };
      
      expect(() => validateSwitchModelStep(step)).toThrow('Switch-model step switch-1 must specify a model');
    });

    it('throws error when model is empty string', () => {
      const step = {
        id: 'switch-1',
        action: 'switch-model',
        model: ''
      };
      
      expect(() => validateSwitchModelStep(step)).toThrow('Switch-model step switch-1 must specify a model');
    });
  });
});