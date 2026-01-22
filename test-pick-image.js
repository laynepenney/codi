#!/usr/bin/env node
// Simple test script for the /pick-image command
// This script tests the image picker functionality

import { pickImage } from './src/commands/image-commands.js';

async function testPickImage() {
  console.log('Testing /pick-image command...\n');

  // Test with a question
  const result = await pickImage('What does this image show?');

  if (result) {
    console.log(`\n✅ Successfully picked image: ${result}`);
    console.log('\nPrompt to send to AI:');
    console.log(`Analyze this image: ${result}`);
    console.log('\nFocus on: What does this image show?');
  } else {
    console.log('\n❌ No image selected');
  }
}

testPickImage().catch(console.error);