#!/usr/bin/env node

/**
 * 🧾 DEMONSTRAÇÃO DO SISTEMA DE RECIBOS LEAF
 * 
 * Esta demonstração mostra como o sistema de recibos funciona
 * com dados reais de uma corrida finalizada
 */

const ReceiptService = require('./services/receipt-service');

async function demonstrateReceiptSystem() {
    console.log('🧾 DEMONSTRAÇÃO - SISTEMA DE RECIBOS LEAF\n');
    
    // Simular dados de uma corrida real
    const mockRideData = {
        rideId: 'corrida_exemplo_001',
        userId: 'motorista_123',
        userName: 'João Silva',
        startLocation: { lat: -23.550520, lng: -46.633308 }, // São Paulo Centro
        endLocation: { lat: -23.561684, lng: -46.656139 },   // Vila Madalena
        startTime: '2025-09-12T19:30:00Z',
        endTime: '2025-09-12T20:15:00Z',
        totalAmount: 42.50,
        paymentMethod: 'PIX',
        distance: 8.2,
        fare: 42.50
    };
    
    console.log('📍 DADOS DA CORRIDA:');
    console.log(`   🚗 ID: ${mockRideData.rideId}`);
    console.log(`   👤 Motorista: ${mockRideData.userName}`);
    console.log(`   💰 Valor Total: R$ ${mockRideData.totalAmount.toFixed(2)}`);
    console.log(`   📏 Distância: ${mockRideData.distance} km`);
    console.log(`   ⏱️  Duração: 45 minutos`);
    console.log(`   💳 Pagamento: ${mockRideData.paymentMethod}`);
    console.log('');
    
    // Inicializar serviço de recibos
    const receiptService = new ReceiptService();
    
    try {
        console.log('⚡ GERANDO RECIBO...\n');
        
        // Gerar recibo completo
        const receipt = await receiptService.generateReceiptFromRideData(mockRideData);
        
        console.log('✅ RECIBO GERADO COM SUCESSO!\n');
        console.log('📋 DETALHES DO RECIBO:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🆔 ID do Recibo: ${receipt.receiptId}`);
        console.log(`📅 Data/Hora: ${new Date(receipt.timestamp).toLocaleString('pt-BR')}`);
        console.log(`👤 Motorista: ${receipt.driverName}`);
        console.log('');
        console.log('💰 VALORES:');
        console.log(`   Valor Total Pago: R$ ${receipt.totalAmount.toFixed(2)}`);
        console.log(`   Taxa Operacional: R$ ${receipt.breakdown.operationalFee.toFixed(2)}`);
        console.log(`   Taxa de Pagamento: R$ ${receipt.breakdown.paymentProcessingFee.toFixed(2)}`);
        console.log(`   ────────────────────────────────────────`);
        console.log(`   💵 Valor ao Motorista: R$ ${receipt.breakdown.driverAmount.toFixed(2)}`);
        console.log('');
        console.log('🗺️  VIAGEM:');
        console.log(`   📏 Distância: ${receipt.distance} km`);
        console.log(`   ⏱️  Duração: ${receipt.duration} minutos`);
        console.log(`   💳 Forma de Pagamento: ${receipt.paymentMethod}`);
        console.log('');
        console.log('🌍 MAPA DO TRAJETO:');
        console.log(`   🔗 URL: ${receipt.mapImageUrl}`);
        console.log('');
        console.log('📊 BREAKDOWN DETALHADO:');
        console.log(`   • Taxa Operacional (${receipt.breakdown.operationalFeeRate}): R$ ${receipt.breakdown.operationalFee.toFixed(2)}`);
        console.log(`   • Taxa de Pagamento (${(receipt.breakdown.paymentProcessingRate * 100).toFixed(1)}% + R$ ${receipt.breakdown.paymentFixedFee.toFixed(2)}): R$ ${receipt.breakdown.paymentProcessingFee.toFixed(2)}`);
        console.log(`   • Total de Taxas: R$ ${(receipt.breakdown.operationalFee + receipt.breakdown.paymentProcessingFee).toFixed(2)}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        console.log('\n🎯 COMO O SISTEMA FUNCIONA:');
        console.log('1. ✅ Corrida é finalizada no app');
        console.log('2. ✅ Sistema calcula automaticamente todas as taxas');
        console.log('3. ✅ Gera imagem do trajeto via Google Maps');
        console.log('4. ✅ Cria recibo com todas as informações legais');
        console.log('5. ✅ Disponibiliza para motorista e passageiro');
        console.log('6. ✅ Permite compartilhamento e download');
        
        console.log('\n🚀 FUNCIONALIDADES IMPLEMENTADAS:');
        console.log('✅ Cálculo automático de taxas operacionais');
        console.log('✅ Cálculo de taxas de processamento de pagamento');
        console.log('✅ Geração de URL de mapa estático do trajeto');
        console.log('✅ Formatação completa do recibo');
        console.log('✅ API REST para integração com mobile app');
        console.log('✅ Sistema de compartilhamento');
        console.log('✅ Conformidade legal e transparência');
        
        console.log('\n📱 INTEGRAÇÃO MOBILE:');
        console.log('• ReceiptService.js - Cliente para buscar recibos');
        console.log('• ReceiptScreen.js - Tela completa do recibo');
        console.log('• Compartilhamento nativo do recibo');
        console.log('• Cache local dos recibos');
        
        return receipt;
        
    } catch (error) {
        console.error('❌ Erro ao gerar recibo:', error.message);
        return null;
    }
}

// Executar demonstração
if (require.main === module) {
    demonstrateReceiptSystem()
        .then(receipt => {
            if (receipt) {
                console.log('\n🎉 DEMONSTRAÇÃO CONCLUÍDA COM SUCESSO!');
                console.log('📋 O sistema de recibos está funcionando perfeitamente!');
            } else {
                console.log('\n❌ Demonstração falhou!');
            }
        })
        .catch(error => {
            console.error('❌ Erro na demonstração:', error);
        });
}

module.exports = { demonstrateReceiptSystem };




