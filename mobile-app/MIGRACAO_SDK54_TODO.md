# Migracao Expo SDK 54 - Checklist de Execucao

Data de inicio: 2026-03-16  
Branch de trabalho: `codex/migracao-expo-sdk54-zero-debito`  
Commit base (rollback): `a01b8f7`  
Tag de seguranca: `backup-pre-sdk54-20260316`

Objetivo: migrar de Expo SDK 52 para SDK 54, mantendo funcionamento geral do app e zerando debito tecnico relacionado a runtime, build e deprecacoes criticas.

## Regras da jornada

- [ ] Executar em passos pequenos e com validacao ao final de cada bloco.
- [ ] Nao avancar de fase com build quebrado.
- [ ] Registrar causa raiz e correcao de cada quebra relevante.
- [ ] Manter rollback rapido para o commit/tag base.
- [ ] Atualizar este checklist ao final de cada sessao.

## Fase 0 - Seguranca e baseline

- [x] Criar branch dedicada para migracao.
- [x] Criar tag de backup antes da migracao.
- [x] Confirmar que o workspace esta limpo antes de iniciar mudancas de dependencias.
- [x] Coletar baseline funcional do SDK 52.
- [x] Analisar logs das ultimas falhas EAS (Android/iOS) antes de novas execucoes.
- [ ] Gerar baseline de build Android (dev/preview).
- [ ] Gerar baseline de build iOS (dev/preview).
- [x] Consolidar baseline em um relatorio curto (`docs/migration-sdk54-baseline.md`).

## Fase 1 - Saneamento de debito tecnico pre-upgrade

- [x] Remover `overrides` globais de `react-native`/`metro` no root ou isolar para nao travar o mobile.
- [x] Corrigir dependencia faltante `expo-linear-gradient` ou remover imports nao usados.
- [x] Revisar `postinstall` (`scripts/fix-firebase-kotlin.js`) e remover chamada vazia.
- [x] Revisar plugins customizados e marcar quais sao realmente necessarios:
- [x] `withExpoModulesCoreFix` (necessario no SDK 52 pelo erro `components.release`; reavaliar remocao apos upgrade para 54)
- [x] `withGradleNodeFix` (necessario em monorepo para resolver `react-native` no `expo-dev-launcher`)
- [x] `withBoringSSLFix` (necessario no iOS/Xcode 26.2 para remover flags `-G*` em pods)
- [x] `withNetworkSecurityConfig` (necessario para trafego HTTP de homologacao/dev; revisar endurecimento na Fase 7)
- [x] Congelar imagens EAS para evitar variacao de ambiente (`latest` -> imagem explicita).
- [x] Rodar smoke de inicializacao apos saneamento.

## Fase 2 - Upgrade controlado SDK 52 -> SDK 53

- [x] Atualizar `expo` para SDK 53.
- [x] Rodar `expo install --fix` para alinhar pacotes suportados.
- [x] Atualizar `jest-expo` e `babel-preset-expo` para linha do SDK 53.
- [x] Validar `expo prebuild` sem erro (Android/iOS).
- [x] Corrigir quebras de compilacao.
- [ ] Rodar app em Android (dev-client) e validar fluxo minimo.
- [ ] Rodar app em iOS (dev-client) e validar fluxo minimo.
- [x] Registrar diff de dependencias e mudancas de codigo desta fase (`docs/migration-sdk53-phase2-2026-03-16.md`).

## Fase 3 - Upgrade controlado SDK 53 -> SDK 54

- [x] Atualizar `expo` para SDK 54.
- [x] Rodar `expo install --fix` para alinhar matriz oficial do SDK 54.
- [x] Atualizar novamente `jest-expo` e `babel-preset-expo` para linha do SDK 54.
- [x] Validar `expo prebuild` sem erro (Android/iOS).
- [x] Corrigir eventuais quebras de runtime e build.
- [ ] Validar build Android (preview/internal).
- [ ] Validar build iOS (preview/internal).

## Fase 4 - Limpeza de deprecacoes (zero debito tecnico)

- [ ] Migrar uso de `expo-av` para `expo-audio`/`expo-video` quando aplicavel.
- [ ] Enderecar APIs legadas de `expo-file-system` (migrar ou isolar em camada de compatibilidade).
- [ ] Atualizar handler de notificacao para opcoes modernas de apresentacao no iOS.
- [ ] Revisar warnings do `expo doctor` e zerar warnings bloqueantes.
- [ ] Remover excecoes antigas de `reactNativeDirectoryCheck` que nao forem mais necessarias.

## Fase 5 - Dependencias nativas fora da matriz Expo

- [ ] Validar compatibilidade da suite `@react-native-firebase` com RN do SDK 54.
- [ ] Validar `@react-native-google-signin/google-signin`.
- [ ] Validar `expo-text-recognition` (manutencao/compatibilidade real).
- [ ] Validar libs nativas de maior risco:
- [ ] `react-native-pdf`
- [ ] `react-native-blob-util`
- [ ] `react-native-elements`
- [ ] `react-native-vector-icons`
- [ ] `react-native-gifted-chat`
- [ ] Substituir ou atualizar bibliotecas sem manutencao comprovada.

## Fase 6 - Validacao funcional ponta a ponta

- [ ] Login e persistencia de sessao.
- [ ] Fluxo passageiro completo (origem -> corrida -> pagamento -> recibo).
- [ ] Fluxo motorista completo (online -> aceitar -> iniciar -> finalizar).
- [ ] Localizacao foreground/background.
- [ ] Push notifications (foreground, background, cold start).
- [ ] Upload de documentos (camera, galeria, PDF).
- [ ] Chat e websocket.
- [ ] Pagamentos e comprovantes.
- [ ] OTA (`expo-updates`) validado.

## Fase 7 - Hardening para producao

- [ ] Rodar regressao E2E principal.
- [ ] Auditar performance basica (tempo de abertura, uso de memoria, travamentos).
- [ ] Auditar crash-free em testes internos.
- [ ] Revisar seguranca de permissao e network config.
- [ ] Gerar changelog tecnico da migracao.

## Fase 8 - Go-live e rollback

- [ ] Publicar build interno final para QA/Stakeholders.
- [ ] Aprovar go-live com checklist de risco assinado.
- [ ] Publicar em producao de forma gradual.
- [ ] Monitorar 24-72h (crash, ANR, falhas de login, notificacao, localizacao).
- [ ] Definir criterio objetivo de rollback.
- [ ] Encerrar jornada com relatorio final.

## Criterios de conclusao (Definition of Done)

- [ ] Android e iOS buildando no SDK 54 sem workaround fragil.
- [ ] Fluxos criticos validados em dispositivo real.
- [ ] Sem deprecacoes criticas pendentes para SDK 55.
- [ ] Sem dependencia quebrada ou sem dono tecnico.
- [ ] Plano de rollback testado e documentado.
