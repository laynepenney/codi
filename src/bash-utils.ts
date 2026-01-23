// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parse a command string to extract individual commands from pipes and logical operators.
 * Returns an array of individual command strings.
 */
export function parseCommandChain(command: string): string[] {
  // Split on pipes and logical operators (|, &&, ||, ;)
  // This regex splits on |, ;, &&, or || while preserving the separators
  const parts = command.split(/(\s*\|\s*|\s*;\s*|\s+&&\s+|\s+\|\|\s+)/);

  const commands: string[] = [];
  let currentCommand = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Check if this part is separator content (|, ;, &&, ||)
    const trimmed = part.trim();
    const isSeparator = trimmed === '|' || trimmed === ';' || trimmed === '&&' || trimmed === '||';

    if (isSeparator) {
      // Found a separator, push the current command and start a new one
      if (currentCommand.trim()) {
        commands.push(currentCommand.trim());
      }
      currentCommand = '';
    } else if (trimmed) {
      // Part of a command - only add non-separators
      currentCommand += (currentCommand ? ' ' : '') + trimmed;
    }
  }

  // Don't forget the last command
  if (currentCommand.trim()) {
    commands.push(currentCommand.trim());
  }

  return commands;
}

/**
 * Request permission for chained commands.
 * Shows each command and asks for approval.
 */
export async function requestPermissionForChainedCommands(
  rl: { question: (query: string, callback: (answer: string) => void) => void },
  commands: string[]
): Promise<boolean> {
  console.log('\n⚠️  Chained command detected. Please review each command:\n');
  
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    console.log(`  ${i + 1}. ${cmd}`);
  }
  
  return new Promise<boolean>((resolve) => {
    rl.question('\nApprove execution of all commands? [y/N/abort] ', (answer: string) => {
      const lower = answer.toLowerCase().trim();
      if (lower === 'y' || lower === 'yes') {
        resolve(true);
      } else if (lower === 'a' || lower === 'abort') {
        // In real implementation, this would throw an error
        resolve(false);
      } else {
        resolve(false);
      }
    });
  });
}