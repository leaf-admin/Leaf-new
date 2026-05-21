# Playbook de Suporte Leaf

Versao: 0.2
Data: 2026-05-20
Objetivo: permitir que a Leaf contrate uma operacao terceirizada de suporte tecnico e de atendimento ao usuario com processo, limites, ferramentas, escalacoes e criterios de qualidade claros desde o primeiro dia.

## 1. Principios de Operacao

1. Segurança vem antes de SLA. Qualquer risco fisico, assedio, ameaca, acidente, violencia, roubo, fraude ativa ou exposicao de dados deve ser tratado como N1 e escalado sem aguardar confirmacao completa.
2. O ticket e a fonte de verdade do atendimento. Toda acao, evidencia, contato, decisao e handoff deve ficar registrado no ticket ou no incidente operacional.
3. O suporte terceirizado executa runbooks e triagem; a Leaf mantem propriedade de produto, dados sensiveis, risco, engenharia, seguranca e decisoes fora da matriz.
4. N1/N2/N3 na operacao significam nivel de suporte; N1/N2/N3 no backend atual tambem aparecem como prioridade de ticket. Neste playbook, usamos ambos, mas a matriz deixa claro quando estamos falando de fila/prioridade e quando estamos falando de time responsavel.
5. Se houver duvida de severidade, classifique para cima e rebaixe depois. Durante incidente nao se debate prioridade.
6. Nenhum agente deve pedir senha, codigo OTP, token Pix, documento completo fora do fluxo autenticado, dados completos de cartao ou credenciais internas.
7. Dados pessoais sensiveis de motorista, como CPF, nascimento, nome da mae, CNH, CRLV, antecedentes e biometria/KYC, so podem ser vistos por perfis autorizados e com motivo registrado.
8. O suporte nunca altera diretamente banco, Redis, Firebase, pagamento ou status de corrida fora de ferramenta aprovada.
9. Toda solucao precisa ser reprodutivel por runbook, artigo de base de conhecimento ou issue tecnica.
10. O fornecedor deve ser medido por qualidade de triagem, seguranca, aderencia a processo e satisfacao, nao apenas por volume fechado.

## 2. Escopo do Suporte

### 2.1 Personas atendidas

- Passageiro: login, cadastro, corrida, pagamento, reembolso, recibo, avaliacao, suporte durante viagem, objeto perdido, privacidade e seguranca.
- Motorista: cadastro, KYC, documentos, veiculo, plano/assinatura, ficar online, receber/aceitar corrida, iniciar/concluir corrida, ganhos, saldo, saque, incidentes e avaliacao.
- Operacao interna Leaf: acompanhamento de incidentes, fila, documentos, geofence, observabilidade, filas tecnicas e comunicacao com engenharia.

### 2.2 Fora do escopo do N1 terceirizado

- Alteracao manual de saldo, split, charge, refund fora da politica.
- Aprovar KYC/documentos sem evidencias completas.
- Suspender ou desbloquear usuario/motorista fora de runbook autorizado.
- Alterar configuracao de geofence, cidades, politicas operacionais, promocao ou assinatura sem aprovacao N2.
- Acessar dados pessoais sensiveis sem ticket, justificativa e permissao.
- Confirmar incidente de seguranca da informacao ou comunicacao a regulador. Isso e N3/Security/Legal.
- Rodar scripts, consultas diretas, mutacoes em Firebase/Redis/producao.
- Declarar causa raiz tecnica sem validacao N2/N3.

## 3. Modelo N1/N2/N3

### 3.1 N1: atendimento, triagem e resolucao por runbook

Responsabilidades:

- Receber contatos em app/chat/ticket/e-mail/telefone/social.
- Autenticar o usuario de forma leve e segura.
- Classificar persona, assunto, cidade/regiao, prioridade e impacto.
- Coletar evidencias minimas.
- Resolver duvidas e problemas previstos em base de conhecimento.
- Abrir/atualizar ticket no painel de suporte.
- Assumir ticket, responder, acompanhar SLA e escalar com handoff completo.
- Encaminhar social para canal autenticado quando houver dados pessoais.
- Usar macros aprovadas e registrar todas as acoes.

Permissoes recomendadas:

- Ver tickets e chat.
- Ver perfil basico de usuario.
- Ver resumo de corrida e recibo sem dados sensiveis.
- Ver status publico de documento/KYC sem abrir imagens/documentos sensiveis.
- Abrir ticket, responder, assumir, escalar.
- Solicitar reenvio de instrucoes, orientacoes de app e base de conhecimento.

Nao deve ter:

- KYC documental completo.
- Acoes financeiras mutaveis.
- Bloqueio/desbloqueio de passageiro.
- Suspensao/desuspensao de motorista.
- Geofence mutavel.
- DLQ, workers, runtime flags mutaveis.

### 3.2 N2: suporte tecnico/operacoes

Responsabilidades:

- Analisar casos escalados com evidencias.
- Validar logs de painel, observabilidade, fila, metricas e estado operacional.
- Resolver casos de pagamento/reembolso dentro de matriz aprovada.
- Operar disputas, incidentes nao criticos, watchlist/bloqueio com justificativa.
- Revisar documentos/KYC quando permitido.
- Confirmar bugs e abrir issue para engenharia.
- Criar/atualizar artigos da base.
- Auditar amostra de N1.
- Conduzir comunicacao operacional em incidentes P1/P2.

Permissoes recomendadas:

- Tudo do N1.
- Ver detalhes de motorista/documentos quando necessario.
- Executar assign/escalate/resolve.
- Criar disputa e aplicar decisao conforme politica.
- Acknowledge/resolver incidente operacional nao critico.
- Aplicar watchlist/soft block com evidencias.
- Operar notificacoes e comunicados aprovados.

### 3.3 N3: engenharia, SRE, seguranca, risco e produto

Responsabilidades:

- Corrigir bug, dados, infraestrutura, integrações, pagamentos e WebSocket.
- Atuar em incidentes SEV1/SEV2.
- Decidir rollback, feature flag, hotfix e mitigacao tecnica.
- Conduzir RCA/postmortem.
- Decidir casos de seguranca da informacao, LGPD/ANPD, fraude estruturada e abuso complexo.
- Aprovar alteracoes em runbooks e limites de automacao.

Permissoes:

- Acesso tecnico controlado por trilha de auditoria, break-glass e menor privilegio.
- Acoes diretas em producao apenas por processo de incidente/mudanca.

## 4. Prioridade, SLA e Estado do Ticket

### 4.1 Prioridade operacional

| Prioridade | Definicao Leaf | Exemplos | Time minimo | SLA atual no backend |
|---|---|---|---|---|
| N1 | Urgente/critico | risco fisico, SOS, assedio, acidente, app fora, pagamento amplo indisponivel, vazamento de dados, corrida presa afetando seguranca | N1 + N2 imediato, N3 se tecnico/seguranca | ack 5 min, primeira resposta 10 min |
| N2 | Alto impacto ou financeiro/safety sem emergencia | reembolso/disputa, cobrança indevida, motorista nao consegue operar, KYC bloqueando ativacao, falha regional parcial | N1 + N2 | ack 15 min, primeira resposta 30 min |
| N3 | Dúvida, erro isolado, solicitação comum | orientacao de app, recibo, alteracao cadastral simples, objeto perdido sem risco, atraso sem impacto financeiro | N1 | ack 60 min, primeira resposta 240 min |

O backend atual define estes SLAs em `leaf-websocket-backend/services/support-queue-service.js`.

### 4.2 Estados padrao

- `open`: novo ticket ainda sem dono.
- `assigned`: agente assumiu.
- `in_progress`: agente/N2 trabalhando. Se o painel ainda nao permitir esta transicao diretamente, use comentario interno e status disponivel.
- `escalated`: precisa de camada superior.
- `resolved`: resolucao enviada ao usuario; aguarda reabertura ou fechamento automatico.
- `closed`: caso encerrado.

### 4.3 Regras de SLA

- Primeira resposta nao e "ola, estamos vendo" vazio. Ela deve conter entendimento do problema, proximo passo e expectativa.
- Ack significa que alguem assumiu ou iniciou triagem. No painel novo, use "Assumir".
- Se aguarda usuario, registre pergunta objetiva e coloque status apropriado quando existir.
- Se aguarda terceiro, pagamento ou engenharia, registre dono e proxima atualizacao prometida.
- O SLA nao zera quando o ticket escala.
- Tickets N1 sem dono por mais de 5 minutos devem acionar N2/lider.
- Tickets N2 sem dono por mais de 15 minutos devem acionar lider de turno.
- N3 sem primeira resposta por 4 horas deve ser revisado no check de backlog.

## 5. Ferramentas

### 5.1 Painel Leaf

| Ferramenta | Caminho | Uso em suporte | Nivel |
|---|---|---|---|
| Suporte | `/support` | fila, SLA, assumir, escalar, resolver, responder ticket/chat | N1/N2 |
| Usuarios | `/users`, `/users/:id` | identificar passageiro/motorista, contato, status basico | N1/N2 |
| Motoristas | `/drivers` | status de aplicacao, aprovacao/rejeicao operacional | N2 |
| Fila de documentos | `/drivers/review-queue` | revisar pendencias documentais | N2/N3 conforme politica |
| Documentos do motorista | `/drivers/:id/documents` | CNH, CRLV, antecedentes, KYC, veiculo | N2/N3 com PII |
| Mapa | `/maps` | motorista online, demanda, geofence, cidade ativa | N1 leitura, N2 mutacao |
| Observabilidade | `/observability` | health, workers, DLQ, runtime, alertas, operacao | N2/N3 |
| Notificacoes | `/notifications` | comunicados operacionais aprovados | N2 |
| Assinaturas | `/subscriptions` | plano, cobranca recorrente, periodo gratis | N2 financeiro |
| Promocoes | `/promotions` | cupom/campanha/referral | N2/growth |
| Waitlist | `/waitlist` | fila de cidade/motorista | N1 leitura, N2 operacao |
| Relatorios | `/reports` | export/analise gerencial | N2/gestao |

### 5.2 Serviços e fontes tecnicas

- Tickets: `support_tickets` e mensagens via backend `routes/support.js`.
- Chat: `support-chat-service` e rotas `/api/support/chat/:userId`.
- Incidentes: `ops_incidents` e rotas `/api/ops/incidents`.
- Corridas: bookings/active rides, WebSocket e dashboard ride monitoring.
- Pagamentos: `routes/payment.js`, Woovi/OpenPix, webhooks e recibos.
- Motoristas/KYC: `driver-application-service`, `driver-document-analysis-queue`, `kyc-service`, `services/kyc-service`.
- Geofence/cidade ativa: `geofence-routes.js`, `operational-area-policy-service`.
- Observabilidade: `/metrics/observability`, `/monitoring/health`, worker health/lag/DLQ, alert-service.

### 5.3 Ferramentas externas recomendadas para terceirizacao

- Sistema de ticketing com SLAs, filas, macros, auditoria, campos obrigatorios e integracao com Leaf Dashboard.
- Canal interno de incidentes: Slack/Teams com sala por incidente.
- On-call/incident tool: PagerDuty, Opsgenie, incident.io ou equivalente.
- Status page: publico ou semi-publico para incidentes amplos.
- Base de conhecimento KCS: artigos versionados, donos e revisao por release.
- Gravacao/QA de atendimento onde permitido.
- Repositorio de issues tecnicas: Linear/Jira/GitHub Issues.
- Painel BI de suporte: backlog, SLA, CSAT, FCR, reabertura, top drivers de contato.

## 6. Dados Obrigatorios por Ticket

Todo ticket deve ter:

- Persona: passageiro, motorista ou interno.
- User ID, telefone/e-mail mascarado, cidade/regiao.
- Categoria: conta, corrida, pagamento, motorista/KYC, seguranca, bug, geofence, notificacao, promocao, assinatura, outro.
- Prioridade N1/N2/N3.
- Canal de entrada.
- Timestamp com timezone.
- App/OS/device/versao quando disponivel.
- Booking ID, charge ID, correlation ID, ticket relacionado ou incident ID quando aplicavel.
- Sintoma observado.
- Resultado esperado.
- Passos ja tentados.
- Evidencias: screenshot, recibo, log, mensagem de erro, localizacao aproximada, horario.
- Acao tomada.
- Proximo dono e proximo prazo.

Handoff para N2/N3 deve incluir:

```text
Resumo:
Persona:
Impacto:
Prioridade:
Usuario/driver:
Booking/charge/incident:
Cidade/regiao:
Inicio do problema:
Passos de reproducao:
Mensagem/erro:
Evidencias:
Ferramentas consultadas:
Hipotese:
Acao N1 ja executada:
Pedido objetivo para N2/N3:
Prazo prometido ao usuario:
```

## 7. Triagem Inicial N1

### 7.1 Checklist dos primeiros 90 segundos

1. Confirmar se ha risco fisico ou emergencia.
2. Identificar persona e se ha corrida em andamento.
3. Confirmar se o usuario esta autenticado no canal.
4. Capturar ID ou telefone/e-mail, sem pedir senha ou OTP.
5. Buscar ticket/corrida/usuario no painel.
6. Verificar se ha incidente conhecido em Observabilidade/Status.
7. Classificar prioridade.
8. Responder com proximo passo e expectativa.
9. Executar runbook ou escalar.

### 7.2 Arvore de decisao rapida

- Risco fisico, ameaca, acidente, violencia, assedio, roubo, SOS: N1, registrar incidente, acionar N2/lider, manter usuario acompanhado.
- App fora para muitos usuarios, pagamentos indisponiveis, corridas presas em massa: N1 tecnico, acionar N2/N3 e incidente.
- Corrida individual em andamento com problema operacional: N2 se afeta seguranca, pagamento ou continuidade da viagem.
- Pagamento/reembolso/disputa: N2 se ha valor ou cobranca; N1 coleta evidencias.
- Cadastro/documento de motorista: N2/KYC.
- Duvida, recibo, orientacao, objeto perdido simples: N3/N1.
- Bug sem workaround: N2 para validar e abrir issue.

## 8. Playbooks de Passageiro

### 8.1 Login, OTP e conta

| Cenario | Sinais | N1 | N2 | Ferramentas |
|---|---|---|---|---|
| Nao recebe OTP/SMS | usuario nao consegue entrar, muitas tentativas | orientar rede, numero correto, aguardar cooldown, nao pedir codigo | checar rate limit/auth, logs de auth, provedor SMS | Usuarios, logs auth, `/api/admin/auth`, Firebase Auth |
| OTP invalido | erro `INVALID_OTP` ou `AUTH/INVALID-VERIFICATION-CODE` | pedir novo codigo, orientar copiar sem espacos | investigar clock, numero, provider | App, Auth, friendly errors |
| Sessao expirada | 401, `TOKEN_EXPIRED`, app pede login | orientar login novamente | se recorrente, validar refresh token/API | Usuarios, auth-service |
| Conta com dados errados | nome/e-mail/telefone | orientar edicao no app se existir | alterar perfil apenas com politica e auditoria | Usuarios |
| Exclusao de conta | pedido formal | orientar canal/politica | acionar processo privacy/legal | Landing/legal, account routes |
| Suspeita de invasao | login desconhecido, troca de dados | N1, coletar evidencias, orientar troca de acesso | bloquear/forcar logout, Security | Usuarios, audit, Security |

Macros:

```text
Entendi. Para proteger sua conta, eu nunca vou pedir sua senha ou codigo SMS. Vou confirmar seu cadastro pelo canal autenticado e verificar o status da sua sessao. Se precisar de analise tecnica, deixo o ticket atualizado com o prazo da proxima resposta.
```

### 8.2 App, conexao e WebSocket

| Cenario | Sinais | N1 | N2/N3 | Ferramentas |
|---|---|---|---|---|
| Sem internet/local offline | `NETWORK_ERROR`, tela nao carrega | orientar rede, reiniciar app, trocar rede | se massivo, checar API e WebSocket | App, Observabilidade |
| WebSocket desconectado | chat/corrida nao atualiza | orientar reabrir app | checar socket admission, auth busy, Redis adapter | Observabilidade, metrics, backend logs |
| App crash | fechamento inesperado | coletar OS, versao, tela, passos | abrir issue com logs | Ticket, crash/logs |
| App lento | performance degradada | validar rede/aparelho | checar event loop, metrics, incidentes | Observabilidade |

Gatilhos N3:

- Erro repetido com mais de 5 tickets em 15 min.
- `socketAdmission` timeout, Redis error ou DLQ crescendo.
- Corridas ativas sem transicao por falha de backend.

### 8.3 Busca de destino, mapa, rota e geofence

| Cenario | Sinais | N1 | N2 | Ferramentas |
|---|---|---|---|---|
| Endereco nao encontrado | busca vazia ou endereco errado | pedir endereco completo/referencia | verificar Places cache/API | App, Places, logs |
| Origem/destino fora de area | `OUT_OF_COVERAGE`, `GEOFENCE_OUT_OF_COVERAGE` | explicar disponibilidade por cidade/regiao | verificar cidade ativa/geofence | Maps, Geofence |
| Rota estimada estranha | ETA/tarifa divergente | coletar origem/destino e screenshot | checar route cache, fare estimation | Maps, pricing |
| Cidade deveria estar ativa | usuario em area piloto | N1 coleta cidade/bairro | N2 valida configuracao | `/maps`, geofence admin |

Regra: N1 nao ativa cidade/geofence; somente N2 com aprovacao operacional.

### 8.4 Estimativa, tarifa e pagamento antes da corrida

| Cenario | Sinais | N1 | N2 | Ferramentas |
|---|---|---|---|---|
| Tarifa estimada parece alta | passageiro questiona valor | explicar estimativa, demanda, distancia | verificar fare snapshot/dynamic pricing | Pricing, metrics |
| Pix nao gera | erro no modal/pagamento | orientar tentar novamente e checar app atualizado | checar Woovi/OpenPix, create-charge | Payment, Woovi |
| Pix pago mas app nao confirma | `PAYMENT_NOT_CONFIRMED` | pedir comprovante, horario, valor, ID se houver | checar charge/status/webhook, reconciliar | Payment, Woovi, webhook |
| Pagamento duplicado | duas cobrancas | coletar comprovantes | criar disputa/reembolso | Payment, disputes |
| Pagamento bloqueia corrida | createBooking falha por pagamento | explicar que corrida so busca motorista apos confirmacao | validar charge/status | Payment, createBooking |

N1 pode:

- orientar nova tentativa;
- coletar comprovante;
- abrir ticket N2.

N1 nao pode:

- prometer estorno sem validar;
- alterar status de pagamento;
- pedir chave Pix completa por chat aberto.

### 8.5 Solicitar corrida e busca de motorista

| Cenario | Sinais | N1 | N2/N3 | Ferramentas |
|---|---|---|---|---|
| Nenhum motorista disponivel | `NO_DRIVERS_AVAILABLE`, busca encerra | orientar tentar novamente, conferir area/horario | verificar motoristas online e geofence | Maps, active drivers |
| Alta demanda/fila | `QUEUE_BACKPRESSURE`, retry-after | explicar sobrecarga e tentar em instantes | checar queue pending/worker | Observabilidade, queues |
| Busca nao para | app preso em solicitando | orientar fechar/reabrir app, abrir ticket | cancelar busca/checar booking preso se ferramenta existir | Active ride, backend |
| Motorista aceitou mas sumiu | ETA congelado, sem movimento | abrir chat/ligacao, coletar tempo | avaliar no-show/reassign/cancelamento | Trip status, chat |
| Corrida duplicada | duas solicitacoes | pedir nao criar novas | N2 valida idempotencia/supersede | Bookings, idempotency |

### 8.6 Corrida aceita, embarque e no-show

| Cenario | N1 | N2 | Ferramentas |
|---|---|---|---|
| Passageiro quer alterar ponto de embarque | orientar ajustar no app se disponivel; se nao, combinar via chat com motorista | se cobranca/rota mudar, abrir disputa | Chat, ticket |
| Motorista nao chegou | conferir ETA e contato; orientar esperar janela definida | no-show driver, reassign/cancel/refund conforme politica | Booking, tests no-show |
| Passageiro nao aparece | para motorista: orientar registrar pelo app, nao encerrar indevidamente | validar no-show, taxa e disputa | Driver chat, booking |
| Motorista recusa destino apos aceitar | coletar relato | N2 avalia conduta e possivel reembolso/acao no motorista | Ticket, rating, trust |
| Problema de comunicacao | chat/ligacao falha | orientar canal alternativo no app | checar suporte/chat/socket | Chat, WebSocket |

### 8.7 Viagem em andamento

| Cenario | N1 | N2/N3 | Ferramentas |
|---|---|---|---|
| Rota insegura ou errada | manter usuario acompanhado; se risco, N1 incidente | N2 safety; N3 se bug de rota | Support, incident, maps |
| Acidente | N1 emergencia, orientar autoridades locais, registrar incidente | N2/Safety acompanha; Legal se necessario | Ops incidents |
| Assedio/ameaca/violencia | N1, protocolo de seguranca, nao confrontar | Safety/Legal, possivel bloqueio | Incidents, trust |
| App nao deixa iniciar/concluir | coletar motorista/passenger, booking, status | N2 checa paymentStatus/state; N3 se bug | Booking, commands |
| Pagamento pendente ao iniciar | explicar bloqueio | N2 valida charge/webhook | Payment, StartTripCommand |

### 8.8 Cancelamento, taxa e reembolso

Base atual: `mobile-app/REFUND_POLICY.md`.

| Cenario | Elegibilidade inicial | N1 | N2 |
|---|---|---|---|
| Motorista cancela sem justificativa | reembolso/credito possivel | coletar booking e impacto | validar historico e processar conforme politica |
| Passageiro cancela antes de 2 min | geralmente sem taxa | orientar | validar se houve cobranca indevida |
| Passageiro cancela apos 2 min | pode ter taxa | explicar politica | revisar excecao se safety/tecnico |
| Problema tecnico impediu viagem | elegivel | coletar erro/screenshot | validar logs e reembolso |
| Servico nao prestado | elegivel | coletar relato/evidencia | disputa e decisao |
| Viagem realizada corretamente | nao elegivel | explicar com empatia | N2 se usuario contesta com evidencia |

Macro de negativa:

```text
Revisei as informacoes disponiveis da corrida. Pela politica atual, este caso nao se enquadra nos criterios de reembolso automatico. Se voce tiver uma evidencia adicional, como comprovante, print ou detalhe do ocorrido, eu posso anexar ao ticket para uma nova analise.
```

### 8.9 Recibo, avaliacao, reclamacao e objeto perdido

| Cenario | N1 | N2 | Ferramentas |
|---|---|---|---|
| Recibo nao aparece | orientar historico/atualizar app | checar receipt-service/PDF | Receipt, reports |
| Nota/avaliacao errada | orientar que feedback e registrado | N2 avalia abuso/alteracao somente se politica | Rating |
| Reclamacao de conduta | abrir ticket N2, coletar relato | Trust/Safety se grave | Support, incidents |
| Objeto perdido | coletar booking, objeto, contato seguro | N2 intermedia sem expor dados desnecessarios | Ticket/chat |

## 9. Playbooks de Motorista

### 9.1 Cadastro, documentos e KYC

| Cenario | N1 | N2/N3 | Ferramentas |
|---|---|---|---|
| CNH rejeitada por falta EAR | explicar motivo padrao e pedir CNH correta | revisar documento se contestado | Review queue |
| CNH vencida/invalida | orientar novo PDF/CNH-e | N2 valida imagem/PDF | Driver documents |
| CRLV invalido | orientar CRLV digital PDF | N2 valida licenciamento, ano, marca/modelo | Driver documents |
| Antecedentes ausente/invalido | orientar upload correto | N2 revisa certidao | Driver documents |
| Liveness/face falhou | orientar ambiente iluminado, camera limpa | N2 checa KYC service; N3 se bug | KYC service |
| KYC aprovado no app mas painel pendente | abrir N2 | recompute activation/status | Driver activation |
| Documento sensivel vazado em chat | N1 interrompe, orienta canal seguro | Security/Legal | Incident |

Regras:

- N1 nao aprova/rejeita documentos.
- Toda rejeicao deve usar motivo padrao claro.
- Documento sensivel nunca deve ser baixado fora de ambiente autorizado.
- URLs assinadas longas precisam ser tratadas como risco ate haver proxy autenticado.

### 9.2 Aprovacao, suspensao e ativacao de motorista

| Cenario | N1 | N2 | Ferramentas |
|---|---|---|---|
| Motorista aprovado mas nao consegue ficar online | checar status no app e documento pendente aparente | validar `approved`, `kyc_status`, ativacao e assinatura | Drivers, documents |
| Aplicacao rejeitada | explicar motivo registrado | reabrir analise se evidencia nova | Review queue |
| Motorista suspenso | informar que ha restricao e abrir ticket | revisar motivo, prazo e evidencias | Drivers complete |
| Motorista pede reativacao | coletar justificativa | N2 decide conforme politica | Drivers, trust |

### 9.3 Veiculo, categoria e elegibilidade

| Cenario | N1 | N2 | Ferramentas |
|---|---|---|---|
| Veiculo nao aparece | pedir relogar/atualizar | validar userVehicleId/config ativa | Driver documents |
| Categoria errada | coletar placa/modelo/ano | ajustar categoria se permitido | Vehicle config |
| Elite/Plus inconsistente | explicar regras | N2 valida `acceptPlusWithElite`, status e plano | Driver docs |
| Ano/modelo nao permitido | informar politica | N2 analisa excecao se houver | Review queue |

### 9.4 Plano, assinatura e periodo gratis

| Cenario | N1 | N2 | Ferramentas |
|---|---|---|---|
| Cobranca de assinatura contestada | coletar semana, valor, comprovante | validar subscription state/pagamento | Subscriptions |
| Periodo gratis nao aplicado | coletar campanha/referral | estender se elegivel | Subscriptions, promotions |
| Motorista bloqueado por cobranca | explicar status | N2 valida billing/reativacao | Subscriptions |
| Plano errado | coletar pedido | N2 altera se autorizado | Subscriptions |

N1 nao altera plano, isencao ou periodo gratis.

### 9.5 Conta Woovi/OpenPix, ganhos, saldo e saque

| Cenario | N1 | N2/N3 | Ferramentas |
|---|---|---|---|
| Subconta nao criada | coletar motorista, KYC, pix | N2 checa create-client/subaccount | Woovi driver |
| Saldo divergente | coletar corridas e periodo | N2 valida settlement/earnings | Driver balance, reports |
| Saque falhou | coletar withdrawal ID, horario | N2 valida password guard, pending withdrawals | Payment routes |
| Split nao caiu | coletar booking | N2/N3 valida webhook/distribution | Woovi, payment |
| Chave Pix errada | orientar fluxo seguro | N2 atualiza conforme politica | Woovi driver |

Regra: qualquer movimentacao financeira manual requer dupla aprovacao ou trilha de auditoria.

### 9.6 Ficar online, receber chamada e aceitar corrida

| Cenario | N1 | N2/N3 | Ferramentas |
|---|---|---|---|
| Botao online nao funciona | checar permissao localizacao, internet, app atualizado | validar eligibility, activation, subscription | Maps, drivers |
| Online mas nao recebe corridas | checar area, demanda, categoria, app em foreground | validar driver pool, availability snapshot, geofence | Maps, observability |
| Corrida some ao aceitar | coletar horario e booking | validar lock/reservation/supersede | Offer reservation |
| Aceite falha | coletar erro | N2 valida state manager/lock | Backend logs |
| Notificacao nao chega | orientar permissoes push | N2 checa FCM/token | Notifications/FCM |

### 9.7 Iniciar, concluir e receber corrida

| Cenario | N1 | N2/N3 | Ferramentas |
|---|---|---|---|
| Nao consegue iniciar | checar se chegou ao ponto, pagamento confirmado | N2 valida status `ARRIVED` e payment confirmed | StartTripCommand |
| Nao consegue concluir | coletar status, local, erro | N2 valida `CompleteTripCommand` | Booking/commands |
| Ganho nao aparece apos concluir | orientar aguardar processamento | N2 valida settlement e daily earnings | Earnings/report |
| Corrida ficou presa | N1 abre N2 | N2/N3 corrige estado com runbook aprovado | Ride health monitor |
| Reatribuicao confusa | explicar e registrar | N2 valida reassignment state | Ride lifecycle |

### 9.8 Cancelamento, no-show e conduta do passageiro

| Cenario | N1 | N2 |
|---|---|---|
| Passageiro nao apareceu | orientar usar fluxo no app, nao cobrar fora | validar no-show/taxa |
| Passageiro agressivo | N1 safety, incidente | trust/watchlist/block se confirmado |
| Motorista cancela por risco | registrar motivo | N2 avalia penalidade/isenção |
| Motorista cancelou indevidamente | coletar relato passageiro | N2 avalia acao educativa/suspensao |

## 10. Incidentes de Segurança e Safety

### 10.1 Categorias

- Safety fisico: acidente, violencia, assedio, ameaca, roubo, sequestro, passageiro/motorista em perigo.
- Fraude/abuso: chargeback, uso indevido, passageiro recorrente problemático, motorista manipulando corrida.
- Segurança da informação: vazamento de dados, acesso indevido, documentos expostos, conta invadida, token/API.
- Operacional: app fora, WebSocket indisponivel, pagamento fora, cidade/geofence errada, filas paradas.

### 10.2 Fluxo N1 safety

1. Permanecer no canal, responder com calma.
2. Perguntar se a pessoa esta em local seguro.
3. Orientar contato com autoridades/emergencia local quando necessario.
4. Registrar incidente no sistema.
5. Coletar o minimo: booking, local aproximado, envolvidos, descricao, evidencias.
6. Escalar para N2/Safety imediatamente.
7. Nao prometer punicao, reembolso ou resultado investigativo.
8. Registrar todos os tempos.

Macro safety:

```text
Sinto muito que isso esteja acontecendo. Sua seguranca vem primeiro. Se houver risco imediato, acione tambem as autoridades locais. Eu vou registrar este caso como prioridade maxima, manter o atendimento aberto e acionar nossa equipe de seguranca agora.
```

### 10.3 Segurança da informação e LGPD

Gatilhos:

- Documento pessoal exposto.
- Acesso indevido a conta.
- Vazamento de base, logs, chaves ou credenciais.
- Mensagem com dados sensiveis enviada ao canal errado.
- Suspeita de scraping, abuso de API ou token.

Acao:

- N1 classifica N1, nao investiga causa tecnica.
- N2/Security preserva evidencia e aciona N3.
- Legal/Privacy decide comunicacoes. A ANPD informa que incidentes de seguranca com risco ou dano relevante devem ser comunicados pelo controlador a ANPD e aos titulares em ate 3 dias uteis, salvo prazo especifico aplicavel.

## 11. Incidente Maior

### 11.1 Quando declarar

- App indisponivel para todos ou grupo relevante.
- Falha de pagamento ampla.
- Corridas presas em massa.
- Motoristas nao conseguem ficar online.
- WebSocket ou Redis com impacto de operacao.
- Vazamento ou risco de dados.
- Safety recorrente ou caso publico/reputacional.

### 11.2 Papeis

- Incident Commander: coordena, decide cadencia, prioriza.
- Tech Lead: diagnostico e mitigacao tecnica.
- Support Liaison: informa suporte, macros, status, volume de tickets.
- Comms Lead: status page, stakeholders, comunicacao externa.
- Scribe: linha do tempo, decisoes, acoes.
- Legal/Security: dados pessoais, regulatorio, risco.

### 11.3 Rotina

1. Detectar por monitoria, suporte ou usuario.
2. Abrir incidente e sala dedicada.
3. Classificar severidade.
4. Congelar comunicacao improvisada; usar macro oficial.
5. Atualizar suporte a cada 15-30 min em N1/SEV1 e 30-60 min em N2/SEV2.
6. Vincular tickets duplicados.
7. Mitigar antes de buscar causa perfeita.
8. Resolver, monitorar e enviar pos-comunicacao.
9. Postmortem sem culpa com action items.

## 12. Base de Conhecimento e Macros

Todo artigo deve conter:

- Sintoma.
- Publico afetado.
- Escopo/cidade/plataforma.
- Causa conhecida.
- Passos seguros para N1.
- Evidencias a coletar.
- Critério de escalação.
- Ferramentas.
- Macro aprovada.
- Dono.
- Data de revisao.
- Tags.

Macros obrigatorias:

- Login/OTP.
- Pix pago nao confirmado.
- Nenhum motorista disponivel.
- Area fora de cobertura.
- Motorista atrasado/no-show.
- Reembolso elegivel.
- Reembolso negado.
- Documento rejeitado.
- KYC em analise.
- Safety.
- Incidente tecnico conhecido.
- Aguardando engenharia.
- Encerramento/resolucao.

## 13. Qualidade, Auditoria e Governança do Fornecedor

### 13.1 Metricas

- CSAT e CES.
- First response time.
- Ack time.
- Tempo de triagem qualificada.
- Tempo de resolucao.
- SLA attainment por prioridade.
- FCR: resolucao no primeiro contato.
- Reopen/recontact em 7 dias.
- Escalation rate N1->N2 e N2->N3.
- Triage accuracy.
- Backlog aging.
- Tickets sem dono.
- Tickets por corrida e por motorista ativo.
- Top contact reasons.
- QA score.
- Uso/reuso de KB.
- Incidentes e recorrencia.
- MTTA/MTTR.

### 13.2 QA semanal

Amostra minima:

- 10 tickets N1 comuns.
- 10 tickets N2 financeiros/operacionais.
- 100% dos N1 safety.
- 100% dos tickets com dado sensivel.
- 100% dos tickets reabertos por erro de suporte.
- 5 chats aleatorios por agente.

Rubrica:

- Classificacao correta.
- Evidencias completas.
- Uso de ferramenta correta.
- Linguagem clara e empatica.
- Sem promessa indevida.
- Sem acesso indevido a PII.
- Handoff acionavel.
- Resolucao aderente a politica.
- Registro/auditoria suficientes.

### 13.3 Rotina de governança

- Daily de 15 min: backlog, N1/N2/N3, incidentes, gargalos.
- Weekly ops review: top motivos, bugs, QA, KB.
- Monthly business review: SLA, CSAT, custo por contato, melhorias.
- Quarterly access review: permissoes, agentes ativos, recertificacao.
- Revisao apos cada release: macros e artigos afetados.

## 14. Avaliação do Dashboard Atual

### 14.1 Veredito

O painel esta parcialmente adequado para suporte tecnico terceirizado. Ele ja tem as bases principais: suporte, chat, usuarios, motoristas, documentos, mapas, observabilidade, notificacoes, assinaturas, promocoes, waitlist e relatorios. Para contratar uma empresa amanha, porem, ele ainda precisa de segregacao de permissoes, auditoria forte e mascaramento/controle de dados sensiveis.

Nesta frente, foi feito um ajuste imediato na tela `/support`: a pagina agora usa fila de suporte, resumo de SLA, backlog, filtros por prioridade, assumir, escalar e resolver ticket. Isso reduz a lacuna mais direta para operacao N1/N2/N3.

### 14.2 Adequacao por necessidade

| Necessidade de terceirizacao | Estado atual | Risco | Recomendacao |
|---|---|---|---|
| Fila unica de tickets | Existe e foi reforcada na UI | Medio | manter `/support` como cockpit N1 |
| SLA visivel | Backend existia; UI agora mostra resumo | Baixo/medio | adicionar alertas visuais e notificacao de breach |
| Atribuicao/ownership | Backend existia; UI agora tem "Assumir" | Baixo | adicionar fila por agente/equipe |
| Escalacao | Backend existia; UI agora tem "Escalar" | Baixo | padronizar motivos de escalação |
| Resolucao | Backend existia; UI agora tem "Resolver" | Baixo | exigir macro/resolution code |
| Notas internas | Backend aceita `isInternal`; UI ainda nao tem fluxo | Medio | adicionar comentarios internos |
| Anexos/evidencias | Campos existem; UI limitada | Medio | upload/visualizacao controlada |
| Permissoes N1/N2/N3 | Papel `support` amplo | Alto | permissions granulares |
| PII/KYC | Exposto a perfis operacionais amplos | Alto | masking, proxy autenticado, approval logs |
| Auditoria de acoes | Logs dispersos | Alto | audit trail imutavel por acao |
| Incidentes safety | Backend ops/incidents existe | Medio | UI dedicada de incidentes e playbook |
| Financeiro/reembolso | Rotas existem; painel parcial | Alto | workflow de disputa/reembolso com aprovacao |
| Observabilidade | Boa base para N2/N3 | Medio | role guard; runbook por alerta |
| Base de conhecimento | Ainda nao integrada | Medio | macros/artigos vinculados ao motivo |

### 14.3 Riscos tecnicos encontrados

- `support` aparece em papeis operacionais amplos no backend; isso e excesso de privilegio para N1 terceirizado.
- O frontend esconde menus por papel, mas a protecao real precisa ser de backend e tambem de guardas de rota.
- Rotas de ops incluem `support` em papeis de mutacao; separar N1/N2/N3 antes de terceirizar.
- Documentos de motorista exibem PII sensivel; requer mascaramento e justificativa.
- URLs assinadas de documentos com vida longa devem virar proxy autenticado com TTL curto.
- Auditoria deve registrar ator real, ticket, antes/depois, motivo e correlation ID.
- Endpoints legados com `adminId = admin1` precisam usar `req.user`.

### 14.4 Backlog de prontidao

P0 antes de terceirizar:

1. Criar perfis granulares: `support_n1`, `support_n2`, `support_n3`, `support_lead`, `viewer`.
2. Bloquear KYC/documentos e mutacoes financeiras para N1.
3. Registrar audit trail para assign, escalate, resolve, KYC approve/reject, block/unblock, subscription, refund/dispute, geofence.
4. Mascarar PII por padrao.
5. Criar matriz de reembolso e disputa com limites por nivel.
6. Criar UI/fluxo de incidentes safety.
7. Treinar fornecedor e exigir certificacao no playbook.

P1 no primeiro mes:

1. Notas internas e anexos no suporte.
2. Macros e KB integradas ao motivo do contato.
3. Dashboard QA de fornecedor.
4. Status page e incidente maior.
5. Alertas automaticos de SLA breach.
6. Fila por cidade/regiao/persona.

P2 evolutivo:

1. Automacao N0/bot para duvidas comuns.
2. Agrupamento de tickets por incidente.
3. Analytics de top contact drivers.
4. Recomendacao de artigo por texto do ticket.
5. Score de risco para reembolso/fraude.

## 15. Checklist de Turno

Inicio:

- Verificar backlog por N1/N2/N3.
- Checar tickets sem dono.
- Checar SLA vencido.
- Checar observabilidade/health.
- Ler incidentes em aberto.
- Confirmar macros/incidentes conhecidos.
- Validar escala de N2/N3/on-call.

Durante:

- Revisar N1 a cada 15 min.
- Revisar N2 a cada 30 min.
- Atualizar incidentes na cadencia combinada.
- Agrupar duplicados.
- Sinalizar bug recorrente.

Fim:

- Zero N1 sem dono.
- Handoff de tickets em progresso.
- Lista de top motivos do turno.
- Incidentes/bugs abertos.
- Pendencias de usuario com prazo prometido.

## 16. Apendice Tecnico Leaf

### 16.1 Estados de corrida que o suporte deve reconhecer

Estados principais:

- `PENDING`: solicitacao criada ou aguardando fluxo inicial.
- `AWAITING_PAYMENT`: pagamento ainda precisa confirmar antes do despacho.
- `SEARCHING`: backend buscando motorista.
- `NOTIFIED`: motorista recebeu oferta.
- `AWAITING_RESPONSE`: oferta aguardando aceite/rejeicao.
- `ACCEPTED`: motorista aceitou.
- `ARRIVED`: motorista chegou ao embarque.
- `IN_PROGRESS`: viagem iniciada.
- `COMPLETED`: viagem concluida.
- `CANCELED`: viagem cancelada.
- `REJECTED`: oferta/corrida rejeitada.
- `REASSIGNMENT_PENDING`: aguardando reatribuicao.
- `EARLY_ENDED_REVIEW`: encerramento antecipado em revisao.

Regras de suporte:

- Passageiro em `AWAITING_PAYMENT` com reclamacao de "nao acha motorista" deve ser tratado primeiro como pagamento pendente.
- `SEARCHING` longo com `QUEUE_BACKPRESSURE` indica alta demanda/fila; N1 comunica, N2 confere fila e motoristas online.
- `ACCEPTED`/`ARRIVED` sem movimento exige checar ETA, chat, no-show e safety.
- `IN_PROGRESS` nao deve ser cancelado por N1; vira incidente operacional, safety ou encerramento assistido por N2/N3.
- `REASSIGNMENT_PENDING` exige explicar ao passageiro que o sistema esta tentando outro motorista e checar se houve cancelamento indevido.
- `EARLY_ENDED_REVIEW` e sempre N2/N3.

### 16.2 Codigos e sintomas frequentes

| Codigo/sintoma | Leitura operacional | Nivel |
|---|---|---|
| `VALIDATION_ERROR` | payload incompleto/invalido | N1 coleta dados; N2 se recorrente |
| `ACTIVE_RIDE_EXISTS` | usuario ja tem corrida ativa | N1 orienta abrir corrida ativa; N2 se corrida fantasma |
| `PAYMENT_REQUIRED` | pagamento obrigatorio antes do despacho | N1 orienta pagamento |
| `PAYMENT_NOT_CONFIRMED` | pagamento ainda nao confirmado | N2 se Pix pago com comprovante |
| `QUEUE_BACKPRESSURE` | fila/regiao em sobrecarga | N2 se recorrente/regional |
| `NO_DRIVERS_AVAILABLE` | sem motorista elegivel/disponivel | N1 orienta; N2 checa mapa/geofence |
| `OUT_OF_COVERAGE` / `GEOFENCE_OUT_OF_COVERAGE` | area inativa/fora de cobertura | N1 informa; N2 valida config |
| `AUTH_BUSY` / `AUTH_TIMEOUT` | auth/WebSocket sobrecarregado | N2/N3 se volume |
| `CHAT_NOT_AVAILABLE_YET` | chat de corrida ainda nao permitido | N1 explica regra |
| `CHAT_RIDE_CANCELED` | corrida cancelada bloqueia chat | N1 abre suporte/ticket |
| `CHAT_POST_TRIP_BLOCKED` | chat pos-viagem bloqueado exceto motivo permitido | N1 abre ticket, objeto perdido se aplicavel |

### 16.3 Estados de ativacao do motorista

- `PRE_REGISTERED`: pre-cadastro.
- `DRIVER_DOCS_PENDING`: documentos do motorista pendentes.
- `DRIVER_DOCS_IN_REVIEW`: documentos em analise.
- `VEHICLE_PENDING`: veiculo pendente.
- `VEHICLE_IN_REVIEW`: veiculo em analise.
- `APPROVED_NEEDS_LIVENESS`: aprovado, mas liveness pendente.
- `ACTIVE`: apto a operar se demais gates permitirem.
- `SUSPENDED`: suspenso.
- `REJECTED`: rejeitado.

Gates para ficar online:

- aprovado/ativo;
- KYC/documentos sem bloqueio;
- assinatura/billing elegivel;
- veiculo ativo e categoria compativel;
- localizacao atualizada;
- sem lock ou corrida ativa conflitante;
- cidade/geofence compatível.

### 16.4 Dominios tecnicos e runbooks associados

| Dominio | Arquivos-fonte de verdade | Cenario de suporte |
|---|---|---|
| Criação de corrida | `bootstrap/register-socket-create-booking-handler.js`, `commands/RequestRideCommand.js` | `PAYMENT_REQUIRED`, `ACTIVE_RIDE_EXISTS`, `QUEUE_BACKPRESSURE` |
| Aceite/rejeicao | `commands/AcceptRideCommand.js`, `services/offer-reservation-service.js` | oferta expirada, lock, motorista indisponivel |
| Estado da corrida | `services/ride-state-manager.js`, `services/ride-health-monitor.js` | transicao invalida, corrida presa |
| Despacho | `services/ride-queue-manager.js`, `services/gradual-radius-expander.js`, `services/driver-notification-dispatcher.js` | sem motorista, onda expirada |
| Pagamento | `routes/payment.js`, `routes/woovi.js`, `services/payment-service.js` | Pix pendente, webhook, refund |
| KYC | `services/driver-activation-state-service.js`, `routes/kyc-routes.js`, `routes/kyc-onboarding.js` | documento/liveness/ocr |
| Geofence | `routes/geofence-routes.js`, `services/city-activation-state-service.js` | cidade inativa, fora da area |
| Notificacoes | `bootstrap/register-socket-fcm-handlers.js`, `services/fcm-service.js` | token ausente, push nao chega |
| Chat | `bootstrap/register-socket-engagement-chat-handlers.js`, `routes/support-chat.js` | chat bloqueado/encerrado |
| Cancelamento | `bootstrap/register-socket-cancel-ride-handler.js`, `commands/CancelRideCommand.js` | refund, taxa, locks |
| Safety | `bootstrap/register-socket-safety-support-handlers.js`, `services/safety-incident-service.js` | emergencia, incidente, ticket N1 |
| Suporte | `routes/support.js`, `services/support-ticket-service.js`, `services/support-queue-service.js` | fila, SLA, assign/escalate/resolve |

## 17. Orquestrador de Agents

Esta secao define como conectar o suporte Leaf ao `leaf-support-agent-orchestrator` para triagem, roteamento e execucao assistida de chamados. O orquestrador deve operar primeiro como copiloto: ele classifica, recomenda, gera handoff e registra trilha de auditoria, mas so executa automaticamente acoes explicitamente permitidas.

### 17.1 Fluxo alvo

```text
Canal de entrada
-> normalizacao do ticket/chat
-> classificacao por playbook e guardrails
-> recomendacao N1, N2 ou N3
-> execucao assistida ou roteamento
-> validacao humana quando exigida
-> atualizacao do ticket
-> metricas, auditoria e melhoria do playbook
```

Fontes permitidas:

- Ticket, mensagens e chat vindo das APIs internas Leaf.
- Playbook versionado neste arquivo.
- Backlog de suporte via `/support/queue/backlog`.
- Redis/Socket.IO internos quando habilitados.
- Logs, metricas, traces e incidentes internos, quando expostos por ferramentas aprovadas.

Fontes proibidas:

- Internet livre.
- Dados fora do ticket sem necessidade operacional.
- Credenciais, OTP, tokens, documentos completos ou chaves Pix coletados em canal aberto.
- Mutacoes diretas em banco, Redis, Firebase, PSP ou producao.

### 17.2 Papeis dos agents

| Agent | Responsabilidade | Entrada | Saida | Pode executar |
|---|---|---|---|---|
| `classifier` | Classificar categoria, prioridade, nivel de suporte, confianca e flags de risco | ticket, mensagens, chat e playbook | `classification` | nenhuma acao externa |
| `n1-agent` | Gerar resposta, pergunta objetiva ou handoff N1 | `classification` e contexto do ticket | `recommendation.n1` | resposta sugerida; auto-resposta somente se permitido |
| `n2-router` | Roteamento especializado para pagamento, KYC, operacao ou suporte | `classification` | `recommendation.n2` | encaminhar fila e criar resumo humano |
| `n3-diagnostics` | Checklist tecnico, safety, fraude, risco e engenharia | `classification` e metadata | `recommendation.n3` | diagnostico e pedido objetivo; nao corrige producao sozinho |
| `reviewer/guardrails` | Validar risco, limite de confianca e autonomia | flags, confianca, modo de automacao | `canAutoReply`, `needsHuman` | bloquear automacao e exigir humano |

Regra de ouro: o resultado do orquestrador nao substitui propriedade humana em safety, fraude, LGPD, KYC, pagamento sensivel, reembolso, bloqueio, desbloqueio, geofence, incidentes ou qualquer acao destrutiva.

### 17.3 Contrato de entrada

O conector do dashboard, ticketing ou chat deve normalizar o chamado antes de enviar ao orquestrador. Campos desconhecidos devem permanecer em `metadata`; dados sensiveis devem ser mascarados.

```json
{
  "ticket": {
    "id": "SUP-123",
    "subject": "PIX pago mas app nao confirmou",
    "description": "Passageiro enviou comprovante e a corrida ficou em AWAITING_PAYMENT.",
    "category": "payment",
    "priority": "N2",
    "userId": "user_123",
    "user": {
      "id": "user_123",
      "type": "passenger",
      "city": "Sao Paulo"
    },
    "metadata": {
      "bookingId": "booking_123",
      "paymentId": "pay_123",
      "chargeId": "charge_123",
      "channel": "app_chat",
      "appVersion": "1.2.3",
      "platform": "ios",
      "openedAt": "2026-05-20T14:30:00-03:00"
    }
  },
  "messages": [
    {
      "senderType": "customer",
      "message": "Paguei no pix e ainda aparece aguardando pagamento.",
      "createdAt": "2026-05-20T14:31:00-03:00"
    }
  ],
  "chatMessages": []
}
```

Campos minimos para triagem:

- `ticket.id`.
- `ticket.subject` ou `ticket.description`.
- `ticket.category`, quando o sistema de origem ja tiver classificado.
- `ticket.priority`, quando existir.
- `ticket.userId` ou identificador equivalente.
- `metadata.bookingId`, `metadata.paymentId`, `metadata.chargeId`, `metadata.incidentId` ou `metadata.driverId` quando aplicavel.
- mensagens recentes do ticket ou chat.

### 17.4 Contrato de saida

O orquestrador devolve uma execucao (`run`) com classificacao, recomendacao e auditoria.

```json
{
  "id": "run_...",
  "createdAt": "2026-05-20T17:40:00.000Z",
  "source": "ticket",
  "ticketId": "SUP-123",
  "userId": "user_123",
  "classification": {
    "category": "payment",
    "priority": "N2",
    "supportTier": "N2",
    "confidence": 0.88,
    "riskFlags": ["payment"],
    "canAutoReply": false,
    "needsHuman": true,
    "playbookVersion": "0.2",
    "playbookReferences": [
      {
        "title": "8.4 Estimativa, tarifa e pagamento antes da corrida",
        "score": 7,
        "excerpt": "Pix pago mas app nao confirma..."
      }
    ],
    "rationale": [
      "Playbook encontrou cobertura relacionada.",
      "Sinais detectados: payment.",
      "Copiloto/handoff recomendado."
    ]
  },
  "recommendation": {
    "n1": {
      "action": "handoff",
      "reply": "Vou encaminhar seu caso para o time responsavel e manter o atendimento registrado no ticket."
    },
    "n2": {
      "route": "n2-payments",
      "action": "route_to_specialist",
      "humanSummary": "Revisar contexto do usuario, evidencias, historico e status operacional antes de responder."
    },
    "n3": null,
    "nextAction": "route_to_specialist"
  },
  "audit": {
    "playbookVersion": "0.2",
    "autonomousMode": false,
    "minConfidence": 0.72,
    "internetSearchUsed": false
  }
}
```

O consumidor deve gravar no ticket:

- categoria, prioridade e fila recomendada;
- resumo humano;
- referencias do playbook usadas;
- se houve ou nao permissao para auto-resposta;
- `run.id`, `playbookVersion`, `confidence` e flags de risco;
- proximo dono e prazo prometido.

### 17.5 Matriz de roteamento

Nesta matriz, `Nivel` significa `classification.supportTier`, ou seja, quem deve conduzir o atendimento. A prioridade operacional continua em `classification.priority`; por exemplo, safety e fraude devem sair como prioridade `N1`, mas com `supportTier` N3 para envolver Safety/Security/Engineering.

| Categoria | Flags ou sinais | Nivel | Fila/agent | Ação inicial |
|---|---|---|---|---|
| `general` | duvida, recibo, orientacao, objeto perdido simples | N1 | `n1-agent` | responder por macro ou pedir detalhe objetivo |
| `technical` | bug, erro, falha, WebSocket, Redis, timeout, app fora | N2 ou N3 se massivo | `n2-ops` ou `n3-engineering-safety` | coletar IDs, verificar incidentes e logs |
| `payment` | Pix, cobranca, charge, Woovi, OpenPix, reembolso, saldo, saque | N2 | `n2-payments` | validar comprovante, charge, webhook e politica |
| `driver_kyc` | documento, CNH, CRLV, antecedentes, biometria, cadastro motorista | N2 | `n2-driver-ops` | revisar status sem expor PII para N1 |
| `safety` | SOS, emergencia, acidente, assedio, ameaca, violencia, roubo | N3, prioridade N1 | `n3-engineering-safety` + Safety Lead | abrir incidente e acompanhar pessoa em risco |
| `fraud` | golpe, conta invadida, phishing, LGPD, vazamento, abuso | N3, prioridade N1 | `n3-engineering-safety` + Security/Legal | preservar evidencia, bloquear automacao e escalar |

### 17.6 Politica de automacao

O modo padrao e `SUPPORT_AUTONOMOUS_MODE=false`. Neste modo, o orquestrador nunca responde sozinho; ele gera sugestoes e handoffs.

Auto-resposta so pode ocorrer quando todos os criterios forem verdadeiros:

1. `SUPPORT_AUTONOMOUS_MODE=true`.
2. `confidence >= SUPPORT_MIN_CONFIDENCE`.
3. O playbook retornou referencia clara.
4. Nao ha flags `emergency`, `fraud`, `payment` ou `kyc`.
5. O caso nao envolve PII sensivel, documento, pagamento, conta invadida, reembolso, bloqueio, desbloqueio, safety, incidente ou producao.
6. A resposta usa macro aprovada e registra `run.id` no ticket.

Execucao automatica continua proibida para:

- alterar status de corrida;
- aprovar ou rejeitar KYC/documentos;
- processar reembolso, saque, split, chargeback ou ajuste financeiro;
- bloquear, desbloquear, suspender ou reativar usuario/motorista;
- alterar geofence, cidade, pricing, promocao ou assinatura;
- reiniciar servico, rodar script, mutar banco, Redis, Firebase ou PSP;
- fechar ticket sem criterio objetivo de resolucao.

### 17.7 Playbooks executaveis iniciais

#### Login, OTP e conta

```yaml
id: login_otp_account
category: general
owner_agent: n1-agent
support_tier: N1
required_context:
  - userId
  - phone_or_email_masked
  - platform
  - appVersion
  - errorCode
safe_actions:
  - ask_clarifying_question
  - suggest_macro
  - request_app_update_or_retry
escalate_when:
  - repeated_failure_same_user
  - multiple_tickets_in_15_minutes
  - suspected_account_takeover
approval_required_for:
  - force_logout
  - account_data_change
  - security_action
ticket_note_template: |
  Login/OTP triado. Dados coletados: userId, plataforma, versao, erro, tentativas e horario. Sem pedido de senha ou OTP.
```

#### Pix pago nao confirmado

```yaml
id: pix_paid_not_confirmed
category: payment
owner_agent: n2-router
route: n2-payments
support_tier: N2
required_context:
  - userId
  - bookingId
  - paymentId
  - chargeId
  - amount
  - paidAt
  - receipt_or_psp_reference
safe_actions:
  - collect_receipt
  - check_ticket_history
  - create_human_summary
  - route_to_specialist
blocked_actions:
  - confirm_payment_manually
  - promise_refund
  - alter_payment_status
escalate_to_n3_when:
  - more_than_5_payment_tickets_in_15_minutes
  - webhook_failure_detected
  - charge_status_inconsistent_between_leaf_and_psp
ticket_note_template: |
  Pix pago nao confirmado. Validar charge/status/webhook no PSP, bookingId e paymentId. Nao houve promessa de estorno.
```

#### Corrida presa ou estado inconsistente

```yaml
id: stuck_ride_state
category: technical
owner_agent: n2-router
route: n2-ops
support_tier: N2
required_context:
  - bookingId
  - userId
  - driverId
  - currentRideState
  - lastStateTransitionAt
  - paymentStatus
  - correlationId
safe_actions:
  - collect_context
  - check_known_incidents
  - create_handoff
  - route_to_specialist
blocked_actions:
  - cancel_in_progress_ride
  - mutate_ride_state
  - force_complete_trip
escalate_to_n3_when:
  - ride_in_progress_with_safety_risk
  - multiple_stuck_rides_same_window
  - invalid_transition_requires_backend_fix
ticket_note_template: |
  Corrida presa triada. Registrar estado atual, ultima transicao, paymentStatus, correlationId e impacto ao usuario.
```

#### KYC ou documento de motorista

```yaml
id: driver_kyc_document_review
category: driver_kyc
owner_agent: n2-router
route: n2-driver-ops
support_tier: N2
required_context:
  - driverId
  - documentType
  - applicationStatus
  - rejectionReason
  - submittedAt
safe_actions:
  - explain_public_status
  - request_resubmission
  - route_to_authorized_reviewer
blocked_actions:
  - open_sensitive_document_for_n1
  - approve_document
  - reject_document_without_policy_reason
escalate_to_n3_when:
  - suspected_pii_exposure
  - signed_url_leak
  - kyc_service_or_liveness_failure_massive
ticket_note_template: |
  KYC/documento triado. N1 nao acessou documento sensivel; caso enviado para fila autorizada.
```

#### Safety, SOS, acidente ou assedio

```yaml
id: safety_emergency
category: safety
owner_agent: n3-diagnostics
route: n3-engineering-safety
support_tier: N3
required_context:
  - ticketId
  - userId
  - bookingId
  - approximateLocation
  - involvedParties
  - immediateRisk
safe_actions:
  - keep_user_in_channel
  - advise_local_authorities_if_immediate_risk
  - create_incident
  - escalate_to_safety_lead
blocked_actions:
  - auto_reply_only
  - close_ticket
  - promise_punishment
  - expose_counterparty_contact
ticket_note_template: |
  Safety tratado como prioridade maxima. Registrar linha do tempo, risco imediato, envolvidos, bookingId e acionamento do lider/Safety.
```

### 17.8 Endpoints de integracao

Serviço local: `services/support-agent-orchestrator`
Porta padrao: `3015`
Token opcional: header `x-orchestrator-token` ou `Authorization: Bearer <token>`.

| Endpoint | Uso | Quando chamar |
|---|---|---|
| `GET /health` | Healthcheck simples | monitoria |
| `GET /v1/status` | Modo, playbook, polling e integracoes | dashboard e operacao |
| `GET /v1/runs` | Ultimas analises | auditoria e cockpit |
| `GET /v1/tickets/:ticketId/analysis` | Obter analise existente ou criar sob demanda | abrir ticket no painel |
| `POST /v1/tickets/:ticketId/analyze` | Forcar nova analise | apos novas mensagens/evidencias |
| `POST /v1/chat/analyze` | Analisar conversa enviada pelo caller | chat em tempo real |

Fluxo recomendado para o dashboard:

1. Ao abrir um ticket, chamar `GET /v1/tickets/:ticketId/analysis`.
2. Exibir categoria, prioridade, confianca, flags e playbook references.
3. Se `needsHuman=true`, mostrar a recomendacao como sugestao e exigir acao humana.
4. Se `canAutoReply=true`, permitir envio automatico apenas com macro aprovada.
5. Ao receber nova mensagem relevante, chamar `POST /v1/tickets/:ticketId/analyze`.
6. Ao rotear ou responder, gravar comentario interno com `run.id`.

### 17.9 Checklist de implantacao

MVP em modo copiloto:

1. Subir o orquestrador com `SUPPORT_AUTONOMOUS_MODE=false`.
2. Configurar `LEAF_API_BASE_URL`, `LEAF_API_TOKEN` e `SUPPORT_ORCHESTRATOR_TOKEN`.
3. Validar que `SUPPORT_PLAYBOOK_PATH` aponta para este arquivo.
4. Expor no dashboard a analise do ticket, sem envio automatico.
5. Rodar 50 tickets historicos e medir acuracia de categoria, prioridade e fila.
6. Ajustar palavras-chave e playbooks a partir dos erros de triagem.
7. Treinar N1/N2 para registrar `run.id` e corrigir classificacao quando necessario.

Piloto controlado:

1. Habilitar polling de backlog somente em uma fila ou cidade.
2. Criar painel diario de `confidence`, `needsHuman`, `canAutoReply`, escalacoes e reaberturas.
3. Permitir auto-resposta apenas para duvidas N1 sem flags de risco.
4. Revisar 100% das auto-respostas na primeira semana.
5. Bloquear automaticamente a autonomia se QA, CSAT ou reopen piorarem.

Producao gradual:

1. Separar credenciais e permissoes por ambiente.
2. Adicionar trilha de auditoria imutavel por run e por acao humana.
3. Criar fila de excecoes de baixa confianca.
4. Versionar mudancas do playbook com data, dono e motivo.
5. Revisar guardrails apos cada incidente, release ou novo produto.

## 18. Referencias

- Atlassian, severidade e processo de incidente: https://www.atlassian.com/incident-management/kpis/severity-levels e https://www.atlassian.com/incident-management/itsm/major-incident-management
- PagerDuty, severidade e regra de assumir o pior: https://response.pagerduty.com/before/severity_levels/
- NIST SP 800-61 Rev. 3, recomendações de resposta a incidentes: https://csrc.nist.gov/pubs/sp/800/61/r3/final
- Zendesk, politicas de SLA: https://support.zendesk.com/hc/en-us/articles/4408829459866-Defining-SLA-policies
- Freshdesk/Freshworks, SLA e priorizacao por tipo de problema: https://www.freshworks.com/helpdesk/sla/
- Intercom, FRT/NRT/TTC para conversas e tickets: https://www.intercom.com/help/en/articles/6546152-set-slas-for-conversations-and-tickets
- KCS, praticas de base de conhecimento: https://library.serviceinnovation.org/KCS/Knowledge-Centered_Success_Practices_Guide
- ANPD, comunicacao de incidente de seguranca: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
