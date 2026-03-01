#!/usr/bin/env node

/**
 * 🧪 TESTE DE CONEXÃO REDIS
 * 
 * Testa se o Redis está acessível e funcionando
 */

const Redis = require('ioredis');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

async function testRedisConnection() {
    console.log(`${colors.bold}${colors.cyan}🧪 TESTE DE CONEXÃO REDIS${colors.reset}\n`);

    // Testar diferentes configurações
    const configs = [
        {
            name: 'localhost:6379 (VPS padrão)',
            config: {
                host: 'localhost',
                port: 6379,
                password: null,
                db: 0,
                connectTimeout: 5000,
                lazyConnect: false
            }
        },
        {
            name: '147.93.66.253:6379 (IP VPS)',
            config: {
                host: '147.93.66.253',
                port: 6379,
                password: null,
                db: 0,
                connectTimeout: 5000,
                lazyConnect: false
            }
        },
        {
            name: 'REDIS_URL (variável de ambiente)',
            config: process.env.REDIS_URL || null
        }
    ];

    for (const testConfig of configs) {
        if (!testConfig.config) {
            console.log(`${colors.yellow}⏭️  ${testConfig.name}: Não configurado${colors.reset}`);
            continue;
        }

        console.log(`\n${colors.cyan}Testando: ${testConfig.name}${colors.reset}`);
        
        try {
            const redis = new Redis(testConfig.config);

            // Aguardar conexão
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    redis.disconnect();
                    reject(new Error('Timeout de conexão (5s)'));
                }, 5000);

                redis.once('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                redis.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });

            // Testar PING
            const pingResult = await redis.ping();
            console.log(`${colors.green}✅ Conectado! PING: ${pingResult}${colors.reset}`);

            // Testar SET/GET
            const testKey = `test:${Date.now()}`;
            await redis.set(testKey, 'test-value', 'EX', 10);
            const getValue = await redis.get(testKey);
            
            if (getValue === 'test-value') {
                console.log(`${colors.green}✅ SET/GET funcionando!${colors.reset}`);
            } else {
                console.log(`${colors.red}❌ SET/GET falhou: esperado 'test-value', recebido '${getValue}'${colors.reset}`);
            }

            // Limpar
            await redis.del(testKey);
            await redis.quit();

            console.log(`${colors.green}✅ ${testConfig.name}: FUNCIONANDO${colors.reset}`);
            return true;

        } catch (error) {
            console.log(`${colors.red}❌ ${testConfig.name}: FALHOU${colors.reset}`);
            console.log(`${colors.red}   Erro: ${error.message}${colors.reset}`);
            
            if (error.code) {
                console.log(`${colors.red}   Código: ${error.code}${colors.reset}`);
            }
            
            if (error.code === 'ECONNREFUSED') {
                console.log(`${colors.yellow}   → Redis não está rodando ou não está acessível nesta porta${colors.reset}`);
            } else if (error.code === 'ETIMEDOUT') {
                console.log(`${colors.yellow}   → Timeout - Redis pode estar bloqueado por firewall${colors.reset}`);
            } else if (error.code === 'ENOTFOUND') {
                console.log(`${colors.yellow}   → Host não encontrado${colors.reset}`);
            }
        }
    }

    console.log(`\n${colors.bold}📋 RESUMO:${colors.reset}`);
    console.log(`Para que o servidor funcione, o Redis precisa estar:`);
    console.log(`  1. Rodando na VPS (localhost:6379)`);
    console.log(`  2. Acessível pelo servidor Node.js`);
    console.log(`  3. Sem senha (ou senha configurada em REDIS_PASSWORD)`);
    console.log(`\n${colors.yellow}Para verificar na VPS:${colors.reset}`);
    console.log(`  ssh usuario@147.93.66.253`);
    console.log(`  redis-cli ping`);
    console.log(`  systemctl status redis`);
}

if (require.main === module) {
    testRedisConnection().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error(`${colors.red}❌ Erro fatal: ${error.message}${colors.reset}`);
        process.exit(1);
    });
}

module.exports = { testRedisConnection };
