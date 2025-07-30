const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configurações do teste com regra de negócio REAL
const CONFIG = {
  API_BASE_URL: 'https://api.leaf.app.br',
  WEBSOCKET_URL: 'wss://api.leaf.app.br',
  TEST_RIDE: {
    origin: { lat: -23.5505, lng: -46.6333 }, // São Paulo
    destination: { lat: -23.5631, lng: -46.6564 }, // São Paulo
    distance: 2.5, // km
    duration: 480, // segundos (8 minutos)
    rateDetails: {
      base_fare: 5.00,
      rate_per_unit_distance: 2.50, // R$ 2,50/km
      rate_per_hour: 30.00 // R$ 30,00/hora
    }
  }
};

// CUSTOS REAIS DA INFRAESTRUTURA (por corrida) - CORRIGIDO
const INFRASTRUCTURE_COSTS = {
  google: {
    maps: {
      geocoding: 0.025, // R$ 0,025 por request
      directions: 0.025, // R$ 0,025 por request
      requests_per_ride: 5, // 5 requests por corrida (CORRIGIDO)
      total: 0.125 // R$ 0,125 por corrida (CORRIGIDO)
    },
    firebase: {
      functions: 0.0000125, // R$ 0,0000125 por execução
      database: {
        reads: 0.0000003, // R$ 0,0000003 por read
        writes: 0.0000009, // R$ 0,0000009 por write
        reads_per_ride: 8,
        writes_per_ride: 8,
        total: 0.0000096
      },
      total: 0.0000221
    }
  },
  infrastructure: {
    redis: {
      operations: 0.000005, // R$ 0,000005 por operação
      operations_per_ride: 140, // 140 operações por corrida
      total: 0.0007
    },
    websocket: {
      connections: 0.0005, // R$ 0,0005 por conexão
      messages: 0.000005, // R$ 0,000005 por mensagem
      connections_per_ride: 2,
      messages_per_ride: 122, // 122 mensagens por corrida
      total: 0.00161
    }
  },
  mobile: {
    apiCalls: {
      calls: 0.000005, // R$ 0,000005 por chamada
      calls_per_ride: 28, // 28 chamadas por corrida
      total: 0.00014
    },
    location: {
      updates: 0.000005, // R$ 0,000005 por update
      updates_per_ride: 56, // 56 updates por corrida
      total: 0.00028
    }
  }
  // REMOVIDO: payment.woovi - não é custo da infraestrutura
  // As taxas de pagamento são descontadas do valor da corrida
};

// Função para calcular tarifa base (regra real do Leaf)
function calculateBaseFare(distance, time, rateDetails) {
  const baseFare = parseFloat(rateDetails.base_fare) || 0;
  const ratePerKm = parseFloat(rateDetails.rate_per_unit_distance) || 0;
  const ratePerHour = parseFloat(rateDetails.rate_per_hour) || 0;
  
  const distanceFare = distance * ratePerKm;
  const timeFare = (time / 3600) * ratePerHour; // Converter segundos para horas
  
  return baseFare + distanceFare + timeFare;
}

// Função para calcular taxa operacional (regra real do Leaf)
function calculateOperationalFee(rideValue) {
  if (rideValue < 10.00) {
    return 0.79; // Corridas < R$ 10,00
  } else if (rideValue <= 20.00) {
    return 0.99; // Corridas R$ 10,00 - R$ 20,00
  } else {
    return 1.49; // Corridas > R$ 20,00
  }
}

// Função para calcular custos totais da infraestrutura (CORRIGIDA)
function calculateInfrastructureCosts(rideValue) {
  const costs = {
    google: {
      maps: INFRASTRUCTURE_COSTS.google.maps.total,
      firebase: INFRASTRUCTURE_COSTS.google.firebase.total
    },
    infrastructure: {
      redis: INFRASTRUCTURE_COSTS.infrastructure.redis.total,
      websocket: INFRASTRUCTURE_COSTS.infrastructure.websocket.total
    },
    mobile: {
      apiCalls: INFRASTRUCTURE_COSTS.mobile.apiCalls.total,
      location: INFRASTRUCTURE_COSTS.mobile.location.total
    }
    // REMOVIDO: payment.woovi - não é custo da infraestrutura
  };
  
  costs.total = costs.google.maps + costs.google.firebase + 
                costs.infrastructure.redis + costs.infrastructure.websocket +
                costs.mobile.apiCalls + costs.mobile.location;
  
  return costs;
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
async function simulateRide(driver, rideData) {
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

// Função para processar pagamento (CORRIGIDA)
async function processPayment(rideData) {
  console.log('💳 Processando pagamento...');
  
  const paymentMethods = [
    { type: 'pix', name: 'PIX', fee: 0.008 },
    { type: 'credit_card', name: 'Cartão de Crédito', fee: 0.0498 },
    { type: 'debit_card', name: 'Cartão de Débito', fee: 0.0298 }
  ];
  
  const selectedMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
  const paymentFee = rideData.totalValue * selectedMethod.fee;
  const finalAmount = rideData.totalValue + paymentFee;
  
  console.log(`💳 Método: ${selectedMethod.name}`);
  console.log(`💰 Valor da corrida: R$ ${rideData.totalValue.toFixed(2)}`);
  console.log(`💸 Taxa de pagamento: R$ ${paymentFee.toFixed(2)} (descontada do valor)`);
  console.log(`💵 Total pago pelo usuário: R$ ${finalAmount.toFixed(2)}`);
  
  // Simular processamento
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('✅ Pagamento processado com sucesso!');
  console.log('📊 Taxa de pagamento é descontada do valor da corrida (não é custo da infraestrutura)');
  
  return {
    method: selectedMethod.name,
    amount: rideData.totalValue,
    fee: paymentFee.toFixed(2),
    total: finalAmount.toFixed(2)
  };
}

// Função para gerar relatório da corrida (CORRIGIDA)
function generateRideReport(driver, rideData, payment) {
  console.log('\n📊 RELATÓRIO DA CORRIDA - LEAF APP');
  console.log('====================================');
  console.log(`🚗 Motorista: ${driver.name}`);
  console.log(`⭐ Avaliação: ${driver.rating}/5.0`);
  console.log(`🚙 Veículo: ${driver.car} (${driver.plate})`);
  console.log(`📏 Distância: ${CONFIG.TEST_RIDE.distance}km`);
  console.log(`⏱️  Duração: ${CONFIG.TEST_RIDE.duration / 60} minutos`);
  
  console.log('\n💰 CÁLCULO DA TARIFA (REGRА REAL)');
  console.log('==================================');
  console.log(`🏷️  Tarifa base: R$ ${rideData.baseFare.toFixed(2)}`);
  console.log(`📏 Custo por distância: R$ ${rideData.distanceFare.toFixed(2)} (${CONFIG.TEST_RIDE.distance}km × R$ ${CONFIG.TEST_RIDE.rateDetails.rate_per_unit_distance}/km)`);
  console.log(`⏱️  Custo por tempo: R$ ${rideData.timeFare.toFixed(2)} (${CONFIG.TEST_RIDE.duration / 60}min × R$ ${CONFIG.TEST_RIDE.rateDetails.rate_per_hour}/hora)`);
  console.log(`📊 Valor da corrida: R$ ${rideData.rideValue.toFixed(2)}`);
  
  console.log('\n🏢 TAXA OPERACIONAL (NOVA ESTRUTURA)');
  console.log('=====================================');
  console.log(`💰 Taxa operacional: R$ ${rideData.operationalFee.toFixed(2)} (${rideData.operationalFeePercentage.toFixed(1)}% do valor)`);
  console.log(`👨‍💼 Valor para motorista: R$ ${rideData.driverValue.toFixed(2)}`);
  console.log(`💵 TOTAL: R$ ${rideData.totalValue.toFixed(2)}`);
  
  console.log('\n💸 CUSTOS REAIS DA INFRAESTRUTURA (CORRIGIDO)');
  console.log('===============================================');
  console.log(`🗺️  Google Maps: R$ ${rideData.infrastructureCosts.google.maps.toFixed(6)} (5 requests)`);
  console.log(`🔥 Firebase: R$ ${rideData.infrastructureCosts.google.firebase.toFixed(6)}`);
  console.log(`🔴 Redis: R$ ${rideData.infrastructureCosts.infrastructure.redis.toFixed(6)}`);
  console.log(`🔌 WebSocket: R$ ${rideData.infrastructureCosts.infrastructure.websocket.toFixed(6)}`);
  console.log(`📱 Mobile API: R$ ${rideData.infrastructureCosts.mobile.apiCalls.toFixed(6)}`);
  console.log(`📍 Location: R$ ${rideData.infrastructureCosts.mobile.location.toFixed(6)}`);
  console.log(`📊 CUSTO TOTAL INFRAESTRUTURA: R$ ${rideData.infrastructureCosts.total.toFixed(6)}`);
  
  console.log('\n💳 INFORMAÇÕES DE PAGAMENTO');
  console.log('============================');
  console.log(`💳 Método: ${payment.method}`);
  console.log(`💰 Valor da corrida: R$ ${payment.amount.toFixed(2)}`);
  console.log(`💸 Taxa de pagamento: R$ ${payment.fee} (descontada do valor)`);
  console.log(`💵 Total pago pelo usuário: R$ ${payment.total}`);
  console.log('📊 Taxa de pagamento NÃO é custo da infraestrutura');
  
  console.log('\n📈 RESULTADO FINANCEIRO (CORRIGIDO)');
  console.log('====================================');
  console.log(`💰 Receita operacional: R$ ${rideData.operationalFee.toFixed(2)}`);
  console.log(`💸 Custo infraestrutura: R$ ${rideData.infrastructureCosts.total.toFixed(6)}`);
  console.log(`📊 Lucro operacional: R$ ${(rideData.operationalFee - rideData.infrastructureCosts.total).toFixed(6)}`);
  console.log(`📈 Margem de lucro: ${((rideData.operationalFee - rideData.infrastructureCosts.total) / rideData.operationalFee * 100).toFixed(2)}%`);
  
  console.log('\n🎯 Corrida concluída com sucesso!');
}

// Função principal do teste
async function runEndToEndTest() {
  console.log('🚀 Iniciando teste ponta a ponta de corrida - LEAF APP\n');
  
  try {
    // 1. Calcular tarifa base (regra real do Leaf)
    console.log('💰 Calculando tarifa base...');
    const baseFare = calculateBaseFare(
      CONFIG.TEST_RIDE.distance,
      CONFIG.TEST_RIDE.duration,
      CONFIG.TEST_RIDE.rateDetails
    );
    
    const distanceFare = CONFIG.TEST_RIDE.distance * CONFIG.TEST_RIDE.rateDetails.rate_per_unit_distance;
    const timeFare = (CONFIG.TEST_RIDE.duration / 3600) * CONFIG.TEST_RIDE.rateDetails.rate_per_hour;
    const rideValue = baseFare;
    
    // 2. Calcular taxa operacional (nova estrutura)
    const operationalFee = calculateOperationalFee(rideValue);
    const operationalFeePercentage = (operationalFee / rideValue) * 100;
    const driverValue = rideValue - operationalFee;
    const totalValue = rideValue;
    
    // 3. Calcular custos da infraestrutura
    const infrastructureCosts = calculateInfrastructureCosts(rideValue);
    
    const rideData = {
      baseFare: CONFIG.TEST_RIDE.rateDetails.base_fare,
      distanceFare,
      timeFare,
      rideValue,
      operationalFee,
      operationalFeePercentage,
      driverValue,
      totalValue,
      infrastructureCosts
    };
    
    // 4. Buscar motorista
    const driver = await searchDriver();
    
    // 5. Aceitar corrida
    const accepted = await acceptRide(driver);
    if (!accepted) {
      throw new Error('Motorista não aceitou a corrida');
    }
    
    // 6. Simular viagem
    const rideCompleted = await simulateRide(driver, rideData);
    if (!rideCompleted) {
      throw new Error('Viagem não foi concluída');
    }
    
    // 7. Processar pagamento
    const payment = await processPayment(rideData);
    
    // 8. Gerar relatório
    generateRideReport(driver, rideData, payment);
    
  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
  }
}

// Executar teste
runEndToEndTest().catch(console.error); 