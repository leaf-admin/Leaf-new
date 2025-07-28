const fs = require('fs');
const path = require('path');

// Função para corrigir duplicações em arquivos JavaScript
function fixJavaScriptDuplicates(filePath) {
    try {
        console.log(`Verificando ${filePath}...`);
        
        let content = fs.readFileSync(filePath, 'utf8');
        const originalContent = content;
        
        // Padrões para remover duplicações
        const patterns = [
            // Remover múltiplas declarações de const/let/var
            /(const\s+\w+\s*=.*?;[\s\S]*?)(const\s+\w+\s*=.*?;[\s\S]*?)(const\s+\w+\s*=.*?;[\s\S]*?)/g,
            // Remover múltiplas declarações de function
            /(function\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(function\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(function\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)/g,
            // Remover múltiplas declarações de class
            /(class\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(class\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)(class\s+\w+.*?\{[\s\S]*?\}[\s\S]*?)/g,
            // Remover múltiplos module.exports
            /(module\.exports\s*=.*?;[\s\S]*?)(module\.exports\s*=.*?;[\s\S]*?)(module\.exports\s*=.*?;[\s\S]*?)/g,
            // Remover múltiplos export default
            /(export default.*?;[\s\S]*?)(export default.*?;[\s\S]*?)(export default.*?;[\s\S]*?)/g
        ];
        
        patterns.forEach(pattern => {
            content = content.replace(pattern, '$1');
        });
        
        // Remover linhas duplicadas consecutivas
        const lines = content.split('\n');
        const cleanedLines = [];
        let previousLine = '';
        
        lines.forEach(line => {
            if (line.trim() !== previousLine.trim() || line.trim() === '') {
                cleanedLines.push(line);
                previousLine = line;
            }
        });
        
        content = cleanedLines.join('\n');
        
        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`  ✅ ${filePath} corrigido`);
        } else {
            console.log(`  ✅ ${filePath} OK`);
        }
        
    } catch (error) {
        console.log(`  ❌ Erro em ${filePath}: ${error.message}`);
    }
}

// Lista de arquivos JavaScript problemáticos
const problemFiles = [
    'leaf-dashboard/check-docker-redis.js',
    'leaf-websocket-backend/diagnose-monitoring.js',
    'leaf-websocket-backend/monitoring/resource-monitor.js',
    'leaf-websocket-backend/monitoring/sync-alert-system.js',
    'leaf-websocket-backend/test-redis-connection.js',
    'mobile-app/src/config/GoogleAuthConfig.js',
    'mobile-app/src/screens/index.js',
    'mobile-app/src/services/WebSocketServiceWithRetry.js',
    'production-setup/load-balancer-config.js'
];

console.log('🔧 Corrigindo arquivos JavaScript duplicados...\n');

problemFiles.forEach(file => {
    if (fs.existsSync(file)) {
        fixJavaScriptDuplicates(file);
    } else {
        console.log(`⚠️ Arquivo não encontrado: ${file}`);
    }
});

console.log('\n🎉 Correção concluída!'); 