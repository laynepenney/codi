// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnalyzeImageTool } from '../src/tools/analyze-image.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AnalyzeImageTool', () => {
  let tool: AnalyzeImageTool;
  let testDir: string;

  beforeEach(() => {
    tool = new AnalyzeImageTool();
    testDir = join(tmpdir(), `.codi-image-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getDefinition', () => {
    it('returns correct tool definition', () => {
      const def = tool.getDefinition();
      expect(def.name).toBe('analyze_image');
      expect(def.description).toContain('Analyze an image file');
      expect(def.input_schema.properties).toHaveProperty('path');
      expect(def.input_schema.properties).toHaveProperty('question');
      expect(def.input_schema.required).toContain('path');
    });
  });

  describe('execute', () => {
    it('throws error when path is missing', async () => {
      await expect(tool.execute({})).rejects.toThrow('Path is required');
    });

    it('throws error when file does not exist', async () => {
      await expect(tool.execute({ path: '/nonexistent/image.png' }))
        .rejects.toThrow('Image file not found');
    });

    it('throws error for unsupported format', async () => {
      const txtFile = join(testDir, 'test.txt');
      writeFileSync(txtFile, 'not an image');

      await expect(tool.execute({ path: txtFile }))
        .rejects.toThrow('Unsupported image format');
    });

    it('processes JPEG file correctly', async () => {
      // Create a minimal valid JPEG (just header bytes for testing)
      const jpgFile = join(testDir, 'test.jpg');
      const jpgHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
      writeFileSync(jpgFile, jpgHeader);

      const result = await tool.execute({ path: jpgFile });
      expect(result).toMatch(/^__IMAGE__:image\/jpeg:/);
    });

    it('processes PNG file correctly', async () => {
      // Create a minimal valid PNG header
      const pngFile = join(testDir, 'test.png');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      writeFileSync(pngFile, pngHeader);

      const result = await tool.execute({ path: pngFile });
      expect(result).toMatch(/^__IMAGE__:image\/png:/);
    });

    it('processes GIF file correctly', async () => {
      const gifFile = join(testDir, 'test.gif');
      const gifHeader = Buffer.from('GIF89a');
      writeFileSync(gifFile, gifHeader);

      const result = await tool.execute({ path: gifFile });
      expect(result).toMatch(/^__IMAGE__:image\/gif:/);
    });

    it('processes WebP file correctly', async () => {
      const webpFile = join(testDir, 'test.webp');
      // Minimal RIFF/WEBP header
      const webpHeader = Buffer.from('RIFF\x00\x00\x00\x00WEBP');
      writeFileSync(webpFile, webpHeader);

      const result = await tool.execute({ path: webpFile });
      expect(result).toMatch(/^__IMAGE__:image\/webp:/);
    });

    it('includes question in result', async () => {
      const pngFile = join(testDir, 'test.png');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      writeFileSync(pngFile, pngHeader);

      const result = await tool.execute({
        path: pngFile,
        question: 'What is in this image?'
      });

      expect(result).toContain('What%20is%20in%20this%20image%3F');
    });

    it('handles empty question', async () => {
      const pngFile = join(testDir, 'test.png');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      writeFileSync(pngFile, pngHeader);

      const result = await tool.execute({ path: pngFile, question: '' });
      // Empty question should be encoded as empty string
      expect(result).toMatch(/^__IMAGE__:image\/png::/);
    });

    it('encodes image data as base64', async () => {
      const pngFile = join(testDir, 'test.png');
      const pngData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      writeFileSync(pngFile, pngData);

      const result = await tool.execute({ path: pngFile });
      const parts = result.split(':');
      const base64Data = parts.slice(3).join(':');

      // Verify it's valid base64
      expect(() => Buffer.from(base64Data, 'base64')).not.toThrow();

      // Verify it decodes back to original
      const decoded = Buffer.from(base64Data, 'base64');
      expect(decoded.equals(pngData)).toBe(true);
    });

    it('handles relative paths', async () => {
      const pngFile = join(testDir, 'test.png');
      writeFileSync(pngFile, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

      // Save and change cwd
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await tool.execute({ path: 'test.png' });
        expect(result).toMatch(/^__IMAGE__:image\/png:/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
