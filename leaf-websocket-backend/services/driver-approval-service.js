const WooviDriverService = require('./woovi-driver-service');
const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');
const {
  recomputeDriverActivationStatus
} = require('./driver-document-analysis-queue');

class DriverApprovalService {
  constructor() {
    // Criar instância do WooviDriverService
    this.wooviDriverService = new WooviDriverService();
    this.LEGACY_DRIVER_BAAS_FALLBACK_ENABLED =
      String(process.env.ENABLE_LEGACY_DRIVER_BAAS_FALLBACK || 'false').toLowerCase() === 'true';
  }

  normalizePixKey(value) {
    return String(value || '').trim();
  }

  normalizeApprovalEvidence(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') return { ref: item };
          if (item && typeof item === 'object') return item;
          return null;
        })
        .filter(Boolean);
    }

    if (value && typeof value === 'object') {
      return [value];
    }

    if (typeof value === 'string' && value.trim()) {
      return [{ ref: value.trim() }];
    }

    return [];
  }

  normalizeManualApprovalAudit(driverData = {}) {
    const audit = driverData.approvalAudit || driverData.audit || driverData.auditTrail || {};
    const actorId = String(
      audit.actorId ||
        audit.adminId ||
        audit.userId ||
        audit.actor?.id ||
        ''
    ).trim();
    const actorRole = String(
      audit.actorRole ||
        audit.role ||
        audit.actor?.role ||
        'admin'
    ).trim();
    const reason = String(
      audit.reason ||
        audit.approvalReason ||
        audit.reviewReason ||
        audit.justification ||
        ''
    ).trim();
    const provenance = String(
      audit.provenance ||
        audit.source ||
        audit.reviewSource ||
        ''
    ).trim();
    const evidence = this.normalizeApprovalEvidence(
      audit.evidence ||
        audit.evidenceRefs ||
        audit.documents ||
        audit.documentRefs ||
        audit.reviewEvidence
    );

    if (!actorId || !actorRole || !reason || !provenance || evidence.length === 0) {
      return {
        valid: false,
        error: 'APPROVAL_AUDIT_REQUIRED',
        details: 'Aprovação manual exige actorId, actorRole, reason, provenance e evidence.'
      };
    }

    return {
      valid: true,
      audit: {
        action: 'driver.manual_approval',
        actorId,
        actorRole,
        reason,
        provenance,
        evidence,
        source: provenance,
        createdAt: new Date().toISOString()
      }
    };
  }

  async getDriverPreviousApprovalState(driverId) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return {
        ok: false,
        error: 'APPROVAL_AUDIT_STORE_UNAVAILABLE',
        details: 'Firestore indisponível para capturar estado anterior.'
      };
    }

    const driverRef = firestore.collection('users').doc(driverId);
    const snapshot = await driverRef.get();
    const data = snapshot.exists ? (snapshot.data() || {}) : {};

    return {
      ok: true,
      firestore,
      previousState: {
        exists: Boolean(snapshot.exists),
        approved: data.approved ?? null,
        isApproved: data.isApproved ?? null,
        driverStatus: data.driverStatus || data.status || null,
        kycStatus: data.kycStatus || data.kyc_status || null,
        vehicleStatus: data.vehicleStatus || data.vehicle_status || null,
        wooviAccountCreated: data.wooviAccountCreated ?? null,
        wooviSubaccountCreated: data.wooviSubaccountCreated ?? null
      }
    };
  }

  buildApprovalAuditFields(driverData = {}, nextState = {}) {
    const auditTrail = driverData.approvalAuditTrail;
    if (!auditTrail) {
      return {};
    }

    return {
      approvalAuditTrail: {
        ...auditTrail,
        nextState
      },
      approvalAuditUpdatedAt: auditTrail.createdAt,
      approvalAuditActorId: auditTrail.actorId,
      approvalAuditReason: auditTrail.reason,
      approvalAuditProvenance: auditTrail.provenance
    };
  }

  async prepareManualApprovalAudit(driverData = {}) {
    const normalizedAudit = this.normalizeManualApprovalAudit(driverData);
    if (!normalizedAudit.valid) {
      return normalizedAudit;
    }

    const previous = await this.getDriverPreviousApprovalState(driverData.id);
    if (!previous.ok) {
      return {
        valid: false,
        error: previous.error,
        details: previous.details
      };
    }

    const nextState = {
      approved: true,
      isApproved: true,
      driverStatus: 'approved'
    };

    return {
      valid: true,
      firestore: previous.firestore,
      auditTrail: {
        ...normalizedAudit.audit,
        driverId: driverData.id,
        previousState: previous.previousState,
        nextState
      },
      nextState
    };
  }

  async resolveCanonicalApprovalEvidence(driverId) {
    try {
      const activationStatus = await recomputeDriverActivationStatus(driverId);
      if (activationStatus?.canGoOnline === true) {
        return {
          valid: true,
          activationStatus
        };
      }

      return {
        valid: false,
        error: 'CANONICAL_DRIVER_EVIDENCE_REQUIRED',
        details: 'Aprovação manual não substitui CNH válida, CRLV/veículo ativo, liveness, face compare e demais evidências canônicas.',
        activationStatus: activationStatus || null
      };
    } catch (error) {
      return {
        valid: false,
        error: 'CANONICAL_DRIVER_EVIDENCE_CHECK_FAILED',
        details: error?.message || String(error),
        activationStatus: null
      };
    }
  }

  buildDriverSubaccountPayload(driverData = {}) {
    const pixKey = this.normalizePixKey(
      driverData.wooviSubaccountPixKey ||
      driverData.subaccountPixKey ||
      driverData.driverPixKey ||
      driverData.pixKey ||
      driverData.bankAccount
    );

    if (!pixKey) {
      return null;
    }

    return {
      name: driverData.name,
      email: driverData.email,
      phone: driverData.phone,
      taxID: driverData.cpf,
      pixKey
    };
  }

  async persistDriverWooviAccount(driverId, dataToSave) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      logStructured('warn', 'Firestore não disponível, dados Woovi não foram salvos', {
        service: 'driver-approval-service',
        driverId
      });
      return false;
    }

    const sanitized = { ...dataToSave };
    Object.keys(sanitized).forEach(key => {
      if (sanitized[key] === undefined) {
        delete sanitized[key];
      }
    });

    await firestore.collection('users').doc(driverId).set(sanitized, { merge: true });
    return true;
  }

  async tryCreateDriverSubaccount(driverData = {}) {
    const subaccountPayload = this.buildDriverSubaccountPayload(driverData);
    if (!subaccountPayload) {
      return {
        success: false,
        reason: 'pix_key_missing'
      };
    }

    const result = await this.wooviDriverService.createSubaccount(subaccountPayload);
    if (!result.success) {
      return {
        success: false,
        reason: 'woovi_subaccount_create_failed',
        error: result.error,
        details: result
      };
    }

    const subaccountPixKey = result.pixKey || subaccountPayload.pixKey;
    const subaccountId =
      result.subaccount?.id ||
      result.subaccount?.accountId ||
      result.subaccount?.pixKey ||
      subaccountPixKey;

    const nowIso = new Date().toISOString();
    const approvalFields = driverData.approvalAuditTrail
      ? {
          isApproved: true,
          approvedAt: nowIso,
          ...this.buildApprovalAuditFields(driverData, {
            approved: true,
            isApproved: true,
            driverStatus: 'approved',
            wooviSubaccountCreated: true,
            fallbackToCustomer: false
          })
        }
      : {};

    const dataToSave = {
      wooviAccountId: subaccountId,
      wooviClientId: subaccountId,
      wooviSubaccountId: subaccountId,
      wooviSubaccountPixKey: subaccountPixKey,
      pixKey: subaccountPixKey,
      wooviAccountCreated: true,
      wooviSubaccountCreated: true,
      baasAccountCreated: false,
      fallbackToCustomer: false,
      baasUpgradePending: false,
      wooviAccountCreatedAt: nowIso,
      ...approvalFields
    };

    await this.persistDriverWooviAccount(driverData.id, dataToSave);

    return {
      success: true,
      wooviAccountId: subaccountId,
      wooviClientId: subaccountId,
      wooviSubaccountId: subaccountId,
      wooviSubaccountPixKey: subaccountPixKey,
      subaccount: result.subaccount,
      dataToSave
    };
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
      const audit = await this.prepareManualApprovalAudit(driverData);
      if (!audit.valid) {
        return {
          success: false,
          error: audit.error,
          details: audit.details
        };
      }
      const canonicalEvidence = await this.resolveCanonicalApprovalEvidence(driverData.id);
      if (!canonicalEvidence.valid) {
        return {
          success: false,
          error: canonicalEvidence.error,
          details: canonicalEvidence.details,
          activationStatus: canonicalEvidence.activationStatus
        };
      }
      const driverDataWithAudit = {
        ...driverData,
        approvalAuditTrail: {
          ...audit.auditTrail,
          activationStatus: canonicalEvidence.activationStatus,
          canonicalEvidenceConfirmed: true
        }
      };

      const subaccountResult = await this.tryCreateDriverSubaccount(driverDataWithAudit);
      if (subaccountResult.success) {
        return {
          success: true,
          message: 'Motorista aprovado com subconta Woovi para split',
          driverData: {
            ...driverDataWithAudit,
            ...subaccountResult.dataToSave
          },
          wooviAccountId: subaccountResult.wooviAccountId,
          wooviClientId: subaccountResult.wooviClientId,
          wooviSubaccountPixKey: subaccountResult.wooviSubaccountPixKey
        };
      }

      if (subaccountResult.reason !== 'pix_key_missing') {
        logStructured('warn', 'Falha ao criar subconta Woovi; tentando fallback BaaS/customer', {
          service: 'driver-approval-service',
          driverId: driverDataWithAudit.id,
          reason: subaccountResult.reason,
          error: subaccountResult.error
        });
      }
      
      // 1. Fallback legado: conta BaaS completa fica explicitamente desligada.
      // O modelo atual é ledger interno + saque solicitado pelo motorista.
      let baasResult = {
        success: false,
        useFallback: true,
        legacyDisabled: true
      };
      if (this.LEGACY_DRIVER_BAAS_FALLBACK_ENABLED) {
        baasResult = await this.wooviDriverService.createDriverBaaSAccount({
          name: driverData.name,
          email: driverData.email,
          phone: driverData.phone,
          cpf: driverData.cpf,
          driverId: driverData.id
        });
      }

      // Se API MASTER não estiver configurada, usar fallback (customer)
      let useCustomerFallback = false;
      
      if (!baasResult || !baasResult.success) {
        if (baasResult && baasResult.useFallback) {
          logStructured('warn', 'BaaS legado desativado. Usando customer/subconta Woovi quando necessário.', {
            service: 'driver-approval-service',
            driverId: driverData.id,
            legacyDisabled: baasResult.legacyDisabled === true
          });
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
          ...driverDataWithAudit,
          wooviAccountId: customerResult.wooviClientId,
          wooviClientId: customerResult.wooviClientId, // Compatibilidade
          isApproved: true,
          approvedAt: new Date().toISOString(),
          wooviAccountCreated: true,
          baasAccountCreated: false, // Indica que não é BaaS real ainda
          fallbackToCustomer: true,
          baasUpgradePending: false
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
              baasUpgradePending: false,
              wooviAccountCreatedAt: new Date().toISOString(),
              isApproved: true,
              approvedAt: new Date().toISOString(),
              ...this.buildApprovalAuditFields(driverDataWithAudit, {
                approved: true,
                isApproved: true,
                driverStatus: 'approved',
                wooviAccountCreated: true,
                fallbackToCustomer: true
              })
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
          message: 'Motorista aprovado com ledger interno e customer Woovi auxiliar',
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
        ...driverDataWithAudit,
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
            approvedAt: new Date().toISOString(),
            ...this.buildApprovalAuditFields(driverDataWithAudit, {
              approved: true,
              isApproved: true,
              driverStatus: 'approved',
              wooviAccountCreated: true,
              baasAccountCreated: true
            })
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
        wooviSubaccountId: driverData.wooviSubaccountId || null,
        wooviSubaccountPixKey: driverData.wooviSubaccountPixKey || driverData.subaccountPixKey || null,
        pixKey: driverData.pixKey || driverData.wooviPixKey || driverData.driverPixKey || null, // Chave Pix do motorista
        driverPixKey: driverData.driverPixKey || driverData.pixKey || driverData.wooviPixKey || null,
        pixKeyType: driverData.pixKeyType || null,
        baasAccountCreated: driverData.baasAccountCreated || false,
        wooviSubaccountCreated: driverData.wooviSubaccountCreated || false,
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
        wooviSubaccountId: accountData.wooviSubaccountId,
        wooviSubaccountPixKey: accountData.wooviSubaccountPixKey,
        pixKey: accountData.pixKey,
        baasAccountCreated: accountData.baasAccountCreated,
        wooviSubaccountCreated: accountData.wooviSubaccountCreated,
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

      const subaccountResult = await this.tryCreateDriverSubaccount(driverData);
      if (subaccountResult.success) {
        return {
          success: true,
          message: 'Subconta Woovi criada com sucesso',
          wooviClientId: subaccountResult.wooviClientId,
          wooviAccountId: subaccountResult.wooviAccountId,
          wooviSubaccountPixKey: subaccountResult.wooviSubaccountPixKey
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

  async getDriverWooviAccount(driverId) {
    const accountData = await this.getDriverWooviAccountId(driverId);
    if (!accountData || !accountData.wooviAccountId) {
      return null;
    }

    const accountId =
      accountData.wooviSubaccountPixKey ||
      accountData.wooviSubaccountId ||
      accountData.wooviAccountId;

    return {
      accountId,
      wooviAccountId: accountData.wooviAccountId,
      wooviClientId: accountData.wooviClientId,
      wooviSubaccountId: accountData.wooviSubaccountId,
      wooviSubaccountPixKey: accountData.wooviSubaccountPixKey,
      pixKey: accountData.pixKey,
      driverPixKey: accountData.driverPixKey,
      pixKeyType: accountData.pixKeyType,
      baasAccountCreated: accountData.baasAccountCreated,
      wooviSubaccountCreated: accountData.wooviSubaccountCreated,
      fallbackToCustomer: accountData.fallbackToCustomer
    };
  }
}

module.exports = DriverApprovalService;
