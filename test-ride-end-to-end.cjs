const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configurações do teste
const CONFIG = {
  API_BASE_URL: 'https://api.leaf.app.br',
  WEBSOCKET_URL: 'wss://api.leaf.app.br',
  TEST_RIDE: {
    origin: { lat: -23.5505, lng: -46.6333 }, // São Paulo
    destination: { lat: -23.5631, lng: -46.6564 }, // São Paulo
    distance: 2.5, // km
    duration: 8, // minutos
    baseFare: 5.00,
    perKmRate: 2.50,
    perMinuteRate: 0.50
  }
};

// Simulação de custos discriminados
const COST_BREAKDOWN = {
  baseFare: 5.00,
  distanceCost: 0,
  timeCost: 0,
  platformFee: 0,
  driverEarnings: 0,
  totalCost: 0
};

// Função para calcular custos
function calculateCosts(distance, duration) {
  const distanceCost = distance * CONFIG.TEST_RIDE.perKmRate;
  const timeCost = duration * CONFIG.TEST_RIDE.perMinuteRate;
  const subtotal = CONFIG.TEST_RIDE.baseFare + distanceCost + timeCost;
  const platformFee = subtotal * 0.15; // 15% taxa da plataforma
  const driverEarnings = subtotal * 0.70; // 70% para o motorista
  const totalCost = subtotal + platformFee;

  return {
    baseFare: CONFIG.TEST_RIDE.baseFare,
    distanceCost: distanceCost.toFixed(2),
    timeCost: timeCost.toFixed(2),
    subtotal: subtotal.toFixed(2),
    platformFee: platformFee.toFixed(2),
    driverEarnings: driverEarnings.toFixed(2),
    totalCost: totalCost.toFixed(2),
    breakdown: {
      distance: `${distance}km × R$ ${CONFIG.TEST_RIDE.perKmRate}/km`,
      time: `${duration}min × R$ ${CONFIG.TEST_RIDE.perMinuteRate}/min`,
      platform: '15% taxa da plataforma',
      driver: '70% para o motorista'
    }
  };
}

// Função para simular busca de motorista
async function searchDriver() {
  console.log('🔍 Buscando motorista...');
  
  // Simular tempo de busca
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const drivers = [
    { id: 'driver_001', name: 'João Silva', rating: 4.8, car: 'Toyota Corolla', plate: 'ABC-1234' },
    { id: 'driver_002', name: 'Maria Santos', rating: 4.9, car: 'Honda Civic', plate: 'DEF-5678' },
    { id: 'driver_003', name: 'Pedro Costa', rating: 4.7, car: 'Hyundai HB20', plate: 'GHI-9012' }
  ];
  
  const selectedDriver = drivers[Math.floor(Math.random() * drivers.length)];
  console.log(`✅ Motorista encontrado: ${selectedDriver.name} (${selectedDriver.car})`);
  
  return selectedDriver;
}

// Função para simular aceitação da corrida
async function acceptRide(driver) {
  console.log('📱 Motorista aceitou a corrida!');
  console.log(`🚗 ${driver.name} está a caminho...`);
  
  // Simular tempo de chegada
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('🚗 Motorista chegou!');
  return true;
}

// Função para simular viagem em tempo real
async function simulateRide(driver, costs) {
  console.log('🚀 Iniciando viagem...');
  console.log(`📍 Origem: São Paulo (${CONFIG.TEST_RIDE.origin.lat}, ${CONFIG.TEST_RIDE.origin.lng})`);
  console.log(`🎯 Destino: São Paulo (${CONFIG.TEST_RIDE.destination.lat}, ${CONFIG.TEST_RIDE.destination.lng})`);
  
  const rideSteps = [
    { progress: 0, message: 'Saindo da origem...' },
    { progress: 25, message: 'Pegando avenida principal...' },
    { progress: 50, message: 'Passando pelo centro...' },
    { progress: 75, message: 'Aproximando do destino...' },
    { progress: 100, message: 'Chegando ao destino...' }
  ];
  
  for (const step of rideSteps) {
    console.log(`📍 ${step.message} (${step.progress}%)`);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  console.log('✅ Viagem concluída!');
  return true;
}

// Função para processar pagamento
async function processPayment(costs) {
  console.log('💳 Processando pagamento...');
  
  const paymentMethods = [
    { type: 'credit_card', name: 'Cartão de Crédito', fee: 0.05 },
    { type: 'debit_card', name: 'Cartão de Débito', fee: 0.03 },
    { type: 'pix', name: 'PIX', fee: 0.01 },
    { type: 'cash', name: 'Dinheiro', fee: 0.00 }
  ];
  
  const selectedMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
  const paymentFee = parseFloat(costs.totalCost) * selectedMethod.fee;
  const finalAmount = parseFloat(costs.totalCost) + paymentFee;
  
  console.log(`💳 Método: ${selectedMethod.name}`);
  console.log(`💰 Valor: R$ ${costs.totalCost}`);
  console.log(`💸 Taxa: R$ ${paymentFee.toFixed(2)}`);
  console.log(`💵 Total: R$ ${finalAmount.toFixed(2)}`);
  
  // Simular processamento
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('✅ Pagamento processado com sucesso!');
  
  return {
    method: selectedMethod.name,
    amount: costs.totalCost,
    fee: paymentFee.toFixed(2),
    total: finalAmount.toFixed(2)
  };
}

// Função para gerar relatório da corrida
function generateRideReport(driver, costs, payment) {
  console.log('\n📊 RELATÓRIO DA CORRIDA');
  console.log('========================');
  console.log(`🚗 Motorista: ${driver.name}`);
  console.log(`⭐ Avaliação: ${driver.rating}/5.0`);
  console.log(`🚙 Veículo: ${driver.car} (${driver.plate})`);
  console.log(`📏 Distância: ${CONFIG.TEST_RIDE.distance}km`);
  console.log(`⏱️  Duração: ${CONFIG.TEST_RIDE.duration} minutos`);
  
  console.log('\n💰 CUSTOS DISCRIMINADOS');
  console.log('=======================');
  console.log(`🏷️  Tarifa base: R$ ${costs.baseFare}`);
  console.log(`📏 Custo por distância: R$ ${costs.distanceCost} (${costs.breakdown.distance})`);
  console.log(`⏱️  Custo por tempo: R$ ${costs.timeCost} (${costs.breakdown.time})`);
  console.log(`📊 Subtotal: R$ ${costs.subtotal}`);
  console.log(`🏢 Taxa da plataforma: R$ ${costs.platformFee} (${costs.breakdown.platform})`);
  console.log(`👨‍💼 Ganhos do motorista: R$ ${costs.driverEarnings} (${costs.breakdown.driver})`);
  console.log(`💵 TOTAL: R$ ${costs.totalCost}`);
  
  console.log('\n💳 INFORMAÇÕES DE PAGAMENTO');
  console.log('============================');
  console.log(`💳 Método: ${payment.method}`);
  console.log(`💰 Valor: R$ ${payment.amount}`);
  console.log(`💸 Taxa: R$ ${payment.fee}`);
  console.log(`💵 Total pago: R$ ${payment.total}`);
  
  console.log('\n🎯 Corrida concluída com sucesso!');
}

// Função principal do teste
async function runEndToEndTest() {
  console.log('🚀 Iniciando teste ponta a ponta de corrida...\n');
  
  try {
    // 1. Calcular custos
    console.log('💰 Calculando custos...');
    const costs = calculateCosts(CONFIG.TEST_RIDE.distance, CONFIG.TEST_RIDE.duration);
    
    // 2. Buscar motorista
    const driver = await searchDriver();
    
    // 3. Aceitar corrida
    const accepted = await acceptRide(driver);
    if (!accepted) {
      throw new Error('Motorista não aceitou a corrida');
    }
    
    // 4. Simular viagem
    const rideCompleted = await simulateRide(driver, costs);
    if (!rideCompleted) {
      throw new Error('Viagem não foi concluída');
    }
    
    // 5. Processar pagamento
    const payment = await processPayment(costs);
    
    // 6. Gerar relatório
    generateRideReport(driver, costs, payment);
    
  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
  }
}

// Executar teste
runEndToEndTest().catch(console.error); 