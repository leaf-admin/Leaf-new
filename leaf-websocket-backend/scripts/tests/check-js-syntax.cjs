#!/usr/bin/env node

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const backendRoot = path.resolve(__dirname, '..', '..');

function syntaxError(source, filename) {
  try {
    new vm.Script(Module.wrap(source.replace(/^#!.*/, '')), { filename });
    return null;
  } catch (error) {
    return error;
  }
}

function trackedScripts() {
  return execFileSync('git', ['ls-files', '*.js', '*.cjs'], { cwd: backendRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function main() {
  const files = trackedScripts();
  const failures = files
    .map((file) => ({ file, error: syntaxError(fs.readFileSync(path.join(backendRoot, file), 'utf8'), file) }))
    .filter((result) => result.error);
  failures.forEach(({ file, error }) => console.error(`[syntax] ${file}: ${error.message}`));
  console.log(`[syntax] ${files.length} arquivos verificados, ${failures.length} com erro`);
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { syntaxError };
