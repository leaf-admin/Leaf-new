#!/usr/bin/env node
/**
 * Script para substituir todos os console.log por logStructured
 * Uso: node scripts/replace-console-logs.js
 */

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../routes');
const servicesDir = path.join(__dirname, '../services');

// Arquivos já processados (pular)
const processedFiles = new Set([
  'woovi.js', // Em andamento
]);

function hasLoggerImport(content) {
  return content.includes("require('../utils/logger')") || 
         content.includes('require("../utils/logger")');
}

function addLoggerImport(content) {
  const lines = content.split('\n');
  let insertIndex = 0;
  
  // Encontrar última linha de require
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].includes('require(')) {
      insertIndex = i + 1;
    }
  }
  
  lines.splice(insertIndex, 0, "const { logStructured, logError } = require('../utils/logger');");
  return lines.join('\n');
}

function replaceConsoleLogs(content, filename) {
  let modified = content;
  
  // Adicionar import se não existir
  if (!hasLoggerImport(modified)) {
    modified = addLoggerImport(modified);
  }
  
  const serviceName = filename.replace('.js', '-routes');
  
  // Substituir console.log simples
  modified = modified.replace(
    /console\.log\((.*?)\);/g,
    (match, args) => {
      if (args.includes('JSON.stringify')) {
        return `logStructured('info', ${args}, { service: '${serviceName}' });`;
      }
      return `logStructured('info', ${args}, { service: '${serviceName}' });`;
    }
  );
  
  // Substituir console.error
  modified = modified.replace(
    /console\.error\((.*?),\s*(error|err|e)\);/g,
    `logError($2, $1, { service: '${serviceName}' });`
  );
  
  // Substituir console.error sem error object
  modified = modified.replace(
    /console\.error\((.*?)\);/g,
    `logStructured('error', $1, { service: '${serviceName}' });`
  );
  
  // Substituir console.warn
  modified = modified.replace(
    /console\.warn\((.*?)\);/g,
    `logStructured('warn', $1, { service: '${serviceName}' });`
  );
  
  // Substituir console.debug
  modified = modified.replace(
    /console\.debug\((.*?)\);/g,
    `logStructured('debug', $1, { service: '${serviceName}' });`
  );
  
  return modified;
}

function processFile(filePath) {
  const filename = path.basename(filePath);
  
  if (processedFiles.has(filename)) {
    console.log(`⏭️  Pulando ${filename} (já processado)`);
    return { processed: false };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Verificar se tem console.log
    if (!content.match(/console\.(log|error|warn|debug|info)/)) {
      return { processed: false };
    }
    
    const modified = replaceConsoleLogs(content, filename);
    
    // Verificar se houve mudanças
    if (modified === content) {
      return { processed: false };
    }
    
    // Backup
    fs.writeFileSync(filePath + '.bak', content);
    
    // Escrever modificado
    fs.writeFileSync(filePath, modified);
    
    const beforeCount = (content.match(/console\./g) || []).length;
    const afterCount = (modified.match(/console\./g) || []).length;
    
    console.log(`✅ ${filename}: ${beforeCount} → ${afterCount} console.* restantes`);
    
    return {
      processed: true,
      file: filename,
      before: beforeCount,
      after: afterCount
    };
    
  } catch (error) {
    console.error(`❌ Erro ao processar ${filename}:`, error.message);
    return { processed: false, error: error.message };
  }
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  const results = [];
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      results.push(...processDirectory(filePath));
    } else if (file.endsWith('.js')) {
      const result = processFile(filePath);
      if (result.processed) {
        results.push(result);
      }
    }
  }
  
  return results;
}

// Processar routes
console.log('🔄 Processando routes/...\n');
const routesResults = processDirectory(routesDir);

console.log('\n📊 Resumo:');
console.log(`✅ Arquivos processados: ${routesResults.length}`);
const totalBefore = routesResults.reduce((sum, r) => sum + (r.before || 0), 0);
const totalAfter = routesResults.reduce((sum, r) => sum + (r.after || 0), 0);
console.log(`📉 console.* removidos: ${totalBefore} → ${totalAfter}`);

