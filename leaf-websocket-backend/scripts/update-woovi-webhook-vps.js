#!/usr/bin/env node

/**
 * Script para atualizar webhook da Woovi para URL da VPS
 * Substitui webhooks com ngrok/localhost pela URL da VPS
 */

const axios = require('axios');
const path = require('path');

// Carregar configuração Woovi
const configPath = path.join(__dirname, '../config/woovi-sandbox.js');
const WOOVI_CONFIG = require(configPath);

// ✅ URL correta da API Woovi (sandbox)
// A baseUrl no config está como 'https://api-sandbox.woovi.com'
// Mas a API real é 'https://api.woovi-sandbox.com/api/v1'
const WOOVI_API_BASE_URL = process.env.WOOVI_BASE_URL || 'https://api.woovi-sandbox.com/api/v1';

const VPS_WEBHOOK_URL = process.env.WOOVI_WEBHOOK_URL || 'http://147.93.66.253/api/woovi/webhook';

async function updateWooviWebhook(webhookUrl) {
  try {
    console.log('🔄 Atualizando webhook na Woovi via API...');
    console.log(`   Nova URL: ${webhookUrl}`);
    
    const api = axios.create({
      baseURL: WOOVI_API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': WOOVI_CONFIG.apiToken
      },
      timeout: 10000,
      maxRedirects: 0, // Não seguir redirecionamentos
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });
    
    // Listar webhooks existentes
    console.log('   📋 Listando webhooks existentes...');
    const listResponse = await api.get('/webhook');
    
    // A API pode retornar webhooks em diferentes formatos
    let webhooks = [];
    if (listResponse.data) {
      if (Array.isArray(listResponse.data)) {
        webhooks = listResponse.data;
      } else if (listResponse.data.webhooks) {
        webhooks = Array.isArray(listResponse.data.webhooks) 
          ? listResponse.data.webhooks 
          : [listResponse.data.webhooks];
      } else if (listResponse.data.webhook) {
        webhooks = Array.isArray(listResponse.data.webhook)
          ? listResponse.data.webhook
          : [listResponse.data.webhook];
      } else if (listResponse.data.data) {
        webhooks = Array.isArray(listResponse.data.data)
          ? listResponse.data.data
          : [listResponse.data.data];
      }
    }
    
    console.log(`   ✅ Encontrados ${webhooks.length} webhook(s)`);
    
    if (webhooks.length > 0) {
      // Procurar webhook existente (ngrok, localhost, 192.168, ou qualquer outro)
      const existingWebhook = webhooks.find(w => {
        const url = w.url || w.webhookUrl || '';
        return url && (
          url.includes('ngrok') || 
          url.includes('localhost') ||
          url.includes('192.168') ||
          url.includes('127.0.0.1')
        );
      });
      
      if (existingWebhook) {
        // Atualizar webhook existente
        console.log(`   📝 Atualizando webhook existente:`);
        console.log(`      ID: ${existingWebhook.id}`);
        console.log(`      URL antiga: ${existingWebhook.url}`);
        console.log(`      URL nova: ${webhookUrl}`);
        
        const updateResponse = await api.put(`/webhook/${existingWebhook.id}`, {
          webhook: {
            url: webhookUrl,
            isActive: true,
            name: existingWebhook.name || 'Leaf App Webhook - VPS'
          }
        });
        
        if (updateResponse.data) {
          console.log('   ✅ Webhook atualizado na Woovi com sucesso!');
          return {
            success: true,
            webhook: updateResponse.data.webhook || updateResponse.data
          };
        }
      } else {
        // Verificar se já existe webhook com a URL da VPS
        const vpsWebhook = webhooks.find(w => {
          const url = w.url || w.webhookUrl || '';
          return url && url.includes('147.93.66.253');
        });
        
        if (vpsWebhook) {
          console.log('   ✅ Webhook já está configurado para a VPS!');
          console.log(`      URL: ${vpsWebhook.url || vpsWebhook.webhookUrl}`);
          return {
            success: true,
            webhook: vpsWebhook,
            alreadyConfigured: true
          };
        }
        
        // Criar novo webhook
        console.log('   📝 Criando novo webhook na Woovi...');
        const payload = {
          webhook: {
            name: 'Leaf App Webhook - VPS',
            url: webhookUrl,
            isActive: true,
            event: 'OPENPIX:CHARGE_COMPLETED'
          }
        };
        console.log('   📤 Payload:', JSON.stringify(payload, null, 2));
        
        const createResponse = await api.post('/webhook', payload);
        
        console.log('   📥 Status:', createResponse.status);
        console.log('   📥 Resposta completa:', JSON.stringify(createResponse.data, null, 2).substring(0, 300));
        
        if (createResponse.data) {
          console.log('   ✅ Webhook criado na Woovi com sucesso!');
          const webhookData = createResponse.data.webhook || createResponse.data;
          return {
            success: true,
            webhook: webhookData
          };
        }
      }
    } else {
      // Nenhum webhook encontrado, criar novo
      console.log('   📝 Nenhum webhook existente encontrado, criando novo...');
      const createResponse = await api.post('/webhook', {
        webhook: {
          name: 'Leaf App Webhook - VPS',
          url: webhookUrl,
          isActive: true,
          event: 'OPENPIX:CHARGE_COMPLETED'
        }
      });
      
      if (createResponse.data) {
        console.log('   ✅ Webhook criado na Woovi com sucesso!');
        return {
          success: true,
          webhook: createResponse.data.webhook || createResponse.data
        };
      }
    }
  } catch (error) {
    console.error('   ❌ Erro ao atualizar webhook na Woovi:');
    console.error(`      Status: ${error.response?.status || 'N/A'}`);
    console.error(`      Mensagem: ${error.response?.data?.message || error.message}`);
    
    if (error.response?.data) {
      console.error(`      Detalhes:`, JSON.stringify(error.response.data, null, 2));
    }
    
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔔 ATUALIZAR WEBHOOK WOOVI PARA VPS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  
  const result = await updateWooviWebhook(VPS_WEBHOOK_URL);
  
  console.log('');
  if (result.success) {
    if (result.alreadyConfigured) {
      console.log('✅ Webhook já estava configurado corretamente!');
    } else {
      console.log('✅ Webhook atualizado com sucesso!');
    }
    console.log('');
    console.log('📋 Informações do webhook:');
    console.log(`   ID: ${result.webhook?.id || 'N/A'}`);
    console.log(`   Nome: ${result.webhook?.name || 'N/A'}`);
    console.log(`   URL: ${result.webhook?.url || VPS_WEBHOOK_URL}`);
    console.log(`   Ativo: ${result.webhook?.isActive ? 'Sim' : 'Não'}`);
  } else {
    console.log('❌ Falha ao atualizar webhook');
    console.log(`   Erro: ${result.error}`);
    console.log('');
    console.log('💡 Você pode configurar manualmente na Woovi Dashboard:');
    console.log(`   URL: ${VPS_WEBHOOK_URL}`);
    process.exit(1);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

// Executar
main().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});

