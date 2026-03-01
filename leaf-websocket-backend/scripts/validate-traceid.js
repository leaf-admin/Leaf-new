#!/usr/bin/env node
/**
 * Script para validar presença de traceId em pontos críticos
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Validando presença de traceId em pontos críticos...\n');

const checks = {
  commands: { required: 0, found: 0, files: [] },
  events: { required: 0, found: 0, files: [] },
  listeners: { required: 0, found: 0, files: [] },
  handlers: { required: 0, found: 0, files: [] },
  routes: { required: 0, found: 0, files: [] }
};

// 1. Validar Commands
const commandsDir = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('Command.js'));
checks.commands.required = commandFiles.length;

for (const file of commandFiles) {
  const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
  if (content.includes('this.traceId') || content.includes('traceId:')) {
    checks.commands.found++;
    checks.commands.files.push(`✅ ${file}`);
  } else {
    checks.commands.files.push(`❌ ${file} - FALTANDO traceId`);
  }
}

// 2. Validar Events
const eventsDir = path.join(__dirname, '../events');
const eventFiles = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js') && !f.includes('index') && !f.includes('README'));
checks.events.required = eventFiles.length;

for (const file of eventFiles) {
  const content = fs.readFileSync(path.join(eventsDir, file), 'utf8');
  if (content.includes('traceId:') || content.includes('traceContext')) {
    checks.events.found++;
    checks.events.files.push(`✅ ${file}`);
  } else {
    checks.events.files.push(`❌ ${file} - FALTANDO traceId`);
  }
}

// 3. Validar Listeners
const listenersDir = path.join(__dirname, '../listeners');
if (fs.existsSync(listenersDir)) {
  const listenerFiles = fs.readdirSync(listenersDir).filter(f => f.endsWith('.js') && !f.includes('index'));
  checks.listeners.required = listenerFiles.length;
  
  for (const file of listenerFiles) {
    const content = fs.readFileSync(path.join(listenersDir, file), 'utf8');
    if (content.includes('event.data.traceId') || content.includes('event.traceId') || content.includes('traceContext')) {
      checks.listeners.found++;
      checks.listeners.files.push(`✅ ${file}`);
    } else {
      checks.listeners.files.push(`❌ ${file} - FALTANDO traceId`);
    }
  }
}

// 4. Validar Handlers principais
const handlerDirs = [
  path.join(__dirname, '../handlers'),
  path.join(__dirname, '../websocket-handlers')
];

for (const handlerDir of handlerDirs) {
  if (fs.existsSync(handlerDir)) {
    const handlerFiles = fs.readdirSync(handlerDir).filter(f => f.endsWith('.js'));
    checks.handlers.required += handlerFiles.length;
    
    for (const file of handlerFiles) {
      const content = fs.readFileSync(path.join(handlerDir, file), 'utf8');
      if (content.includes('traceId') || content.includes('traceContext')) {
        checks.handlers.found++;
        checks.handlers.files.push(`✅ ${file}`);
      } else {
        checks.handlers.files.push(`❌ ${file} - FALTANDO traceId`);
      }
    }
  }
}

// 5. Amostra de routes (principais)
const mainRoutes = ['woovi.js', 'payment.js', 'auth.js'];
checks.routes.required = mainRoutes.length;

for (const file of mainRoutes) {
  const routePath = path.join(__dirname, '../routes', file);
  if (fs.existsSync(routePath)) {
    const content = fs.readFileSync(routePath, 'utf8');
    if (content.includes('traceId') || content.includes('traceContext')) {
      checks.routes.found++;
      checks.routes.files.push(`✅ ${file}`);
    } else {
      checks.routes.files.push(`⚠️  ${file} - traceId opcional (routes HTTP)`);
    }
  }
}

// Relatório
console.log('📊 RELATÓRIO DE VALIDAÇÃO\n');
console.log('=' .repeat(60));

for (const [category, data] of Object.entries(checks)) {
  const percentage = data.required > 0 ? ((data.found / data.required) * 100).toFixed(1) : 0;
  const status = percentage >= 80 ? '✅' : percentage >= 50 ? '⚠️' : '❌';
  
  console.log(`\n${status} ${category.toUpperCase()}: ${data.found}/${data.required} (${percentage}%)`);
  console.log('-'.repeat(60));
  
  for (const file of data.files) {
    console.log(`  ${file}`);
  }
}

console.log('\n' + '='.repeat(60));

const totalRequired = Object.values(checks).reduce((sum, c) => sum + c.required, 0);
const totalFound = Object.values(checks).reduce((sum, c) => sum + c.found, 0);
const totalPercentage = ((totalFound / totalRequired) * 100).toFixed(1);

console.log(`\n📈 TOTAL: ${totalFound}/${totalRequired} arquivos com traceId (${totalPercentage}%)\n`);

if (totalPercentage >= 80) {
  console.log('✅ VALIDAÇÃO APROVADA! TraceId está presente em pontos críticos.');
} else if (totalPercentage >= 50) {
  console.log('⚠️  VALIDAÇÃO PARCIAL. Alguns arquivos ainda precisam de traceId.');
} else {
  console.log('❌ VALIDAÇÃO FALHADA. Muitos arquivos sem traceId.');
}

console.log('\n💡 Dica: Use traceContext.getCurrentTraceId() para capturar o traceId atual.\n');

