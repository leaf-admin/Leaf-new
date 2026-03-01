const WooviDriverService = require('./woovi-driver-service');
const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');

class DriverApprovalService {
  constructor() {
    // Criar instância do WooviDriverService
    this.wooviDriverService = new WooviDriverService();
  }
  /**
   * Processa a aprovação de um motorista e cria conta na Woovi
   * @param {Object} driverData - Dados do motorista aprovado
   * @param {string} driverData.id - ID do motorista no sistema
   * @param {string} driverData.name - Nome completo
   * @param {string} driverData.email - Email
   * @param {string} driverData.phone - Telefone
   * @param {string} driverData.cpf - CPF
   * @returns {Promise<Object>} - Resultado da aprovação
   */
  async approveDriver(driverData) {
    try {
      logStructured('info', 'Processando aprovação do motorista', { service: 'driver-approval-service', driverId: driverData.id, driverName: driverData.name });
      
      // 1. Tentar criar subaccount BaaS na Woovi (conta real para o motorista gerenciar saldo)
      // Se API MASTER não estiver configurada, usa fallback automaticamente
      let baasResult = await this.wooviDriverService.createDriverBaaSAccount({
        name: driverData.name,
        email: driverData.email,
        phone: driverData.phone,
        cpf: driverData.cpf,
        driverId: driverData.id
      });

      // Se API MASTER não estiver configurada, usar fallback (customer)
      let useCustomerFallback = false;
      
      if (!baasResult || !baasResult.success) {
        if (baasResult && baasResult.useFallback) {
          logStructured('warn', 'API MASTER não configurada ainda. Usando fallback (customer)', { service: 'driver-approval-service', driverId: driverData.id, note: 'Quando API MASTER estiver disponível, contas BaaS serão criadas automaticamente' });
        } else {
          logError(new Error(baasResult?.error || 'Erro desconhecido'), 'Falha ao criar subaccount BaaS', { service: 'driver-approval-service', driverId: driverData.id });
          logStructured('warn', 'Tentando criar apenas customer como fallback', { service: 'driver-approval-service', driverId: driverData.id });
        }
        
        useCustomerFallback = true;
      }

      // Se precisar usar fallback ou se BaaS falhou, criar customer
      if (useCustomerFallback || !baasResult || !baasResult.success) {
        const customerResult = await this.wooviDriverService.createDriverClient({
          name: driverData.name,
          email: driverData.email,
          phone: driverData.phone,
          cpf: driverData.cpf,
          driverId: driverData.id
        });

        if (!customerResult.success) {
          return {
            success: false,
            error: 'Falha ao criar conta na Woovi',
            details: customerResult.error
          };
        }

        // Usar customer como fallback (temporário até API MASTER estar disponível)
        const updatedDriverData = {
          ...driverData,
          wooviAccountId: customerResult.wooviClientId,
          wooviClientId: customerResult.wooviClientId, // Compatibilidade
          isApproved: true,
          approvedAt: new Date().toISOString(),
          wooviAccountCreated: true,
          baasAccountCreated: false, // Indica que não é BaaS real ainda
          fallbackToCustomer: true,
          baasUpgradePending: true // Flag para indicar que pode ser atualizado para BaaS depois
        };

        // ✅ Salvar wooviAccountId no Firestore (mesmo sendo fallback)
        try {
          const firestore = firebaseConfig.getFirestore();
          if (firestore && customerResult.wooviClientId) {
            const driverRef = firestore.collection('users').doc(driverData.id);
            // Filtrar valores undefined para evitar erro no Firestore
            const dataToSave = {
              wooviAccountId: customerResult.wooviClientId,
              wooviClientId: customerResult.wooviClientId,
              wooviAccountCreated: true,
              baasAccountCreated: false,
              fallbackToCustomer: true,
              baasUpgradePending: true, // Pode ser atualizado para BaaS quando API MASTER estiver disponível
              wooviAccountCreatedAt: new Date().toISOString(),
              isApproved: true,
              approvedAt: new Date().toISOString()
            };
            // Remover valores undefined
            Object.keys(dataToSave).forEach(key => {
              if (dataToSave[key] === undefined) {
                delete dataToSave[key];
              }
            });
            
            await driverRef.set(dataToSave, { merge: true });
            
            logStructured('info', 'wooviAccountId (fallback) salvo no Firestore', { service: 'driver-approval-service', driverId: driverData.id, wooviClientId: customerResult.wooviClientId });
          } else if (!customerResult.wooviClientId) {
            logStructured('warn', 'wooviClientId não disponível para salvar no Firestore', { service: 'driver-approval-service', driverId: driverData.id });
          }
        } catch (firestoreError) {
          logError(firestoreError, 'Erro ao salvar wooviAccountId no Firestore (fallback)', { service: 'driver-approval-service', driverId: driverData.id });
        }

        return {
          success: true,
          message: 'Motorista aprovado (usando customer como fallback)',
          driverData: updatedDriverData,
          wooviAccountId: customerResult.wooviClientId,
          wooviClientId: customerResult.wooviClientId
        };
      }

      // Se chegou aqui, BaaS foi criado com sucesso
      if (!baasResult || !baasResult.success) {
        // Não deveria chegar aqui, mas por segurança retornar erro
        return {
          success: false,
          error: 'Falha ao criar conta BaaS e fallback não foi executado corretamente'
        };
      }

      // 2. Criar também customer para compatibilidade (se necessário)
      const customerResult = await this.wooviDriverService.createDriverClient({
        name: driverData.name,
        email: driverData.email,
        phone: driverData.phone,
        cpf: driverData.cpf,
        driverId: driverData.id
      });

      // 3. Atualizar dados do motorista no sistema (Firebase/Firestore)
      const updatedDriverData = {
        ...driverData,
        wooviAccountId: baasResult.wooviAccountId, // ID da conta BaaS (principal)
        wooviClientId: baasResult.wooviClientId, // Para compatibilidade
        customerId: customerResult.success ? customerResult.wooviClientId : null,
        isApproved: true,
        approvedAt: new Date().toISOString(),
        wooviAccountCreated: true,
        baasAccountCreated: true // Indica que é BaaS real
      };

      // ✅ Salvar wooviAccountId no Firestore
      try {
        const firestore = firebaseConfig.getFirestore();
        if (firestore && baasResult.wooviAccountId) {
          const driverRef = firestore.collection('users').doc(driverData.id);
          
          // Preparar dados para salvar (filtrar undefined)
          const dataToSave = {
            wooviAccountId: baasResult.wooviAccountId,
            wooviClientId: baasResult.wooviClientId || baasResult.wooviAccountId,
            wooviAccountCreated: true,
            baasAccountCreated: true,
            wooviAccountCreatedAt: new Date().toISOString(),
            isApproved: true,
            approvedAt: new Date().toISOString()
          };
          
          // Adicionar customerId apenas se existir
          if (customerResult.success && customerResult.wooviClientId) {
            dataToSave.customerId = customerResult.wooviClientId;
          }
          
          // Remover valores undefined para evitar erro no Firestore
          Object.keys(dataToSave).forEach(key => {
            if (dataToSave[key] === undefined) {
              delete dataToSave[key];
            }
          });
          
          await driverRef.set(dataToSave, { merge: true }); // merge: true para não sobrescrever outros campos
          
          logStructured('info', 'wooviAccountId salvo no Firestore', { service: 'driver-approval-service', driverId: driverData.id, wooviAccountId: baasResult.wooviAccountId });
        } else if (!baasResult.wooviAccountId) {
          logStructured('warn', 'wooviAccountId não disponível para salvar no Firestore', { service: 'driver-approval-service', driverId: driverData.id });
        } else {
          logStructured('warn', 'Firestore não disponível, wooviAccountId não foi salvo', { service: 'driver-approval-service', driverId: driverData.id });
        }
      } catch (firestoreError) {
        logError(firestoreError, 'Erro ao salvar wooviAccountId no Firestore', { service: 'driver-approval-service', driverId: driverData.id });
        // Não bloquear aprovação se falhar ao salvar no Firestore
      }

      // 4. Verificar e aplicar promoções elegíveis
      try {
        const promotionService = require('./promotion-service');
        const promotionResult = await promotionService.checkAndApplyEligiblePromotions(driverData.id);
        
        if (promotionResult.success && promotionResult.results && promotionResult.results.length > 0) {
          logStructured('info', 'Promoções aplicadas para motorista', { service: 'driver-approval-service', driverId: driverData.id, results: promotionResult.results });
        }
      } catch (promoError) {
        logError(promoError, 'Erro ao verificar promoções (não bloqueia aprovação)', { service: 'driver-approval-service', driverId: driverData.id });
        // Não bloquear aprovação se falhar verificação de promoções
      }

      // 5. Enviar notificação para o motorista
      // TODO: Implementar notificação push/email
      logStructured('info', 'Enviando notificação de aprovação', { service: 'driver-approval-service', driverId: driverData.id, email: driverData.email });
      logStructured('info', 'Subaccount BaaS criada', { service: 'driver-approval-service', driverId: driverData.id, wooviAccountId: baasResult.wooviAccountId });

      return {
        success: true,
        message: 'Motorista aprovado e conta BaaS criada com sucesso',
        driverData: updatedDriverData,
        wooviAccountId: baasResult.wooviAccountId,
        wooviClientId: baasResult.wooviClientId
      };
      
    } catch (error) {
      logError(error, 'Erro ao aprovar motorista', { service: 'driver-approval-service', driverId: driverData.id });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      };
    }
  }

  /**
   * Processa ganhos de uma corrida para o motorista
   * @param {Object} rideData - Dados da corrida
   * @param {string} rideData.driverId - ID do motorista
   * @param {string} rideData.wooviClientId - ID do cliente na Woovi
   * @param {number} rideData.earnings - Ganhos em centavos
   * @param {string} rideData.description - Descrição da corrida
   * @returns {Promise<Object>} - Resultado do processamento
   */
  async processRideEarnings(rideData) {
    try {
      logStructured('info', 'Processando ganhos da corrida para motorista', { service: 'driver-approval-service', driverId: rideData.driverId, rideId: rideData.rideId });
      
      // Criar cobrança de ganhos na Woovi
      const earningsResult = await this.wooviDriverService.createRideEarnings(
        rideData.wooviClientId,
        rideData.earnings,
        rideData.description,
        rideData.rideId
      );

      if (!earningsResult.success) {
        logError(new Error(earningsResult.error), 'Falha ao criar cobrança de ganhos', { service: 'driver-approval-service', driverId: rideData.driverId, rideId: rideData.rideId });
        return {
          success: false,
          error: 'Falha ao processar ganhos na Woovi',
          details: earningsResult.error
        };
      }

      // TODO: Atualizar banco de dados com os ganhos
      // TODO: Enviar notificação para o motorista

      return {
        success: true,
        message: 'Ganhos processados com sucesso',
        chargeId: earningsResult.charge.id,
        earnings: rideData.earnings
      };
      
    } catch (error) {
      logError(error, 'Erro ao processar ganhos', { service: 'driver-approval-service', driverId: rideData.driverId, rideId: rideData.rideId });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      };
    }
  }

  /**
   * Busca wooviAccountId do motorista do Firestore
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} - Dados da conta Woovi ou null
   */
  async getDriverWooviAccountId(driverId) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        logStructured('warn', 'Firestore não disponível para buscar wooviAccountId', { service: 'driver-approval-service', driverId });
        return null;
      }

      const driverRef = firestore.collection('users').doc(driverId);
      const driverDoc = await driverRef.get();

      if (!driverDoc.exists) {
        logStructured('warn', 'Motorista não encontrado no Firestore', { service: 'driver-approval-service', driverId });
        return null;
      }

      const driverData = driverDoc.data();
      const wooviAccountId = driverData.wooviAccountId || driverData.wooviClientId;

      if (!wooviAccountId) {
        logStructured('warn', 'Motorista não possui wooviAccountId no Firestore', { service: 'driver-approval-service', driverId });
        return null;
      }

      return {
        wooviAccountId: wooviAccountId,
        wooviClientId: driverData.wooviClientId || wooviAccountId,
        pixKey: driverData.pixKey || driverData.wooviPixKey || null, // Chave Pix do motorista
        pixKeyType: driverData.pixKeyType || null,
        baasAccountCreated: driverData.baasAccountCreated || false,
        fallbackToCustomer: driverData.fallbackToCustomer || false
      };
    } catch (error) {
      logError(error, 'Erro ao buscar wooviAccountId do Firestore', { service: 'driver-approval-service', driverId });
      return null;
    }
  }

  /**
   * Verifica se um motorista tem conta na Woovi
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} - Status da conta Woovi
   */
  async checkDriverWooviAccount(driverId) {
    try {
      // ✅ Buscar wooviAccountId do Firestore
      const accountData = await this.getDriverWooviAccountId(driverId);
      
      if (!accountData || !accountData.wooviAccountId) {
        return {
          success: false,
          hasAccount: false,
          message: 'Motorista não possui conta na Woovi'
        };
      }

      const wooviAccountId = accountData.wooviAccountId;

      // Verificar se a conta ainda existe na Woovi (opcional - pode ser custoso)
      // Por enquanto, apenas retornar os dados do Firestore
      return {
        success: true,
        hasAccount: true,
        wooviAccountId: wooviAccountId,
        wooviClientId: accountData.wooviClientId,
        baasAccountCreated: accountData.baasAccountCreated,
        fallbackToCustomer: accountData.fallbackToCustomer,
        message: 'Motorista possui conta na Woovi'
      };

    } catch (error) {
      logError(error, 'Erro ao verificar conta Woovi', { service: 'driver-approval-service', driverId });
      return {
        success: false,
        hasAccount: false,
        error: error.message
      };
    }
  }

  /**
   * Cria conta Woovi para motorista existente (migração)
   * @param {Object} driverData - Dados do motorista
   * @returns {Promise<Object>} - Resultado da criação
   */
  async createWooviAccountForExistingDriver(driverData) {
    try {
      logStructured('info', 'Criando conta Woovi para motorista existente', { service: 'driver-approval-service', driverId: driverData.id, driverName: driverData.name });
      
      // Verificar se já tem conta
      const accountCheck = await this.checkDriverWooviAccount(driverData.id);
      
      if (accountCheck.hasAccount) {
        return {
          success: true,
          message: 'Motorista já possui conta na Woovi',
          wooviClientId: accountCheck.wooviClientId
        };
      }

      // Criar nova conta
      const wooviResult = await this.wooviDriverService.createDriverClient({
        name: driverData.name,
        email: driverData.email,
        phone: driverData.phone,
        cpf: driverData.cpf,
        driverId: driverData.id
      });

      if (!wooviResult.success) {
        return {
          success: false,
          error: 'Falha ao criar conta na Woovi',
          details: wooviResult.error
        };
      }

      // ✅ Atualizar Firestore com wooviClientId
      try {
        const firestore = firebaseConfig.getFirestore();
        if (firestore && wooviResult.wooviClientId) {
          const driverRef = firestore.collection('users').doc(driverData.id);
          
          // Preparar dados (filtrar undefined)
          const dataToSave = {
            wooviAccountId: wooviResult.wooviClientId,
            wooviClientId: wooviResult.wooviClientId,
            wooviAccountCreated: true,
            baasAccountCreated: false,
            wooviAccountCreatedAt: new Date().toISOString()
          };
          
          // Remover valores undefined
          Object.keys(dataToSave).forEach(key => {
            if (dataToSave[key] === undefined) {
              delete dataToSave[key];
            }
          });
          
          await driverRef.set(dataToSave, { merge: true });
          
          logStructured('info', 'wooviClientId salvo no Firestore', { service: 'driver-approval-service', driverId: driverData.id, wooviClientId: wooviResult.wooviClientId });
        } else if (!wooviResult.wooviClientId) {
          logStructured('warn', 'wooviClientId não disponível para salvar', { service: 'driver-approval-service', driverId: driverData.id });
        }
      } catch (firestoreError) {
        logError(firestoreError, 'Erro ao salvar wooviClientId no Firestore', { service: 'driver-approval-service', driverId: driverData.id });
      }

      return {
        success: true,
        message: 'Conta Woovi criada com sucesso',
        wooviClientId: wooviResult.wooviClientId
      };
      
    } catch (error) {
      logError(error, '❌ Erro ao criar conta Woovi para motorista existente:', { service: 'driver-approval-service' });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      };
    }
  }
}

module.exports = DriverApprovalService;