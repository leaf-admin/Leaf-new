// Serviço de pagamentos (Pix/Woovi, repasse, reembolso, saque). O código fica em
// services/payment-service/: shared.js com dependências e helpers, e uma parte por grupo
// de métodos. As partes só acrescentam métodos ao prototype; nenhum nome se repete.
const {
  WooviDriverService,
  FinancialLedgerService,
  paymentRuntimeProfileService,
  isRefundedPaymentStatus,
  isCapturedPaymentStatus,
} = require('./payment-service/shared');

class PaymentService {
  constructor() {
    const appReviewMode = String(process.env.APP_REVIEW || '').toLowerCase() === 'true';
    const productionRuntime = [
      process.env.NODE_ENV,
      process.env.APP_ENV,
      process.env.LEAF_ENV,
      process.env.ENVIRONMENT
    ].some((value) => ['production', 'prod'].includes(String(value || '').toLowerCase()));
    this.productionRuntime = productionRuntime;
    this.LEAF_ACCOUNT_ID = process.env.LEAF_WOOVI_ACCOUNT_ID || 'leaf-main-account';
    // Chave Pix da conta Leaf (origem das transferências)
    // ⚠️ ATENÇÃO: Configurar LEAF_PIX_KEY em produção via variável de ambiente
    this.LEAF_PIX_KEY = process.env.LEAF_PIX_KEY || 'test@leaf.app.br'; // ⚠️ Valor de teste - configurar em produção
    // Criar instância do WooviDriverService
    this.wooviDriverService = new WooviDriverService();
    this.paymentRuntimeProfileService = paymentRuntimeProfileService;
    this.financialLedgerService = new FinancialLedgerService();
    // Taxas operacionais por faixa de valor (regra vigente)
    this.OPERATIONAL_FEE_UP_TO_10 = 79; // R$ 0,79 para corridas até R$ 10,00 (em centavos)
    this.OPERATIONAL_FEE_10_TO_25 = 99; // R$ 0,99 para corridas acima de R$ 10,00 até R$ 25,00 (em centavos)
    this.OPERATIONAL_FEE_25_TO_50 = 149; // R$ 1,49 para corridas acima de R$ 25,00 até R$ 50,00 (em centavos)
    this.OPERATIONAL_FEE_ABOVE_50_PERCENTAGE = 0.03; // 3% para corridas acima de R$ 50,00
    this.THRESHOLD_10 = 1000; // R$ 10,00 em centavos
    this.THRESHOLD_25 = 2500; // R$ 25,00 em centavos
    this.THRESHOLD_50 = 5000; // R$ 50,00 em centavos
    this.WOOVI_FEE_PERCENTAGE = 0.008; // 0,8% da transação
    this.WOOVI_FEE_MINIMUM = 50; // R$ 0,50 mínimo (em centavos)
    this.WITHDRAW_FEE_FLAT_CENTS = 100; // R$ 1,00 por saque, qualquer valor
    this.SUBSCRIPTION_DAILY_BILLING_ENABLED =
      String(process.env.SUBSCRIPTION_DAILY_BILLING_ENABLED || 'false').toLowerCase() === 'true';
    this.SUBSCRIPTION_DAILY_FEE_NOMINAL_CENTS = Math.max(
      0,
      Number.parseInt(
        process.env.SUBSCRIPTION_DAILY_FEE_NOMINAL_CENTS ||
        process.env.SUBSCRIPTION_DAILY_MAX_FEE_CENTS ||
        '1490',
        10
      ) || 1490
    );
    this.SUBSCRIPTION_SETTLE_ON_WITHDRAW =
      String(process.env.SUBSCRIPTION_SETTLE_ON_WITHDRAW || 'true').toLowerCase() !== 'false';
    this.SUBSCRIPTION_SPLIT_RETENTION_ENABLED =
      String(process.env.SUBSCRIPTION_SPLIT_RETENTION_ENABLED || 'false').toLowerCase() === 'true';
    this.PAYMENT_BYPASS_ON_WOOVI_FAILURE =
      appReviewMode ||
      (!productionRuntime && String(process.env.PAYMENT_BYPASS_ON_WOOVI_FAILURE || '').toLowerCase() === 'true');
    this.PAYMENT_FORCE_BYPASS =
      appReviewMode ||
      (!productionRuntime && String(process.env.PAYMENT_FORCE_BYPASS || '').toLowerCase() === 'true');
    const bypassPassengersRaw =
      process.env.PAYMENT_FORCE_BYPASS_PASSENGERS ||
      process.env.PAYMENT_FORCE_BYPASS_USER_IDS ||
      '';
    this.PAYMENT_FORCE_BYPASS_PASSENGERS = new Set(
      String(bypassPassengersRaw)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    );

    // Configuração de retry
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 segundo
    this.PAYMENT_STATUS_CACHE_TTL_SECONDS = Number.parseInt(
      process.env.PAYMENT_STATUS_CACHE_TTL_SECONDS || '900',
      10
    );
    this.WOOVI_MIN_CHARGE_EXPIRES_IN_SECONDS = Math.max(
      300,
      Number.parseInt(process.env.WOOVI_MIN_CHARGE_EXPIRES_IN_SECONDS || '300', 10) || 300
    );

    // Estados válidos de payment holding
    this.PAYMENT_STATES = {
      PENDING: 'pending',
      IN_HOLDING: 'in_holding',
      DISTRIBUTED: 'distributed',
      REFUNDED: 'refunded',
      CANCELLED: 'cancelled'
    };

    // Transições de estado válidas
    this.VALID_TRANSITIONS = {
      [this.PAYMENT_STATES.PENDING]: [this.PAYMENT_STATES.IN_HOLDING, this.PAYMENT_STATES.CANCELLED],
      [this.PAYMENT_STATES.IN_HOLDING]: [this.PAYMENT_STATES.DISTRIBUTED, this.PAYMENT_STATES.REFUNDED, this.PAYMENT_STATES.CANCELLED],
      [this.PAYMENT_STATES.DISTRIBUTED]: [], // Estado final
      [this.PAYMENT_STATES.REFUNDED]: [], // Estado final
      [this.PAYMENT_STATES.CANCELLED]: [] // Estado final
    };
  }
}

const PARTS = [
  require('./payment-service/01-intent-and-split'),
  require('./payment-service/02-events-and-status-cache'),
  require('./payment-service/03-advance-and-confirmation'),
  require('./payment-service/04-refunds-and-release'),
  require('./payment-service/05-distribution'),
  require('./payment-service/06-driver-balance'),
  require('./payment-service/07-withdrawals'),
  require('./payment-service/08-status-and-holding'),
];

for (const part of PARTS) {
  for (const name of Object.getOwnPropertyNames(part.prototype)) {
    if (name === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(PaymentService.prototype, name)) {
      throw new Error(`PaymentService: método duplicado entre partes: ${name}`);
    }
    Object.defineProperty(PaymentService.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name));
  }
}

module.exports = PaymentService;
module.exports.isRefundedPaymentStatus = isRefundedPaymentStatus;
module.exports.isCapturedPaymentStatus = isCapturedPaymentStatus;
