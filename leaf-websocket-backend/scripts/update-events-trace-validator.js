/**
 * Script para atualizar todos os eventos para usar trace-validator
 */

const fs = require('fs');
const path = require('path');

const eventsDir = path.join(__dirname, '../events');
const eventFiles = [
    'ride.accepted.js',
    'ride.started.js',
    'ride.completed.js',
    'ride.canceled.js',
    'ride.rejected.js',
    'driver.online.js',
    'driver.offline.js',
    'payment.confirmed.js'
];

eventFiles.forEach(file => {
    const filePath = path.join(eventsDir, file);
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️ Arquivo não encontrado: ${file}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    const eventType = file.replace('.js', '').toUpperCase().replace('.', '_');
    
    // Adicionar import do validator se não existir
    if (!content.includes('trace-validator')) {
        content = content.replace(
            /const { CanonicalEvent, EVENT_TYPES } = require\('\.\/index'\);/
            ,
            `const { CanonicalEvent, EVENT_TYPES } = require('./index');\nconst { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');`
        );
    }
    
    // Substituir traceId assignment
    if (content.includes('traceId: data.traceId || traceContext.getCurrentTraceId()')) {
        content = content.replace(
            /traceId: data\.traceId \|\| traceContext\.getCurrentTraceId\(\)/g,
            'traceId: validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.' + eventType + ')'
        );
        
        // Adicionar variável validatedTraceId se necessário
        if (!content.includes('validatedTraceId')) {
            content = content.replace(
                /const eventData = \{[\s\S]*?traceId: validateAndEnsureTraceIdInEvent/,
                match => {
                    const validatedTraceId = 'const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.' + eventType + ');\n        \n        ' + match.replace(/traceId: validateAndEnsureTraceIdInEvent/, 'traceId: validatedTraceId');
                    return validatedTraceId;
                }
            );
        }
        
        // Atualizar metadata.traceId para usar validatedTraceId
        content = content.replace(
            /this\.data\.metadata\.traceId = spanContext\?\.traceId \|\| eventData\.traceId;/g,
            'this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;'
        );
        
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Atualizado: ${file}`);
    } else {
        console.log(`⏭️  Já atualizado ou não precisa: ${file}`);
    }
});

console.log('\n✅ Todos os eventos foram atualizados!');

