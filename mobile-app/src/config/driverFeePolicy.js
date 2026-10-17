// Taxas e requisitos mostrados ao motorista (onboarding e tela de ganhos).
// Quem cobra é o backend: os valores daqui só explicam a regra e precisam
// acompanhar leaf-websocket-backend/services/ride-financial-contract.js
// (DEFAULT_POLICY), commands/CancelRideCommand.js, a taxa de saque e a
// assinatura diária (services/daily-subscription-service.js). Decisão de 17/10/2026: transparência total, sem nomes de
// fornecedores.

export const PILOT_SERVICE_AREA_LABEL = 'Zona Sul, Barra e Jacarepaguá';

export const DRIVER_FEE_POLICY = Object.freeze({
  serviceFeeBands: Object.freeze([
    Object.freeze({ upToCents: 1000, feeCents: 79 }),
    Object.freeze({ upToCents: 2500, feeCents: 99 }),
    Object.freeze({ upToCents: 5000, feeCents: 149 }),
  ]),
  serviceFeeAbovePercentage: 0.03,
  paymentProcessingPercentage: 0.008,
  paymentProcessingMinimumCents: 50,
  withdrawalFeeCents: 100,
  // Plano diário previsto (hoje desligado): o valor depende do faturamento do dia.
  dailySubscriptionTiers: Object.freeze([
    Object.freeze({ upToGrossCents: 10000, feeCents: 0 }),
    Object.freeze({ upToGrossCents: 20000, feeCents: 490 }),
    Object.freeze({ upToGrossCents: 30000, feeCents: 790 }),
    Object.freeze({ upToGrossCents: 50000, feeCents: 1290 }),
    Object.freeze({ upToGrossCents: null, feeCents: 1490 }),
  ]),
  dailySubscriptionMinAccountAgeDays: 60,
  dailySubscriptionNoticeDays: 60,
  passengerNoShowGraceMinutes: 5,
});

export const DRIVER_REQUIREMENTS = Object.freeze([
  'CNH com EAR (exerce atividade remunerada), vencida há no máximo 30 dias',
  'Carro com até 10 anos de fabricação, marca e modelo aceitos e licenciamento do ano em dia',
  'CNH e CRLV digitais em PDF (app Carteira Digital de Trânsito)',
  'Certidão de antecedentes no seu CPF',
  `Rodar na região atendida: ${PILOT_SERVICE_AREA_LABEL}`,
]);

export function formatCents(cents) {
  const value = Math.round(Number(cents) || 0) / 100;
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

export function resolveServiceFeeCents(fareCents, policy = DRIVER_FEE_POLICY) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0));
  const band = policy.serviceFeeBands.find((item) => fare <= item.upToCents);
  return band ? band.feeCents : Math.round(fare * policy.serviceFeeAbovePercentage);
}

export function resolvePaymentProcessingCents(paidCents, policy = DRIVER_FEE_POLICY) {
  const paid = Math.max(0, Math.round(Number(paidCents) || 0));
  return Math.max(Math.round(paid * policy.paymentProcessingPercentage), policy.paymentProcessingMinimumCents);
}

// Quanto o motorista fica numa corrida sem pedágio, para o exemplo da tela.
export function resolveDriverNetExample(fareCents, policy = DRIVER_FEE_POLICY) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0));
  const serviceFeeCents = resolveServiceFeeCents(fare, policy);
  const processingCents = resolvePaymentProcessingCents(fare, policy);
  const netCents = Math.max(0, fare - serviceFeeCents - processingCents);
  return {
    fareCents: fare,
    serviceFeeCents,
    processingCents,
    netCents,
    netPercent: fare > 0 ? Math.round((netCents / fare) * 1000) / 10 : 0,
  };
}

export function describeDailySubscriptionTiers(policy = DRIVER_FEE_POLICY) {
  const tiers = policy.dailySubscriptionTiers;
  return tiers.map((tier, index) => {
    const fee = tier.feeCents > 0 ? formatCents(tier.feeCents) : 'grátis';
    if (tier.upToGrossCents === null) {
      return `${fee} acima de ${formatCents(tiers[index - 1].upToGrossCents)}`;
    }
    return `${fee} até ${formatCents(tier.upToGrossCents)}`;
  }).join(', ');
}

export function buildDriverFeeRows(policy = DRIVER_FEE_POLICY) {
  const [b1, b2, b3] = policy.serviceFeeBands;
  return [
    {
      key: 'service',
      title: 'Taxa da Leaf por corrida',
      value: `${formatCents(b1.feeCents)} a ${formatCents(b3.feeCents)}`,
      detail: `${formatCents(b1.feeCents)} até ${formatCents(b1.upToCents)} · ${formatCents(b2.feeCents)} até ${formatCents(b2.upToCents)} · ${formatCents(b3.feeCents)} até ${formatCents(b3.upToCents)} · ${String(policy.serviceFeeAbovePercentage * 100).replace('.', ',')}% acima disso. Calculada sem o pedágio.`,
    },
    {
      key: 'processing',
      title: 'Processamento do Pix',
      value: `${String(policy.paymentProcessingPercentage * 100).replace('.', ',')}%`,
      detail: `Sobre o valor pago pelo passageiro, mínimo de ${formatCents(policy.paymentProcessingMinimumCents)}.`,
    },
    {
      key: 'toll',
      title: 'Pedágio',
      value: '100% seu',
      detail: 'Repassado inteiro para você.',
    },
    {
      key: 'withdrawal',
      title: 'Saque',
      value: formatCents(policy.withdrawalFeeCents),
      detail: 'Por saque, qualquer valor. Um saque por dia evita pagar a taxa mais de uma vez.',
    },
    {
      key: 'subscription',
      title: 'Mensalidade',
      value: 'Nenhuma hoje',
      detail: `Se o plano diário for ativado, ele só vale depois de ${policy.dailySubscriptionMinAccountAgeDays} dias de conta e com ${policy.dailySubscriptionNoticeDays} dias de aviso. O valor depende do quanto você faturou no dia: ${describeDailySubscriptionTiers(policy)}.`,
    },
    {
      key: 'cancel',
      title: 'Cancelamento e espera',
      value: 'Você recebe',
      detail: `Se o passageiro cancelar depois do aceite, você recebe pelo deslocamento. Se ele não aparecer em ${policy.passengerNoShowGraceMinutes} minutos, você recebe pela espera.`,
    },
  ];
}
