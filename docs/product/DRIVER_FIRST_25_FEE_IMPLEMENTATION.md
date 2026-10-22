# Tarifa Leaf nas primeiras 25 conclusões no destino

## Objetivo e decisão aprovada

Issue #405. Em 22/10/2026, Izaak aprovou:

- R$ 0,99 da Leaf, com o custo Pix separado e mantido na política atual.
- As primeiras 25 corridas concluídas no destino desde o cadastro. Cancelamentos e encerramentos antecipados não consomem a contagem.
- Todos os motoristas, inclusive já cadastrados, sem prazo de término.
- Depois da 25ª conclusão: tabela atual de R$ 0,79 / R$ 0,99 / R$ 1,49 / 3%, conforme a faixa. Não há nova tarifa única de R$ 1,49.

Não há autorização para reprecificar corridas passadas, devolver taxas antigas ou zerar o histórico de motoristas existentes na ativação.

## Escopo deste primeiro PR

Este PR prepara a política pura, o contrato financeiro optativo e uma auditoria offline do histórico. **Não ativa a promoção nem implementa ainda seu contador persistente.** Nenhum endpoint cria ou recebe `driverIntroFee` neste PR. Os consumidores atuais continuam na tabela atual.

O contexto interno exige motorista, contagem inteira não negativa, confirmação explícita de histórico verificado e identificação do snapshot histórico. Ausência de histórico gera erro; não representa zero corridas. A elegibilidade e os 99 centavos são derivados da política aprovada, e não de um valor arbitrário enviado pelo cliente.

Quando o contexto for fornecido pelo backend, os cálculos em centavos/reais usam a mesma tarifa Leaf. Pix, repasse de pedágio, retenção de assinatura e clamps conservam o cálculo existente. O snapshot final preserva o contexto aceito; validação rejeita tarifa promocional divergente e, quando informado o motorista esperado, contexto de outro motorista.

`historyVerified` é uma pré-condição de um chamador interno confiável, não uma assinatura ou autenticação. Nunca aceitar esse objeto em payload de passageiro, motorista ou dashboard. A futura integração precisa obter o contexto exclusivamente do estado canônico do servidor.

## Por que verificar o histórico antes da integração

`totalTrips` e `completedTrips` não provam a regra aprovada. A persistência atual também salva `status=completed` para algumas corridas encerradas antecipadamente; o motivo aparece em `settlement.settlementType`, em outros sinais de encerramento ou na posição final. Há fontes Firestore e RTDB legadas a reconciliar.

O script abaixo lê somente um JSON local e escreve o relatório na saída padrão. Não carrega Firebase Admin, não usa credenciais, não conecta Redis, não consulta provedores e não altera o arquivo de entrada. Não possui modo de importação ou aplicação.

```bash
node leaf-websocket-backend/scripts/audit-driver-intro-fee-history.cjs /caminho/absoluto/history.json > /caminho/absoluto/report.json
```

Contrato do arquivo:

```json
{
  "schemaVersion": 1,
  "exportedThrough": "2026-10-22T12:00:00Z",
  "drivers": [{
    "driverId": "example-driver",
    "registeredAt": "2026-01-01T00:00:00Z",
    "historyCompleteFromRegistration": true
  }],
  "rides": [{
    "bookingId": "example-booking",
    "driverId": "example-driver",
    "status": "COMPLETED",
    "completedAt": "2026-10-21T12:00:00Z",
    "destinationLocation": { "lat": -22.9, "lng": -43.2 },
    "endLocation": { "lat": -22.9001, "lng": -43.2001 }
  }]
}
```

O exemplo é sintético. No export real, manter também os campos disponíveis `completionType`, `settlement`, `earlyEndSettlement`, `earlyEnd`, `driverEarlyEndSkipped`, `financialNamespace`, `financialContext`, `providerEnvironment`, `paymentProviderEnvironment` e `testUserSandbox`.

`historyCompleteFromRegistration` declara cobertura do export e precisa de comprovação na coleta, inclusive fontes legadas. Não é inferido da ausência de documentos. Datas numéricas são milissegundos; timestamps Firestore serializados aceitam `seconds` ou `_seconds`. Usar preferencialmente ISO UTC.

O relatório deduplica por bookingId, separa sandbox, cancelamento e encerramento antecipado, aponta conflitos e exige evidência de posição final/destino e janela temporal válida para candidatas. Usa o limite padrão de 500 m já existente em `ride-early-end-service`; a configuração histórica real precisa ser verificada antes da homologação. As posições persistidas são indícios para reconciliação, não prova independente de telemetria confiável.

`eligibleCandidate=null` significa que os dados não permitem decidir. `true` ou `false` continuam sendo **candidatas a revisão**, não autorização financeira. Todo relatório tem `requiresHumanVerification=true` e hash SHA-256 do input na CLI. Não emite contexto verificado nem escreve contadores.

## Próxima coleta, sujeita a autorização

Não foi acessado histórico de produção. Não foi encontrado um export local apropriado nos diretórios de handoff/releases/backups examinados.

Primeira etapa proposta: leitura limitada a **até 1.000 documentos Firestore no total**, entre cadastros e corridas, para identificar cobertura, campos antigos e sinais de encerramento. Projetar somente identificadores, datas, estado, destino/posição final e metadados de conclusão/contexto financeiro. Guardar o export localmente fora do Git, com acesso restrito; não imprimir dados pessoais, coordenadas ou credenciais no chat/CI. Nenhuma escrita, backfill ou ação Woovi/lojas/infra está incluída.

O limite é de documentos retornados; a cobrança exata depende dos índices e da consulta. Não realizar consultas agregadas, varredura sem limite ou leituras RTDB nesta etapa. Uma amostra limitada não comprova cobertura desde o cadastro: se truncada ou insuficiente, o relatório permanece pendente e uma coleta completa precisa de escopo próprio.

Antes de usar credenciais reais ou fazer essa leitura, pedir a aprovação específica exigida pelo AGENTS.md. Não aumentar o limite automaticamente. Esta proposta não autoriza a coleta.

## Integração que ainda precisa ser implementada e testada

1. Definir a fonte durável do contador por motorista e namespace, incluindo inicialização histórica verificável e cadastro novo. Não inferir zero de cache ausente. Quantificar e submeter à aprovação qualquer nova leitura/escrita paga antes de adicioná-la.
2. Derivar contexto por motorista na oferta (`driver-notification-dispatcher`) e travá-lo no aceite (`AcceptRideCommand`). Reaproveitar o snapshot nos handlers/listeners de aceite e no sync da corrida ativa. A cotação do passageiro ocorre antes de existir motorista e não pode prometer a elegibilidade de um motorista desconhecido.
3. Propagar o contexto aceito a conclusão normal, encerramentos antecipados e recibos, preservando as regras financeiras desses fluxos. A distribuição canônica consome o snapshot final, sem consultar novamente a elegibilidade.
4. Contar conclusão normal com evidência do servidor de chegada ao destino, uma vez por bookingId e motorista. Cancelamentos e encerramentos antecipados não contam. Em reatribuição, o trecho interrompido não é uma conclusão no destino para o motorista anterior.
5. Serializar a conclusão e a disponibilidade do motorista para impedir que duas corridas disputem a última vaga. Testar concorrência real no armazenamento escolhido, crash/retry e recuperação; os testes puros deste PR não provam essa atomicidade.
6. Cobrir a fronteira 24 → 25 → próxima oferta com testes de dispatcher/aceite/conclusão/billing; repetição, cancelamento, antecipação, histórico antigo, cadastro novo, cache perdido e namespace sandbox.
7. Só então alinhar comunicação do app/site, revisar o diff integral e preparar ativação gradual com aprovação separada. Deploy financeiro e alterações de dados não estão autorizados por este documento.

## Validação, riscos e rollback

Validar política, contrato, APIs financeiras e auditoria com dados sintéticos; executar os guards do AGENTS e o CI. Esses resultados não substituem histórico real ou QA em aparelho.

Riscos restantes: cobertura histórica incompleta, telemetria antiga insuficiente, corrida seguinte iniciada antes de a contagem persistir, recuperação após perda de cache e divergência entre oferta e recibo se algum consumidor não for integrado. A promoção **não está pronta para ativação** enquanto esses pontos estiverem abertos.

Rollback deste PR: reverter seus commits; não há migração ou registro financeiro criado. Na integração futura, preservar contextos/snapshots já aceitos mesmo após desativar a concessão para novas ofertas. Nunca recalcular ledger passado automaticamente.

Fora do escopo: alterar Pix, pedágio, saque, assinatura, bônus, fraude/KYC, valor bruto do passageiro, cobranças passadas, produção e consoles.
