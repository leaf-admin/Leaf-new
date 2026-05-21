# Canary test Leaf

Este checklist separa o que pode ser validado antes das builds do que precisa de app rodando em aparelho/simulador.

## 1. Preflight sem device

Rodar antes de gerar release:

```bash
npm run canary:preflight:non-device
```

O comando gera relatório em `reports/canary-preflight/<run-id>/report.md` e cobre:

- whitespace do diff;
- guardrails de rotas sensíveis;
- testes backend unitários e integração;
- copy e testIDs do mobile;
- unit tests mobile;
- preflight estático de release mobile;
- lint e build do dashboard;
- syntax check do orquestrador de suporte;
- dry-run de limpeza financeira de teste;
- reconciliação financeira live.

Flags úteis:

```bash
npm run canary:preflight:non-device -- --skip-mobile-unit
npm run canary:preflight:non-device -- --skip-backend-test
npm run canary:preflight:non-device -- --skip-financial-live
```

Use skip somente quando houver motivo claro, porque o canary de release deve partir de um `GO` completo.

## 2. Builds release

Depois do preflight sem device:

```bash
cd mobile-app
npm run build:local:android:release
npm run build:local:android:aab
npm run build:local:ios:simulator
```

Para IPA/archive, usar os scripts locais iOS conforme a necessidade da submissão.

## 3. Canary em app

Executar pelo menos um ciclo completo passageiro + motorista:

- abrir app sem tela transitória desidratada;
- login telefone + OTP;
- passageiro selecionar partida e destino;
- Pix criado, QR code exibido e status de pagamento confirmado;
- motorista ficar online;
- motorista receber nova corrida com valor, origem, destino, preferência e dados do passageiro;
- aceite de corrida;
- passageiro ver motorista, carro, placa, ETA e ações de segurança/suporte;
- motorista ver passageiro, rota, ETA, valor líquido e ações;
- chegada ao embarque;
- início da viagem;
- viagem em andamento;
- finalização;
- saldo do motorista aumentado;
- resumo do dia offline;
- avaliação final;
- reconciliação financeira sem divergência para a corrida canary.

## 4. Critério GO/NO-GO

GO:

- preflight sem device com status `GO`;
- Android release abre e completa canary;
- iOS release abre e completa canary;
- dashboard mostra a corrida canary sem divergência financeira;
- logs sem erro crítico em auth, pagamento, dispatch, push, socket e ledger.

NO-GO:

- qualquer falha de pagamento ou ledger;
- app preso em splash/loading;
- card sem informação obrigatória em estado principal de corrida;
- motorista não recebe oferta;
- passageiro/motorista entram em estados diferentes para a mesma corrida;
- reconciliação financeira divergente depois da finalização.
