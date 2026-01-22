// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

import { exec } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { extname, resolve as pathResolve } from 'path';
import { registerCommand, type Command, type CommandContext } from './index.js';

const execAsync = promisify(exec);

// Supported image extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/**
 * Check if fzf is available on the system
 */
async function hasFzf(): Promise<boolean> {
  try {
    await execAsync('which fzf');
    return true;
  } catch {
    return false;
  }
}

/**
 * Find all image files in the current directory and subdirectories
 */
async function findImageFiles(): Promise<string[]> {
  const { glob } = await import('node:fs/promises');
  const images: string[] = [];

  try {
    // Use glob to find all image files
    for await (const file of glob('**/*.{png,jpg,jpeg,gif,webp}', {
      cwd: process.cwd(),
    })) {
      // Skip common ignore patterns
      if (
        file.includes('node_modules') ||
        file.includes('.git') ||
        file.includes('coverage') ||
        file.includes('dist') ||
        file.includes('build')
      ) {
        continue;
      }
      images.push(pathResolve(process.cwd(), file));
    }

    return images.sort();
  } catch {
    return [];
  }
}

/**
 * Interactive file picker using fzf
 */
async function pickImageWithFzf(question: string): Promise<string | null> {
  const images = await findImageFiles();

  if (images.length === 0) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const fzfArgs = [
      '--prompt',
      'Select image: ',
      '--height',
      '50%',
      '--border',
      '--preview',
      'file {}',
      '--preview-window',
      'border-left',
    ];

    if (question) {
      fzfArgs.push('--header', 'Focus: ' + question);
    }

    const fzf = spawn('fzf', fzfArgs);

    let stdout = '';

    // Pipe image list to fzf
    fzf.stdin.write(images.join('\n'));
    fzf.stdin.end();

    fzf.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    fzf.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        resolve(null);
      }
    });

    fzf.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Simple readline-based file picker (fallback)
 */
async function pickImageWithReadline(): Promise<string | null> {
  const { createInterface } = await import('readline');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const question = 'Enter image path (use tab for autocompletion): ';

    rl.question(question, (answer) => {
      rl.close();

      if (!answer) {
        resolve(null);
        return;
      }

      const resolvedPath = pathResolve(process.cwd(), answer);

      if (!existsSync(resolvedPath)) {
        console.log(`File not found: ${resolvedPath}`);
        resolve(null);
        return;
      }

      const ext = extname(resolvedPath).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) {
        console.log(
          `Unsupported file type: ${ext}\nSupported: ${IMAGE_EXTENSIONS.join(', ')}`
        );
        resolve(null);
        return;
      }

      resolve(resolvedPath);
    });
  });
}

/**
 * Pick image with available methods
 */
async function pickImage(question: string): Promise<string | null> {
  const hasFzfAvailable = await hasFzf();

  if (hasFzfAvailable) {
    console.log('\nInteractive file picker (fzf):');
    return await pickImageWithFzf(question);
  } else {
    console.log('\nfzf not available. Using manual path entry:');
    return await pickImageWithReadline();
  }
}

/**
 * Command: /pick-image
 * Interactive image picker using fzf (if available) or readline
 */
export const pickImageCommand = {
  name: 'pick-image',
  aliases: ['pi'],
  description:
    'Interactive fzf image picker. Returns a prompt to analyze the selected image.',
  usage: '/pick-image [question]',
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const question = args.trim();

    try {
      const selectedPath = await pickImage(question);

      if (selectedPath) {
        // Return a prompt for the AI to use analyze_image
        const prompt = `Analyze this image: ${selectedPath}`;
        return question ? `${prompt}\n\nFocus on: ${question}` : prompt;
      } else {
        return 'No image selected. Please try again or provide a path directly:\n' +
               'Usage: "Analyze the image at ./assets/banner.png"';
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `Error picking image: ${errorMessage}\n` +
             'You can also provide an image path directly:\n' +
             'Usage: "Analyze the image at ./assets/banner.png"';
    }
  },
};

/**
 * Register image-related commands
 */
export function registerImageCommands(): void {
  registerCommand(pickImageCommand);
}