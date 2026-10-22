# Tarifa Leaf nas primeiras 25 conclusões no destino

## Objetivo e regra aprovada

Issue #405. Em 22/10/2026, Izaak aprovou R$ 0,99 da Leaf, com o custo Pix separado, nas primeiras 25 corridas concluídas no destino desde o cadastro. Cancelamentos e antecipações não consomem vagas. Vale para todos os motoristas, inclusive já cadastrados, sem término. Depois da 25ª, vale a tabela atual: R$ 0,79 / R$ 0,99 / R$ 1,49 / 3%, conforme a faixa.

Não há reprecificação passada, devolução de taxas antigas ou reinício da contagem na ativação. Na faixa de R$ 0,79, os R$ 0,99 aprovados representam aumento; a comunicação não pode prometer desconto em todas as corridas.

## Escopo implementado

Política, auditoria offline, contador e integração financeira no backend, **desligados por padrão**. O contexto nasce no servidor, de histórico verificado. Nenhum endpoint aceita `driverIntroFee` do cliente. `historyVerified` é pré-condição interna, não autenticação.

1. O dispatcher obtém a contagem por motorista e calcula a oferta. A cotação anterior do passageiro não conhece o motorista e não determina sua elegibilidade.
2. A reserva da oferta guarda contexto e estimativa. O CAS Lua existente verifica reserva/contagem e grava contexto, taxas e reserva do contador junto do booking. Oferta antiga não disputa novamente a última vaga.
3. Aceite, sync, conclusão, antecipação e recibo preservam a tarifa aceita. O snapshot final leva o contexto ao billing. Pix, pedágio, assinatura, reembolsos e limites financeiros mantêm os cálculos existentes.
4. A conclusão normal registra a avaliação e atualiza o contador antes de liberar o motorista. Cancelamento, antecipação pelo passageiro e encerramento com revisão liberam a reserva sem consumir vaga, após persistir o estado terminal.
5. BookingIds tornam repetições idempotentes. O contador satura em 25; a próxima oferta usa a tabela atual. Desligar a concessão não recalcula corridas aceitas.

## Armazenamento e recuperação

Redis é a autoridade no runtime. `driver_intro_fee:operational:<driverId codificado>` não tem TTL e guarda baseline histórico, até 25 bookingIds, contagem, referência da auditoria e eventual reserva/revisão. Sandbox não consulta nem altera esse estado.

A conclusão usa Lua limitado a 25 IDs: valida motorista, contexto, estado terminal e geração do dataset; deduplica, incrementa e guarda o checkpoint completo em `driver_intro_fee:pending_checkpoints`, atomicamente. A avaliação usa posição canônica do servidor, destino e idade da telemetria. O `endLocation` do celular não comprova chegada. Usa o limiar existente de `ride-early-end-service` (500 m por padrão).

O processador **existente** do outbox de finalização grava checkpoints em Firestore, coleção `driver_intro_fee_states`. Não há novo job, worker, dependência ou serviço de produção. A transação une IDs sem diminuir a contagem. O ACK só remove o checkpoint Redis se ele ainda for exatamente o processado, preservando conclusões concorrentes. O processamento continua após desligar a flag.

A regra final de negação do Firestore protege a nova coleção; clientes não escrevem contadores. A contagem independe do sucesso do ledger: conta conclusão elegível, não transferência financeira.

Primeiro acesso pode carregar checkpoint aprovado para a geração corrente. Conta antiga sem histórico inicializado gera erro, nunca zero. Conta Auth criada a partir do corte aprovado pode iniciar em zero, em transação. O corte pressupõe a janela sem corridas fora do contador descrita abaixo.

Um marcador persistente registra que o contador já foi carregado. Se desaparecer, um checkpoint Redis pendente pode restaurá-lo. Sem esse checkpoint, não se substitui estado usado por Firestore possivelmente atrasado. Mudança/perda da geração exige reconciliação; a autoridade existente verifica AOF, `noeviction`, memória e quarentena antes de novo aceite.

Queda entre estado terminal e contagem mantém a reserva: a próxima oferta tenta reparar a corrida. Booking expirado, geração alterada ou dados insuficientes exigem reconciliação manual. Nunca apagar a reserva para presumir zero. Perda integral do dataset não tem recuperação automática a partir de checkpoint incompleto.

Sem evidência de chegada, mantém-se a tarifa aceita e permite-se encerrar fisicamente a corrida, mas a elegibilidade financeira aguarda revisão antes de outra oferta. Isso não altera status da conta nem usa GPS simulado para bloquear motorista. Resolver exige histórico verificado e atualização consistente Redis/Firestore; este PR não cria console de revisão.

## Configuração e custo

- `DRIVER_INTRO_FEE_ENABLED=false` por padrão, propagado nos três gateways.
- `DRIVER_INTRO_FEE_HISTORY_CUTOFF`: data/hora ISO UTC do corte aprovado.
- Autoridade obrigatória: `KYC_ACTIVE_TRIP_AUTHORITY_MODE=redis_noeviction`, atestação/quarentena ativas e geração persistente válida. Os demais requisitos continuam no guard existente.
- Outbox de finalização ativo.
- **Incompatibilidade nesta versão:** `ENABLE_OPERATIONAL_REASSIGNMENT` e `ENABLE_MULTI_LEG_BILLING` precisam permanecer desligados. Transferem ownership e aplicam isenções por trecho; sua coexistência é recusada pelo validador e pelo serviço. Integração posterior deve preservar as isenções aprovadas.

Há leituras em cache miss, consulta Auth e duas leituras Firestore para estado novo (consulta + transação), além das transações por conclusão elegível e retries. Checkpoints podem agrupar conclusões. Depois de 25, não se criam gravações por conclusão. Não há varredura histórica por oferta. O custo não é fixo absoluto de uma leitura/uma escrita.

## Auditoria e histórico

A CLI abaixo só lê JSON local e escreve relatório em stdout. Não usa Firebase, Redis, credenciais ou provedores; não tem modo de aplicação:

```bash
node leaf-websocket-backend/scripts/audit-driver-intro-fee-history.cjs /caminho/absoluto/history.json > /caminho/absoluto/report.json
```

Input: `schemaVersion=1`, `exportedThrough`, `drivers[]` com `driverId`, `registeredAt`, `historyCompleteFromRegistration`; `rides[]` com bookingId, motorista, estado, datas e posição/destino. Preservar sinais de antecipação, settlement e namespace. Comprovar cobertura desde o cadastro, inclusive legados. Datas numéricas são milissegundos; timestamps Firestore aceitam `seconds`/`_seconds`.

A auditoria deduplica, separa sandbox/cancelamento/antecipação e aponta conflitos. Toda saída tem `requiresHumanVerification=true`: posição histórica persistida é indício, não telemetria independente. `eligibleCandidate=null` indica insuficiência. A CLI inclui SHA-256 do input.

Na coleta autorizada desta sessão: 7 motoristas atuais, 103 conclusões vinculadas, 86 candidatas no destino e 17 excluídas. Consultas legadas direcionadas não retornaram bookings. Exports/hashes estão fora do Git, com acesso restrito. **Nenhum backfill foi executado.** Atualizar a coleta no corte da ativação. Registros sintéticos antigos sem marcação explícita não foram silenciosamente descartados.

## Rollout proposto, sem execução em produção

1. Revisar PR, classificar histórico ambíguo e homologar contexto/net no ambiente real e app. Testes locais não comprovam aparelho/produção.
2. Com aprovação própria, pausar novas admissões, aguardar ofertas/corridas em andamento e drenar finalizações/checkpoints. Definir corte UTC nessa janela.
3. Recoletar histórico completo e gerar manifesto revisável: hash, contagem, baseline limitado a 25, auditoria, corte e geração. Resolver ambiguidades antes de emitir `historyVerified=true`.
4. Submeter manifesto/operações à aprovação de backfill. Aplicar condicionalmente, sem sobrescrever divergências, sem ledger/refund e com snapshot de recuperação. Conferir Redis/Firestore. Não limpar todo o Redis nem rotacionar a geração crítica para facilitar a promoção.
5. Com aprovação de deploy/ativação, publicar versão revisada, ativar em todos os gateways e reabrir admissões. Cadastro posterior ao corte pode iniciar em zero porque não houve conclusões fora do contador nessa janela.
6. Conferir oferta, aceite, conclusão, contador/checkpoint, billing e recibo. Em falha, desligar novas concessões preservando aceitas/dados/checkpoints.

Reativação após corridas com a flag desligada exige **nova reconciliação e novo corte**; elas também contam desde o cadastro. Reutilizar o corte antigo não atualiza histórico automaticamente. O serviço recusa histórico anterior ao novo corte.

## Validação, riscos e rollback

Unitários cobrem política, auditoria, contrato, dispatcher, aceite, encerramentos, billing, recibo, configuração e recuperação. O teste seguinte inicia Redis privado por socket Unix, sem listener TCP, com dados sintéticos e adaptador Firestore em memória:

```bash
ENV_FILE=/dev/null NODE_ENV=test node leaf-websocket-backend/scripts/tests/test-driver-intro-fee-redis.cjs
```

Verifica concorrência real Redis, 24 → 25 → oferta seguinte, duplicatas, cancelamento, antecipação, queda/retry, ACK concorrente, revisão, geração e rollback. Firestore real, host e aparelho ainda exigem homologação própria.

Riscos: classificação histórica, telemetria, recuperação do dataset e modos opcionais incompatíveis. Rollback: desligar `DRIVER_INTRO_FEE_ENABLED`, mantendo corte, geração, settlement e outbox para honrar aceitas. Reverter código inteiro só após drenar aceitas/checkpoints. Nunca apagar contadores ou recalcular ledger passado.

Fora do escopo: backfill/ativação/deploy, comunicação site/app, lojas, mudanças de Pix, pedágio, saque, assinatura, bônus, fraude/KYC, bruto do passageiro e cobranças passadas.
