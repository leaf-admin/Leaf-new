# Auditoria UI/UX - Ciclo Completo (Cadastro -> Corrida -> Avaliação -> Suporte)

Data: 2026-05-04  
Escopo: `mobile-app` (fluxo `prototype` + telas de privacidade/conta)  
Benchmark de mercado: Uber e 99 (fontes públicas oficiais no final)

---

## 1) Resumo executivo

A base atual está funcional e já cobre quase todo o ciclo fim-a-fim, com boa evolução em estados de corrida, suporte e controles de conta. 

Diagnóstico geral desta rodada:

- Pontos fortes: fluxo de autenticação por telefone com bifurcação correta (`senha` para conta existente e `OTP` para primeiro acesso), card de corrida com estado compacto, suporte e chat dentro do contexto da corrida, exclusão de conta disponível em múltiplos pontos de navegação.
- Lacunas críticas de UX: excesso de variações de UI para o mesmo estado de corrida, acúmulo de CTAs simultâneos em alguns cards, inconsistência de semântica no onboarding (fluxo principal é telefone, mas ainda existe exigência forte de e-mail/senha em parte do cadastro de passageiro), e pontos de fragilidade na tela de privacidade (uso de `currentUser.id` como chave principal sem fallback robusto para `uid`).
- Risco operacional: médio. O produto não está “quebrado” no fluxo principal, mas há risco de fricção, erro humano e percepção de complexidade em cenários de rede degradada/estados transientes.

Score (0-5):

- Cadastro e autenticação: **3.8/5**
- Busca/aceite/início de corrida: **4.1/5**
- Corrida em andamento e mudanças de estado: **3.6/5**
- Recibo, avaliação e pós-corrida: **3.9/5**
- Suporte e resolução de incidentes: **4.0/5**
- Privacidade e exclusão de conta: **3.7/5**
- Coerência visual e clareza global de status: **3.5/5**

---

## 2) Pontos fortes validados

## 2.1 Autenticação por telefone com roteamento correto

- Fluxo já diferencia conta existente (`requiresPassword`) de primeiro acesso (`OTP`) em `PhoneInputStep`.
- Evidências:
  - `mobile-app/src/components/auth/steps/PhoneInputStep.js:277`
  - `mobile-app/src/components/auth/steps/PhoneInputStep.js:278`
  - `mobile-app/src/components/auth/steps/PhoneInputStep.js:313`

## 2.2 Recuperação inline de senha sem quebrar o fluxo

- Usuário existente consegue recuperar senha dentro da mesma etapa, reduzindo abandono.
- Evidências:
  - `mobile-app/src/components/auth/steps/PhoneInputStep.js:147`
  - `mobile-app/src/components/auth/steps/PhoneInputStep.js:162`

## 2.3 Exclusão de conta acessível na navegação ativa

- “Privacidade e exclusão” está no menu, perfil e settings; ação de exclusão chama endpoint dedicado.
- Evidências:
  - `mobile-app/src/screens/prototype/robotaxiMenuConfig.js:34`
  - `mobile-app/src/screens/prototype/RobotaxiProfileScreen.js:29`
  - `mobile-app/src/screens/prototype/RobotaxiSettingsScreen.js:140`
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:118`
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:159`

## 2.4 Ciclo de corrida com status compacto e playback

- Passageiro e motorista têm cards compactos por estado e playback de rota integrado no runtime.
- Evidências:
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:344`
  - `mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js:553`
  - `mobile-app/src/screens/prototype/prototypeRideRuntime.js:13989`
  - `mobile-app/src/screens/prototype/prototypeRideRuntime.js:14120`

## 2.5 Sinalização de conexão com estabilidade mínima

- Indicador de conexão já considera estabilidade temporal para evitar ruído visual.
- Evidências:
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:79`
  - `mobile-app/src/screens/prototype/prototypeConnectionStatus.js:117`

---

## 3) Gaps de UX (falhas unitárias por etapa)

## 3.1 Cadastro / onboarding

1. O fluxo principal comunica “telefone-first”, mas a etapa de passageiro ainda exige `E-mail + Senha + Confirmação + Termos` no mesmo bloco.
- Impacto: aumenta atrito no primeiro acesso e cria percepção de incoerência com a proposta “telefone + OTP”.
- Evidências:
  - `mobile-app/src/components/auth/steps/ProfileDataStep.js:180`
  - `mobile-app/src/components/auth/steps/ProfileDataStep.js:195`
  - `mobile-app/src/components/auth/steps/ProfileDataStep.js:262`

2. Etapa de e-mail para motorista é opcional (bom), mas copy e ordem podem induzir a sensação de cadastro longo.
- Impacto: queda de conversão no onboarding de motorista.
- Evidência:
  - `mobile-app/src/components/auth/steps/DriverEmailStep.js:19`

## 3.2 Corrida (passageiro)

1. Card de viagem mistura múltiplas ações secundárias e CTA final de suporte no mesmo contexto.
- Impacto: sobrecarga cognitiva e dúvida sobre “qual ação principal agora”.
- Evidências:
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:418`
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:699`
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:704`

2. Em estados de interrupção operacional, o volume de texto e opções no card cresce rápido.
- Impacto: leitura lenta em momento crítico da corrida.
- Evidência:
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:561`

## 3.3 Corrida (motorista)

1. Há coexistência de camadas diferentes para “estado de viagem” (banner, overlay compact/expanded e card transitório) dependendo de condições.
- Impacto: risco de ambiguidade de prioridade de ação.
- Evidências:
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:3181`
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:3196`
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:3217`

2. Card do motorista em modo expandido é rico (positivo), mas ainda muito denso em alguns estados.
- Impacto: pode reduzir velocidade de decisão em aceite/início/finalização.
- Evidência:
  - `mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js:708`

## 3.4 Suporte / pós-corrida

1. Existem múltiplos pontos de entrada para suporte (suporte, chat, reclamação, menu detail), com boa cobertura, porém sem priorização explícita por severidade.
- Impacto: usuário pode abrir canal menos adequado para o tipo de incidente.
- Evidências:
  - `mobile-app/src/screens/prototype/RobotaxiSupportScreen.js:24`
  - `mobile-app/src/screens/prototype/RobotaxiSupportScreen.js:133`
  - `mobile-app/src/screens/prototype/RobotaxiComplainScreen.js:111`

2. Avaliação já é robusta, mas usa payload expandido com múltiplos campos e automação QA na tela final.
- Impacto: risco de manutenção/regressão sem contrato de UI simplificado.
- Evidências:
  - `mobile-app/src/screens/prototype/RobotaxiRatingScreen.js:233`
  - `mobile-app/src/screens/prototype/RobotaxiRatingScreen.js:114`

## 3.5 Privacidade / exclusão

1. Tela de privacidade usa `currentUser.id` em leitura/escrita de settings e download.
- Impacto: se perfil estiver apenas com `uid` (sem `id`), chamadas podem falhar silenciosamente e degradar UX.
- Evidências:
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:55`
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:67`
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:110`

---

## 4) Falhas combinadas (efeito cascata)

1. `Cadastro com fricção` + `múltiplos estados visuais na corrida`
- Resultado: usuário entra na corrida com menor confiança e maior chance de erro ao tomar ação crítica.

2. `Conectividade oscilante` + `sobreposição de camadas (banner + overlay + cards)`
- Resultado: percepção de “app instável”, mesmo quando o backend mantém estado correto.

3. `Suporte multicanal sem triagem forte` + `eventos operacionais complexos`
- Resultado: tickets mal classificados e mais tempo médio para resolução.

4. `Privacidade dependente de id` + `conta autenticada por uid`
- Resultado: risco de quebra de operações de privacidade fora do caso feliz.

---

## 5) Comparativo objetivo com Uber e 99

Referência de mercado observada (fontes oficiais públicas):

- Uber enfatiza fluxo com tracking, compartilhamento de viagem, toolkit de segurança e avaliação ao final da corrida.
- 99 enfatiza segurança in-app, compartilhamento em tempo real, centro de ajuda com trilhas de problema e orientação operacional para motorista.

### 5.1 Onde estamos alinhados

1. Tracking e status de corrida com foco no mapa.
2. Fluxo de suporte dentro do app (chat/ticket/incidente/reclamação).
3. Controles de privacidade com opção de exclusão de conta dentro do app.

### 5.2 Onde ainda estamos abaixo

1. Priorização visual da ação principal por estado ainda pode ficar ambígua em alguns cenários.
2. Onboarding de passageiro mais denso que o padrão phone-first percebido em apps líderes.
3. Jornada de suporte com muitos canais paralelos e pouca triagem guiada por severidade.
4. Estrato de UI do fluxo prototype com alta complexidade condicional (custo de manutenção/performance).

---

## 6) Backlog priorizado desta auditoria

Legenda:
- Impacto: `Alto | Médio | Baixo`
- Esforço: `P | M | G`
- Tipo: `UX`, `UI`, `Fluxo`, `Confiabilidade`, `Compliance`

## P0 (executar primeiro)

1. `UX-P0-01` Unificar onboarding phone-first sem ambiguidade
- Tipo: UX/Fluxo
- Impacto: Alto
- Esforço: M
- Ação: para passageiro, manter login por telefone como núcleo e mover e-mail para etapa opcional pós-cadastro (ou explicar claramente que e-mail é apenas para recibo/recuperação, não para login).
- Aceite: usuário entende em 1 tela que login sempre é por telefone.
- Evidência técnica base:
  - `mobile-app/src/components/auth/steps/PhoneInputStep.js:277`
  - `mobile-app/src/components/auth/steps/ProfileDataStep.js:180`

2. `UX-P0-02` Hierarquia única de CTA por estado da corrida
- Tipo: UX/UI
- Impacto: Alto
- Esforço: M
- Ação: em cada estado (`accepted`, `arrived`, `started`, interrupção), limitar 1 CTA primário + 1 secundário; demais ações em overflow.
- Aceite: nenhuma tela de corrida exibe mais de 2 ações principais simultâneas.
- Evidência técnica base:
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:418`
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:704`
  - `mobile-app/src/screens/prototype/home/DriverLiveRideOverlay.js:619`

3. `UX-P0-03` Resolver ambiguidade entre banner/overlay/card no lado motorista
- Tipo: UX/Confiabilidade
- Impacto: Alto
- Esforço: M
- Ação: definir regra única de precedência visual (`trip overlay` > `transient card` > `banner`).
- Aceite: nunca coexistem duas superfícies competindo pela mesma ação primária.
- Evidência técnica base:
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:3181`
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:3196`
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:3217`

4. `UX-P0-04` Hardening da tela de privacidade para `uid/id`
- Tipo: Compliance/Confiabilidade
- Impacto: Alto
- Esforço: P
- Ação: normalizar `userIdentifier = currentUser.id || currentUser.uid` em todas as chamadas de privacy settings/download.
- Aceite: settings e download funcionam para perfis com `id` ausente.
- Evidência técnica base:
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:55`
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:67`
  - `mobile-app/src/screens/PrivacyPolicyScreen.js:110`

## P1 (sequência)

1. `UX-P1-01` Triagem guiada no suporte (incidente vs cobrança vs objeto perdido)
- Tipo: UX
- Impacto: Médio
- Esforço: M
- Ação: adicionar wizard curto de triagem antes de abrir canal, com prioridade automática.
- Aceite: taxa de ticket reclassificado cai.
- Evidência base:
  - `mobile-app/src/screens/prototype/RobotaxiSupportScreen.js:24`

2. `UX-P1-02` Simplificar copy operacional de estados críticos
- Tipo: UX/Conteúdo
- Impacto: Médio
- Esforço: P
- Ação: reduzir blocos longos em interrupção/continuidade para mensagens de 1-2 linhas + ação clara.
- Aceite: leitura completa em <3 segundos no estado crítico.
- Evidência base:
  - `mobile-app/src/screens/prototype/RobotaxiTripScreen.js:561`

3. `UX-P1-03` Contrato visual de métricas fixas (tempo, distância, valor)
- Tipo: UX/UI
- Impacto: Médio
- Esforço: M
- Ação: mesma ordem/label de métricas nos cards de motorista e passageiro.
- Aceite: sem troca de semântica percebida entre fases.

4. `UX-P1-04` Consolidar pontos de entrada para avaliação e pós-corrida
- Tipo: Fluxo
- Impacto: Médio
- Esforço: P
- Ação: unificar entrada principal via recibo + fallback contextual.
- Aceite: usuário não vê caminhos redundantes de avaliação.

## P2 (otimização)

1. `UX-P2-01` Acessibilidade (foco, contraste, leitura por screen reader)
- Tipo: UX/Compliance
- Impacto: Médio
- Esforço: G

2. `UX-P2-02` Auditoria de performance UI em iPad/tablet para folhas longas
- Tipo: UI/Performance
- Impacto: Médio
- Esforço: M

3. `UX-P2-03` Limpeza de caminhos QA/automação na camada visual de produção
- Tipo: Confiabilidade
- Impacto: Médio
- Esforço: G
- Evidência de complexidade:
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:79`
  - `mobile-app/src/screens/prototype/RobotaxiHomeScreen.js:1702`

---

## 7) Checklist global de execução (pronto para operação)

1. Executar `P0` em branch de estabilização UX.
2. Para cada item: implementar -> testar (iOS + Android + tablet) -> validar com evidência -> documentar no relatório de execução.
3. Rodar smoke E2E por papel (`customer` e `driver`) após cada item P0.
4. Fechar P1 na mesma cadência.
5. Consolidar P2 por pacote de otimização (sem bloquear release funcional).

---

## 8) Fontes públicas usadas no benchmark (Uber / 99)

Uber:
- https://www.uber.com/us/en/newsroom/ubers-new-safety-toolkit/
- https://help.uber.com/riders/article/how-to-add-a-rating-or-tip-for-a-ride?nodeId=747f72e2-b011-466c-a79f-7d2f3eb8f809
- https://help.uber.com/riders/article/how-to-share-your-trip-status?nodeId=c86c66b8-974c-43db-8a45-87fe9eaefd7d
- https://help.uber.com/riders/article/delete-my-uber-account?nodeId=4d252dc6-7373-405e-8f54-214fe2543dde

99:
- https://99app.com/ajuda/passageiro/
- https://99app.com/ajuda/motorista/para-onde-vamos/como-funciona-o-fluxo-da-corrida-no-app-da-99/
- https://99app.com/ajuda/passageiro/central-de-ajuda/quais-sao-os-canais-de-atendimento-da-99/
- https://www.99app.com/99-ajuda-seguranca/
- https://seguranca.99app.com/guia-da-comunidade-seguranca/
- https://99app.com/ajuda/passageiro/como-excluir-minha-conta/

---

## 9) Status de execução no backlog (2026-05-05)

Implementação por wave concluída:

- P0: DONE (`docs/RELATORIO_EXECUCAO_AUDITORIA_UI_UX_P0_2026-05-05.md`)
- P1: DONE (`docs/RELATORIO_EXECUCAO_AUDITORIA_UI_UX_P1_2026-05-05.md`)
- P2: DONE (`docs/RELATORIO_EXECUCAO_AUDITORIA_UI_UX_P2_2026-05-05.md`)

Resumo:
- A trilha de autenticação/corrida/pós-corrida/suporte foi revisada com foco em clareza de estado, redução de ambiguidade de CTA, acessibilidade e bloqueio de caminhos QA em runtime visual de produção.
- Evidências técnicas e testes por wave estão registradas nos relatórios acima para consolidação final da auditoria.
