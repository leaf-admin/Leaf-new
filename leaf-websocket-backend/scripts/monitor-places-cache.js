#!/usr/bin/env node
/**
 * Script de Monitoramento do Places Cache
 * 
 * Monitora hit rate, misses, saves e erros do cache de Places
 * 
 * Uso:
 *   node scripts/monitor-places-cache.js
 *   node scripts/monitor-places-cache.js --interval 30  (a cada 30 segundos)
 *   node scripts/monitor-places-cache.js --once         (executar uma vez)
 */

// Usar fetch nativo (Node.js 18+) ou node-fetch
let fetch;
try {
  fetch = require('node-fetch');
} catch (e) {
  // Node.js 18+ tem fetch nativo
  fetch = global.fetch || require('node-fetch');
}

// Configurações
const API_URL = process.env.API_URL || 'http://localhost:3001';
const INTERVAL = parseInt(process.env.INTERVAL || process.argv.find(arg => arg.startsWith('--interval'))?.split('=')[1] || '60') * 1000;
const ONCE = process.argv.includes('--once');

// Cores para terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function formatNumber(num) {
  return num.toLocaleString('pt-BR');
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function getStatusColor(hitRate) {
  if (hitRate >= 80) return 'green';
  if (hitRate >= 50) return 'yellow';
  return 'red';
}

async function fetchMetrics() {
  try {
    const response = await fetch(`${API_URL}/api/places/metrics`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.metrics;
  } catch (error) {
    console.error(colorize(`❌ Erro ao buscar métricas: ${error.message}`, 'red'));
    return null;
  }
}

function displayMetrics(metrics) {
  if (!metrics) return;

  const { stats } = metrics;
  const hitRate = stats.hitRate;
  const statusColor = getStatusColor(hitRate);

  console.log('\n' + '='.repeat(60));
  console.log(colorize('📊 Places Cache Metrics', 'cyan'));
  console.log('='.repeat(60));
  console.log(`   ${colorize('Total Requests:', 'blue')} ${formatNumber(stats.totalRequests)}`);
  console.log(`   ${colorize('Hits:', 'green')} ${formatNumber(stats.hits)} ${colorize(`(${formatPercent(hitRate)})`, statusColor)}`);
  console.log(`   ${colorize('Misses:', 'yellow')} ${formatNumber(stats.misses)} ${colorize(`(${formatPercent(stats.missRate)})`, 'yellow')}`);
  console.log(`   ${colorize('Saves:', 'magenta')} ${formatNumber(stats.saves)}`);
  console.log(`   ${colorize('Errors:', 'red')} ${formatNumber(stats.errors)}`);
  console.log(`   ${colorize('Efficiency:', statusColor)} ${colorize(stats.efficiency, statusColor)}`);
  console.log(`   ${colorize('Timestamp:', 'blue')} ${new Date(metrics.timestamp).toLocaleString('pt-BR')}`);
  console.log('='.repeat(60));

  // Alertas
  if (hitRate < 50 && stats.totalRequests > 10) {
    console.log(colorize('⚠️  ALERTA: Hit rate baixo! Considere pré-popular o cache.', 'yellow'));
  }
  if (stats.errors > 10) {
    console.log(colorize('❌ ALERTA: Muitos erros! Verificar conexão Redis.', 'red'));
  }
  if (hitRate >= 80 && stats.totalRequests > 50) {
    console.log(colorize('✅ Excelente! Cache funcionando muito bem.', 'green'));
  }
}

async function monitor() {
  console.log(colorize('\n🚀 Iniciando monitoramento do Places Cache...', 'cyan'));
  console.log(colorize(`📍 API URL: ${API_URL}`, 'blue'));
  console.log(colorize(`⏱️  Intervalo: ${INTERVAL / 1000}s`, 'blue'));
  console.log(colorize(`🔄 Modo: ${ONCE ? 'Uma execução' : 'Contínuo'}`, 'blue'));

  const run = async () => {
    const metrics = await fetchMetrics();
    displayMetrics(metrics);
  };

  // Executar imediatamente
  await run();

  // Se não for --once, continuar monitorando
  if (!ONCE) {
    console.log(colorize(`\n🔄 Monitorando a cada ${INTERVAL / 1000} segundos... (Ctrl+C para parar)`, 'cyan'));
    setInterval(run, INTERVAL);
  }
}

// Tratamento de erros
process.on('SIGINT', () => {
  console.log(colorize('\n\n👋 Monitoramento encerrado.', 'cyan'));
  process.exit(0);
});

// Executar
monitor().catch(error => {
  console.error(colorize(`\n❌ Erro fatal: ${error.message}`, 'red'));
  process.exit(1);
});



