// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useEffect, useRef } from 'react';
import { Text, useApp, useInput } from 'ink';

export interface CompletableInputProps {
  value: string;
  placeholder?: string;
  focus?: boolean;
  showCursor?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onTab?: (value: string) => string | null;
}

export function CompletableInput({
  value,
  placeholder,
  focus,
  showCursor = true,
  onChange,
  onSubmit,
  onTab,
}: CompletableInputProps) {
  const { exit } = useApp();
  const [cursorIndex, setCursorIndex] = useState(value.length);
  const cursorPositionRef = useRef(cursorIndex);

  // Sync cursor position with value changes
  useEffect(() => {
    cursorPositionRef.current = Math.min(cursorIndex, value.length);
    if (cursorIndex > value.length) {
      setCursorIndex(value.length);
    }
  }, [value, cursorIndex]);

  useInput((input, key) => {
    // Handle Tab completion
    if (key.tab && onTab) {
      const completed = onTab(value);
      if (completed !== null && completed !== value) {
        onChange(completed);
        setCursorIndex(completed.length);
      }
      return;
    }

    // Handle Enter
    if (key.return) {
      onSubmit(value);
      setCursorIndex(0);
      return;
    }

    // Handle Ctrl+C to exit
    if (key.ctrl && (input === 'c' || input === 'C')) {
      exit();
      return;
    }

    // Handle arrow keys for cursor movement
    if (key.leftArrow) {
      setCursorIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorIndex((prev) => Math.min(value.length, prev + 1));
      return;
    }
    if (key.upArrow) {
      // Signal to parent to handle history up
      return;
    }
    if (key.downArrow) {
      // Signal to parent to handle history down
      return;
    }

    // Handle Ctrl+left/right and Option+left/right (meta key) for word navigation
    if ((key.ctrl || key.meta) && key.leftArrow) {
      const pos = findWordBoundary(value, cursorIndex, 'left');
      setCursorIndex(pos);
      return;
    }
    if ((key.ctrl || key.meta) && key.rightArrow) {
      const pos = findWordBoundary(value, cursorIndex, 'right');
      setCursorIndex(pos);
      return;
    }

    // Handle Backspace
    if (key.backspace || key.delete) {
      if (cursorIndex > 0) {
        const newValue = value.slice(0, cursorIndex - 1) + value.slice(cursorIndex);
        onChange(newValue);
        setCursorIndex((prev) => prev - 1);
      }
      return;
    }

    // Handle Ctrl+K (delete to end of line)
    if (key.ctrl && (input === 'k' || input === 'K')) {
      if (cursorIndex < value.length) {
        onChange(value.slice(0, cursorIndex));
      }
      return;
    }

    // Handle Ctrl+U (delete to start of line)
    if (key.ctrl && (input === 'u' || input === 'U')) {
      if (cursorIndex > 0) {
        onChange(value.slice(cursorIndex));
        setCursorIndex(0);
      }
      return;
    }

    // Handle Ctrl+A (move to start)
    if (key.ctrl && (input === 'a' || input === 'A')) {
      setCursorIndex(0);
      return;
    }

    // Handle Ctrl+E (move to end)
    if (key.ctrl && (input === 'e' || input === 'E')) {
      setCursorIndex(value.length);
      return;
    }

    // Handle printable characters
    // Note: key.shift is allowed here because it's used for capital letters
    // Shift+Tab and other shift combinations are handled by the parent before reaching here
    if (input && !key.ctrl && !key.meta) {
      const newChar = input;
      const newValue = value.slice(0, cursorIndex) + newChar + value.slice(cursorIndex);
      onChange(newValue);
      setCursorIndex((prev) => prev + 1);
      return;
    }
  }, { isActive: focus });

  const displayValue = value ?? placeholder ?? '';

  // When NOT focused, just show the text (value or placeholder)
  if (!focus || !showCursor) {
    return <Text dimColor={(!value) as boolean}>{displayValue}</Text>;
  }

  // When focused - show cursor as underscore at cursor position
  // Using underscore instead of block to avoid text displacement issues
  if (value) {
    const beforeCursor = value.slice(0, cursorIndex);
    const afterCursor = value.slice(cursorIndex);
    // Show underscore cursor that doesn't displace text
    return (
      <Text>
        {beforeCursor}
        <Text color="cyan">_</Text>
        {afterCursor}
      </Text>
    );
  }

  // Empty input - show cursor then placeholder
  return (
    <Text>
      <Text color="cyan">_</Text>
      <Text dimColor>{placeholder}</Text>
    </Text>
  );
}

// Helper function to find word boundaries
function findWordBoundary(text: string, pos: number, direction: 'left' | 'right'): number {
  if (direction === 'left') {
    if (pos === 0) return 0;
    let i = pos - 1;
    while (i >= 0 && /\s/.test(text[i])) i--;
    while (i >= 0 && !/\s/.test(text[i])) i--;
    return i + 1;
  } else {
    if (pos >= text.length) return text.length;
    let i = pos;
    while (i < text.length && /\s/.test(text[i])) i++;
    while (i < text.length && !/\s/.test(text[i])) i++;
    return i;
  }
}