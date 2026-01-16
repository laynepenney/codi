// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  summarizeToolResult,
  truncateOldToolResults,
} from '../src/utils/tool-result-utils.js';
import { AGENT_CONFIG } from '../src/constants.js';
import type { Message, ContentBlock } from '../src/types.js';

describe('tool-result-utils', () => {
  describe('summarizeToolResult', () => {
    describe('error summaries', () => {
      it('creates error summary with first line', () => {
        const result = summarizeToolResult(
          'read_file',
          'File not found: /path/to/file.txt\nStack trace...',
          true
        );

        expect(result).toContain('[read_file ERROR:');
        expect(result).toContain('File not found');
        expect(result).not.toContain('Stack trace');
      });

      it('truncates long error messages', () => {
        const longError = 'A'.repeat(200) + '\nSecond line';
        const result = summarizeToolResult('bash', longError, true);

        expect(result).toContain('...');
        expect(result.length).toBeLessThan(200);
      });
    });

    describe('read_file summaries', () => {
      it('shows line and char counts', () => {
        const content = 'line 1\nline 2\nline 3';
        const result = summarizeToolResult('read_file', content, false);

        expect(result).toContain('[read_file:');
        expect(result).toContain('3 lines');
        expect(result).toContain(`${content.length} chars`);
      });
    });

    describe('list_directory summaries', () => {
      it('shows line and char counts', () => {
        const content = 'file1.txt\nfile2.txt\ndir1/';
        const result = summarizeToolResult('list_directory', content, false);

        expect(result).toContain('[list_directory:');
        expect(result).toContain('3 lines');
      });
    });

    describe('glob summaries', () => {
      it('shows match count', () => {
        const content = 'src/file1.ts\nsrc/file2.ts\n';
        const result = summarizeToolResult('glob', content, false);

        expect(result).toContain('[glob:');
        expect(result).toContain('2 matches');
      });

      it('handles empty results', () => {
        const result = summarizeToolResult('glob', '', false);
        expect(result).toContain('0 matches');
      });

      it('ignores blank lines in count', () => {
        const content = 'file1.ts\n\nfile2.ts\n\n';
        const result = summarizeToolResult('glob', content, false);

        expect(result).toContain('2 matches');
      });
    });

    describe('grep summaries', () => {
      it('shows match count', () => {
        const content = 'file1.ts:10:match1\nfile2.ts:20:match2';
        const result = summarizeToolResult('grep', content, false);

        expect(result).toContain('[grep:');
        expect(result).toContain('2 matches');
      });
    });

    describe('bash summaries', () => {
      it('shows preview of output', () => {
        const content = 'command output here';
        const result = summarizeToolResult('bash', content, false);

        expect(result).toContain('[bash:');
        expect(result).toContain('command output here');
        expect(result).toContain('1 lines');
      });

      it('replaces newlines with spaces in preview', () => {
        const content = 'line 1\nline 2\nline 3';
        const result = summarizeToolResult('bash', content, false);

        expect(result).toContain('line 1 line 2');
      });

      it('truncates long output', () => {
        const content = 'A'.repeat(200);
        const result = summarizeToolResult('bash', content, false);

        expect(result).toContain('...');
      });
    });

    describe('file modification tool summaries', () => {
      it('summarizes write_file as success', () => {
        const result = summarizeToolResult('write_file', 'File written successfully', false);
        expect(result).toBe('[write_file: success]');
      });

      it('summarizes edit_file as success', () => {
        const result = summarizeToolResult('edit_file', 'Edit applied', false);
        expect(result).toBe('[edit_file: success]');
      });

      it('summarizes insert_line as success', () => {
        const result = summarizeToolResult('insert_line', 'Line inserted', false);
        expect(result).toBe('[insert_line: success]');
      });

      it('summarizes patch_file as success', () => {
        const result = summarizeToolResult('patch_file', 'Patch applied', false);
        expect(result).toBe('[patch_file: success]');
      });
    });

    describe('default summaries', () => {
      it('shows line and char counts for unknown tools', () => {
        const content = 'some\noutput\nhere';
        const result = summarizeToolResult('custom_tool', content, false);

        expect(result).toContain('[custom_tool:');
        expect(result).toContain('3 lines');
        expect(result).toContain(`${content.length} chars`);
      });
    });
  });

  describe('truncateOldToolResults', () => {
    function createToolResultMessage(toolName: string, content: string): Message {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: `id_${Date.now()}`,
            name: toolName,
            content,
          },
        ],
      };
    }

    function createTextMessage(text: string): Message {
      return {
        role: 'assistant',
        content: text,
      };
    }

    it('truncates old tool results', () => {
      const longContent = 'A'.repeat(AGENT_CONFIG.TOOL_RESULT_TRUNCATE_THRESHOLD + 50);
      const messages: Message[] = [
        createToolResultMessage('read_file', longContent),
        createTextMessage('Response 1'),
      ];

      for (let i = 0; i < AGENT_CONFIG.RECENT_TOOL_RESULTS_TO_KEEP; i++) {
        messages.push(createToolResultMessage('read_file', 'OK'));
        messages.push(createTextMessage(`Response ${i + 2}`));
      }

      truncateOldToolResults(messages);

      // First two tool results should be truncated
      const firstContent = (messages[0].content as ContentBlock[])[0];
      expect(firstContent.type).toBe('tool_result');
      expect((firstContent as any).content).toContain('[read_file:');
      expect((firstContent as any).content.length).toBeLessThan(100);

      // Recent tool results should remain intact
      const lastContent = (messages[messages.length - 2].content as ContentBlock[])[0];
      expect((lastContent as any).content).toBe('OK');
    });

    it('preserves short tool results', () => {
      const shortContent = 'OK';
      const messages: Message[] = [
        createToolResultMessage('write_file', shortContent),
        createTextMessage('Response'),
      ];

      truncateOldToolResults(messages);

      const content = (messages[0].content as ContentBlock[])[0];
      expect((content as any).content).toBe(shortContent);
    });

    it('handles messages without tool results', () => {
      const messages: Message[] = [
        createTextMessage('Hello'),
        createTextMessage('World'),
      ];

      // Should not throw
      truncateOldToolResults(messages);

      expect(messages[0].content).toBe('Hello');
      expect(messages[1].content).toBe('World');
    });

    it('handles mixed content blocks', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: 'Some text' },
            {
              type: 'tool_result' as const,
              tool_use_id: 'id1',
              name: 'read_file',
              content: 'A'.repeat(AGENT_CONFIG.TOOL_RESULT_TRUNCATE_THRESHOLD + 50),
            },
          ],
        },
      ];

      truncateOldToolResults(messages);

      const content = messages[0].content as ContentBlock[];
      expect(content[0].type).toBe('text');
      expect((content[0] as any).text).toBe('Some text');
    });

    it('handles empty messages array', () => {
      const messages: Message[] = [];
      truncateOldToolResults(messages);
      expect(messages).toEqual([]);
    });

    it('preserves tool result metadata when truncating', () => {
      const messages: Message[] = [
        createToolResultMessage('read_file', 'A'.repeat(AGENT_CONFIG.TOOL_RESULT_TRUNCATE_THRESHOLD + 50)),
        createTextMessage('Response 1'),
      ];

      for (let i = 0; i < AGENT_CONFIG.RECENT_TOOL_RESULTS_TO_KEEP; i++) {
        messages.push(createToolResultMessage('read_file', 'OK'));
        messages.push(createTextMessage(`Response ${i + 2}`));
      }

      // Mark first as error
      ((messages[0].content as ContentBlock[])[0] as any).is_error = true;

      truncateOldToolResults(messages);

      const firstContent = (messages[0].content as ContentBlock[])[0] as any;
      expect(firstContent.type).toBe('tool_result');
      expect(firstContent.tool_use_id).toBeDefined();
      expect(firstContent.content).toContain('ERROR');
    });
  });
});
