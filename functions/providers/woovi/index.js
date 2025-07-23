const WooviPixProvider = require('./checkout');
const wooviTemplate = require('./template');

// Função principal para criar cobrança PIX
exports.createPixCharge = async (req, res) => {
    try {
        const { amount, customerName, customerId, bookingId, driverId, comment } = req.body;

        // Validar dados obrigatórios
        if (!amount || !customerName || !customerId) {
            return res.status(400).json({
                success: false,
                error: 'Dados obrigatórios: amount, customerName, customerId'
            });
        }

        // Criar instância do provider
        const woovi = new WooviPixProvider();

        // Criar cobrança PIX
        const result = await woovi.createCustomPixCharge({
            value: amount,
            customerName,
            customerId,
            bookingId,
            driverId,
            comment: comment || `Pagamento LEAF - ${customerName}`,
            expiresIn: 3600 // 1 hora
        });

        if (result.success) {
            // Salvar dados da cobrança no Firebase
            const chargeData = {
                chargeId: result.qrCode.chargeId,
                customerId,
                bookingId,
                driverId,
                amount,
                status: 'pending',
                createdAt: new Date().toISOString(),
                expiresAt: result.qrCode.expiresAt,
                provider: 'woovi'
            };

            // Aqui você pode salvar no Firebase Database
            // const db = admin.database();
            // await db.ref(`pix_charges/${result.qrCode.chargeId}`).set(chargeData);

            return res.status(200).json({
                success: true,
                data: {
                    qrCode: result.qrCode.pixCode,
                    pixCopyPaste: result.qrCode.pixCopyPaste,
                    chargeId: result.qrCode.chargeId,
                    expiresAt: result.qrCode.expiresAt,
                    amount,
                    customerName
                }
            });
        } else {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        console.error('Erro ao criar cobrança PIX:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
};

// Função para consultar status da cobrança
exports.checkChargeStatus = async (req, res) => {
    try {
        const { chargeId } = req.params;

        if (!chargeId) {
            return res.status(400).json({
                success: false,
                error: 'Charge ID é obrigatório'
            });
        }

        const woovi = new WooviPixProvider();
        const result = await woovi.getChargeStatus(chargeId);

        if (result.success) {
            return res.status(200).json({
                success: true,
                data: {
                    chargeId,
                    status: result.status,
                    value: result.data.value,
                    confirmedAt: result.data.confirmedAt,
                    expiresAt: result.data.expiresAt
                }
            });
        } else {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        console.error('Erro ao consultar status:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
};

// Função para processar webhook da Woovi
exports.processWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-signature'];
        const timestamp = req.headers['x-timestamp'];
        const webhookData = req.body;

        if (!signature || !timestamp) {
            return res.status(400).json({
                success: false,
                error: 'Assinatura ou timestamp não fornecidos'
            });
        }

        const woovi = new WooviPixProvider();
        
        // Validar assinatura do webhook
        if (!woovi.validateWebhook(signature, timestamp, JSON.stringify(webhookData))) {
            return res.status(401).json({
                success: false,
                error: 'Assinatura inválida'
            });
        }

        // Processar webhook
        const result = woovi.processWebhook(webhookData);

        if (result.success) {
            // Atualizar status no Firebase
            const { event, chargeId, value, customerId } = result;

            // Aqui você pode atualizar o Firebase Database
            // const db = admin.database();
            // await db.ref(`pix_charges/${chargeId}`).update({
            //     status: event === 'payment_confirmed' ? 'confirmed' : 'expired',
            //     updatedAt: new Date().toISOString(),
            //     event
            // });

            // Se o pagamento foi confirmado, processar a viagem
            if (event === 'payment_confirmed') {
                // Processar confirmação de pagamento
                console.log(`Pagamento confirmado: ${chargeId} - R$ ${value}`);
                
                // Aqui você pode:
                // 1. Atualizar status da viagem
                // 2. Notificar o motorista
                // 3. Processar comissões
                // 4. Enviar recibo
            }

            return res.status(200).json({
                success: true,
                message: 'Webhook processado com sucesso'
            });
        } else {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        console.error('Erro ao processar webhook:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
};

// Função para listar cobranças
exports.listCharges = async (req, res) => {
    try {
        const { limit = 10, offset = 0, status } = req.query;
        
        const filters = { limit, offset };
        if (status) filters.status = status;

        const woovi = new WooviPixProvider();
        const result = await woovi.listCharges(filters);

        if (result.success) {
            return res.status(200).json({
                success: true,
                data: result.data
            });
        } else {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        console.error('Erro ao listar cobranças:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
};

// Função para testar conexão
exports.testConnection = async (req, res) => {
    try {
        const woovi = new WooviPixProvider();
        const result = await woovi.listCharges({ limit: 1 });

        return res.status(200).json({
            success: result.success,
            message: result.success ? 'Conexão estabelecida com sucesso!' : result.error
        });

    } catch (error) {
        console.error('Erro ao testar conexão:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro ao testar conexão'
        });
    }
};

// Exportar template
exports.template = wooviTemplate; 