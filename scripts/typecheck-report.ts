#!/usr/bin/env tsx
/**
 * TypeScript Build Check Report
 * Runs `tsc` and generates a detailed error report with fix suggestions
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

interface TypeScriptError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

function parseTypeScriptErrors(output: string): TypeScriptError[] {
  const errors: TypeScriptError[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm;
  let match;
  
  while ((match = pattern.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      severity: match[4] as 'error' | 'warning',
      code: `TS${match[5]}`,
      message: match[6],
    });
  }
  return errors;
}

function getSuggestion(error: TypeScriptError): string {
  const { code, message } = error;
  
  const suggestions: Record<string, string> = {
    'TS2339': '✓ Property does not exist on object. Check object interface/type definition.',
    'TS2345': '✓ Argument of wrong type. Check function parameter types.',
    'TS2722': '✓ Cannot invoke optional property. Add optional chaining (?.) or null check.',
    'TS7053': '✓ Element implicitly has type "any". Add explicit type annotation.',
    'TS2488': '✓ Type has no properties. Check that object is properly typed.',
    'TS2307': '✓ Module not found. Check import path and tsconfig paths config.',
    'TS6196': '✓ Experimental decorators not enabled. Check tsconfig.json.',
  };
  
  return suggestions[code] || '✓ See TypeScript docs: https://www.typescriptlang.org/docs/';
}

async function main() {
  console.log('\n📋 TypeScript Build Check Report\n');
  console.log('=' .repeat(80));
  
  let output = '';
  let hasErrors = false;
  
  try {
    output = execSync('npm run check 2>&1', { encoding: 'utf-8' });
  } catch (error: any) {
    output = error.stdout || error.message;
    hasErrors = true;
  }
  
  const errors = parseTypeScriptErrors(output);
  
  if (errors.length === 0) {
    console.log('\n✅ No TypeScript errors found!\n');
    return;
  }
  
  // Group by severity
  const typeErrors = errors.filter(e => e.severity === 'error');
  const warnings = errors.filter(e => e.severity === 'warning');
  
  if (typeErrors.length > 0) {
    console.log(`\n🔴 ERRORS (${typeErrors.length})\n`);
    typeErrors.forEach((error, idx) => {
      console.log(`${idx + 1}. ${error.file}:${error.line}:${error.column}`);
      console.log(`   ${error.code} - ${error.message}`);
      console.log(`   ${getSuggestion(error)}\n`);
    });
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS (${warnings.length})\n`);
    warnings.forEach((warning, idx) => {
      console.log(`${idx + 1}. ${warning.file}:${warning.line}:${warning.column}`);
      console.log(`   ${warning.code} - ${warning.message}\n`);
    });
  }
  
  console.log('=' .repeat(80));
  console.log(`\n📊 Summary:`);
  console.log(`   Errors:   ${typeErrors.length}`);
  console.log(`   Warnings: ${warnings.length}`);
  console.log(`   Total:    ${errors.length}\n`);
  
  console.log('💡 Next Steps:');
  console.log('   1. Review errors by file and fix type issues');
  console.log('   2. Run: npm run check -- --strict');
  console.log('   3. Build: npm run build\n');
  
  if (typeErrors.length > 0) {
    console.log('🔗 Resources:');
    console.log('   - TypeScript Handbook: https://www.typescriptlang.org/docs/');
    console.log('   - Common Errors: https://www.typescriptlang.org/docs/handbook/2/narrowing.html\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error running typecheck:', err);
  process.exit(1);
});
