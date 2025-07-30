#!/usr/bin/env node

/**
 * 🏦 Teste do Monitoramento de Custos em Tempo Real
 * 
 * Este script testa o sistema de monitoramento de custos e sustentabilidade
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configuração
const CONFIG = {
  // URLs das APIs
  apis: {
    costData: 'https://us-central1-leaf-reactnative.cloudfunctions.net/getCostData',
    revenueData: 'https://us-central1-leaf-reactnative.cloudfunctions.net/getRevenueData',
    sustainabilityMetrics: 'https://us-central1-leaf-reactnative.cloudfunctions.net/getSustainabilityMetrics'
  },
  
  // Limites de custos
  thresholds: {
    google_maps: 0.15,
    firebase: 0.02,
    redis: 0.01,
    websocket: 0.02,
    mobile_api: 0.01,
    location: 0.01,
    hosting: 0.01,
    monitoring: 0.005,
    security: 0.002,
    total_cost: 0.3
  },
  
  // Taxa operacional média
  averageOperationalFee: 1.49
};

/**
 * Simular dados de custos realistas
 */
function generateMockCostData() {
  return {
    google_maps: Math.random() * 0.15 + 0.05, // R$ 0.05 - 0.20
    firebase: Math.random() * 0.02 + 0.01, // R$ 0.01 - 0.03
    redis: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
    websocket: Math.random() * 0.02 + 0.01, // R$ 0.01 - 0.03
    mobile_api: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
    location: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
    hosting: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
    monitoring: Math.random() * 0.005 + 0.002, // R$ 0.002 - 0.007
    security: Math.random() * 0.002 + 0.001, // R$ 0.001 - 0.003
    total_cost: 0
  };
}

/**
 * Simular dados de receita
 */
function generateMockRevenueData() {
  return {
    operational_fees: Math.random() * 100 + 50, // R$ 50 - 150
    total_rides: Math.floor(Math.random() * 50) + 20, // 20 - 70 corridas
    average_fee: CONFIG.averageOperationalFee,
    profit_margin: 0
  };
}

/**
 * Calcular métricas de sustentabilidade
 */
function calculateSustainabilityMetrics(costData, revenueData) {
  const revenue_per_ride = revenueData.average_fee;
  const cost_per_ride = costData.total_cost;
  const margin_per_ride = revenue_per_ride - cost_per_ride;
  const sustainability_rate = (margin_per_ride / revenue_per_ride) * 100;
  const is_sustainable = margin_per_ride > 0 && sustainability_rate > 50;

  return {
    revenue_per_ride,
    cost_per_ride,
    margin_per_ride,
    sustainability_rate,
    is_sustainable
  };
}

/**
 * Formatar valor monetário
 */
function formatCurrency(value) {
  return `R$ ${value.toFixed(3)}`;
}

/**
 * Formatar porcentagem
 */
function formatPercentage(value) {
  return `${value.toFixed(1)}%`;
}

/**
 * Determinar cor do indicador
 */
function getIndicatorColor(value, threshold) {
  if (value > threshold) return '🔴'; // Vermelho
  if (value > threshold * 0.8) return '🟡'; // Amarelo
  return '🟢'; // Verde
}

/**
 * Testar monitoramento de custos
 */
async function testCostMonitoring() {
  console.log('🏦 TESTE DO MONITORAMENTO DE CUSTOS EM TEMPO REAL');
  console.log('=' .repeat(60));
  
  // Gerar dados simulados
  const costData = generateMockCostData();
  costData.total_cost = Object.values(costData).reduce((sum, cost) => 
    cost !== costData.total_cost ? sum + cost : sum, 0
  );
  
  const revenueData = generateMockRevenueData();
  revenueData.profit_margin = revenueData.operational_fees - costData.total_cost;
  
  const sustainabilityMetrics = calculateSustainabilityMetrics(costData, revenueData);
  
  // Exibir dados de custos
  console.log('\n📊 CUSTOS POR CORRIDA:');
  console.log('─' .repeat(40));
  
  Object.entries(costData).forEach(([key, value]) => {
    if (key !== 'total_cost') {
      const threshold = CONFIG.thresholds[key];
      const color = getIndicatorColor(value, threshold);
      const percentage = costData.total_cost > 0 ? (value / costData.total_cost) * 100 : 0;
      
      console.log(`${color} ${key.replace('_', ' ').toUpperCase()}:`);
      console.log(`   Valor: ${formatCurrency(value)}`);
      console.log(`   Limite: ${formatCurrency(threshold)}`);
      console.log(`   % do total: ${formatPercentage(percentage)}`);
      console.log('');
    }
  });
  
  console.log(`🏦 CUSTO TOTAL: ${formatCurrency(costData.total_cost)}`);
  
  // Exibir dados de receita
  console.log('\n💰 RECEITA OPERACIONAL:');
  console.log('─' .repeat(40));
  console.log(`Taxas Operacionais: ${formatCurrency(revenueData.operational_fees)}`);
  console.log(`Total de Corridas: ${revenueData.total_rides}`);
  console.log(`Taxa Média: ${formatCurrency(revenueData.average_fee)}`);
  console.log(`Margem de Lucro: ${formatCurrency(revenueData.profit_margin)}`);
  
  // Exibir análise de sustentabilidade
  console.log('\n📈 ANÁLISE DE SUSTENTABILIDADE:');
  console.log('─' .repeat(40));
  console.log(`Receita por Corrida: ${formatCurrency(sustainabilityMetrics.revenue_per_ride)}`);
  console.log(`Custo por Corrida: ${formatCurrency(sustainabilityMetrics.cost_per_ride)}`);
  console.log(`Margem por Corrida: ${formatCurrency(sustainabilityMetrics.margin_per_ride)}`);
  console.log(`Taxa de Sustentabilidade: ${formatPercentage(sustainabilityMetrics.sustainability_rate)}`);
  console.log(`Status: ${sustainabilityMetrics.is_sustainable ? '✅ SUSTENTÁVEL' : '❌ NÃO SUSTENTÁVEL'}`);
  
  // Verificar alertas
  console.log('\n🚨 ALERTAS DE CUSTOS:');
  console.log('─' .repeat(40));
  
  const alerts = [];
  
  Object.entries(costData).forEach(([key, value]) => {
    if (key !== 'total_cost') {
      const threshold = CONFIG.thresholds[key];
      if (value > threshold) {
        alerts.push({
          type: 'critical',
          item: key,
          value,
          threshold
        });
      } else if (value > threshold * 0.8) {
        alerts.push({
          type: 'warning',
          item: key,
          value,
          threshold
        });
      }
    }
  });
  
  if (alerts.length === 0) {
    console.log('✅ Nenhum alerta - todos os custos estão dentro dos limites');
  } else {
    alerts.forEach(alert => {
      const icon = alert.type === 'critical' ? '🔴' : '🟡';
      console.log(`${icon} ${alert.item.toUpperCase()}: ${formatCurrency(alert.value)} (limite: ${formatCurrency(alert.threshold)})`);
    });
  }
  
  // Recomendações
  console.log('\n💡 RECOMENDAÇÕES:');
  console.log('─' .repeat(40));
  
  if (!sustainabilityMetrics.is_sustainable) {
    console.log('❌ O serviço não está sustentável. Recomendações:');
    console.log('   • Otimizar uso do Google Maps API');
    console.log('   • Implementar cache mais eficiente');
    console.log('   • Revisar configurações do Firebase');
    console.log('   • Considerar aumentar taxa operacional');
  } else {
    console.log('✅ O serviço está sustentável!');
    console.log('   • Margem positiva mantida');
    console.log('   • Custos controlados');
    console.log('   • Modelo viável');
  }
  
  // Resumo final
  console.log('\n📋 RESUMO FINAL:');
  console.log('─' .repeat(40));
  console.log(`💰 Receita por corrida: ${formatCurrency(sustainabilityMetrics.revenue_per_ride)}`);
  console.log(`💸 Custo por corrida: ${formatCurrency(sustainabilityMetrics.cost_per_ride)}`);
  console.log(`📊 Margem por corrida: ${formatCurrency(sustainabilityMetrics.margin_per_ride)}`);
  console.log(`📈 Taxa de sustentabilidade: ${formatPercentage(sustainabilityMetrics.sustainability_rate)}`);
  console.log(`🎯 Status: ${sustainabilityMetrics.is_sustainable ? 'SUSTENTÁVEL' : 'NÃO SUSTENTÁVEL'}`);
  console.log(`🚨 Alertas: ${alerts.length}`);
  
  return {
    costData,
    revenueData,
    sustainabilityMetrics,
    alerts,
    isSustainable: sustainabilityMetrics.is_sustainable
  };
}

/**
 * Teste de performance com múltiplas simulações
 */
async function testPerformance() {
  console.log('\n⚡ TESTE DE PERFORMANCE');
  console.log('─' .repeat(40));
  
  const simulations = 100;
  let sustainableCount = 0;
  let totalMargin = 0;
  let totalAlerts = 0;
  
  for (let i = 0; i < simulations; i++) {
    const costData = generateMockCostData();
    costData.total_cost = Object.values(costData).reduce((sum, cost) => 
      cost !== costData.total_cost ? sum + cost : sum, 0
    );
    
    const revenueData = generateMockRevenueData();
    const sustainabilityMetrics = calculateSustainabilityMetrics(costData, revenueData);
    
    if (sustainabilityMetrics.is_sustainable) {
      sustainableCount++;
    }
    
    totalMargin += sustainabilityMetrics.margin_per_ride;
    
    // Contar alertas
    Object.entries(costData).forEach(([key, value]) => {
      if (key !== 'total_cost' && value > CONFIG.thresholds[key]) {
        totalAlerts++;
      }
    });
  }
  
  const sustainabilityRate = (sustainableCount / simulations) * 100;
  const averageMargin = totalMargin / simulations;
  const averageAlerts = totalAlerts / simulations;
  
  console.log(`Simulações realizadas: ${simulations}`);
  console.log(`Taxa de sustentabilidade: ${sustainabilityRate.toFixed(1)}%`);
  console.log(`Margem média por corrida: ${formatCurrency(averageMargin)}`);
  console.log(`Média de alertas por simulação: ${averageAlerts.toFixed(1)}`);
  
  if (sustainabilityRate > 80) {
    console.log('✅ Sistema muito sustentável!');
  } else if (sustainabilityRate > 60) {
    console.log('🟡 Sistema moderadamente sustentável');
  } else {
    console.log('❌ Sistema precisa de otimização');
  }
}

// Executar testes
async function runTests() {
  try {
    // Teste básico
    const result = await testCostMonitoring();
    
    // Teste de performance
    await testPerformance();
    
    console.log('\n🎉 TESTES CONCLUÍDOS COM SUCESSO!');
    console.log(`Status final: ${result.isSustainable ? 'SUSTENTÁVEL' : 'NÃO SUSTENTÁVEL'}`);
    
  } catch (error) {
    console.error('❌ Erro durante os testes:', error);
  }
}

runTests(); 