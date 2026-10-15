// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Promoções

const {
  DASHBOARD_OPERATION_MUTATION_ROLES,
  authenticateJWT,
  logger,
  promotionService,
  requireAdminMutationsEnabled,
  requireRole,
  router
} = require('./shared');

/**
 * Criar nova promoção
 * POST /api/promotions
 */
router.post('/api/promotions', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      benefit,
      eligibility,
      startDate,
      endDate,
      maxRedemptions,
      createdBy = 'admin'
    } = req.body;

    // Validação básica
    if (!name || !type || !benefit || !eligibility) {
      return res.status(400).json({
        error: 'Dados obrigatórios faltando',
        required: ['name', 'type', 'benefit', 'eligibility']
      });
    }

    const result = await promotionService.createPromotion({
      name,
      description,
      type,
      benefit,
      eligibility,
      startDate,
      endDate,
      maxRedemptions,
      createdBy
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('❌ Erro ao criar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Listar todas as promoções
 * GET /api/promotions
 */
router.get('/api/promotions', async (req, res) => {
  try {
    const { status, type } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (type) filters.type = type;

    const result = await promotionService.listPromotions(filters);

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao listar promoções:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Obter detalhes de uma promoção específica
 * GET /api/promotions/:promotionId
 */
router.get('/api/promotions/:promotionId', async (req, res, next) => {
  try {
    const { promotionId } = req.params;
    if (promotionId === 'stats') {
      return next('route');
    }
    const result = await promotionService.getPromotionById(promotionId);
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Promoção não encontrada' });
    }

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao buscar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Atualizar promoção
 * PATCH /api/promotions/:promotionId
 */
router.patch('/api/promotions/:promotionId', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { promotionId } = req.params;
    const updates = req.body;
    const result = await promotionService.updatePromotion(promotionId, updates);
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Promoção não encontrada' });
    }

    logger.info(`✅ Promoção atualizada: ${promotionId}`);
    res.json({
      success: true,
      message: result.message || 'Promoção atualizada com sucesso',
      promotion: result.promotion
    });

  } catch (error) {
    logger.error('❌ Erro ao atualizar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Verificar elegibilidade de um motorista para uma promoção
 * GET /api/promotions/:promotionId/check-eligibility/:driverId
 */
router.get('/api/promotions/:promotionId/check-eligibility/:driverId', async (req, res) => {
  try {
    const { promotionId, driverId } = req.params;

    const result = await promotionService.checkEligibility(driverId, promotionId);

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao verificar elegibilidade:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Aplicar promoção a um motorista (manual via dashboard)
 * POST /api/promotions/:promotionId/apply/:driverId
 */
router.post('/api/promotions/:promotionId/apply/:driverId', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { promotionId, driverId } = req.params;

    const result = await promotionService.applyPromotion(driverId, promotionId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('❌ Erro ao aplicar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Verificar e aplicar promoções elegíveis para um motorista
 * POST /api/promotions/check-driver/:driverId
 */
router.post('/api/promotions/check-driver/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;

    const result = await promotionService.checkAndApplyEligiblePromotions(driverId);

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao verificar promoções do motorista:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Estatísticas de promoções
 * GET /api/promotions/stats
 */
router.get('/api/promotions/stats', async (req, res) => {
  try {
    const result = await promotionService.getStats();
    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao buscar estatísticas de promoções:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});
