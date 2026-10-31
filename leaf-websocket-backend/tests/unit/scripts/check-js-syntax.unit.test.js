const { syntaxError } = require('../../../scripts/tests/check-js-syntax.cjs');

describe('check-js-syntax', () => {
  it('reports a missing comma between array items', () => {
    expect(syntaxError("const items = [\n  'a'\n  'b'\n];", 'broken.js')?.name).toBe('SyntaxError');
  });

  it('accepts valid files, including a shebang and top-level return', () => {
    expect(syntaxError("#!/usr/bin/env node\nif (process.env.SKIP) return;\nmodule.exports = 1;", 'ok.js')).toBeNull();
  });
});
