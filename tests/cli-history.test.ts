// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { containsSensitivePattern } from '../src/cli/history.js';

describe('CLI History - Sensitive Pattern Filtering', () => {
  describe('containsSensitivePattern', () => {
    describe('should detect API key patterns', () => {
      it('detects api_key assignment', () => {
        expect(containsSensitivePattern('api_key=sk-12345')).toBe(true);
        expect(containsSensitivePattern('API_KEY: abc123')).toBe(true);
        expect(containsSensitivePattern('apiKey=token')).toBe(true);
      });

      it('detects --key flag', () => {
        expect(containsSensitivePattern('command --key=secret')).toBe(true);
        expect(containsSensitivePattern('command --key secret')).toBe(true);
      });

      it('detects --token flag', () => {
        expect(containsSensitivePattern('command --token=secret')).toBe(true);
        expect(containsSensitivePattern('command --token secret')).toBe(true);
      });

      it('detects --api-key flag', () => {
        expect(containsSensitivePattern('command --api-key=secret')).toBe(true);
        expect(containsSensitivePattern('command --api-key secret')).toBe(true);
      });

      it('detects auth_token assignment', () => {
        expect(containsSensitivePattern('auth_token=xyz')).toBe(true);
        expect(containsSensitivePattern('AUTH_TOKEN: abc')).toBe(true);
      });

      it('detects Bearer token', () => {
        expect(containsSensitivePattern('Authorization: Bearer abc123xyz')).toBe(true);
        expect(containsSensitivePattern('bearer eyJhbGciOiJIUzI1')).toBe(true);
      });
    });

    describe('should detect password patterns', () => {
      it('detects password assignment', () => {
        expect(containsSensitivePattern('password=secret123')).toBe(true);
        expect(containsSensitivePattern('PASSWORD: mypassword')).toBe(true);
        expect(containsSensitivePattern('passwd=pass')).toBe(true);
      });

      it('detects --password flag', () => {
        expect(containsSensitivePattern('mysql --password=secret')).toBe(true);
        expect(containsSensitivePattern('mysql --password secret')).toBe(true);
      });

      it('detects secret assignment', () => {
        expect(containsSensitivePattern('secret=abc123')).toBe(true);
        expect(containsSensitivePattern('SECRET: xyz789')).toBe(true);
      });
    });

    describe('should detect known API key formats', () => {
      it('detects OpenAI key format', () => {
        expect(containsSensitivePattern('sk-abcdefghijklmnopqrstuvwxyz12345')).toBe(true);
        expect(containsSensitivePattern('export OPENAI_API_KEY=sk-proj-abc123')).toBe(true);
      });

      it('detects Anthropic key format', () => {
        expect(containsSensitivePattern('sk-ant-api03-abcdefghijklmnop')).toBe(true);
      });

      it('detects Slack bot token format', () => {
        expect(containsSensitivePattern('xoxb-12345-67890-abcdef')).toBe(true);
      });

      it('detects GitHub PAT format', () => {
        expect(containsSensitivePattern('ghp_abcdefghijklmnop123456')).toBe(true);
      });
    });

    describe('should detect environment variable assignments', () => {
      it('detects ANTHROPIC_API_KEY', () => {
        expect(containsSensitivePattern('ANTHROPIC_API_KEY=sk-ant-xxx')).toBe(true);
        expect(containsSensitivePattern('export ANTHROPIC_API_KEY=xxx')).toBe(true);
      });

      it('detects OPENAI_API_KEY', () => {
        expect(containsSensitivePattern('OPENAI_API_KEY=sk-xxx')).toBe(true);
      });

      it('detects generic API_KEY', () => {
        expect(containsSensitivePattern('API_KEY=xxx')).toBe(true);
      });

      it('detects SECRET_KEY', () => {
        expect(containsSensitivePattern('SECRET_KEY=abc123')).toBe(true);
      });

      it('detects AUTH_TOKEN', () => {
        expect(containsSensitivePattern('AUTH_TOKEN=bearer-xxx')).toBe(true);
      });
    });

    describe('should allow safe commands', () => {
      it('allows normal commands', () => {
        expect(containsSensitivePattern('git status')).toBe(false);
        expect(containsSensitivePattern('npm install')).toBe(false);
        expect(containsSensitivePattern('ls -la')).toBe(false);
        expect(containsSensitivePattern('cat file.txt')).toBe(false);
      });

      it('allows commands mentioning password without values', () => {
        expect(containsSensitivePattern('explain how to reset password')).toBe(false);
        expect(containsSensitivePattern('help me with API key rotation')).toBe(false);
      });

      it('allows code review requests', () => {
        expect(containsSensitivePattern('/review src/auth.ts')).toBe(false);
        expect(containsSensitivePattern('explain the token validation logic')).toBe(false);
      });

      it('allows slash commands', () => {
        expect(containsSensitivePattern('/help')).toBe(false);
        expect(containsSensitivePattern('/commit fix: update auth flow')).toBe(false);
        expect(containsSensitivePattern('/refactor src/secret-manager.ts')).toBe(false);
      });

      it('allows file operations on sensitive-sounding files', () => {
        expect(containsSensitivePattern('read_file src/api-key-manager.ts')).toBe(false);
        expect(containsSensitivePattern('edit password-reset.ts')).toBe(false);
      });
    });
  });
});
