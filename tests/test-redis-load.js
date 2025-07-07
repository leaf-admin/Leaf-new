// test-redis-load.js
// Teste de carga para múltiplos motoristas enviando localização para o backend Redis
// Use: node test-redis-load.js [100|500|1000|2500|5000|10000]

const fetch = require('node-fetch'); // npm install node-fetch@2

const SIZES = [100, 500, 1000, 2500, 5000, 10000];
const DEFAULT_SIZE = 100;
const API_URL = 'http://localhost:5001/leaf-app-91dfdce0/us-central1/update_user_location'; // Altere para seu endpoint

function randomLatLng() {
  // Exemplo: São Paulo
  const lat = -23.5 + Math.random() * 0.2;
  const lng = -46.7 + Math.random() * 0.2;
  return { lat, lng };
}

async function sendLocation(driverId) {
  const { lat, lng } = randomLatLng();
  const start = Date.now();
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: `driver_${driverId}`,
        latitude: lat,
        longitude: lng,
        timestamp: Date.now()
      })
    });
    const latency = Date.now() - start;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return latency;
  } catch (err) {
    return null;
  }
}

async function runTest(numDrivers) {
  console.log(`\nEnviando localização de ${numDrivers} motoristas...`);
  const promises = [];
  for (let i = 0; i < numDrivers; i++) {
    promises.push(sendLocation(i));
  }
  const results = await Promise.all(promises);

  const latencies = results.filter(x => x !== null);
  const failed = results.length - latencies.length;
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const max = Math.max(...latencies);
  const min = Math.min(...latencies);

  console.log(`Sucesso: ${latencies.length}, Falhas: ${failed}`);
  console.log(`Latência média: ${avg.toFixed(2)} ms`);
  console.log(`Latência min: ${min} ms, max: ${max} ms`);
}

// CLI
const arg = process.argv[2];
let numDrivers = parseInt(arg, 10);
if (!SIZES.includes(numDrivers)) {
  console.log(`Tamanho inválido ou não informado. Usando padrão: ${DEFAULT_SIZE}`);
  numDrivers = DEFAULT_SIZE;
  console.log(`Use: node test-redis-load.js [${SIZES.join('|')}]`);
}

runTest(numDrivers); 