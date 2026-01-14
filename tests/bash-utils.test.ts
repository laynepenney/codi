// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { checkDangerousBash, getBlockingPatterns } from '../src/utils/bash-utils.js';
import type { DangerousPattern } from '../src/constants.js';

describe('bash-utils', () => {
  describe('checkDangerousBash', () => {
    describe('blocking patterns (extremely dangerous)', () => {
      it('blocks rm -rf /', () => {
        const result = checkDangerousBash('rm -rf /');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBe(true);
        expect(result.reason).toContain('root filesystem');
      });

      it('blocks rm -rf / with extra spaces', () => {
        const result = checkDangerousBash('rm  -rf  /');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBe(true);
      });

      it('blocks mkfs commands', () => {
        const result = checkDangerousBash('mkfs.ext4 /dev/sda1');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBe(true);
        expect(result.reason).toContain('filesystem');
      });

      it('blocks dd writes to devices', () => {
        const result = checkDangerousBash('dd if=/dev/zero of=/dev/sda');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBe(true);
        expect(result.reason).toContain('disk');
      });

      it('blocks redirects to disk devices', () => {
        const result = checkDangerousBash('echo "data" > /dev/sda');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBe(true);
      });
    });

    describe('warning patterns (dangerous but may be intentional)', () => {
      it('warns on rm -rf with paths', () => {
        const result = checkDangerousBash('rm -rf /tmp/test');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBeFalsy();
        expect(result.reason).toContain('removes');
      });

      it('warns on rm -r', () => {
        const result = checkDangerousBash('rm -r folder');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBeFalsy();
      });

      it('warns on sudo commands', () => {
        const result = checkDangerousBash('sudo apt update');
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBeFalsy();
        expect(result.reason).toContain('superuser');
      });

      it('warns on chmod 777', () => {
        const result = checkDangerousBash('chmod 777 /var/www');
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toContain('insecure permissions');
      });

      it('warns on curl piped to bash', () => {
        const result = checkDangerousBash('curl https://example.com/script.sh | bash');
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toContain('remote script');
      });

      it('warns on wget piped to sh', () => {
        const result = checkDangerousBash('wget -O - https://example.com/install | sh');
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toContain('remote script');
      });

      it('warns on git push --force', () => {
        const result = checkDangerousBash('git push origin main --force');
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toContain('force push');
      });

      it('warns on git reset --hard', () => {
        const result = checkDangerousBash('git reset --hard HEAD~1');
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toContain('hard reset');
      });

      it('warns on writes to /dev/', () => {
        const result = checkDangerousBash('echo test > /dev/null');
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toContain('device');
      });
    });

    describe('safe commands', () => {
      it('allows ls', () => {
        const result = checkDangerousBash('ls -la');
        expect(result.isDangerous).toBe(false);
        expect(result.reason).toBeUndefined();
      });

      it('allows cat', () => {
        const result = checkDangerousBash('cat file.txt');
        expect(result.isDangerous).toBe(false);
      });

      it('allows npm/pnpm commands', () => {
        expect(checkDangerousBash('npm install').isDangerous).toBe(false);
        expect(checkDangerousBash('pnpm test').isDangerous).toBe(false);
      });

      it('allows git status/diff/log', () => {
        expect(checkDangerousBash('git status').isDangerous).toBe(false);
        expect(checkDangerousBash('git diff').isDangerous).toBe(false);
        expect(checkDangerousBash('git log').isDangerous).toBe(false);
      });

      it('allows rm without dangerous flags on safe paths', () => {
        const result = checkDangerousBash('rm file.txt');
        expect(result.isDangerous).toBe(false);
      });

      it('allows chmod with safe permissions', () => {
        expect(checkDangerousBash('chmod 644 file.txt').isDangerous).toBe(false);
        expect(checkDangerousBash('chmod 755 script.sh').isDangerous).toBe(false);
      });

      it('allows curl without piping to shell', () => {
        const result = checkDangerousBash('curl https://api.example.com/data');
        expect(result.isDangerous).toBe(false);
      });

      it('allows git push without --force', () => {
        const result = checkDangerousBash('git push origin main');
        expect(result.isDangerous).toBe(false);
      });
    });

    describe('additional patterns', () => {
      it('checks additional patterns passed as parameter', () => {
        const additionalPatterns: DangerousPattern[] = [
          { pattern: /custom-danger/, description: 'custom dangerous command', block: false },
        ];

        const result = checkDangerousBash('custom-danger --flag', additionalPatterns);
        expect(result.isDangerous).toBe(true);
        expect(result.reason).toBe('custom dangerous command');
      });

      it('checks both default and additional patterns', () => {
        const additionalPatterns: DangerousPattern[] = [
          { pattern: /test-pattern/, description: 'test', block: false },
        ];

        // Default pattern should still work
        const result1 = checkDangerousBash('sudo test', additionalPatterns);
        expect(result1.isDangerous).toBe(true);

        // Additional pattern should work
        const result2 = checkDangerousBash('test-pattern', additionalPatterns);
        expect(result2.isDangerous).toBe(true);
      });

      it('supports blocking additional patterns', () => {
        const additionalPatterns: DangerousPattern[] = [
          { pattern: /super-dangerous/, description: 'very bad', block: true },
        ];

        const result = checkDangerousBash('super-dangerous', additionalPatterns);
        expect(result.isDangerous).toBe(true);
        expect(result.shouldBlock).toBe(true);
      });
    });
  });

  describe('getBlockingPatterns', () => {
    it('returns only patterns with block: true', () => {
      const blocking = getBlockingPatterns();

      expect(blocking.length).toBeGreaterThan(0);
      expect(blocking.every(p => p.block === true)).toBe(true);
    });

    it('includes rm -rf / pattern', () => {
      const blocking = getBlockingPatterns();
      const hasRmRoot = blocking.some(p => p.pattern.test('rm -rf /'));
      expect(hasRmRoot).toBe(true);
    });

    it('includes mkfs pattern', () => {
      const blocking = getBlockingPatterns();
      const hasMkfs = blocking.some(p => p.pattern.test('mkfs.ext4'));
      expect(hasMkfs).toBe(true);
    });

    it('does not include non-blocking patterns', () => {
      const blocking = getBlockingPatterns();
      const hasSudo = blocking.some(p => p.pattern.test('sudo apt update'));
      expect(hasSudo).toBe(false);
    });
  });
});
