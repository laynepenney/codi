// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { parseImageResult } from '../src/utils/image-parser.js';

describe('image-parser', () => {
  describe('parseImageResult', () => {
    it('parses valid image result', () => {
      const content = '__IMAGE__:image/png:What%20is%20in%20this%20image%3F:base64encodeddata';
      const result = parseImageResult(content);

      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('image/png');
      expect(result!.question).toBe('What is in this image?');
      expect(result!.data).toBe('base64encodeddata');
    });

    it('handles different media types', () => {
      const jpegResult = parseImageResult('__IMAGE__:image/jpeg:question:data');
      expect(jpegResult!.mediaType).toBe('image/jpeg');

      const gifResult = parseImageResult('__IMAGE__:image/gif:question:data');
      expect(gifResult!.mediaType).toBe('image/gif');

      const webpResult = parseImageResult('__IMAGE__:image/webp:question:data');
      expect(webpResult!.mediaType).toBe('image/webp');
    });

    it('decodes URL-encoded question', () => {
      const content = '__IMAGE__:image/png:Describe%20the%20colors%20and%20shapes:data';
      const result = parseImageResult(content);

      expect(result!.question).toBe('Describe the colors and shapes');
    });

    it('handles special characters in question', () => {
      const content = '__IMAGE__:image/png:What%27s%20this%3F%20%26%20why%3F:data';
      const result = parseImageResult(content);

      expect(result!.question).toBe("What's this? & why?");
    });

    it('handles colons in base64 data', () => {
      // Base64 doesn't typically contain colons, but the parser should handle it
      const content = '__IMAGE__:image/png:question:data:with:colons';
      const result = parseImageResult(content);

      expect(result!.data).toBe('data:with:colons');
    });

    it('returns null for non-image content', () => {
      const result = parseImageResult('regular text content');
      expect(result).toBeNull();
    });

    it('returns null for content starting with wrong prefix', () => {
      const result = parseImageResult('IMAGE:image/png:question:data');
      expect(result).toBeNull();
    });

    it('returns null for malformed content (too few parts)', () => {
      expect(parseImageResult('__IMAGE__:image/png:question')).toBeNull();
      expect(parseImageResult('__IMAGE__:image/png')).toBeNull();
      expect(parseImageResult('__IMAGE__:')).toBeNull();
    });

    it('handles empty question', () => {
      const content = '__IMAGE__:image/png::data';
      const result = parseImageResult(content);

      expect(result!.question).toBe('');
      expect(result!.data).toBe('data');
    });

    it('handles long base64 data', () => {
      const longData = 'a'.repeat(10000);
      const content = `__IMAGE__:image/png:question:${longData}`;
      const result = parseImageResult(content);

      expect(result!.data).toBe(longData);
      expect(result!.data.length).toBe(10000);
    });

    it('preserves exact media type string', () => {
      // Even unusual media types should be preserved
      const content = '__IMAGE__:custom/type:question:data';
      const result = parseImageResult(content);

      expect(result!.mediaType).toBe('custom/type');
    });
  });
});
