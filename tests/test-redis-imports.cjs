#!/usr/bin/env node

/**
 * Teste Específico para Imports Redis
 * Verifica se há algum import Redis restante no código
 */

const fs = require('fs');
const path = require('path');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

const log = (message, color = 'reset') => {
    console.log(`${colors[color]}${message}${colors.reset}`);
};

const logError = (message) => log(`❌ ${message}`, 'red');
const logSuccess = (message) => log(`✅ ${message}`, 'green');
const logWarning = (message) => log(`⚠️ ${message}`, 'yellow');
const logInfo = (message) => log(`ℹ️ ${message}`, 'blue');

// Padrões de import Redis para detectar
const REDIS_PATTERNS = [
    // Imports diretos
    /import\s+.*\s+from\s+['"`]@redis\/client['"`]/g,
    /import\s+.*\s+from\s+['"`]redis['"`]/g,
    /import\s+.*\s+from\s+['"`]ioredis['"`]/g,
    /require\s*\(\s*['"`]@redis\/client['"`]\s*\)/g,
    /require\s*\(\s*['"`]redis['"`]\s*\)/g,
    /require\s*\(\s*['"`]ioredis['"`]\s*\)/g,
    
    // Imports dinâmicos
    /import\s*\(\s*['"`]@redis\/client['"`]\s*\)/g,
    /import\s*\(\s*['"`]redis['"`]\s*\)/g,
    /import\s*\(\s*['"`]ioredis['"`]\s*\)/g,
    
    // Referências em strings
    /['"`]@redis\/client['"`]/g,
    /['"`]redis['"`]/g,
    /['"`]ioredis['"`]/g,
    
    // Configurações
    /redisConfig/g,
    /redis-client/g,
    /redisClient/g
];

class RedisImportChecker {
    constructor() {
        this.foundImports = [];
        this.totalFiles = 0;
        this.checkedFiles = 0;
    }

    // Verificar se arquivo deve ser ignorado
    shouldIgnoreFile(filePath) {
        const ignorePatterns = [
            /node_modules/,
            /\.git/,
            /\.expo/,
            /\.expo-shared/,
            /build/,
            /dist/,
            /coverage/,
            /test-redis/,
            /test-mobile-build/,
            /redis-config/,
            /redis\.conf/,
            /\.bat$/,
            /\.ps1$/,
            /\.md$/,
            /\.json$/,
            /\.lock$/,
            /\.log$/,
            /\.txt$/,
            /\.yml$/,
            /\.yaml$/
        ];

        return ignorePatterns.some(pattern => pattern.test(filePath));
    }

    // Verificar arquivo específico
    checkFile(filePath) {
        this.totalFiles++;
        
        if (this.shouldIgnoreFile(filePath)) {
            return;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            this.checkedFiles++;
            
            // Verificar cada padrão
            REDIS_PATTERNS.forEach((pattern, index) => {
                const matches = content.match(pattern);
                if (matches) {
                    this.foundImports.push({
                        file: filePath,
                        pattern: pattern.toString(),
                        matches: matches.length,
                        line: this.findLineNumber(content, pattern)
                    });
                }
            });
        } catch (error) {
            logWarning(`Erro ao ler arquivo ${filePath}: ${error.message}`);
        }
    }

    // Encontrar número da linha onde o padrão foi encontrado
    findLineNumber(content, pattern) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
                return i + 1;
            }
        }
        return 'N/A';
    }

    // Verificar diretório recursivamente
    checkDirectory(dirPath) {
        try {
            const files = fs.readdirSync(dirPath);
            
            for (const file of files) {
                const fullPath = path.join(dirPath, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    this.checkDirectory(fullPath);
                } else if (stat.isFile()) {
                    this.checkFile(fullPath);
                }
            }
        } catch (error) {
            logWarning(`Erro ao verificar diretório ${dirPath}: ${error.message}`);
        }
    }

    // Executar verificação
    runCheck() {
        log('🔍 Verificando Imports Redis no Projeto', 'cyan');
        log('=' * 50, 'cyan');

        const directories = [
            './mobile-app',
            './common'
        ];

        directories.forEach(dir => {
            if (fs.existsSync(dir)) {
                logInfo(`Verificando diretório: ${dir}`);
                this.checkDirectory(dir);
            } else {
                logWarning(`Diretório não encontrado: ${dir}`);
            }
        });

        this.generateReport();
    }

    // Gerar relatório
    generateReport() {
        log('\n' + '=' * 50, 'cyan');
        log('📊 RELATÓRIO DE IMPORTS REDIS', 'cyan');
        log('=' * 50, 'cyan');

        log(`📁 Arquivos verificados: ${this.checkedFiles}/${this.totalFiles}`, 'blue');
        log(`🔍 Imports Redis encontrados: ${this.foundImports.length}`, 'blue');

        if (this.foundImports.length === 0) {
            log('\n🎉 SUCESSO! Nenhum import Redis encontrado!', 'green');
            log('✅ O app deve carregar sem problemas no dispositivo móvel', 'green');
        } else {
            log('\n🚨 IMPORTS REDIS ENCONTRADOS:', 'red');
            
            // Agrupar por arquivo
            const groupedImports = {};
            this.foundImports.forEach(importInfo => {
                if (!groupedImports[importInfo.file]) {
                    groupedImports[importInfo.file] = [];
                }
                groupedImports[importInfo.file].push(importInfo);
            });

            Object.keys(groupedImports).forEach(file => {
                log(`\n📄 ${file}:`, 'yellow');
                groupedImports[file].forEach(importInfo => {
                    log(`   Linha ${importInfo.line}: ${importInfo.pattern}`, 'red');
                });
            });

            log('\n❌ CORRIJA ESTES IMPORTS ANTES DE FAZER BUILD!', 'red');
            log('💡 Dica: Use a API Redis em vez de imports diretos', 'yellow');
        }

        log('\n' + '=' * 50, 'cyan');
    }
}

// Executar verificação
if (require.main === module) {
    const checker = new RedisImportChecker();
    checker.runCheck();
    
    // Exit code baseado no resultado
    process.exit(checker.foundImports.length > 0 ? 1 : 0);
}

module.exports = RedisImportChecker; 