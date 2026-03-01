#!/usr/bin/env node

/**
 * Script para corrigir webhooks da Woovi
 * - Lista webhooks existentes
 * - Encontra webhooks com URL do ngrok (offline)
 * - Atualiza ou deleta webhooks antigos
 * - Cria novo webhook com URL correta
 */

const axios = require('axios');

const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X01ENWpTTW1DMExBYWx2WHhiY0tTSnlrVmYyM0g1Z0FxS0pZaE5zT0tUK1E9';
const WOOVI_BASE_URL = process.env.WOOVI_BASE_URL || 'https://api.woovi-sandbox.com/api/v1';
const CORRECT_WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://216.238.107.59:3001/api/woovi/webhook';
const TARGET_EVENT = process.env.WEBHOOK_EVENT || 'OPENPIX:CHARGE_COMPLETED';

const api = axios.create({
  baseURL: WOOVI_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': WOOVI_API_TOKEN
  },
  timeout: 30000
});

async function listWebhooks() {
  try {
    console.log('🔍 Listando webhooks existentes...');
    const response = await api.get('/webhook');
    
    if (response.data && response.data.webhooks) {
      return response.data.webhooks;
    }
    return [];
  } catch (error) {
    console.error('❌ Erro ao listar webhooks:', error.response?.data || error.message);
    return [];
  }
}

async function updateWebhook(webhookId, newUrl, event = TARGET_EVENT) {
  try {
    console.log(`🔄 Atualizando webhook ${webhookId}...`);
    const response = await api.put(`/webhook/${webhookId}`, {
      webhook: {
        url: newUrl,
        event,
        isActive: true
      }
    });
    
    if (response.data && response.data.webhook) {
      console.log('✅ Webhook atualizado:', response.data.webhook);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Erro ao atualizar webhook:', error.response?.data || error.message);
    return false;
  }
}

async function deleteWebhook(webhookId) {
  try {
    console.log(`🗑️ Deletando webhook ${webhookId}...`);
    const response = await api.delete(`/webhook/${webhookId}`);
    console.log('✅ Webhook deletado');
    return true;
  } catch (error) {
    console.error('❌ Erro ao deletar webhook:', error.response?.data || error.message);
    return false;
  }
}

async function createWebhook(name, url, event = TARGET_EVENT) {
  try {
    console.log(`🔔 Criando novo webhook: ${name}...`);
    const response = await api.post('/webhook', {
      webhook: {
        name,
        url,
        event,
        isActive: true
      }
    });
    
    if (response.data && response.data.webhook) {
      console.log('✅ Webhook criado:', response.data.webhook);
      return response.data.webhook;
    }
    return null;
  } catch (error) {
    console.error('❌ Erro ao criar webhook:', error.response?.data || error.message);
    return null;
  }
}

async function main() {
  console.log('🚀 Iniciando correção de webhooks da Woovi...\n');
  
  // 1. Listar webhooks existentes
  const webhooks = await listWebhooks();
  console.log(`📋 Encontrados ${webhooks.length} webhook(s)\n`);
  
  // 2. Encontrar webhooks com URL do ngrok
  const ngrokWebhooks = webhooks.filter(w => 
    w.url && (w.url.includes('ngrok') || w.url.includes('ngrok-free.app'))
  );
  
  if (ngrokWebhooks.length > 0) {
    console.log(`⚠️ Encontrados ${ngrokWebhooks.length} webhook(s) com URL do ngrok (offline):\n`);
    ngrokWebhooks.forEach(w => {
      console.log(`  - ${w.name} (ID: ${w.id})`);
      console.log(`    URL: ${w.url}`);
      console.log(`    Status: ${w.isActive ? 'Ativo' : 'Inativo'}\n`);
    });
    
    // 3. Atualizar ou deletar webhooks do ngrok
    for (const webhook of ngrokWebhooks) {
      const update = await updateWebhook(webhook.id, CORRECT_WEBHOOK_URL);
      if (!update) {
        console.log(`⚠️ Não foi possível atualizar, tentando deletar...`);
        await deleteWebhook(webhook.id);
      }
    }
  } else {
    console.log('✅ Nenhum webhook com URL do ngrok encontrado\n');
  }
  
  // 3. Corrigir webhooks que apontam para o VPS mas possuem evento diferente
  const mismatchedEventWebhooks = webhooks.filter(
    w => w.url === CORRECT_WEBHOOK_URL && w.event !== TARGET_EVENT
  );

  for (const webhook of mismatchedEventWebhooks) {
    console.log(`⚠️ Webhook com evento incorreto (${webhook.event}). Atualizando...`);
    await updateWebhook(webhook.id, CORRECT_WEBHOOK_URL, TARGET_EVENT);
  }
  
  // 4. Verificar se já existe webhook com URL e evento corretos
  const correctWebhook = webhooks.find(
    w => w.url === CORRECT_WEBHOOK_URL && w.event === TARGET_EVENT
  );
  
  if (!correctWebhook) {
    console.log('🔔 Criando novo webhook com URL correta...\n');
    await createWebhook('Leaf App Webhook - OPENPIX:CHARGE_COMPLETED', CORRECT_WEBHOOK_URL, TARGET_EVENT);
  } else {
    console.log('✅ Webhook com URL correta já existe:', correctWebhook);
  }
  
  console.log('\n✅ Processo concluído!');
}

main().catch(console.error);

