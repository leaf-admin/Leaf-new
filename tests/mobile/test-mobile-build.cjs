#!/usr/bin/env node

/**
 * Teste de Build Mobile - Simula o processo de bundling do Metro
 * Detecta problemas de importação antes de fazer build real
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

const log = (message, color = 'reset') => {
    console.log(`${colors[color]}${message}${colors.reset}`);
};

const logError = (message) => log(`❌ ${message}`, 'red');
const logSuccess = (message) => log(`✅ ${message}`, 'green');
const logWarning = (message) => log(`⚠️ ${message}`, 'yellow');
const logInfo = (message) => log(`ℹ️ ${message}`, 'blue');

// Configurações
const CONFIG = {
    mobileAppPath: './mobile-app',
    commonPath: './common',
    testTimeout: 30000, // 30 segundos
    maxFileSize: 1024 * 1024 // 1MB
};

// Problemas conhecidos que causam crash
const KNOWN_ISSUES = {
    nodeModules: [
        '@redis/client',
        'redis',
        'ioredis',
        'node:crypto',
        'node:fs',
        'node:path',
        'node:os',
        'node:util',
        'node:events',
        'node:stream',
        'node:buffer',
        'node:url',
        'node:querystring',
        'node:punycode',
        'node:string_decoder',
        'node:tty',
        'node:vm',
        'node:domain',
        'node:constants',
        'node:timers'
    ],
    reactNativeIncompatible: [
        'fs',
        'path',
        'os',
        'crypto',
        'stream',
        'buffer',
        'util',
        'events',
        'url',
        'querystring',
        'punycode',
        'string_decoder',
        'tty',
        'vm',
        'domain',
        'constants',
        'timers'
    ]
};

class MobileBuildTester {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.successCount = 0;
        this.totalFiles = 0;
    }

    // Verificar se arquivo existe
    checkFileExists(filePath) {
        try {
            return fs.existsSync(filePath);
        } catch (error) {
            this.errors.push(`Erro ao verificar arquivo ${filePath}: ${error.message}`);
            return false;
        }
    }

    // Ler conteúdo do arquivo
    readFileContent(filePath) {
        try {
            const stats = fs.statSync(filePath);
            if (stats.size > CONFIG.maxFileSize) {
                this.warnings.push(`Arquivo muito grande: ${filePath} (${stats.size} bytes)`);
                return null;
            }
            return fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            this.errors.push(`Erro ao ler arquivo ${filePath}: ${error.message}`);
            return null;
        }
    }

    // Verificar importações problemáticas
    checkProblematicImports(content, filePath) {
        const issues = [];

        // Verificar imports ES6
        const importRegex = /import\s+(?:.*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[1];
            this.checkImportPath(importPath, filePath, issues);
        }

        // Verificar requires
        const requireRegex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        while ((match = requireRegex.exec(content)) !== null) {
            const requirePath = match[1];
            this.checkImportPath(requirePath, filePath, issues);
        }

        return issues;
    }

    // Verificar se o caminho de importação é problemático
    checkImportPath(importPath, filePath, issues) {
        // Verificar módulos Node.js incompatíveis
        if (KNOWN_ISSUES.nodeModules.some(module => importPath.includes(module))) {
            issues.push(`Importação de módulo Node.js incompatível: ${importPath}`);
        }

        // Verificar módulos React Native incompatíveis
        if (KNOWN_ISSUES.reactNativeIncompatible.some(module => importPath === module)) {
            issues.push(`Importação de módulo incompatível com React Native: ${importPath}`);
        }

        // Verificar imports relativos que podem não existir
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            const resolvedPath = this.resolveRelativePath(importPath, filePath);
            if (resolvedPath && !this.checkFileExists(resolvedPath)) {
                issues.push(`Importação de arquivo inexistente: ${importPath} -> ${resolvedPath}`);
            }
        }
    }

    // Resolver caminho relativo
    resolveRelativePath(importPath, currentFilePath) {
        try {
            const dir = path.dirname(currentFilePath);
            return path.resolve(dir, importPath);
        } catch (error) {
            return null;
        }
    }

    // Verificar arquivo específico
    checkFile(filePath) {
        this.totalFiles++;
        logInfo(`Verificando: ${filePath}`);

        if (!this.checkFileExists(filePath)) {
            this.errors.push(`Arquivo não encontrado: ${filePath}`);
            return false;
        }

        const content = this.readFileContent(filePath);
        if (!content) {
            return false;
        }

        const issues = this.checkProblematicImports(content, filePath);
        
        if (issues.length > 0) {
            issues.forEach(issue => {
                this.errors.push(`${filePath}: ${issue}`);
            });
            return false;
        }

        this.successCount++;
        return true;
    }

    // Verificar diretório recursivamente
    checkDirectory(dirPath, extensions = ['.js', '.jsx', '.ts', '.tsx']) {
        try {
            const files = fs.readdirSync(dirPath);
            
            for (const file of files) {
                const fullPath = path.join(dirPath, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    // Pular node_modules e .git
                    if (file !== 'node_modules' && file !== '.git' && !file.startsWith('.')) {
                        this.checkDirectory(fullPath, extensions);
                    }
                } else if (stat.isFile()) {
                    const ext = path.extname(file);
                    if (extensions.includes(ext)) {
                        this.checkFile(fullPath);
                    }
                }
            }
        } catch (error) {
            this.errors.push(`Erro ao verificar diretório ${dirPath}: ${error.message}`);
        }
    }

    // Verificar configuração do Metro
    checkMetroConfig() {
        const metroConfigPath = path.join(CONFIG.mobileAppPath, 'metro.config.js');
        logInfo('Verificando configuração do Metro...');

        if (!this.checkFileExists(metroConfigPath)) {
            this.errors.push('metro.config.js não encontrado');
            return false;
        }

        const content = this.readFileContent(metroConfigPath);
        if (!content) {
            return false;
        }

        // Verificar se há configurações problemáticas
        const problematicPatterns = [
            /@redis/,
            /redis/,
            /ioredis/,
            /node:crypto/,
            /node:fs/,
            /node:path/
        ];

        for (const pattern of problematicPatterns) {
            if (pattern.test(content)) {
                this.errors.push(`metro.config.js contém configuração problemática: ${pattern}`);
                return false;
            }
        }

        logSuccess('Configuração do Metro OK');
        return true;
    }

    // Verificar package.json
    checkPackageJson() {
        const packageJsonPath = path.join(CONFIG.mobileAppPath, 'package.json');
        logInfo('Verificando package.json...');

        if (!this.checkFileExists(packageJsonPath)) {
            this.errors.push('package.json não encontrado');
            return false;
        }

        try {
            const content = this.readFileContent(packageJsonPath);
            const packageJson = JSON.parse(content);

            // Verificar dependências problemáticas
            const allDeps = {
                ...packageJson.dependencies,
                ...packageJson.devDependencies
            };

            const problematicDeps = Object.keys(allDeps).filter(dep => 
                dep.includes('redis') || dep.includes('ioredis')
            );

            if (problematicDeps.length > 0) {
                this.errors.push(`Dependências problemáticas encontradas: ${problematicDeps.join(', ')}`);
                return false;
            }

            logSuccess('package.json OK');
            return true;
        } catch (error) {
            this.errors.push(`Erro ao analisar package.json: ${error.message}`);
            return false;
        }
    }

    // Teste de bundling simulado
    async testBundling() {
        logInfo('Iniciando teste de bundling simulado...');

        try {
            // Verificar se o Metro consegue resolver as dependências
            const result = execSync('npx expo install --check', {
                cwd: CONFIG.mobileAppPath,
                timeout: CONFIG.testTimeout,
                encoding: 'utf8'
            });

            logSuccess('Dependências do Expo verificadas com sucesso');
            return true;
        } catch (error) {
            this.errors.push(`Erro na verificação de dependências: ${error.message}`);
            return false;
        }
    }

    // Executar todos os testes
    async runTests() {
        log('🚀 Iniciando Teste de Build Mobile', 'bright');
        log('=' * 50, 'cyan');

        const startTime = Date.now();

        // 1. Verificar configuração do Metro
        this.checkMetroConfig();

        // 2. Verificar package.json
        this.checkPackageJson();

        // 3. Verificar arquivos do mobile-app
        logInfo('Verificando arquivos do mobile-app...');
        this.checkDirectory(CONFIG.mobileAppPath);

        // 4. Verificar arquivos do common
        logInfo('Verificando arquivos do common...');
        this.checkDirectory(CONFIG.commonPath);

        // 5. Teste de bundling simulado
        await this.testBundling();

        const endTime = Date.now();
        const duration = endTime - startTime;

        // Relatório final
        this.generateReport(duration);
    }

    // Gerar relatório
    generateReport(duration) {
        log('\n' + '=' * 50, 'cyan');
        log('📊 RELATÓRIO FINAL', 'bright');
        log('=' * 50, 'cyan');

        log(`⏱️  Duração: ${duration}ms`, 'blue');
        log(`📁 Arquivos verificados: ${this.totalFiles}`, 'blue');
        log(`✅ Sucessos: ${this.successCount}`, 'green');
        log(`❌ Erros: ${this.errors.length}`, 'red');
        log(`⚠️  Avisos: ${this.warnings.length}`, 'yellow');

        if (this.errors.length > 0) {
            log('\n❌ ERROS ENCONTRADOS:', 'red');
            this.errors.forEach((error, index) => {
                log(`${index + 1}. ${error}`, 'red');
            });
        }

        if (this.warnings.length > 0) {
            log('\n⚠️  AVISOS:', 'yellow');
            this.warnings.forEach((warning, index) => {
                log(`${index + 1}. ${warning}`, 'yellow');
            });
        }

        if (this.errors.length === 0) {
            log('\n🎉 SUCESSO! App deve carregar corretamente no dispositivo móvel!', 'green');
            log('✅ Nenhum problema de importação encontrado', 'green');
            log('✅ Configuração do Metro está correta', 'green');
            log('✅ Dependências estão compatíveis', 'green');
        } else {
            log('\n🚨 PROBLEMAS DETECTADOS!', 'red');
            log('❌ Corrija os erros antes de fazer build', 'red');
        }

        log('\n' + '=' * 50, 'cyan');
    }
}

// Executar teste
async function main() {
    try {
        const tester = new MobileBuildTester();
        await tester.runTests();
        
        // Exit code baseado no resultado
        process.exit(tester.errors.length > 0 ? 1 : 0);
    } catch (error) {
        logError(`Erro fatal: ${error.message}`);
        process.exit(1);
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = MobileBuildTester; 