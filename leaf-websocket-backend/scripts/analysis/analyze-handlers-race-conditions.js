#!/usr/bin/env node

/**
 * 🔍 ANÁLISE DE HANDLERS E RACE CONDITIONS
 * 
 * Este script analisa todos os handlers de eventos WebSocket no server.js
 * para identificar:
 * 1. Race conditions (handlers registrados após operações assíncronas)
 * 2. Handlers duplicados
 * 3. Problemas de timing
 * 4. Dependências entre handlers
 */

const fs = require('fs');
const path = require('path');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

class HandlerAnalyzer {
    constructor() {
        this.handlers = [];
        this.issues = [];
        this.warnings = [];
    }

    analyzeFile(filePath) {
        log(`\n${colors.bold}📋 Analisando: ${filePath}${colors.reset}`, 'cyan');
        
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        
        let inConnectionHandler = false;
        let connectionHandlerStart = -1;
        let asyncOperationsBeforeHandlers = [];
        let handlersRegistered = [];
        let currentIndent = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            
            // Detectar início do handler de conexão
            if (line.includes("io.on('connection'") || line.includes('io.on("connection"')) {
                inConnectionHandler = true;
                connectionHandlerStart = lineNum;
                log(`\n🔌 Handler de conexão encontrado na linha ${lineNum}`, 'blue');
                continue;
            }
            
            if (!inConnectionHandler) continue;
            
            // Detectar fim do handler de conexão (aproximado)
            if (line.trim().startsWith('});') && inConnectionHandler && i > connectionHandlerStart + 10) {
                // Verificar se é o fechamento do connection handler
                const indent = line.match(/^(\s*)/)[1].length;
                if (indent <= 2) {
                    inConnectionHandler = false;
                    log(`\n🔌 Fim do handler de conexão na linha ${lineNum}`, 'blue');
                    this.analyzeConnectionHandler(connectionHandlerStart, lineNum, asyncOperationsBeforeHandlers, handlersRegistered, lines);
                    asyncOperationsBeforeHandlers = [];
                    handlersRegistered = [];
                    continue;
                }
            }
            
            // Detectar operações assíncronas ANTES de handlers
            if (inConnectionHandler) {
                // await, Promise, setTimeout, setInterval
                if (line.match(/\bawait\s+[a-zA-Z]/) || 
                    line.match(/\bPromise\./) ||
                    line.match(/\bsetTimeout\(/) ||
                    line.match(/\bsetInterval\(/)) {
                    
                    // Verificar se não está dentro de um handler já registrado
                    const isInHandler = handlersRegistered.some(h => lineNum >= h.start && lineNum <= h.end);
                    if (!isInHandler) {
                        asyncOperationsBeforeHandlers.push({
                            line: lineNum,
                            content: line.trim(),
                            type: this.detectAsyncType(line)
                        });
                    }
                }
                
                // Detectar registro de handlers
                const handlerMatch = line.match(/socket\.(on|once)\s*\(\s*['"]([^'"]+)['"]/);
                if (handlerMatch) {
                    const eventName = handlerMatch[2];
                    const handlerType = handlerMatch[1];
                    
                    // Verificar se há operações assíncronas antes deste handler
                    const asyncBefore = asyncOperationsBeforeHandlers.filter(a => a.line < lineNum);
                    
                    handlersRegistered.push({
                        line: lineNum,
                        event: eventName,
                        type: handlerType,
                        asyncBefore: asyncBefore,
                        content: line.trim()
                    });
                    
                    // Verificar race condition
                    if (asyncBefore.length > 0) {
                        this.issues.push({
                            type: 'race_condition',
                            severity: 'high',
                            handler: eventName,
                            line: lineNum,
                            asyncOps: asyncBefore,
                            description: `Handler '${eventName}' registrado após ${asyncBefore.length} operação(ões) assíncrona(s)`
                        });
                    }
                }
            }
        }
        
        // Verificar handlers duplicados
        this.checkDuplicateHandlers(handlersRegistered);
        
        // Verificar ordem de registro
        this.checkHandlerOrder(handlersRegistered);
    }
    
    detectAsyncType(line) {
        if (line.includes('await')) return 'await';
        if (line.includes('Promise.')) return 'Promise';
        if (line.includes('setTimeout')) return 'setTimeout';
        if (line.includes('setInterval')) return 'setInterval';
        return 'async';
    }
    
    analyzeConnectionHandler(start, end, asyncOps, handlers, lines) {
        log(`\n📊 Análise do handler de conexão (linhas ${start}-${end}):`, 'cyan');
        log(`   Handlers encontrados: ${handlers.length}`, 'blue');
        log(`   Operações assíncronas antes de handlers: ${asyncOps.length}`, 'yellow');
        
        // Verificar se o primeiro handler é 'authenticate'
        const firstHandler = handlers[0];
        if (firstHandler && firstHandler.event !== 'authenticate') {
            this.warnings.push({
                type: 'handler_order',
                severity: 'medium',
                description: `Primeiro handler registrado é '${firstHandler.event}', mas 'authenticate' deveria ser o primeiro`,
                line: firstHandler.line
            });
        }
    }
    
    checkDuplicateHandlers(handlers) {
        const eventMap = new Map();
        
        handlers.forEach(h => {
            if (!eventMap.has(h.event)) {
                eventMap.set(h.event, []);
            }
            eventMap.get(h.event).push(h);
        });
        
        eventMap.forEach((instances, event) => {
            if (instances.length > 1) {
                this.issues.push({
                    type: 'duplicate_handler',
                    severity: 'high',
                    event: event,
                    instances: instances.map(i => ({ line: i.line, type: i.type })),
                    description: `Handler '${event}' registrado ${instances.length} vezes`
                });
            }
        });
    }
    
    checkHandlerOrder(handlers) {
        // Verificar se handlers críticos estão no início
        const criticalHandlers = ['authenticate', 'disconnect'];
        const handlerEvents = handlers.map(h => h.event);
        
        criticalHandlers.forEach(critical => {
            const index = handlerEvents.indexOf(critical);
            if (index > 5) {
                this.warnings.push({
                    type: 'handler_order',
                    severity: 'low',
                    description: `Handler crítico '${critical}' registrado na posição ${index + 1} (deveria estar entre os primeiros)`,
                    line: handlers[index].line
                });
            }
        });
    }
    
    generateReport() {
        log(`\n${colors.bold}📊 RELATÓRIO DE ANÁLISE${colors.reset}`, 'cyan');
        log(`================================`, 'cyan');
        
        log(`\n✅ Handlers encontrados: ${this.handlers.length}`, 'green');
        log(`❌ Problemas encontrados: ${this.issues.length}`, this.issues.length > 0 ? 'red' : 'green');
        log(`⚠️ Avisos: ${this.warnings.length}`, this.warnings.length > 0 ? 'yellow' : 'green');
        
        if (this.issues.length > 0) {
            log(`\n${colors.bold}❌ PROBLEMAS CRÍTICOS:${colors.reset}`, 'red');
            this.issues.forEach((issue, i) => {
                log(`\n${i + 1}. ${issue.type.toUpperCase()}`, 'red');
                log(`   Handler: ${issue.handler || issue.event}`, 'yellow');
                log(`   Linha: ${issue.line}`, 'yellow');
                log(`   Severidade: ${issue.severity}`, 'yellow');
                log(`   Descrição: ${issue.description}`, 'yellow');
                
                if (issue.asyncOps && issue.asyncOps.length > 0) {
                    log(`   Operações assíncronas antes:`, 'yellow');
                    issue.asyncOps.forEach(op => {
                        log(`     - Linha ${op.line}: ${op.content.substring(0, 60)}...`, 'yellow');
                    });
                }
                
                if (issue.instances) {
                    log(`   Instâncias duplicadas:`, 'yellow');
                    issue.instances.forEach(inst => {
                        log(`     - Linha ${inst.line} (${inst.type})`, 'yellow');
                    });
                }
            });
        }
        
        if (this.warnings.length > 0) {
            log(`\n${colors.bold}⚠️ AVISOS:${colors.reset}`, 'yellow');
            this.warnings.forEach((warning, i) => {
                log(`\n${i + 1}. ${warning.type.toUpperCase()}`, 'yellow');
                log(`   Linha: ${warning.line || 'N/A'}`, 'yellow');
                log(`   Severidade: ${warning.severity}`, 'yellow');
                log(`   Descrição: ${warning.description}`, 'yellow');
            });
        }
        
        // Recomendações
        log(`\n${colors.bold}💡 RECOMENDAÇÕES:${colors.reset}`, 'cyan');
        
        if (this.issues.some(i => i.type === 'race_condition')) {
            log(`\n1. ⚠️ RACE CONDITIONS DETECTADAS:`, 'yellow');
            log(`   - Registrar handlers ANTES de operações assíncronas`, 'blue');
            log(`   - Mover operações assíncronas para DENTRO dos handlers`, 'blue');
            log(`   - Usar setImmediate() ou process.nextTick() se necessário`, 'blue');
        }
        
        if (this.issues.some(i => i.type === 'duplicate_handler')) {
            log(`\n2. ⚠️ HANDLERS DUPLICADOS:`, 'yellow');
            log(`   - Remover handlers duplicados`, 'blue');
            log(`   - Consolidar lógica em um único handler`, 'blue');
        }
        
        if (this.warnings.some(w => w.type === 'handler_order')) {
            log(`\n3. ⚠️ ORDEM DE HANDLERS:`, 'yellow');
            log(`   - Registrar handlers críticos primeiro (authenticate, disconnect)`, 'blue');
            log(`   - Handlers menos críticos podem vir depois`, 'blue');
        }
        
        log(`\n${colors.bold}✅ Análise concluída!${colors.reset}\n`, 'green');
    }
}

// Executar análise
const analyzer = new HandlerAnalyzer();
const serverPath = path.join(__dirname, '../../server.js');

if (!fs.existsSync(serverPath)) {
    log(`❌ Arquivo não encontrado: ${serverPath}`, 'red');
    process.exit(1);
}

analyzer.analyzeFile(serverPath);
analyzer.generateReport();

