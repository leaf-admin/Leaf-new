# LEA-81 - Auditoria de valores financeiros na UI mobile

Data: 2026-06-04
Escopo: auditoria estática do app mobile, sem alteração funcional, sem build e sem backend.

## Objetivo

Garantir que a UI nova não misture três valores diferentes:

- **Passageiro:** deve ver o valor pago por ele, igual ao valor travado no Pix.
- **Motorista:** deve ver o repasse líquido somente quando o backend entregar líquido autoritativo ou taxas explícitas suficientes para calcular o líquido.
- **Recibo:** deve mostrar pedágio separadamente sempre que existir, sem esconder a diferença entre total pago, taxas e repasse.

## Contrato canônico de valor

### Passageiro

Fonte preferencial:

1. `paymentData.amount`, `paymentState`, `totalPaid`, `paymentAmount`, `chargedAmount`.
2. Campos brutos equivalentes do booking/trip, quando representam o total cobrado.
3. `selectedFare` ou `fare` apenas como fallback de estimativa antes do pagamento confirmado.

Regra de UI:

- Depois do Pix confirmado, mostrar como **valor pago / total pago**.
- Antes do Pix confirmado, se só houver estimativa, a UI deve tratar como **valor estimado**, não como pagamento concluído.
- O app do passageiro nunca deve exibir valor líquido do motorista.

### Motorista

Fonte preferencial:

1. `estimatedDriverNetAmount`, `driverNetAmount`, `lockedDriverNetAmount`, `netAmount`.
2. `grossAmount - totalFees`, somente se as taxas forem explícitas.

Regra de UI:

- Mostrar **líquido** apenas quando houver líquido autoritativo ou cálculo derivado de taxas explícitas.
- Se houver apenas bruto, mostrar como **bruto** ou ocultar o valor líquido com copy de repasse pendente.
- Nunca rotular bruto isolado como líquido.

### Pedágio

Fonte preferencial:

1. `tollFee`, `tollAmount`, `pedagio`.
2. Campos em centavos vindos de `calculation.tollFee` ou `fareBreakdown.calculation.tollFee`.

Regra de UI:

- Passageiro: pedágio aparece como linha separada e incluso no total pago.
- Motorista: pedágio aparece como linha separada e não deve ser confundido com taxa operacional.

### Taxas

Regra de UI:

- `operationalFee` e `paymentIntermediationFee` podem existir separadamente.
- `totalFees` não deve ser rotulado automaticamente como "Taxa operacional Leaf" quando também incluir intermediação de pagamento.

## Matriz auditada

| Superfície | Arquivo | Status | Observação |
| --- | --- | --- | --- |
| Resumo financeiro comum | `mobile-app/src/screens/prototype/tripFinancialSummary.js` | OK com ressalva | Separa bruto, líquido e pedágio. `resolveTripNetAmount()` retorna `0` quando não há líquido; telas de total líquido precisam evitar somar ausências como zero silencioso. |
| Testes do resumo financeiro | `mobile-app/src/screens/prototype/tripFinancialSummary.test.js` | OK | Cobre separação entre total pago, líquido e pedágio; cobre bruto isolado não tratado como líquido. |
| Oferta do motorista | `mobile-app/src/screens/prototype/driverOfferPricingSnapshot.js` | OK | Gross-only não é selecionável como preço líquido; snapshot travado preserva líquido. |
| Card de nova corrida do motorista | `mobile-app/src/screens/prototype/RobotaxiDriverOfferScreen.js` | OK com ajuste recomendado | Não usa bruto como líquido, mas quando não há líquido autoritativo pode renderizar `"-- líquido"`. Melhor copy futura: "Repasse pendente". |
| Viagem em andamento do motorista | `mobile-app/src/screens/prototype/RobotaxiDriverTripScreen.js` | OK | Fallback bruto é rotulado como `"bruto"`, não `"líquido"`. Há teste cobrindo esse caso. |
| Overlay ativo do motorista | `mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js` | OK com ajuste recomendado | Só considera campos líquidos; se não houver líquido mostra `"--"` com label `"Líquido"`. Melhor copy futura: "Repasse pendente". |
| Tela do passageiro em corrida | `mobile-app/src/screens/prototype/RobotaxiTripScreen.js` | OK com ressalva | Usa valor pago quando o estado de pagamento existe. Risco residual: fallback para estimativa quando ainda não há lock de pagamento; nesse caso copy deve ser estimativa. |
| Modal Pix | `mobile-app/src/components/payments/WooviPaymentModal.js` | OK | Usa amount da cobrança Pix e envia grossAmount ao backend. |
| Recibo passageiro/motorista | `mobile-app/src/screens/prototype/RobotaxiReceiptScreen.js` | Parcial | Layout limpo mostra pedágio para ambos. Há uma seção detalhada do passageiro que mostra tarifa inicial, deslocamento, método e total, mas não explicita pedágio como linha própria. |
| Histórico de viagens | `mobile-app/src/screens/prototype/RobotaxiTripHistoryScreen.js` | OK com ressalva | Passageiro usa total pago; motorista usa líquido. Risco residual: líquido ausente entra como zero no total. |
| Saldo e saque do motorista | `mobile-app/src/services/DriverBalanceService.js` | OK no contrato de app | App consome API Leaf, calcula taxa local de saque abaixo de R$ 500,00 e manda idempotency key. Saldo autoritativo continua sendo backend. |

## Testes existentes relevantes

- `mobile-app/src/screens/prototype/tripFinancialSummary.test.js`
  - separa total pago, líquido do motorista e pedágio.
  - valida pedágio em centavos vindo do cálculo do backend.
  - garante que bruto isolado não vira líquido.
- `mobile-app/__tests__/driver-offer-pricing-snapshot.test.js`
  - não promove oferta gross-only para líquido.
  - preserva snapshot líquido travado.
  - calcula líquido apenas quando taxas explícitas existem.
- `mobile-app/__tests__/prototype-ride-screens.test.js`
  - valida que uma viagem de motorista com fallback bruto aparece como `bruto`, não `líquido`.

## Gaps recomendados

1. Trocar copy de motorista quando não há líquido autoritativo:
   - de `"-- líquido"` / label `"Líquido"`
   - para `"Repasse pendente"` ou ocultar o bloco até o backend entregar líquido.

2. Recibo do passageiro:
   - garantir que todas as variantes de layout exibam pedágio separado quando `tollFee > 0`.

3. Histórico/total líquido:
   - quando um recibo de motorista não tiver líquido autoritativo, não somar como zero sem aviso.
   - sugerido: total líquido considera apenas itens com líquido e mostra contador de itens pendentes.

4. Taxas no recibo:
   - separar "Taxa operacional Leaf" de "Custo de intermediação do pagamento" quando ambos existirem.
   - se só houver `totalFees`, usar copy neutra: "Taxas da corrida".

5. Passageiro antes do Pix:
   - quando a tela usa `selectedFare`/estimativa sem pagamento confirmado, copy deve dizer "valor estimado".

## Conclusão

O risco crítico de LEA-81, que era mostrar bruto como líquido para o motorista, está mitigado nas superfícies principais e já possui testes. A auditoria encontrou gaps de copy e consistência em recibo/histórico, mas não encontrou evidência de que o app do passageiro esteja vendo líquido do motorista ou de que o motorista esteja recebendo bruto rotulado como líquido nas telas principais.

Status sugerido para o Linear: **In Review**, mantendo os ajustes recomendados como follow-up antes de fechar como Done.
