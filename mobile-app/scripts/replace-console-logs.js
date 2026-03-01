/**
 * Script para substituir console.log por Logger em todos os arquivos
 * Uso: node scripts/replace-console-logs.js
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src');

// Padrões de console a substituir
const consolePatterns = [
  { pattern: /console\.log\(/g, replacement: 'Logger.log(' },
  { pattern: /console\.warn\(/g, replacement: 'Logger.warn(' },
  { pattern: /console\.error\(/g, replacement: 'Logger.error(' },
  { pattern: /console\.debug\(/g, replacement: 'Logger.debug(' },
];

// Arquivos a ignorar
const ignoreFiles = [
  'Logger.js',
  'replace-console-logs.js',
  'node_modules',
  '.git',
];

// Verificar se arquivo já importa Logger
function hasLoggerImport(content) {
  return /import.*Logger.*from|require.*Logger/.test(content);
}

// Adicionar import Logger se não existir
function addLoggerImport(content, filePath) {
  if (hasLoggerImport(content)) {
    return content;
  }

  // Determinar caminho relativo para Logger
  const relativePath = path.relative(path.dirname(filePath), path.join(srcDir, 'utils/Logger.js'))
    .replace(/\\/g, '/')
    .replace(/\.js$/, '');

  // Adicionar import no início do arquivo (após outros imports)
  const importLine = `import Logger from '${relativePath.startsWith('.') ? relativePath : './' + relativePath}';\n`;
  
  // Encontrar última linha de import
  const lines = content.split('\n');
  let lastImportIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ') || lines[i].trim().startsWith('const ') && lines[i].includes('require')) {
      lastImportIndex = i;
    } else if (lastImportIndex >= 0 && lines[i].trim() === '') {
      break;
    }
  }
  
  if (lastImportIndex >= 0) {
    lines.splice(lastImportIndex + 1, 0, importLine);
    return lines.join('\n');
  } else {
    // Se não encontrar imports, adicionar no início
    return importLine + content;
  }
}

// Processar arquivo
function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Verificar se tem console.log/warn/error
    const hasConsole = consolePatterns.some(p => p.pattern.test(content));
    
    if (!hasConsole) {
      return false;
    }

    // Substituir padrões
    consolePatterns.forEach(({ pattern, replacement }) => {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        modified = true;
      }
    });

    // Adicionar import Logger se necessário
    if (modified && !hasLoggerImport(content)) {
      content = addLoggerImport(content, filePath);
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Processado: ${path.relative(srcDir, filePath)}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Erro ao processar ${filePath}:`, error.message);
    return false;
  }
}

// Processar diretório recursivamente
function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let processedCount = 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Ignorar arquivos/diretórios
    if (ignoreFiles.some(ignore => entry.name.includes(ignore))) {
      continue;
    }

    if (entry.isDirectory()) {
      processedCount += processDirectory(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      if (processFile(fullPath)) {
        processedCount++;
      }
    }
  }

  return processedCount;
}

// Executar
console.log('🔄 Iniciando substituição de console.log por Logger...\n');
const count = processDirectory(srcDir);
console.log(`\n✅ Processamento concluído! ${count} arquivo(s) modificado(s).`);


