#!/usr/bin/env node
/**
 * Script de teste local para observabilidade
 * Testa: Prometheus, Tempo, Grafana e métricas do backend
 */

const http = require('http');
const { execSync } = require('child_process');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkService(name, url, expectedStatus = 200) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 5000 }, (res) => {
            const status = res.statusCode;
            if (status === expectedStatus || (expectedStatus === 200 && status < 400)) {
                log(`✅ ${name}: OK (${status})`, 'green');
                resolve(true);
            } else {
                log(`❌ ${name}: Erro ${status}`, 'red');
                resolve(false);
            }
        });

        req.on('error', (err) => {
            log(`❌ ${name}: ${err.message}`, 'red');
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            log(`❌ ${name}: Timeout`, 'red');
            resolve(false);
        });
    });
}

async function checkDockerServices() {
    log('\n🐳 Verificando serviços Docker...', 'cyan');
    
    try {
        const output = execSync('docker-compose -f docker-compose.observability.yml ps --format json', { encoding: 'utf-8' });
        const services = output.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
        
        let allUp = true;
        for (const service of services) {
            if (service.State === 'running') {
                log(`✅ ${service.Name}: ${service.State}`, 'green');
            } else {
                log(`❌ ${service.Name}: ${service.State}`, 'red');
                allUp = false;
            }
        }
        
        return allUp;
    } catch (error) {
        log(`❌ Erro ao verificar Docker: ${error.message}`, 'red');
        return false;
    }
}

async function checkBackendMetrics() {
    log('\n📊 Verificando endpoint /metrics do backend...', 'cyan');
    
    try {
        const response = await fetch('http://localhost:3001/metrics');
        const text = await response.text();
        
        if (response.ok && text.includes('leaf_')) {
            const metricCount = (text.match(/^leaf_/gm) || []).length;
            log(`✅ Métricas encontradas: ${metricCount} métricas leaf_*`, 'green');
            log(`   Primeiras métricas:`, 'blue');
            const lines = text.split('\n').filter(l => l.startsWith('leaf_')).slice(0, 5);
            lines.forEach(line => log(`   ${line.split(' ')[0]}`, 'yellow'));
            return true;
        } else {
            log(`❌ Endpoint /metrics não retornou métricas válidas`, 'red');
            return false;
        }
    } catch (error) {
        log(`❌ Erro ao acessar /metrics: ${error.message}`, 'red');
        log(`   Certifique-se de que o backend está rodando na porta 3001`, 'yellow');
        return false;
    }
}

async function checkPrometheusScrape() {
    log('\n📈 Verificando Prometheus...', 'cyan');
    
    try {
        // Verificar se Prometheus está rodando
        const statusOk = await checkService('Prometheus', 'http://localhost:9090/-/healthy');
        if (!statusOk) return false;
        
        // Verificar targets
        const targetsResponse = await fetch('http://localhost:9090/api/v1/targets');
        const targets = await targetsResponse.json();
        
        if (targets.data && targets.data.activeTargets) {
            const leafTarget = targets.data.activeTargets.find(t => t.labels.service === 'leaf-websocket-backend');
            if (leafTarget) {
                if (leafTarget.health === 'up') {
                    log(`✅ Target leaf-backend: ${leafTarget.health}`, 'green');
                    log(`   Último scrape: ${leafTarget.lastScrape}`, 'blue');
                    return true;
                } else {
                    log(`❌ Target leaf-backend: ${leafTarget.health}`, 'red');
                    log(`   Erro: ${leafTarget.lastError || 'N/A'}`, 'yellow');
                    return false;
                }
            } else {
                log(`⚠️ Target leaf-backend não encontrado`, 'yellow');
                return false;
            }
        }
        
        return false;
    } catch (error) {
        log(`❌ Erro ao verificar Prometheus: ${error.message}`, 'red');
        return false;
    }
}

async function checkTempo() {
    log('\n🔍 Verificando Tempo...', 'cyan');
    
    try {
        // Verificar se Tempo está respondendo
        const response = await fetch('http://localhost:3200/ready');
        if (response.ok) {
            log(`✅ Tempo: OK`, 'green');
            return true;
        } else {
            log(`❌ Tempo: Erro ${response.status}`, 'red');
            return false;
        }
    } catch (error) {
        log(`❌ Erro ao verificar Tempo: ${error.message}`, 'red');
        return false;
    }
}

async function checkGrafana() {
    log('\n📊 Verificando Grafana...', 'cyan');
    
    try {
        const response = await fetch('http://localhost:3000/api/health');
        const health = await response.json();
        
        if (health.database === 'ok' && health.version) {
            log(`✅ Grafana: OK (v${health.version})`, 'green');
            
            // Verificar datasources
            const dsResponse = await fetch('http://localhost:3000/api/datasources', {
                headers: { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') }
            });
            const datasources = await dsResponse.json();
            
            const tempoDs = datasources.find(ds => ds.type === 'tempo');
            const promDs = datasources.find(ds => ds.type === 'prometheus');
            
            if (tempoDs) log(`✅ Datasource Tempo: Configurado`, 'green');
            else log(`❌ Datasource Tempo: Não encontrado`, 'red');
            
            if (promDs) log(`✅ Datasource Prometheus: Configurado`, 'green');
            else log(`❌ Datasource Prometheus: Não encontrado`, 'red');
            
            return tempoDs && promDs;
        } else {
            log(`❌ Grafana: Erro`, 'red');
            return false;
        }
    } catch (error) {
        log(`❌ Erro ao verificar Grafana: ${error.message}`, 'red');
        return false;
    }
}

async function main() {
    log('🚀 Teste de Observabilidade Local - LEAF Project', 'cyan');
    log('='.repeat(60), 'cyan');
    
    const results = {
        docker: await checkDockerServices(),
        tempo: await checkTempo(),
        prometheus: await checkPrometheusScrape(),
        grafana: await checkGrafana(),
        backendMetrics: await checkBackendMetrics(),
    };
    
    log('\n' + '='.repeat(60), 'cyan');
    log('📋 Resumo:', 'cyan');
    
    const allOk = Object.values(results).every(r => r);
    
    Object.entries(results).forEach(([name, ok]) => {
        const icon = ok ? '✅' : '❌';
        const color = ok ? 'green' : 'red';
        log(`${icon} ${name}: ${ok ? 'OK' : 'FALHOU'}`, color);
    });
    
    if (allOk) {
        log('\n🎉 Todos os serviços estão funcionando!', 'green');
        log('\n📝 Próximos passos:', 'cyan');
        log('   1. Acesse Grafana: http://localhost:3000 (admin/admin)', 'blue');
        log('   2. Acesse Prometheus: http://localhost:9090', 'blue');
        log('   3. Acesse Tempo: http://localhost:3200', 'blue');
        log('   4. Execute o backend: cd leaf-websocket-backend && npm start', 'blue');
        log('   5. Gere algumas requisições para ver métricas e traces', 'blue');
    } else {
        log('\n⚠️ Alguns serviços precisam de atenção', 'yellow');
    }
}

// Usar fetch se disponível (Node 18+), senão usar http
if (typeof fetch === 'undefined') {
    global.fetch = async (url, options = {}) => {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const req = http.request({
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers || {},
                timeout: options.timeout || 5000,
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        text: () => Promise.resolve(data),
                        json: () => Promise.resolve(JSON.parse(data)),
                    });
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
            
            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    };
}

main().catch(console.error);

/**
 * Script de teste local para observabilidade
 * Testa: Prometheus, Tempo, Grafana e métricas do backend
 */

const http = require('http');
const { execSync } = require('child_process');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkService(name, url, expectedStatus = 200) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 5000 }, (res) => {
            const status = res.statusCode;
            if (status === expectedStatus || (expectedStatus === 200 && status < 400)) {
                log(`✅ ${name}: OK (${status})`, 'green');
                resolve(true);
            } else {
                log(`❌ ${name}: Erro ${status}`, 'red');
                resolve(false);
            }
        });

        req.on('error', (err) => {
            log(`❌ ${name}: ${err.message}`, 'red');
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            log(`❌ ${name}: Timeout`, 'red');
            resolve(false);
        });
    });
}

async function checkDockerServices() {
    log('\n🐳 Verificando serviços Docker...', 'cyan');
    
    try {
        const output = execSync('docker-compose -f docker-compose.observability.yml ps --format json', { encoding: 'utf-8' });
        const services = output.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
        
        let allUp = true;
        for (const service of services) {
            if (service.State === 'running') {
                log(`✅ ${service.Name}: ${service.State}`, 'green');
            } else {
                log(`❌ ${service.Name}: ${service.State}`, 'red');
                allUp = false;
            }
        }
        
        return allUp;
    } catch (error) {
        log(`❌ Erro ao verificar Docker: ${error.message}`, 'red');
        return false;
    }
}

async function checkBackendMetrics() {
    log('\n📊 Verificando endpoint /metrics do backend...', 'cyan');
    
    try {
        const response = await fetch('http://localhost:3001/metrics');
        const text = await response.text();
        
        if (response.ok && text.includes('leaf_')) {
            const metricCount = (text.match(/^leaf_/gm) || []).length;
            log(`✅ Métricas encontradas: ${metricCount} métricas leaf_*`, 'green');
            log(`   Primeiras métricas:`, 'blue');
            const lines = text.split('\n').filter(l => l.startsWith('leaf_')).slice(0, 5);
            lines.forEach(line => log(`   ${line.split(' ')[0]}`, 'yellow'));
            return true;
        } else {
            log(`❌ Endpoint /metrics não retornou métricas válidas`, 'red');
            return false;
        }
    } catch (error) {
        log(`❌ Erro ao acessar /metrics: ${error.message}`, 'red');
        log(`   Certifique-se de que o backend está rodando na porta 3001`, 'yellow');
        return false;
    }
}

async function checkPrometheusScrape() {
    log('\n📈 Verificando Prometheus...', 'cyan');
    
    try {
        // Verificar se Prometheus está rodando
        const statusOk = await checkService('Prometheus', 'http://localhost:9090/-/healthy');
        if (!statusOk) return false;
        
        // Verificar targets
        const targetsResponse = await fetch('http://localhost:9090/api/v1/targets');
        const targets = await targetsResponse.json();
        
        if (targets.data && targets.data.activeTargets) {
            const leafTarget = targets.data.activeTargets.find(t => t.labels.service === 'leaf-websocket-backend');
            if (leafTarget) {
                if (leafTarget.health === 'up') {
                    log(`✅ Target leaf-backend: ${leafTarget.health}`, 'green');
                    log(`   Último scrape: ${leafTarget.lastScrape}`, 'blue');
                    return true;
                } else {
                    log(`❌ Target leaf-backend: ${leafTarget.health}`, 'red');
                    log(`   Erro: ${leafTarget.lastError || 'N/A'}`, 'yellow');
                    return false;
                }
            } else {
                log(`⚠️ Target leaf-backend não encontrado`, 'yellow');
                return false;
            }
        }
        
        return false;
    } catch (error) {
        log(`❌ Erro ao verificar Prometheus: ${error.message}`, 'red');
        return false;
    }
}

async function checkTempo() {
    log('\n🔍 Verificando Tempo...', 'cyan');
    
    try {
        // Verificar se Tempo está respondendo
        const response = await fetch('http://localhost:3200/ready');
        if (response.ok) {
            log(`✅ Tempo: OK`, 'green');
            return true;
        } else {
            log(`❌ Tempo: Erro ${response.status}`, 'red');
            return false;
        }
    } catch (error) {
        log(`❌ Erro ao verificar Tempo: ${error.message}`, 'red');
        return false;
    }
}

async function checkGrafana() {
    log('\n📊 Verificando Grafana...', 'cyan');
    
    try {
        const response = await fetch('http://localhost:3000/api/health');
        const health = await response.json();
        
        if (health.database === 'ok' && health.version) {
            log(`✅ Grafana: OK (v${health.version})`, 'green');
            
            // Verificar datasources
            const dsResponse = await fetch('http://localhost:3000/api/datasources', {
                headers: { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') }
            });
            const datasources = await dsResponse.json();
            
            const tempoDs = datasources.find(ds => ds.type === 'tempo');
            const promDs = datasources.find(ds => ds.type === 'prometheus');
            
            if (tempoDs) log(`✅ Datasource Tempo: Configurado`, 'green');
            else log(`❌ Datasource Tempo: Não encontrado`, 'red');
            
            if (promDs) log(`✅ Datasource Prometheus: Configurado`, 'green');
            else log(`❌ Datasource Prometheus: Não encontrado`, 'red');
            
            return tempoDs && promDs;
        } else {
            log(`❌ Grafana: Erro`, 'red');
            return false;
        }
    } catch (error) {
        log(`❌ Erro ao verificar Grafana: ${error.message}`, 'red');
        return false;
    }
}

async function main() {
    log('🚀 Teste de Observabilidade Local - LEAF Project', 'cyan');
    log('='.repeat(60), 'cyan');
    
    const results = {
        docker: await checkDockerServices(),
        tempo: await checkTempo(),
        prometheus: await checkPrometheusScrape(),
        grafana: await checkGrafana(),
        backendMetrics: await checkBackendMetrics(),
    };
    
    log('\n' + '='.repeat(60), 'cyan');
    log('📋 Resumo:', 'cyan');
    
    const allOk = Object.values(results).every(r => r);
    
    Object.entries(results).forEach(([name, ok]) => {
        const icon = ok ? '✅' : '❌';
        const color = ok ? 'green' : 'red';
        log(`${icon} ${name}: ${ok ? 'OK' : 'FALHOU'}`, color);
    });
    
    if (allOk) {
        log('\n🎉 Todos os serviços estão funcionando!', 'green');
        log('\n📝 Próximos passos:', 'cyan');
        log('   1. Acesse Grafana: http://localhost:3000 (admin/admin)', 'blue');
        log('   2. Acesse Prometheus: http://localhost:9090', 'blue');
        log('   3. Acesse Tempo: http://localhost:3200', 'blue');
        log('   4. Execute o backend: cd leaf-websocket-backend && npm start', 'blue');
        log('   5. Gere algumas requisições para ver métricas e traces', 'blue');
    } else {
        log('\n⚠️ Alguns serviços precisam de atenção', 'yellow');
    }
}

// Usar fetch se disponível (Node 18+), senão usar http
if (typeof fetch === 'undefined') {
    global.fetch = async (url, options = {}) => {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const req = http.request({
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers || {},
                timeout: options.timeout || 5000,
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        text: () => Promise.resolve(data),
                        json: () => Promise.resolve(JSON.parse(data)),
                    });
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
            
            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    };
}

main().catch(console.error);



