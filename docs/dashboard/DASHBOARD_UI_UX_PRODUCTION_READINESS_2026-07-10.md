# Dashboard Leaf — relatório técnico de UI/UX

**Data:** 10 de julho de 2026

**Branch:** `codex/p0-p1-no-regression-hardening`

**Status:** aprovado na camada de UI/UX para o piloto controlado, condicionado ao dry-run operacional com um operador real.

## Resultado executivo

O dashboard deixou de funcionar como uma coleção de dados e passou a operar como um centro de decisão. A tela inicial apresenta uma prioridade dominante, quatro sinais essenciais e contexto secundário sob demanda. As demais superfícies seguem a mesma hierarquia: ação principal evidente, detalhes progressivos e confirmação explícita antes de mutações críticas.

Não há P0 visual ou de acessibilidade conhecido nesta rodada. A matriz final de Axe ficou zerada nos viewports de 390 × 844 e 1024 × 768, inclusive com disclosures abertos. O build de produção gerou 27 rotas e o smoke percorreu 24 rotas operacionais.

Nenhuma regra de taxa, split, pedágio, refund, saldo, saque, pricing, KYC ou lifecycle foi alterada.

## Diretriz de produto aplicada

O redesenho adotou cinco contratos:

1. Uma decisão dominante por contexto.
2. Até quatro sinais primários antes de detalhes secundários.
3. Progressive disclosure para configuração, payload técnico, filtros e métricas complementares.
4. Mutações relevantes passam por revisão e confirmação; leitura continua imediata.
5. Mobile troca densidade de workstation por master-detail, sem comprimir três painéis na mesma tela.

O sistema visual usa superfícies neutras quentes, verde Leaf como acento funcional, tipografia com hierarquia mais forte, bordas discretas, raios consistentes e movimento respeitando `prefers-reduced-motion`.

## Superfície revisada

| Domínio | Rotas | Estado de UI/UX | Contrato principal |
|---|---|---|---|
| Acesso | `/login` | consistente | entrada única, identidade Leaf e feedback de autenticação |
| Hoje | `/dashboard` | pronto | uma prioridade, quatro sinais, contexto e diagnóstico sob demanda |
| Hoje | `/support` | pronto | fila, conversa e contexto; no mobile, somente um pane por vez |
| Hoje | `/maps` | pronto | mapa read-only por padrão, edição separada de publicação |
| Hoje | `/drivers/review-queue` | pronto | triagem sem aprovar/rejeitar diretamente na tabela |
| Operação | `/metrics`, `/metrics/history`, `/metrics/marketplace` | pronto | quatro sinais principais e detalhes progressivos |
| Operação | `/drivers`, `/users`, `/users/[id]` | pronto | busca com debounce, ações críticas agrupadas e confirmadas |
| Operação | `/drivers/[id]/documents` | pronto | decisão documental na ficha, com motivo e confirmação |
| Financeiro | `/financial-reconciliation` | pronto na UI | leitura resumida; execução manual exige confirmação |
| Financeiro | `/payment-runtime`, `/runtime-flags` | pronto na UI | sandbox como fluxo explícito; ativar/pausar passa por revisão |
| Financeiro | `/subscriptions` | pronto | configuração e ações financeiras em disclosures e dialogs |
| Financeiro | `/reports` | pronto | uma ação por relatório e download autenticado via API Leaf |
| Financeiro | `/financial-simulator` | feature-gated | rotulado como Labs e sem aparência de dado operacional real |
| Crescimento | `/campaign-center` | feature-gated | leitura primeiro; editor fechado e publicação confirmada |
| Crescimento | `/programs`, `/promotions`, `/waitlist` | pronto na UI | configuração separada da lista e mutações confirmadas |
| Crescimento | `/notifications` | pronto | fluxo Mensagem → Público → Revisar, sem audiência pré-selecionada |
| Sistema | `/observability` | pronto | incident-first, quatro sinais e detalhe técnico sob demanda |
| Sistema | `/audit` | pronto | filtros nomeados e tabelas navegáveis |

## Mudanças estruturais

### Navegação e shell

- Cinco grupos estáveis: Hoje, Operação, Financeiro, Crescimento e Sistema.
- Grupo ativo expandido e rota ativa marcada com `aria-current`.
- Sidebar mobile com `inert`, foco inicial, focus trap, Escape e restauração do foco.
- Topbar reduzida a contexto, runtime e identidade do operador.
- O conteúdo técnico foi retirado do primeiro nível de navegação visual.

### Centro de operação

- Hero “Atenção agora” alimentado pelo command center do backend.
- Uma única ação primária na primeira dobra.
- Quatro KPIs prioritários: corrida, oferta, suporte e pagamento pendente.
- Prioridades e contexto ao vivo separados para evitar repetição.
- Custos, canary, serviços e fontes ficaram dentro de diagnóstico progressivo.

### Mapa e geofence

- O navegador não carrega Google Maps; o mapa operacional usa dados Leaf/H3 e SVG.
- A região publicada real foi reconhecida como geofence composta: **22 áreas e 4.337 pontos**.
- O dashboard preserva o payload composto e renderiza uma amostra visual sem achatar ou apagar áreas.
- Edição por clique permanece disponível para um polígono simples.
- Em região composta, o mapa fica read-only e direciona para o editor de coordenadas equivalente e rotulado.
- “Revisar e publicar” fica desabilitado para rascunho inválido ou com menos de três vértices.
- A publicação exige dialog de revisão; cancelar não produz mutação.
- H3 não retroalimenta os próprios bounds e não intercepta cliques no modo de edição simples.

### Suporte

- Desktop mantém fila, conversa e contexto lado a lado.
- Mobile usa tabs Fila, Conversa e Contexto, com exatamente um pane visível.
- Selecionar um atendimento abre automaticamente a conversa.
- A lista tem scroll interno limitado ao viewport e não alonga a página indefinidamente.
- Composer, respostas rápidas e ações deixam de provocar overflow horizontal.
- Encerramento de chat continua protegido por confirmação.

### Decisões críticas

Foi criado um dialog comum com foco inicial, trap, Escape, retorno de foco, bloqueio de scroll e indicação de consequência. Ele protege, entre outros:

- publicação de geofence e ativação territorial;
- criação/ativação/pausa de perfil de pagamento;
- envio de notificação;
- decisões e solicitações documentais;
- bloqueio, suspensão e reativação de usuário;
- campanhas, promoções, programas e waitlist;
- ações de assinatura e execução financeira manual.

### Tabelas, formulários e acessibilidade

- As 24 tabelas presentes em 16 páginas têm um único owner de scroll.
- Todas as regiões roláveis são focusáveis e têm nome acessível.
- Buscas, datas, selects e filtros receberam labels persistentes ou `aria-label`.
- Payloads técnicos roláveis são regiões focusáveis e nomeadas.
- Contraste de texto secundário foi elevado para WCAG AA.
- Targets móveis relevantes passaram a ter ao menos 44 px.
- Conteúdo de `<details>` fechado é realmente removido do layout, inclusive quando o filho usa `display:grid` ou `display:flex`.
- Dialogs bloqueiam o scroll do documento e restauram os estilos no cleanup.

## Evidências visuais

Diretório local: `test-results/dashboard-uiux-20260710/`

- `dashboard-desktop-1440x900.png`
- `maps-desktop-1440x900.png`
- `maps-mobile-390x844.png`
- `support-mobile-390x844.png`
- `support-conversation-mobile-390x844.png`
- `campaign-tablet-1024x768.png`
- `driver-review-tablet-1024x768.png`
- `notifications-mobile-390x844.png`
- `subscriptions-mobile-390x844.png`
- `payment-runtime-desktop-1440x900.png`

As capturas foram feitas em sessão administrativa real, consumindo a API Leaf em modo read-only. Nenhuma ação de publicação, pagamento, aprovação documental, push ou alteração operacional foi confirmada durante a inspeção visual.

## Gates executados

### Automação

- `npm --prefix leaf-dashboard-js run qa:backoffice`
  - ESLint aprovado.
  - Next build aprovado: 27 páginas/rotas.
  - Smoke aprovado: 24 rotas.
- Smoke adicional da geofence composta:
  - read-only inicial;
  - preservação de duas áreas na fixture;
  - editor equivalente por coordenadas;
  - review aberto e cancelado;
  - zero mutações.
- Governança do repositório aprovada.
- Secret scan e hardcoded-secret guard aprovados.
- `git diff --check` aprovado.

### Acessibilidade e responsividade

- Axe WCAG 2A, 2AA, 2.1A e 2.1AA: **zero violações**.
- Viewports finais: 390 × 844 e 1024 × 768.
- Rotas com disclosures abertos: suporte, mapas, campanhas e financeiro.
- Rotas-base adicionais: dashboard, notificações e assinaturas.
- Sem overflow horizontal nas superfícies inspecionadas.
- Dashboard: uma ação primária e quatro sinais visíveis.
- Notificações: motorista e passageiro começam desmarcados.

## Estado de maturidade

### Maduro para o piloto

- arquitetura de informação e navegação;
- sistema visual e responsividade;
- hierarquia de cards e progressive disclosure;
- visualização e proteção da geofence composta;
- suporte mobile master-detail;
- guard rails visuais para mutações;
- acessibilidade WCAG da matriz auditada;
- smoke de rotas, contratos financeiros existentes e ausência de providers diretos no navegador.

### Requer dry-run antes de uso operacional amplo

- um operador deve executar tarefas reais controladas de suporte, documentos, geofence e payment runtime sem ajuda de engenharia;
- cada ação de mutação deve ser testada primeiro em sandbox/cohort, validando mensagem, consequência, auditoria e rollback;
- o fluxo de documento ainda expõe link assinado de storage como ação secundária; recomenda-se servir preview/download por endpoint Leaf antes da abertura ampla;
- dados apresentados pelo ambiente real ainda contêm backlog de suporte e documentos pendentes; são sinais operacionais, não regressões de UI.

### P2 estrutural

- centralizar o shell de navegação no layout do App Router para remover a repetição de `<AppNav />` entre páginas;
- converter as evidências responsivas principais em regressão visual automatizada;
- consolidar estilos legados duplicados de `globals.css` sem alterar o resultado aprovado;
- substituir gradualmente links externos de documentos por downloads mediados pela API Leaf.

## Riscos e rollback

O risco principal desta rodada é a amplitude visual: o sistema foi atualizado de ponta a ponta e depende do smoke expandido para impedir regressões. O risco funcional foi reduzido porque endpoints, payloads críticos e fórmulas financeiras foram preservados; mudanças de estado ganharam mais proteção, não menos.

Rollback: reverter o commit desta rodada restaura o dashboard anterior. Os novos componentes são aditivos e não alteram backend, mobile, KYC, Woovi ou infraestrutura. A referência histórica `codex/dashboard-consolidated-reference` permanece preservada apenas para consulta e não foi incorporada por cherry-pick.

## Fora do escopo desta rodada

- E2E físico bilateral da corrida, que permanece no checkpoint pausado.
- KYC/liveness.
- FCM e Live Activities.
- execução real de Woovi ou rotação de chave.
- mudança de regra financeira ou de negócio.
- deploy de produção.
