// Script para debugar importações Redis
const fs = require('fs');
const path = require('path');

console.log('🔍 Procurando por importações Redis...');

function searchForRedisImports(dir, depth = 0) {
  if (depth > 3) return; // Limitar profundidade
  
  try {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        searchForRedisImports(fullPath, depth + 1);
      } else if (stat.isFile() && item.endsWith('.js')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes('@redis') || content.includes('redis') || content.includes('ioredis')) {
            console.log(`📁 Encontrado em: ${fullPath}`);
            console.log(`   Conteúdo relevante:`);
            const lines = content.split('\n');
            lines.forEach((line, index) => {
              if (line.includes('@redis') || line.includes('redis') || line.includes('ioredis')) {
                console.log(`   Linha ${index + 1}: ${line.trim()}`);
              }
            });
            console.log('');
          }
        } catch (err) {
          // Ignorar erros de leitura
        }
      }
    }
  } catch (err) {
    // Ignorar erros de acesso
  }
}

// Procurar no diretório atual
searchForRedisImports('.');

// Procurar no node_modules
console.log('\n🔍 Procurando no node_modules...');
searchForRedisImports('node_modules');

console.log('\n✅ Busca concluída!'); 