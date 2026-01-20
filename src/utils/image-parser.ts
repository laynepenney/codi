// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Image result parsing utilities.
 * Extracted from agent.ts for reusability.
 */

import type { ImageMediaType } from '../types.js';

/**
 * Parsed image result from analyze_image tool.
 */
export interface ParsedImageResult {
  mediaType: ImageMediaType;
  question: string;
  data: string;
}

/**
 * Parse an image result from the analyze_image tool.
 * Format: __IMAGE__:media_type:question:base64data
 */
export function parseImageResult(content: string): ParsedImageResult | null {
  if (!content.startsWith('__IMAGE__:')) {
    return null;
  }

  const parts = content.split(':');
  if (parts.length < 4) {
    return null;
  }

  const mediaType = parts[1] as ImageMediaType;
  const question = decodeURIComponent(parts[2]);
  // Join remaining parts in case base64 contains colons (unlikely but safe)
  const data = parts.slice(3).join(':');

  return { mediaType, question, data };
}
