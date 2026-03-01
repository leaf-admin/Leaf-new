/**
 * 🎁 EXEMPLO: Criar Promoção via API
 * 
 * Este script demonstra como criar uma promoção via API do dashboard
 * 
 * Uso:
 * node scripts/exemplo-criar-promocao.js
 */

const axios = require('axios');

// Configuração do backend
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || ''; // Se necessário autenticação

/**
 * Exemplo 1: Promoção dos Primeiros 500 Motoristas
 */
async function criarPromocaoPrimeiros500() {
  try {
    const response = await axios.post(`${BACKEND_URL}/api/promotions`, {
      name: "Primeiros 500 - Assinatura Grátis",
      description: "Os primeiros 500 motoristas cadastrados até 31/12/2025 ganham assinatura grátis até 31/01/2026",
      type: "free_subscription",
      benefit: {
        type: "free_subscription",
        duration: 31,
        unit: "days"
      },
      eligibility: {
        criteria: "first_n_drivers",
        value: 500,
        endDate: "2025-12-31T23:59:59Z"
      },
      startDate: new Date().toISOString(),
      endDate: "2025-12-31T23:59:59Z",
      maxRedemptions: 500,
      createdBy: "admin"
    }, {
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
      }
    });

    console.log('✅ Promoção criada com sucesso!');
    console.log('ID:', response.data.promotion.id);
    console.log('Nome:', response.data.promotion.name);
    console.log('Status:', response.data.promotion.status);

    return response.data.promotion;

  } catch (error) {
    console.error('❌ Erro ao criar promoção:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Exemplo 2: Promoção de Período Específico
 */
async function criarPromocaoPeriodoEspecifico() {
  try {
    const response = await axios.post(`${BACKEND_URL}/api/promotions`, {
      name: "Natal 2025 - Assinatura Grátis",
      description: "Motoristas que se cadastrarem em dezembro de 2025 ganham 30 dias grátis",
      type: "free_subscription",
      benefit: {
        type: "free_subscription",
        duration: 30,
        unit: "days"
      },
      eligibility: {
        criteria: "registration_date_range",
        startDate: "2025-12-01T00:00:00Z",
        endDate: "2025-12-31T23:59:59Z"
      },
      startDate: "2025-12-01T00:00:00Z",
      endDate: "2025-12-31T23:59:59Z",
      maxRedemptions: null, // Ilimitado
      createdBy: "admin"
    }, {
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
      }
    });

    console.log('✅ Promoção criada com sucesso!');
    console.log('ID:', response.data.promotion.id);

    return response.data.promotion;

  } catch (error) {
    console.error('❌ Erro ao criar promoção:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Exemplo 3: Listar Promoções Ativas
 */
async function listarPromocoes() {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/promotions?status=active`, {
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
      }
    });

    console.log(`\n📋 ${response.data.count} promoções ativas encontradas:\n`);
    
    response.data.promotions.forEach(promo => {
      console.log(`- ${promo.name}`);
      console.log(`  ID: ${promo.id}`);
      console.log(`  Tipo: ${promo.type}`);
      console.log(`  Resgates: ${promo.currentRedemptions}/${promo.maxRedemptions || 'ilimitado'}`);
      console.log(`  Status: ${promo.status}\n`);
    });

    return response.data.promotions;

  } catch (error) {
    console.error('❌ Erro ao listar promoções:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Exemplo 4: Verificar Elegibilidade de um Motorista
 */
async function verificarElegibilidade(driverId, promotionId) {
  try {
    const response = await axios.get(
      `${BACKEND_URL}/api/promotions/${promotionId}/check-eligibility/${driverId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
        }
      }
    );

    if (response.data.eligible) {
      console.log(`✅ Motorista ${driverId} é elegível para a promoção!`);
    } else {
      console.log(`❌ Motorista ${driverId} NÃO é elegível: ${response.data.reason}`);
    }

    return response.data;

  } catch (error) {
    console.error('❌ Erro ao verificar elegibilidade:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Exemplo 5: Aplicar Promoção Manualmente
 */
async function aplicarPromocao(driverId, promotionId) {
  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/promotions/${promotionId}/apply/${driverId}`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
        }
      }
    );

    if (response.data.success) {
      console.log(`✅ Promoção aplicada com sucesso para motorista ${driverId}!`);
      console.log('Benefício:', response.data.benefit);
    } else {
      console.log(`❌ Erro ao aplicar promoção: ${response.data.error}`);
    }

    return response.data;

  } catch (error) {
    console.error('❌ Erro ao aplicar promoção:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Exemplo 6: Estatísticas de Promoções
 */
async function obterEstatisticas() {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/promotions/stats`, {
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY && { 'Authorization': `Bearer ${API_KEY}` })
      }
    });

    console.log('\n📊 Estatísticas de Promoções:\n');
    console.log(`Total: ${response.data.stats.total}`);
    console.log(`Ativas: ${response.data.stats.active}`);
    console.log(`Completadas: ${response.data.stats.completed}`);
    console.log(`Expiradas: ${response.data.stats.expired}`);
    console.log(`Total de Resgates: ${response.data.stats.totalRedemptions}`);
    console.log('\nPor Tipo:');
    Object.entries(response.data.stats.byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    return response.data.stats;

  } catch (error) {
    console.error('❌ Erro ao obter estatísticas:', error.response?.data || error.message);
    throw error;
  }
}

// Executar exemplos
async function main() {
  console.log('🎁 Exemplos de Gestão de Promoções\n');
  console.log('='.repeat(50));

  try {
    // Exemplo 1: Criar promoção dos primeiros 500
    console.log('\n1️⃣ Criando promoção dos primeiros 500...');
    const promo1 = await criarPromocaoPrimeiros500();

    // Exemplo 2: Listar promoções
    console.log('\n2️⃣ Listando promoções ativas...');
    await listarPromocoes();

    // Exemplo 3: Estatísticas
    console.log('\n3️⃣ Obtendo estatísticas...');
    await obterEstatisticas();

    // Exemplo 4: Verificar elegibilidade (substituir IDs reais)
    // console.log('\n4️⃣ Verificando elegibilidade...');
    // await verificarElegibilidade('driver123', promo1.id);

    // Exemplo 5: Aplicar promoção manualmente (substituir IDs reais)
    // console.log('\n5️⃣ Aplicando promoção manualmente...');
    // await aplicarPromocao('driver123', promo1.id);

    console.log('\n✅ Exemplos executados com sucesso!');

  } catch (error) {
    console.error('\n❌ Erro ao executar exemplos:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main();
}

module.exports = {
  criarPromocaoPrimeiros500,
  criarPromocaoPeriodoEspecifico,
  listarPromocoes,
  verificarElegibilidade,
  aplicarPromocao,
  obterEstatisticas
};

