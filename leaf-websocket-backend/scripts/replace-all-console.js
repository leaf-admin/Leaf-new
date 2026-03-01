#!/usr/bin/env node
/**
 * Script mais agressivo para processar TODOS os console.log
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baseDir = path.join(__dirname, '..');

// Encontrar todos os arquivos com console.log
const filesWithConsole = execSync(
  `find routes/ services/ graphql/ -name "*.js" -exec grep -l "console\\\.\\(log\\|error\\|warn\\)" {} \\;`,
  { cwd: baseDir, encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

console.log(`📋 Encontrados ${filesWithConsole.length} arquivos com console.*\n`);

for (const relPath of filesWithConsole) {
  const fullPath = path.join(baseDir, relPath);
  const filename = path.basename(relPath);

  try {
    let content = fs.readFileSync(fullPath, 'utf8');
    const originalCount = (content.match(/console\./g) || []).length;

    // 1. Adicionar import se não existir
    if (!content.includes("require('../utils/logger')") &&
      !content.includes('require("../utils/logger")')) {
      const lines = content.split('\n');
      let insertIdx = 0;

      for (let i = 0; i < Math.min(lines.length, 30); i++) {
        if (lines[i].includes('require(') || lines[i].includes('import ')) {
          insertIdx = i + 1;
        }
      }

      const loggerPath = relPath.startsWith('routes/') ? '../utils/logger' : '../utils/logger';
      lines.splice(insertIdx, 0, `const { logStructured, logError } = require('${loggerPath}');`);
      content = lines.join('\n');
    }

    const serviceName = filename.replace('.js', '').replace(/-/g, '-');

    // 2. Substituir padrões complexos primeiro
    // console.log('Text:', JSON.stringify(data))
    content = content.replace(
      /console\.log\((.*?),\s*JSON\.stringify\((.*?)\)\);/g,
      `logStructured('info', $1, { service: '${serviceName}', data: $2 });`
    );

    // console.log('Text:', data)
    content = content.replace(
      /console\.log\(([^,]+),\s*(\{[^}]+\})\);/g,
      `logStructured('info', $1, { service: '${serviceName}', ...$2 });`
    );

    //console.error('Error:', error)
    content = content.replace(
      /console\.error\(([^,]+),\s*(error|err|e)\);/g,
      `logError($2, $1, { service: '${serviceName}' });`
    );

    // Padrões simples
    content = content.replace(/console\.log\(/g, `logStructured('info', `);
    content = content.replace(/console\.error\(/g, `logStructured('error', `);
    content = content.replace(/console\.warn\(/g, `logStructured('warn', `);
    content = content.replace(/console\.debug\(/g, `logStructured('debug', `);
    content = content.replace(/console\.info\(/g, `logStructured('info', `);

    const newCount = (content.match(/console\./g) || []).length;

    if (newCount !== originalCount) {
      fs.writeFileSync(fullPath, content);
      console.log(`✅ ${relPath}: ${originalCount} → ${newCount}`);
    } else {
      console.log(`⏭️  ${relPath}: sem mudanças`);
    }

  } catch (error) {
    console.error(`❌ Erro em ${relPath}:`, error.message);
  }
}

console.log('\n✅ Processamento completo!');

