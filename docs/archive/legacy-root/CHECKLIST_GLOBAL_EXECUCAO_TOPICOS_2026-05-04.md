# CHECKLIST GLOBAL DE EXECUCAO - TODOS OS TOPICOS

Data base: 2026-05-04
Escopo: mobile-app + leaf-websocket-backend + operacao de release (iOS/Android)
Objetivo: executar de ponta a ponta os topicos do diagnostico, com criterio de aceite e evidencia por item.

---

## 0) Como usar este checklist

- [ ] Definir owner por item (Eng Mobile, Eng Backend, QA, Produto, Release, Ops).
- [ ] Definir data alvo por item.
- [ ] Marcar evidencia obrigatoria no fechamento (link de PR, log, video, screenshot, relatorio de teste).
- [ ] Nao pular gate de release: so promover apos checklist E2E e checklist de loja.

Campos sugeridos por item:
- Owner:
- Data alvo:
- Evidencia:
- Status: `todo | doing | done | blocked`

---

## 1) Wave 0 - Preparacao e governanca (D0-D1)

### W0-01 Ambiente e freeze controlado
- [ ] Congelar novas features fora deste plano ate finalizar P0.
- [ ] Criar branch de estabilizacao para iOS e Android.
- [ ] Alinhar matriz de ambiente (`dev`, `staging`, `review`, `prod`) com flags explicitas.
Criterio de aceite:
- Existe branch de estabilizacao ativa e comunicada ao time.
- Flags criticas revisadas por ambiente.

### W0-02 Inventario de flags criticas
- [ ] Listar e validar flags/envs de auth, pagamento, geofence, maps, review.
- [ ] Garantir default seguro para release.
Criterio de aceite:
- Documento de configuracao por ambiente publicado.
- Build de release nao sobe com config insegura.

### W0-03 Matriz de teste obrigatoria
- [ ] Publicar matriz minima de testes por fluxo (passageiro, motorista, suporte, pagamento, cancelamento).
- [ ] Definir devices obrigatorios: iPhone + iPad + Android phone.
Criterio de aceite:
- Matriz publicada e vinculada ao checklist de release.

---

## 2) Wave P0 - Bloqueadores de compliance, receita e seguranca funcional (D1-D5)

### P0-01 Exclusao de conta visivel no fluxo principal
- [ ] Expor "Excluir conta" em navegacao principal da UI ativa (nao apenas em tela secundaria dificil).
- [ ] Garantir caminho curto e claro (2-3 toques max).
- [ ] Validar fluxo completo: iniciar exclusao -> confirmar -> sucesso -> logout/reset.
Criterio de aceite:
- Opcao visivel no menu principal de conta.
- Exclusao funciona em ambiente de review.
- Gravacao do fluxo pronta para App Review.

### P0-02 Texto e credenciais de review (sem email)
- [ ] Atualizar instrucoes de App Review para login por telefone + senha.
- [ ] Validar credenciais de passageiro e motorista antes de submeter.
- [ ] Incluir passo a passo de login e troca de perfil no texto de review.
Criterio de aceite:
- Apple/Google conseguem autenticar com as credenciais informadas.
- Sem referencia a email onde o app nao usa email.

### P0-03 Desligar auto confirmacao QA no fluxo principal
- [ ] Remover/condicionar `qaAutoConfirmPix = true` para nao entrar em release.
- [ ] Garantir que confirmacao de pagamento de corrida real nao ocorre por bypass local.
Criterio de aceite:
- Build release nao auto confirma PIX.
- Fluxo exige confirmacao real de pagamento.

### P0-04 Pagamento com backend como fonte da verdade
- [ ] Bloquear despacho de corrida com base apenas em `paymentStatus` vindo do cliente.
- [ ] Validar charge/payment no backend antes de promover corrida para busca/dispatch.
- [ ] Rejeitar `mock_review_*` fora de ambiente de review explicitamente autorizado.
Criterio de aceite:
- Corrida so entra em dispatch apos validacao server-side.
- Teste negativo: payload client forjado nao despacha corrida.

### P0-05 OTP bypass seguro por default
- [ ] Mudar default de bypass OTP para `false`.
- [ ] Exigir enable explicito por env e allowlist estrita.
- [ ] Auditar logs e bloquear uso indevido em release.
Criterio de aceite:
- Sem env explicita, bypass fica desativado.
- Numeros comuns nao aceitam OTP estatico.

### P0-06 Geofence/review bypass sob controle
- [ ] Revisar bypass por `APP_REVIEW`/env para nao contaminar release real.
- [ ] Garantir comportamento previsivel por ambiente.
Criterio de aceite:
- Review env funciona conforme esperado.
- Prod nao herda bypass de review.

### P0-07 Video de account deletion para App Review
- [ ] Gravar video em dispositivo fisico com: login -> navegacao -> exclusao completa -> confirmacao.
- [ ] Anexar video no campo correto em App Store Connect.
Criterio de aceite:
- Video anexado e citado nas notas de revisao.

---

## 3) Wave P1 - Backend source of truth e consistencia de plataforma (D5-D10)

### P1-01 Encerrar fallback Google direto no cliente (release)
- [ ] Remover fallback cliente-direto para Directions/Places no fluxo padrao de release.
- [ ] Forcar chamada backend autoritativa para rota, autocomplete e details.
- [ ] Definir fallback funcional controlado pelo backend (cache/estimativa) sem chamada direta do app.
Criterio de aceite:
- Telemetria mostra 0 chamadas diretas do app para Google em release.
- Custo/controle centralizados no backend.

### P1-02 Ajustar contrato de places/search
- [ ] Eliminar contrato que instrui "usar Google diretamente" no path principal.
- [ ] Retornar resposta padrao de backend (hit, miss, fallback interno controlado).
Criterio de aceite:
- Front nao depende de fallback externo direto.
- Erros de places nao quebram UX principal.

### P1-03 Localizacao de viagem: desativar broadcast global legado
- [ ] Remover ou bloquear handler legado que usa `io.emit` global para `tripLocationUpdated`.
- [ ] Manter canal por room/participantes da corrida.
Criterio de aceite:
- Nao existe emissao global de localizacao de viagem.
- Somente passageiro/motorista da corrida recebem updates.

### P1-04 Fluxo usuario existente sem senha
- [ ] Revisar estrategia quando telefone existe e `hasPassword=false`.
- [ ] Garantir UX sem dead-end (reset guiado simples e robusto).
Criterio de aceite:
- Usuario existente sem senha consegue entrar sem bloqueio confuso.

### P1-05 Consolidacao de rotas de suporte
- [ ] Definir rota canonica de suporte/chat/ticket.
- [ ] Evitar duplicidade funcional entre implementacoes legadas.
Criterio de aceite:
- Um unico fluxo canonico em producao.
- Sem ambiguidade de contrato entre cliente e backend.

---

## 4) Wave P2 - Robustez operacional, observabilidade e escala (D10-D20)

### P2-01 Observabilidade critica por fluxo
- [ ] Instrumentar funil: auth -> pagamento -> createBooking -> dispatch -> accept -> start -> complete.
- [ ] Dashboards de erro e latencia com alertas de regressao.
Criterio de aceite:
- Time detecta falha por etapa em minutos (nao horas).

### P2-02 SLOs minimos de operacao
- [ ] Definir SLO de login, createBooking, dispatch e atualizacao de localizacao.
- [ ] Configurar alerta para quebra de SLO.
Criterio de aceite:
- SLO e alerta ativos em ambiente de producao.

### P2-03 Higiene de backlog tecnico
- [ ] Revisar TODO/FIXME/HACK em modulos criticos.
- [ ] Remover ou ticketar cada item com prioridade e owner.
Criterio de aceite:
- Nenhum item critico sem dono e sem prazo.

### P2-04 Itens de seguranca/safety pos-aprovacao (gateado)
- [ ] Executar backlog de seguranca ja documentado somente apos gate definido.
- [ ] Aplicar waves de seguranca com smoke + rollback pronto.
Criterio de aceite:
- Itens P0/P1 de seguranca executados com evidencias de deploy seguro.

---

## 5) Checklist de falhas combinadas (prevencao de cascata)

### CF-01 Compliance + UX
- [ ] Validar que exclusao de conta esta acessivel na UI principal ativa.
- [ ] Validar fluxo completo com conta real de review.

### CF-02 Pagamento + Dispatch
- [ ] Teste negativo: cliente envia `paymentStatus=confirmed` sem pagamento real -> backend deve negar dispatch.
- [ ] Teste positivo: pagamento real confirmado -> dispatch ocorre normalmente.

### CF-03 Backend maps + custo
- [ ] Induzir falha de backend places/directions e validar fallback interno sem chamada direta do app.
- [ ] Confirmar budget guard ativo e telemetria de custo correta.

### CF-04 Auth + bypass
- [ ] Validar que OTP estatico nao funciona fora de ambiente autorizado.
- [ ] Validar numeros de teste somente em ambiente permitido.

### CF-05 Localizacao + privacidade
- [ ] Garantir que localizacao de corrida nao vaza para sockets/usuarios fora da corrida.
- [ ] Teste de isolamento de room com 3+ clientes conectados.

---

## 6) Paridade funcional com Uber/99 (baseline de categoria)

### PR-01 Onboarding/login
- [ ] Login principal por telefone + senha/OTP funcionando e claro.
- [ ] Mensagens de erro amigaveis e recuperacao de senha direta.

### PR-02 Tracking em tempo real
- [ ] Distancia/ETA atualizando no card apos aceite do motorista.
- [ ] Atualizacoes consistentes em rede real e rede degradada.

### PR-03 Pagamento confiavel
- [ ] Sem auto confirm QA em release.
- [ ] Confirmacao de pagamento validada no servidor antes de despacho.

### PR-04 Controles de conta
- [ ] Exclusao de conta acessivel dentro do app.
- [ ] Confirmacao de exclusao e saida da sessao funcionando.

### PR-05 Suporte e incidentes
- [ ] Abertura de ticket/chat/incidente funcionando.
- [ ] Evidencia de rastreabilidade no backend.

---

## 7) Checklist de QA E2E obrigatorio

### E2E-AUTH
- [ ] Telefone novo -> OTP -> onboarding completo.
- [ ] Telefone existente -> senha -> login direto.
- [ ] Reset de senha completo e re-login.

### E2E-RIDE-PASSENGER
- [ ] Buscar destino, estimar tarifa, pagar, solicitar corrida.
- [ ] Receber aceite, acompanhar chegada, iniciar e finalizar corrida.
- [ ] Recibo e avaliacao apos corrida.

### E2E-RIDE-DRIVER
- [ ] Ficar online, receber oferta, aceitar, navegar ate pickup.
- [ ] Iniciar corrida, atualizar localizacao, finalizar corrida.
- [ ] Ver saldo/ganho atualizado.

### E2E-SUPPORT-SAFETY
- [ ] Abrir ticket de suporte pelo app.
- [ ] Reportar incidente.
- [ ] Fluxo de emergencia com retorno de confirmacao.

### E2E-CANCEL-REFUND
- [ ] Cancelamento antes e depois do aceite.
- [ ] Regra de taxa e estorno conforme politica.

---

## 8) Checklist de submissao iOS (App Review)

### IOS-01 Build
- [ ] Build de release sem flags QA inseguras.
- [ ] Testado em iPhone e iPad.

### IOS-02 App Review Info
- [ ] Credenciais validas (telefone + senha) para passageiro e motorista.
- [ ] Passo a passo claro de login e teste dos dois fluxos.
- [ ] Link de exclusao de conta e caminho in-app descritos.
- [ ] Video de exclusao anexado.

### IOS-03 Smoke final
- [ ] Login review passageiro ok.
- [ ] Login review motorista ok.
- [ ] Abertura da opcao de exclusao no fluxo principal ok.

---

## 9) Checklist de submissao Android (Play)

### AND-01 Build
- [ ] Build de release alinhada com correcoes P0/P1.
- [ ] Testada em dispositivo fisico.

### AND-02 Videos de permissao
- [ ] Video foreground location limpo (sem flicker).
- [ ] Video background location limpo (sem flicker).
- [ ] Narrativa e passos coerentes com o fluxo real.

### AND-03 Politicas e formularios
- [ ] Declaracao de permissoes alinhada ao comportamento real.
- [ ] Justificativa de uso em primeiro e segundo plano consistente.

---

## 10) Gate Go/No-Go para release

### GO criterios obrigatorios
- [ ] 100% dos itens P0 = `done`.
- [ ] E2E minimo aprovado em iOS + Android.
- [ ] Sem bloqueador aberto de compliance loja.
- [ ] Sem bloqueador aberto de pagamento/auth/localizacao.

### NO-GO gatilhos
- [ ] Qualquer item P0 em `blocked`.
- [ ] Qualquer falha de login review.
- [ ] Opcao de exclusao de conta nao acessivel no fluxo principal.
- [ ] Qualquer bypass QA ativo em release.

---

## 11) Evidencias minimas por fechamento

- [ ] Link de PR por item tecnico.
- [ ] Print/video curto por item de UX/compliance.
- [ ] Resultado de testes E2E anexado.
- [ ] Registro de config final por ambiente (`review`/`prod`).

---

## 12) Resumo rapido de execucao (ordem recomendada)

- [ ] Dia 0-1: Wave 0 completa.
- [ ] Dia 1-5: P0 completo (compliance + auth + pagamento).
- [ ] Dia 5-10: P1 completo (backend source of truth + privacidade realtime).
- [ ] Dia 10-20: P2 completo (observabilidade + robustez operacional).
- [ ] Fechamento: checklist iOS + Android + gate Go/No-Go.

---

## 13) Addendum UX/UI - Auditoria ciclo completo (2026-05-04)

Referencia:
- [x] `docs/architecture/AUDITORIA_UI_UX_CICLO_COMPLETO_UBER_99_2026-05-04.md`

Itens P0 adicionados ao backlog global:
- [x] UX-P0-01 Unificar onboarding phone-first sem ambiguidade.
- [x] UX-P0-02 Hierarquia unica de CTA por estado da corrida.
- [x] UX-P0-03 Resolver ambiguidade entre banner/overlay/card no lado motorista.
- [x] UX-P0-04 Hardening da tela de privacidade para fallback `uid/id`.

Itens P1 adicionados ao backlog global:
- [x] UX-P1-01 Triagem guiada no suporte com prioridade automatica.
- [x] UX-P1-02 Simplificar copy operacional de estados criticos.
- [x] UX-P1-03 Contrato visual fixo de metricas (tempo, distancia, valor).
- [x] UX-P1-04 Consolidar pontos de entrada de avaliacao/pos-corrida via recibo.

Regra de execucao (mesmo padrão do checklist principal):
- [x] Executar item -> testar iOS/Android/tablet -> validar com evidencia -> documentar no relatorio de execucao.
