const axios = require('axios');
const { logStructured, logError } = require('../utils/logger');

// Configuração Woovi
// ⚠️ ATENÇÃO: Para produção, atualizar baseUrl para 'https://api.woovi.com/api/v1' e usar credenciais de produção
const WOOVI_CONFIG = {
  // ✅ Usar variáveis de ambiente em produção
  // ✅ NOVO APPID CRIADO PELO USUÁRIO (25/11/2025)
  apiToken: process.env.WOOVI_API_TOKEN || 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X01ENWpTTW1DMExBYWx2WHhiY0tTSnlrVmYyM0g1Z0FxS0pZaE5zT0tUK1E9',
  // ⚠️ SANDBOX: URL correta é 'https://api.woovi-sandbox.com/api/v1' (com ponto antes de woovi-sandbox)
  // ✅ TESTADO: https://api-sandbox.woovi.com retorna 302 (redirecionamento) → HTML
  // ✅ TESTADO: https://api.woovi-sandbox.com retorna 401 (JSON válido) → CORRETO
  // ⚠️ PRODUÇÃO: 'https://api.woovi.com/api/v1'
  baseUrl: process.env.WOOVI_BASE_URL || 'https://api.woovi-sandbox.com/api/v1',
  appId: process.env.WOOVI_APP_ID || 'Client_Id_18c0dc27-6306-41dc-a2de-b6303347c3ae',
  environment: process.env.WOOVI_ENVIRONMENT || 'sandbox', // 'sandbox' ou 'production'
  // API MASTER para criar contas BaaS (deve ser configurada via env)
  masterApiToken: process.env.WOOVI_MASTER_API_TOKEN || null,
  masterAppId: process.env.WOOVI_MASTER_APP_ID || null
};

class WooviDriverService {
  constructor() {
    this.api = axios.create({
      baseURL: WOOVI_CONFIG.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': WOOVI_CONFIG.apiToken
        // ⚠️ X-App-ID removido - routes/woovi.js não usa e pode estar causando erro "appID inválido"
        // 'X-App-ID': WOOVI_CONFIG.appId
      },
      timeout: 30000,
      maxRedirects: 0, // ✅ NÃO seguir redirecionamentos (evitar receber HTML)
      validateStatus: function (status) {
        return status >= 200 && status < 500; // Aceitar até 499 para capturar erros
      }
    });
  }

  /**
   * Cria um webhook na Woovi via API
   * Documentação: https://developers.woovi.com/docs/webhook/platform/webhook-platform-api
   * @param {Object} webhookData - Dados do webhook
   * @param {string} webhookData.name - Nome do webhook
   * @param {string} webhookData.url - URL para receber os eventos
   * @param {string} webhookData.authorization - Chave de autorização (opcional)
   * @param {boolean} webhookData.isActive - Se o webhook está ativo (padrão: true)
   * @returns {Promise<Object>} - Dados do webhook criado
   */
  async createWebhook(webhookData) {
    try {
      // ✅ A API oficial espera o payload aninhado em "webhook"
      const webhookPayload = {
        webhook: {
          name: webhookData.name || 'Leaf App Webhook',
          url: webhookData.url,
          event: webhookData.event || 'OPENPIX:CHARGE_COMPLETED',
          isActive: webhookData.isActive !== false // Padrão: true
        }
      };
      
      if (webhookData.authorization) {
        webhookPayload.webhook.authorization = webhookData.authorization;
      }

      logStructured('info', 'Criando webhook via API', { service: 'woovi-driver-service', ...webhookPayload.webhook });

      // ✅ API de webhook: /api/v1/webhook (conforme doc)
      const response = await this.api.post('/webhook', webhookPayload);
      
      logStructured('debug', 'Resposta da Woovi ao criar webhook', { service: 'woovi-driver-service', status: response.status, data: response.data });

      if (response.data && response.data.webhook) {
        logStructured('info', 'Webhook criado com sucesso', { service: 'woovi-driver-service', webhookId: response.data.webhook.id, name: response.data.webhook.name, url: response.data.webhook.url });
        return {
          success: true,
          webhook: response.data.webhook
        };
      } else {
        logStructured('error', 'Resposta inválida ao criar webhook', { service: 'woovi-driver-service', responseData: response.data });
        return {
          success: false,
          error: 'Resposta inválida da API Woovi',
          details: response.data
        };
      }
    } catch (error) {
      const errorData = error.response?.data;
      logError(error, 'Erro ao criar webhook', { service: 'woovi-driver-service', status: error.response?.status, errorData });
      return {
        success: false,
        error: errorData?.message || error.message,
        details: errorData
      };
    }
  }

  /**
   * Lista todos os webhooks configurados
   * Documentação: https://developers.woovi.com/docs/webhook/platform/webhook-platform-api
   * @returns {Promise<Object>} - Lista de webhooks
   */
  async listWebhooks() {
    try {
      logStructured('info', 'Listando webhooks', { service: 'woovi-driver-service' });
      
      // ✅ API de webhook: GET /api/v1/webhook
      const response = await this.api.get('/webhook');

      if (response.data && response.data.webhooks) {
        logStructured('info', `Webhooks encontrados: ${response.data.webhooks.length}`, { service: 'woovi-driver-service', count: response.data.webhooks.length });
        return {
          success: true,
          webhooks: response.data.webhooks
        };
      } else {
        return {
          success: true,
          webhooks: []
        };
      }
    } catch (error) {
      const errorData = error.response?.data;
      logError(error, 'Erro ao listar webhooks', { service: 'woovi-driver-service',
        status: error.response?.status,
        error: errorData || error.message
      });
      return {
        success: false,
        error: errorData?.message || error.message,
        details: errorData
      };
    }
  }

  /**
   * Atualiza um webhook existente
   * Documentação: https://developers.woovi.com/docs/webhook/platform/webhook-platform-api
   * @param {string} webhookId - ID do webhook
   * @param {Object} webhookData - Dados atualizados do webhook
   * @returns {Promise<Object>} - Dados do webhook atualizado
   */
  async updateWebhook(webhookId, webhookData) {
    try {
      const webhookPayload = {
        webhook: {
          name: webhookData.name,
          url: webhookData.url,
          isActive: webhookData.isActive !== false
        }
      };

      if (webhookData.authorization) {
        webhookPayload.webhook.authorization = webhookData.authorization;
      }
      if (webhookData.event) {
        webhookPayload.webhook.event = webhookData.event;
      }

      logStructured('info', 'Atualizando webhook', { service: 'woovi-driver-service',
        webhookId,
        ...webhookPayload.webhook
      });

      // ✅ API de webhook: PUT /api/v1/webhook/{webhookId}
      const response = await this.api.put(`/webhook/${webhookId}`, webhookPayload);

      if (response.data && response.data.webhook) {
        logStructured('info', 'Webhook atualizado com sucesso', { service: 'woovi-driver-service',
          webhookId: response.data.webhook.id,
          name: response.data.webhook.name,
          url: response.data.webhook.url
        });
        return {
          success: true,
          webhook: response.data.webhook
        };
      } else {
        return {
          success: false,
          error: 'Resposta inválida da API Woovi',
          details: response.data
        };
      }
    } catch (error) {
      const errorData = error.response?.data;
      logError(error, 'Erro ao atualizar webhook', { service: 'woovi-driver-service',
        status: error.response?.status,
        error: errorData || error.message
      });
      return {
        success: false,
        error: errorData?.message || error.message,
        details: errorData
      };
    }
  }

  /**
   * Deleta um webhook
   * Documentação: https://developers.woovi.com/docs/webhook/platform/webhook-platform-api
   * @param {string} webhookId - ID do webhook
   * @returns {Promise<Object>} - Resultado da deleção
   */
  async deleteWebhook(webhookId) {
    try {
      logStructured('info', 'Deletando webhook', { service: 'woovi-driver-service', webhookId });

      // ✅ API de webhook: DELETE /api/v1/webhook/{webhookId}
      const response = await this.api.delete(`/webhook/${webhookId}`);

      logStructured('info', 'Webhook deletado com sucesso', { service: 'woovi-driver-service', webhookId });
      return {
        success: true,
        message: 'Webhook deletado com sucesso'
      };
    } catch (error) {
      const errorData = error.response?.data;
      logError(error, 'Erro ao deletar webhook', { service: 'woovi-driver-service',
        status: error.response?.status,
        error: errorData || error.message
      });
      return {
        success: false,
        error: errorData?.message || error.message,
        details: errorData
      };
    }
  }

  /**
   * Cria um cliente na Woovi para um motorista aprovado (compatibilidade)
   * @param {Object} driverData - Dados do motorista
   * @returns {Promise<Object>} - Resultado da criação
   */
  async createDriverClient(driverData) {
    try {
      logStructured('info', 'Criando cliente Woovi para motorista', { service: 'woovi-driver-service', driverName: driverData.name });
      
      const clientData = {
        name: driverData.name,
        email: driverData.email,
        phone: driverData.phone,
        document: driverData.cpf,
        additionalInfo: [
          {
            key: 'app',
            value: 'leaf'
          },
          {
            key: 'type',
            value: 'driver'
          },
          {
            key: 'driver_id',
            value: driverData.driverId
          },
          {
            key: 'created_at',
            value: new Date().toISOString()
          }
        ]
      };

      const response = await this.api.post('/customer', clientData);
      
      // A resposta da Woovi pode ter diferentes estruturas
      // Tentar diferentes campos para obter o ID do customer
      let customerId = null;
      
      if (response.data) {
        // Estrutura 1: response.data.customer.id
        if (response.data.customer?.id) {
          customerId = response.data.customer.id;
        }
        // Estrutura 2: response.data.id
        else if (response.data.id) {
          customerId = response.data.id;
        }
        // Estrutura 3: response.data.customer (objeto direto)
        else if (response.data.customer && typeof response.data.customer === 'object') {
          // Tentar encontrar ID em qualquer campo do customer
          customerId = response.data.customer.id || 
                      response.data.customer.customerId || 
                      response.data.customer.correlationID;
        }
      }
      
      if (customerId) {
        logStructured('info', 'Cliente Woovi criado com sucesso', { service: 'woovi-driver-service', customerId });
        return {
          success: true,
          wooviClientId: customerId,
          customer: response.data.customer || response.data
        };
      } else {
        logStructured('warn', 'Resposta da Woovi não contém ID do customer', { service: 'woovi-driver-service', responseData: response.data });
        // Se não encontrou ID, usar correlationID como fallback
        const correlationID = response.data?.correlationID || response.data?.customer?.correlationID;
        if (correlationID) {
          logStructured('warn', 'Usando correlationID como fallback', { service: 'woovi-driver-service', correlationID });
          return {
            success: true,
            wooviClientId: correlationID,
            customer: response.data.customer || response.data,
            warning: 'ID do customer não encontrado, usando correlationID'
          };
        } else {
          throw new Error('Resposta inválida da API Woovi - ID do customer não encontrado');
        }
      }
    } catch (error) {
      logError(error, 'Erro ao criar cliente Woovi', { service: 'woovi-driver-service', errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Cria uma conta BaaS na Woovi para um motorista aprovado
   * Baseado na documentação: https://developers.woovi.com/docs/category/baas
   * 
   * Fluxo:
   * 1. Registrar conta com /api/v1/account-register (requer API MASTER)
   * 2. Aguardar aprovação (webhook ACCOUNT_REGISTER_APPROVED)
   * 3. Criar API para a conta com /api/v1/application
   * 4. Criar chave Pix com /api/v1/pix-keys
   * 
   * @param {Object} driverData - Dados do motorista
   * @returns {Promise<Object>} - Resultado da criação da conta BaaS
   */
  async createDriverBaaSAccount(driverData) {
    try {
      logStructured('info', 'Criando conta BaaS para motorista', { service: 'woovi-driver-service', driverName: driverData.name });
      
      // Verificar se API MASTER está configurada
      if (!WOOVI_CONFIG.masterApiToken || !WOOVI_CONFIG.masterAppId) {
        logStructured('warn', 'API MASTER não configurada ainda. Retornando erro para usar fallback', { service: 'woovi-driver-service' });
        // Retornar erro específico para que o caller use fallback (createDriverClient)
        return {
          success: false,
          error: 'API MASTER não configurada. Usando fallback para customer.',
          requiresMasterApi: true,
          useFallback: true // Flag para indicar que deve usar fallback
        };
      }

      // Criar API client para requisições com MASTER
      const masterApi = axios.create({
        baseURL: WOOVI_CONFIG.baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WOOVI_CONFIG.masterApiToken,
          'X-App-ID': WOOVI_CONFIG.masterAppId
        },
        timeout: 30000
      });

      // 1. Registrar nova conta BaaS usando /api/v1/account-register
      const accountRegisterData = {
        officialName: driverData.name,
        tradeName: driverData.name,
        taxID: driverData.cpf,
        email: driverData.email,
        phone: driverData.phone,
        // Campos opcionais
        businessDescription: 'Motorista parceiro Leaf',
        documents: [], // Pode ser preenchido depois
        representatives: [], // Pode ser preenchido depois
        billingAddress: {} // Pode ser preenchido depois
      };

      logStructured('info', 'Registrando conta BaaS via /api/v1/account-register', { service: 'woovi-driver-service' });
      const registerResponse = await masterApi.post('/account-register', accountRegisterData);

      if (!registerResponse.data || !registerResponse.data.accountId) {
        throw new Error('Resposta inválida da API Woovi - accountId não encontrado');
      }

      const accountId = registerResponse.data.accountId;
      logStructured('info', 'Conta BaaS registrada com sucesso', { service: 'woovi-driver-service', accountId });
      logStructured('info', 'Aguardando aprovação da conta (será notificado via webhook ACCOUNT_REGISTER_APPROVED)', { service: 'woovi-driver-service', accountId });

      // NOTA: A conta precisa ser aprovada pela Woovi antes de poder criar API e chave Pix
      // Por enquanto, retornamos o accountId e o sistema deve aguardar o webhook
      // Em produção, implementar webhook handler para ACCOUNT_REGISTER_APPROVED

      return {
        success: true,
        wooviAccountId: accountId,
        wooviClientId: accountId, // Para compatibilidade
        account: registerResponse.data,
        status: 'pending_approval', // Conta aguardando aprovação
        message: 'Conta BaaS registrada. Aguardando aprovação da Woovi.',
        nextSteps: [
          'Aguardar webhook ACCOUNT_REGISTER_APPROVED',
          'Criar API para a conta com /api/v1/application',
          'Criar chave Pix com /api/v1/pix-keys'
        ]
      };
    } catch (error) {
      logError(error, 'Erro ao criar conta BaaS', { service: 'woovi-driver-service', errorData: error.response?.data });
      
      // Se erro for por falta de API MASTER, retornar erro específico
      if (error.message.includes('API MASTER não configurada')) {
        return {
          success: false,
          error: error.message,
          requiresMasterApi: true
        };
      }
      
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Cria API para uma conta BaaS aprovada
   * Deve ser chamado após receber webhook ACCOUNT_REGISTER_APPROVED
   * @param {string} accountId - ID da conta BaaS aprovada
   * @param {string} applicationName - Nome da aplicação
   * @returns {Promise<Object>} - Dados da API criada (clientId, clientSecret)
   */
  async createAccountApi(accountId, applicationName = 'Leaf Driver App') {
    try {
      if (!WOOVI_CONFIG.masterApiToken || !WOOVI_CONFIG.masterAppId) {
        throw new Error('API MASTER não configurada');
      }

      const masterApi = axios.create({
        baseURL: WOOVI_CONFIG.baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WOOVI_CONFIG.masterApiToken,
          'X-App-ID': WOOVI_CONFIG.masterAppId
        },
        timeout: 30000
      });

      const applicationData = {
        accountId: accountId,
        application: {
          name: applicationName,
          type: 'API'
        }
      };

      logStructured('info', 'Criando API para conta BaaS', { service: 'woovi-driver-service', accountId });
      const response = await masterApi.post('/application', applicationData);

      if (response.data && (response.data.clientId || response.data.appId)) {
        const clientId = response.data.clientId || response.data.appId;
        logStructured('info', 'API criada com sucesso', { service: 'woovi-driver-service', clientId, accountId });
        return {
          success: true,
          clientId: clientId,
          clientSecret: response.data.clientSecret,
          appId: clientId,
          data: response.data
        };
      } else {
        throw new Error('Resposta inválida da API Woovi para criação de API');
      }
    } catch (error) {
      logError(error, 'Erro ao criar API para conta BaaS', { service: 'woovi-driver-service', accountId, errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Cria chave Pix para uma conta BaaS
   * Deve ser chamado após criar a API da conta
   * @param {string} appId - AppId da conta BaaS
   * @param {string} pixKeyType - Tipo da chave: 'RANDOM', 'EMAIL', 'CPF', 'CNPJ', 'PHONE'
   * @param {string} pixKey - Valor da chave (opcional para RANDOM)
   * @returns {Promise<Object>} - Dados da chave Pix criada
   */
  async createPixKey(appId, pixKeyType = 'RANDOM', pixKey = null) {
    try {
      // Criar API client com o appId da conta BaaS
      const accountApi = axios.create({
        baseURL: WOOVI_CONFIG.baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': WOOVI_CONFIG.apiToken, // Usar token da conta BaaS quando disponível
          'X-App-ID': appId
        },
        timeout: 30000
      });

      const pixKeyData = {
        type: pixKeyType
      };

      if (pixKey && pixKeyType !== 'RANDOM') {
        pixKeyData.key = pixKey;
      }

      logStructured('info', 'Criando chave Pix para conta', { service: 'woovi-driver-service', appId });
      const response = await accountApi.post('/pix-keys', pixKeyData);

      if (response.data && response.data.key) {
        logStructured('info', 'Chave Pix criada com sucesso', { service: 'woovi-driver-service', key: response.data.key, appId });
        return {
          success: true,
          pixKey: response.data.key,
          pixKeyType: response.data.type || pixKeyType,
          data: response.data
        };
      } else {
        throw new Error('Resposta inválida da API Woovi para criação de chave Pix');
      }
    } catch (error) {
      logError(error, 'Erro ao criar chave Pix', { service: 'woovi-driver-service', appId, errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Cria uma cobrança PIX genérica (para passageiros ou outros casos)
   * @param {Object} chargeData - Dados da cobrança
   * @param {number} chargeData.value - Valor em centavos
   * @param {string} chargeData.comment - Comentário/descrição
   * @param {string} chargeData.correlationID - ID único da cobrança
   * @param {Object} chargeData.customer - Dados do cliente (opcional)
   * @param {Array} chargeData.additionalInfo - Informações adicionais (opcional)
   * @param {number} chargeData.expiresIn - Tempo de expiração em segundos (opcional, padrão: 3600)
   * @returns {Promise<Object>} - Dados da cobrança criada
   */
  async createCharge(chargeData) {
    try {
      logStructured('info', 'Criando cobrança', { service: 'woovi-driver-service', value: chargeData.value, correlationID: chargeData.correlationID, comment: chargeData.comment?.substring(0, 50), appId: WOOVI_CONFIG.appId, baseUrl: WOOVI_CONFIG.baseUrl });
      
      // ✅ URL do webhook para receber notificações sobre esta cobrança
      // ✅ Carrega automaticamente do ngrok (arquivo .ngrok-url.json ou variável de ambiente)
      const { getNgrokWebhookUrl } = require('../config/load-ngrok-url');
      const webhookUrl = getNgrokWebhookUrl();
      
      const chargePayload = {
        value: chargeData.value,
        correlationID: chargeData.correlationID,
        comment: chargeData.comment,
        expiresIn: chargeData.expiresIn || 3600, // 1 hora padrão
        notificationUrl: webhookUrl, // ✅ URL para receber webhooks desta cobrança
        ...(chargeData.customer && { customer: chargeData.customer }),
        ...(chargeData.additionalInfo && { additionalInfo: chargeData.additionalInfo })
      };

      logStructured('debug', 'Webhook URL configurada', { service: 'woovi-driver-service', webhookUrl });
      logStructured('debug', 'Payload completo sendo enviado', { service: 'woovi-driver-service', value: chargePayload.value, correlationID: chargePayload.correlationID, notificationUrl: chargePayload.notificationUrl, hasCustomer: !!chargePayload.customer, additionalInfoCount: chargePayload.additionalInfo?.length || 0 });

      // ✅ Garantir que os headers estão corretos a cada requisição
      // ⚠️ NOTA: routes/woovi.js não usa X-App-ID, apenas Authorization
      // Testando sem X-App-ID primeiro, se falhar, adicionar de volta
      const requestHeaders = {
        'Content-Type': 'application/json',
        'Authorization': WOOVI_CONFIG.apiToken
        // 'X-App-ID': WOOVI_CONFIG.appId // ⚠️ Comentado temporariamente para testar
      };
      
      logStructured('debug', 'Headers da requisição', { service: 'woovi-driver-service', authorization: WOOVI_CONFIG.apiToken ? `${WOOVI_CONFIG.apiToken.substring(0, 20)}...` : 'Ausente', contentType: 'application/json', baseURL: WOOVI_CONFIG.baseUrl, xAppId: 'REMOVIDO (não usado)' });

      // ✅ Usar a instância do axios já configurada (this.api)
      // Mas garantir que os headers estão atualizados
      const response = await this.api.post('/charge', chargePayload, {
        headers: requestHeaders
      });
      
      // ✅ Verificar se a resposta é HTML (erro de URL/redirecionamento)
      const responseData = response.data;
      if (typeof responseData === 'string' && responseData.includes('<!DOCTYPE html>')) {
        logStructured('error', 'Resposta HTML recebida (URL incorreta ou redirecionamento)', { service: 'woovi-driver-service', url: `${WOOVI_CONFIG.baseUrl}/charge`, status: response.status, headers: response.headers });
        throw new Error('URL da API Woovi incorreta ou redirecionamento detectado');
      }
      
      if (responseData && responseData.charge) {
        logStructured('info', 'Cobrança criada com sucesso', { service: 'woovi-driver-service', chargeId: responseData.charge.id, correlationID: chargeData.correlationID, notificationUrl: chargePayload.notificationUrl, chargeNotificationUrl: responseData.charge.notificationUrl || 'NÃO RETORNADO NA RESPOSTA' });
        
        // ✅ Verificar se a Woovi retornou a notificationUrl na resposta
        if (responseData.charge.notificationUrl) {
          logStructured('info', 'Woovi aceitou notificationUrl', { service: 'woovi-driver-service', notificationUrl: responseData.charge.notificationUrl });
        } else {
          logStructured('warn', 'Woovi NÃO retornou notificationUrl na resposta - pode estar usando webhook do painel', { service: 'woovi-driver-service' });
        }
        
        return {
          success: true,
          charge: responseData.charge
        };
      } else {
        logStructured('error', 'Resposta inválida da Woovi', { service: 'woovi-driver-service', data: responseData, status: response.status, headers: response.headers });
        throw new Error('Resposta inválida da API Woovi');
      }
    } catch (error) {
      const errorData = error.response?.data;
      const errorMessage = errorData?.errors?.[0]?.message || errorData?.message || error.message;
      
      logError(error, 'Erro ao criar cobrança PIX', { service: 'woovi-driver-service', message: errorMessage, status: error.response?.status, statusText: error.response?.statusText,
        data: errorData,
        appId: WOOVI_CONFIG.appId,
        baseUrl: WOOVI_CONFIG.baseUrl,
        correlationID: chargeData.correlationID
      });
      
      // ✅ Se for erro 401, pode ser problema de autenticação - retornar erro claro
      if (error.response?.status === 401) {
      return {
        success: false,
          error: 'Erro de autenticação com Woovi. Verifique as credenciais.',
          details: {
            status: 401,
            message: errorMessage,
            hint: 'O appID ou apiToken pode estar inválido ou expirado'
          }
        };
      }
      
      return {
        success: false,
        error: errorMessage || 'Falha ao criar cobrança PIX',
        details: {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: errorData
        }
      };
    }
  }

  /**
   * Verifica status de uma cobrança
   * @param {string} chargeId - ID da cobrança
   * @returns {Promise<Object>} - Status da cobrança
   */
  async getChargeStatus(chargeId) {
    try {
      const response = await this.api.get(`/charge/${chargeId}`);
      
      if (response.data && response.data.charge) {
        return {
          success: true,
          status: response.data.charge.status,
          amount: response.data.charge.value,
          charge: response.data.charge
        };
      } else {
        throw new Error('Resposta inválida da API Woovi');
      }
    } catch (error) {
      logError(error, 'Erro ao verificar status da cobrança', { service: 'woovi-driver-service', errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Processa reembolso de uma cobrança
   * @param {string} chargeId - ID da cobrança
   * @param {number} amount - Valor a reembolsar em centavos (opcional, se não informado reembolsa total)
   * @param {string} reason - Motivo do reembolso
   * @returns {Promise<Object>} - Resultado do reembolso
   */
  async processRefund(chargeId, amount, reason) {
    try {
      const refundData = {
        value: amount, // Se não informado, reembolsa total
        ...(reason && { comment: reason })
      };

      const response = await this.api.post(`/charge/${chargeId}/refund`, refundData);
      
      return {
        success: true,
        refundId: response.data.refund?.id,
        refund: response.data.refund
      };
    } catch (error) {
      logError(error, 'Erro ao processar reembolso', { service: 'woovi-driver-service', errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Cria uma cobrança PIX para o motorista (ganhos das corridas)
   * @deprecated Use transferDirectToDriver() para transferência direta via BaaS
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @param {number} value - Valor em centavos
   * @param {string} description - Descrição da cobrança
   * @param {string} rideId - ID da corrida
   * @returns {Promise<Object>} - Dados da cobrança criada
   */
  async createRideEarnings(wooviClientId, value, description, rideId) {
    try {
      // wooviClientId pode ser string (ID) ou objeto (customer completo)
      // Se for string, criar objeto customer com o ID
      const customerData = typeof wooviClientId === 'string' 
        ? { id: wooviClientId }
        : wooviClientId;
      
      const chargeData = {
        value: value,
        correlationID: `ride_${rideId}_${Date.now()}`,
        comment: description,
        expiresIn: 3600, // 1 hora
        customer: customerData,
        additionalInfo: [
          {
            key: 'app',
            value: 'leaf'
          },
          {
            key: 'type',
            value: 'ride_earnings'
          },
          {
            key: 'driver_id',
            value: wooviClientId
          },
          {
            key: 'ride_id',
            value: rideId
          }
        ]
      };

      const response = await this.api.post('/charge', chargeData);
      
      return {
        success: true,
        charge: response.data.charge
      };
    } catch (error) {
      logError(error, 'Erro ao criar cobrança de ganhos', { service: 'woovi-driver-service', errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Transfere valor líquido diretamente para a conta BaaS do motorista (Pix Out)
   * Baseado na documentação: https://developers.woovi.com/docs/transfer/how-to-transfer-values-between-accounts
   * 
   * Endpoint: /api/v1/transfer
   * Campos: value, fromPixKey, toPixKey
   * 
   * @param {string} wooviAccountId - ID da conta BaaS do motorista (ou chave Pix)
   * @param {string} driverPixKey - Chave Pix da conta do motorista (destino)
   * @param {string} leafPixKey - Chave Pix da conta Leaf (origem)
   * @param {number} value - Valor em centavos a transferir
   * @param {string} description - Descrição da transferência
   * @param {string} rideId - ID da corrida
   * @returns {Promise<Object>} - Resultado da transferência
   */
  async transferDirectToDriver(wooviAccountId, value, description, rideId, driverPixKey = null, leafPixKey = null) {
    try {
      logStructured('info', 'Transferindo valor líquido para motorista', { service: 'woovi-driver-service',
        accountId: wooviAccountId,
        value: value,
        rideId: rideId
      });

      // Se não tiver chaves Pix, tentar usar accountId como fallback
      // Mas o endpoint /transfer requer chaves Pix
      if (!driverPixKey || !leafPixKey) {
        logStructured('warn', 'Chaves Pix não fornecidas. Tentando buscar do banco de dados', { service: 'woovi-driver-service', driverId, rideId });
        // ✅ Buscar chaves Pix do Firestore (implementado em driver-approval-service)
        // Por enquanto, retornar erro informativo
        return {
          success: false,
          error: 'Chaves Pix necessárias para transferência',
          details: 'É necessário fornecer driverPixKey (chave Pix do motorista) e leafPixKey (chave Pix da conta Leaf)',
          requiredFields: ['driverPixKey', 'leafPixKey']
        };
      }

      // Preparar dados da transferência conforme documentação Woovi
      // Endpoint: /api/v1/transfer
      const transferData = {
        value: value, // Valor em centavos
        fromPixKey: leafPixKey, // Chave Pix da conta Leaf (origem)
        toPixKey: driverPixKey // Chave Pix da conta do motorista (destino)
      };

      logStructured('info', 'Enviando transferência via /api/v1/transfer', { service: 'woovi-driver-service', driverId, rideId, value });
      const response = await this.api.post('/transfer', transferData);

      if (response.data && response.data.transaction) {
        const transaction = response.data.transaction;
        logStructured('info', 'Transferência realizada com sucesso', { service: 'woovi-driver-service', transactionId: transaction.correlationID, value: (transaction.value / 100).toFixed(2), time: transaction.time, driverId, rideId });
        
        return {
          success: true,
          transferId: transaction.correlationID,
          transactionId: transaction.correlationID,
          amount: transaction.value,
          accountId: wooviAccountId,
          rideId: rideId,
          endpoint: '/transfer',
          transaction: transaction,
          data: response.data
        };
      } else {
        throw new Error('Resposta inválida da API Woovi para transferência');
      }
    } catch (error) {
      logError(error, 'Erro ao transferir para motorista', { service: 'woovi-driver-service', driverId, rideId, errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message,
        details: 'Verificar se as chaves Pix estão corretas e se a conta Leaf tem saldo suficiente'
      };
    }
  }

  /**
   * Transfere valor entre subcontas (alternativa para transferência)
   * Endpoint: /api/v1/subaccount/transfer
   * @param {string} fromPixKey - Chave Pix da subconta de origem
   * @param {string} fromPixKeyType - Tipo da chave (EMAIL, CPF, CNPJ, PHONE, RANDOM)
   * @param {string} toPixKey - Chave Pix da subconta de destino
   * @param {string} toPixKeyType - Tipo da chave (EMAIL, CPF, CNPJ, PHONE, RANDOM)
   * @param {number} value - Valor em centavos
   * @returns {Promise<Object>} - Resultado da transferência
   */
  async transferBetweenSubaccounts(fromPixKey, fromPixKeyType, toPixKey, toPixKeyType, value) {
    try {
      const transferData = {
        value: value,
        fromPixKey: fromPixKey,
        fromPixKeyType: fromPixKeyType,
        toPixKey: toPixKey,
        toPixKeyType: toPixKeyType
      };

      logStructured('info', 'Transferindo entre subcontas via /api/v1/subaccount/transfer', { service: 'woovi-driver-service', value, fromPixKey, toPixKey });
      const response = await this.api.post('/subaccount/transfer', transferData);

      if (response.data && response.data.transaction) {
        return {
          success: true,
          transaction: response.data.transaction,
          data: response.data
        };
      } else {
        throw new Error('Resposta inválida da API Woovi para transferência entre subcontas');
      }
    } catch (error) {
      logError(error, 'Erro ao transferir entre subcontas', { service: 'woovi-driver-service', errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Lista cobranças de um motorista específico
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @returns {Promise<Object>} - Lista de cobranças
   */
  async getDriverCharges(wooviClientId) {
    try {
      const response = await this.api.get(`/charge?customer=${wooviClientId}`);
      return {
        success: true,
        charges: response.data.charges
      };
    } catch (error) {
      logError(error, 'Erro ao listar cobranças do motorista', { service: 'woovi-driver-service', driverId, errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Calcula o saldo total de um motorista
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @returns {Promise<Object>} - Saldo do motorista
   */
  async getDriverBalance(wooviClientId) {
    try {
      const chargesResponse = await this.getDriverCharges(wooviClientId);
      
      if (chargesResponse.success) {
        const completedCharges = chargesResponse.charges.filter(charge => 
          charge.status === 'COMPLETED'
        );
        
        const totalEarnings = completedCharges.reduce((total, charge) => {
          return total + (charge.value - (charge.fee || 0));
        }, 0);

        return {
          success: true,
          balance: totalEarnings,
          totalCharges: completedCharges.length,
          charges: completedCharges
        };
      } else {
        throw new Error('Erro ao buscar cobranças');
      }
    } catch (error) {
      logError(error, 'Erro ao verificar saldo do motorista', { service: 'woovi-driver-service', driverId, errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Atualiza dados de um cliente na Woovi
   * @param {string} wooviClientId - ID do cliente na Woovi
   * @param {Object} updateData - Dados para atualizar
   * @returns {Promise<Object>} - Resultado da atualização
   */
  async updateDriverClient(wooviClientId, updateData) {
    try {
      const response = await this.api.put(`/customer/${wooviClientId}`, updateData);
      return {
        success: true,
        customer: response.data.customer
      };
    } catch (error) {
      logError(error, 'Erro ao atualizar cliente Woovi', { service: 'woovi-driver-service', driverId, errorData: error.response?.data });
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Simula pagamento de uma cobrança (para testes)
   * @param {string} chargeId - ID da cobrança
   * @returns {Promise<Object>} - Resultado da simulação
   */
  /**
   * ⚠️ MÉTODO DE TESTE - REMOVER EM PRODUÇÃO
   * Simula pagamento de uma cobrança (apenas para desenvolvimento/testes)
   * @param {string} chargeId - ID da cobrança
   * @returns {Promise<Object>} - Resultado da simulação
   */
  async simulatePayment(chargeId) {
    try {
      // Nota: Em produção, isso seria feito via webhook da Woovi
      // Aqui simulamos apenas para testes
      logStructured('info', 'Simulando pagamento da cobrança', { service: 'woovi-driver-service', chargeId });
      
      return {
        success: true,
        message: 'Pagamento simulado com sucesso',
        chargeId: chargeId
      };
    } catch (error) {
      logError(error, 'Erro ao simular pagamento', { service: 'woovi-driver-service', chargeId });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = WooviDriverService;
