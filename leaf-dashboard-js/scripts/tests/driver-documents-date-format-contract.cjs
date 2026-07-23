const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'America/Sao_Paulo';

const pagePath = path.join(
  __dirname,
  '..',
  '..',
  'app',
  'drivers',
  '[id]',
  'documents',
  'page.js'
);
const source = fs.readFileSync(pagePath, 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} precisa existir na tela de documentos`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`Não foi possível extrair ${name}`);
}

const context = { Date, Number, String };
vm.runInNewContext(
  [
    extractFunction('formatDateTime'),
    extractFunction('isValidCivilDate'),
    extractFunction('formatDateOnly'),
    'this.helpers = { formatDateTime, formatDateOnly };',
  ].join('\n'),
  context
);

const { formatDateOnly, formatDateTime } = context.helpers;

assert.equal(formatDateOnly('2001-02-08'), '08/02/2001');
assert.equal(formatDateOnly('2001-02-08T00:00:00.000Z'), '08/02/2001');
assert.equal(formatDateOnly('08/02/2001'), '08/02/2001');
assert.equal(formatDateOnly('2001-02-31'), '-');
assert.equal(formatDateOnly('data inválida'), '-');

const timestamp = formatDateTime('2026-07-15T01:00:00.000Z');
assert.match(timestamp, /14\/07\/2026/);
assert.match(timestamp, /22:00:00/);

assert.match(
  source,
  /if \(key === "dataNascimento"\) \{\s*return formatDateOnly\(value\);/,
  'dataNascimento deve usar formatação civil sem timezone'
);
assert.match(
  source,
  /if \(key === "dataCadastro"\) \{\s*return formatDateTime\(value\);/,
  'dataCadastro deve continuar usando timestamp com hora'
);

console.log('driver documents date format contract: ok');
