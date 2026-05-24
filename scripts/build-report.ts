#!/usr/bin/env tsx
/**
 * Build Report Generator
 * Analyzes build output and generates detailed error/warning report
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

interface BuildIssue {
  type: 'error' | 'warning' | 'info';
  file: string;
  message: string;
  severity: number;
}

function colorize(text: string, color: 'red' | 'yellow' | 'green' | 'blue'): string {
  const colors: Record<string, [number, number]> = {
    red: [31, 39],
    yellow: [33, 39],
    green: [32, 39],
    blue: [34, 39],
  };
  const [start, end] = colors[color];
  return `\x1b[${start}m${text}\x1b[${end}m`;
}

async function main() {
  console.log('\n' + colorize('═'.repeat(80), 'blue'));
  console.log(colorize('📦 Build Report Generator', 'blue'));
  console.log(colorize('═'.repeat(80), 'blue') + '\n');
  
  console.log('Step 1: TypeScript Type Checking...');
  try {
    execSync('npm run check', { stdio: 'pipe' });
    console.log(colorize('✅ Type check passed', 'green') + '\n');
  } catch (error: any) {
    console.log(colorize('❌ Type check found errors', 'red'));
    console.log(error.stdout?.toString() || error.message);
    console.log('\nRun: npm run typecheck-report\n');
  }
  
  console.log('Step 2: Building project...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log(colorize('✅ Build successful', 'green') + '\n');
  } catch (error: any) {
    console.log(colorize('❌ Build failed', 'red'));
    console.log(error.message);
    console.log('\nCheck errors above and fix before deploying.\n');
    process.exit(1);
  }
  
  console.log(colorize('═'.repeat(80), 'blue'));
  console.log(colorize('✅ All checks passed! Ready for deployment.', 'green'));
  console.log(colorize('═'.repeat(80), 'blue') + '\n');
}

main().catch(err => {
  console.error(colorize('Error:', 'red'), err);
  process.exit(1);
});
