// Copyright 2026 Layne Penney
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { resolve, extname } from 'path';
import { BaseTool } from './base.js';
import type { ToolDefinition, ImageMediaType } from '../types.js';

// Maximum recommended image size (5MB)
const MAX_RECOMMENDED_SIZE = 5 * 1024 * 1024;

// Map file extensions to media types
const EXTENSION_TO_MEDIA_TYPE: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Tool for analyzing images using vision-capable models.
 * Returns image data in a special format that the agent converts
 * to an image content block.
 */
export class AnalyzeImageTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: 'analyze_image',
      description:
        'Analyze an image file (screenshot, diagram, UI mockup, etc.) using vision capabilities. ' +
        'Supports JPEG, PNG, GIF, and WebP formats.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the image file to analyze',
          },
          question: {
            type: 'string',
            description: 'Optional: specific question or focus for the analysis',
          },
        },
        required: ['path'],
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input.path as string;
    const question = (input.question as string) || '';

    if (!path) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(process.cwd(), path);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Image file not found: ${resolvedPath}`);
    }

    // Check file extension
    const ext = extname(resolvedPath).toLowerCase();
    const mediaType = EXTENSION_TO_MEDIA_TYPE[ext];

    if (!mediaType) {
      throw new Error(
        `Unsupported image format: ${ext}. Supported formats: JPEG, PNG, GIF, WebP`
      );
    }

    // Check file size
    const stats = statSync(resolvedPath);
    if (stats.size > MAX_RECOMMENDED_SIZE) {
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      console.warn(
        `Warning: Image is ${sizeMB}MB. Large images may use significant context tokens.`
      );
    }

    // Read and encode the image
    const imageBuffer = await readFile(resolvedPath);
    const base64Data = imageBuffer.toString('base64');

    // Return in special format for the agent to parse
    // Format: __IMAGE__:media_type:question:base64data
    return `__IMAGE__:${mediaType}:${encodeURIComponent(question)}:${base64Data}`;
  }
}
