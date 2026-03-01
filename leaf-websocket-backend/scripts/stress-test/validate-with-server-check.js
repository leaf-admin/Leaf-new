#!/usr/bin/env node
/**
 * VALIDAÇÃO COM VERIFICAÇÃO DE SERVIDOR
 * 
 * Versão melhorada que verifica se o servidor está rodando antes de testar WebSocket
 */

const { execSync } = require('child_process');
const http = require('http');
const url = require('url');

const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
const parsedUrl = url.parse(serverUrl);

// Verificar se servidor está rodando
function checkServer() {
    return new Promise((resolve) => {
        const req = http.get({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 3001,
            path: '/health',
            timeout: 3000
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({ running: true, status: res.statusCode, data });
            });
        });
        
        req.on('error', () => {
            resolve({ running: false });
        });
        
        req.on('timeout', () => {
            req.destroy();
            resolve({ running: false });
        });
    });
}

// Tentar iniciar servidor
async function ensureServerRunning() {
    const check = await checkServer();
    
    if (check.running) {
        console.log('✅ Servidor já está rodando');
        return true;
    }
    
    console.log('⚠️  Servidor não está rodando. Tentando iniciar...');
    
    try {
        // Verificar se já existe um processo
        try {
            const pid = execSync('pgrep -f "node server.js"', { encoding: 'utf8' }).trim();
            if (pid) {
                console.log(`⚠️  Processo existente encontrado (PID: ${pid}). Matando...`);
                execSync(`kill ${pid}`, { timeout: 5000 });
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            // Nenhum processo encontrado, OK
        }
        
        // Iniciar servidor
        console.log('🚀 Iniciando servidor...');
        const { spawn } = require('child_process');
        const serverProcess = spawn('node', ['server.js'], {
            cwd: process.cwd(),
            detached: true,
            stdio: ['ignore', 'ignore', 'ignore']
        });
        
        serverProcess.unref();
        
        // Aguardar servidor iniciar
        console.log('⏳ Aguardando servidor iniciar...');
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const checkAgain = await checkServer();
            if (checkAgain.running) {
                console.log('✅ Servidor iniciado com sucesso!');
                return true;
            }
            process.stdout.write('.');
        }
        
        console.log('\n❌ Timeout ao aguardar servidor iniciar');
        return false;
    } catch (error) {
        console.error(`❌ Erro ao iniciar servidor: ${error.message}`);
        return false;
    }
}

// Executar validação
async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 VALIDAÇÃO COM VERIFICAÇÃO DE SERVIDOR');
    console.log('='.repeat(60) + '\n');
    
    const serverRunning = await ensureServerRunning();
    
    if (!serverRunning) {
        console.log('\n⚠️  Servidor não está rodando. Execute manualmente:');
        console.log('   node server.js\n');
        process.exit(1);
    }
    
    // Executar validação normal
    const { spawn } = require('child_process');
    const validation = spawn('node', ['scripts/stress-test/validate-all-features.js'], {
        stdio: 'inherit',
        cwd: process.cwd()
    });
    
    validation.on('close', (code) => {
        process.exit(code);
    });
}

main().catch(error => {
    console.error('Erro fatal:', error);
    process.exit(1);
});







