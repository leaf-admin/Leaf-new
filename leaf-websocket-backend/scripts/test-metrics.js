/**
 * Script de teste para validar métricas Prometheus
 */

const http = require('http');

const PORT = 3001;
const ENDPOINT = '/metrics';

console.log('🧪 Testando endpoint de métricas...\n');

const options = {
  hostname: 'localhost',
  port: PORT,
  path: ENDPOINT,
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`✅ Status: ${res.statusCode}`);
  console.log(`✅ Headers: ${JSON.stringify(res.headers['content-type'])}\n`);

  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`📊 Total de bytes: ${data.length}\n`);
    
    // Verificar métricas esperadas
    const metrics = [
      'leaf_rides_requested_total',
      'leaf_rides_accepted_total',
      'leaf_commands_duration_seconds',
      'leaf_events_published_total',
      'leaf_listeners_duration_seconds',
      'process_cpu_user_seconds_total',
      'nodejs_heap_size_total_bytes'
    ];

    console.log('🔍 Verificando métricas:\n');
    metrics.forEach(metric => {
      const found = data.includes(metric);
      console.log(`${found ? '✅' : '❌'} ${metric}`);
    });

    // Mostrar algumas métricas
    console.log('\n📈 Primeiras 20 linhas de métricas:\n');
    const lines = data.split('\n').slice(0, 20);
    lines.forEach(line => {
      if (line.trim() && !line.startsWith('#')) {
        console.log(`  ${line}`);
      }
    });

    console.log('\n✅ Teste concluído!');
  });
});

req.on('error', (error) => {
  console.error(`❌ Erro ao conectar: ${error.message}`);
  console.error('\n💡 Dica: Certifique-se de que o servidor está rodando:');
  console.error('   cd leaf-websocket-backend && npm start');
  process.exit(1);
});

req.end();

