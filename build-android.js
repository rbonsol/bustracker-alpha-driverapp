#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

try {
  // Run node with the flag directly on eas CLI
  execSync(`node --no-experimental-strip-types "${require.resolve('eas-cli/bin/eas.js')}" build --platform android`, { 
    stdio: 'inherit',
    cwd: __dirname 
  });
} catch (error) {
  process.exit(1);
}
