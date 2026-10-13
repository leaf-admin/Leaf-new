# Configurações e voz — fechamento local da Leaf 1.0.6

## Objetivo

Fechar os controles restantes da nova superfície React Native e gerar candidatos completos iOS/Android, preservando Liquid Glass, os dados reais e as regras existentes.

## Escopo concluído

| Item | Implementação | Evidência |
|---|---|---|
| Notificações | Permissão real do sistema, acesso aos ajustes, solicitação após toque e registro FCM ao conceder | Testes de interface; estado desativado observado no simulador |
| Idioma | Português do Brasil para o piloto; nenhum seletor promete tradução incompleta | Configurações e confirmação percorridas no simulador |
| Trânsito | Preferência da conta, switch para motorista, respeitando a política existente do mapa | Teste com mudança do contexto e mapa memoizado; round trip autenticado HTTP 200 |
| Voz | Ponte AVSpeechSynthesizer/TTS, passos da navegação existente, sem nova API de rotas | Compilação iOS/Android; ponte/classe presente nos binários; testes de deduplicação e interrupção |
| Sessão | Cache por UID, cancelamento de respostas antigas, atualização confirmada pelo backend, erro e retry | Testes de leitura, escrita, corrida GET/PATCH e troca de conta |
| Build | Sincronização idempotente das fontes nativas em projetos já existentes; qualifier Android `pt-rBR` | Build nativo completo e teste de sincronização |

Voz é exclusiva do motorista, na navegação interna em primeiro plano. Para ao silenciar, trocar de conta, sair da navegação ou colocar o app em segundo plano. Android exige uma voz offline pt-BR instalada. O pacote nativo atualizado é necessário; versões antigas informam indisponibilidade. Áudio real, chamadas, Bluetooth e navegação bilateral ainda precisam de aceitação física.

O idioma foi limitado ao português do Brasil para o piloto, conforme a hipótese comunicada durante a execução. Inglês completo não foi implementado. Onboarding final e badges continuam com a decisão de adiamento anterior.

## Arquivos alterados

30 arquivos versionados e dois gerados no Android. Lista completa e hashes antes/depois: [settings-files-changed.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/settings-files-changed.json). Principais: `MobilePreferencesService`, novo `MobilePreferencesProvider`, `RobotaxiSettingsScreen`, `PrototypeMapLayer`, `RobotaxiHomeScreen`, `LeafVoiceGuidanceService`, hook de voz, quatro fontes nativas, plugin e scripts de build. Nenhuma dependência foi adicionada.

Código isolado nos commits `609fca2d3`, `d3f8e5f88` e `1097a27fc`, branch `codex/leaf-ui-rc-1.0.6`. Os 222 arquivos do manifesto do candidato coincidem entre o checkout principal e o RC. Nenhuma alteração de outra tarefa foi commitada na árvore principal.

## Testes executados

- Mobile completo: **177 suítes / 1.467 testes passaram**.
- Production guards, governança, scan de segredos, guard hardcoded, `git diff --check` e preflight de release: PASS.
- Canary de pagamento QA por usuário: PASS; ambiente global e regras de pagamento preservados.
- Archive iOS, exportação de distribuição e de desenvolvimento: PASS, **Team Leaf DTA8W5KA5D em app e widget**.
- AAB e APK Android: PASS; certificado coincide com o candidato Leaf anterior e App Links. O log de jarsigner preserva avisos sobre certificado próprio e leitura do layout JAR; `jar verified` retornou sucesso. Isso não substitui a validação da Play Store.
- Bundle iOS: PASS, 2.321 módulos.
- API real QA: GET/PATCH/GET/restauração/GET de trânsito, todos HTTP 200; valor original restaurado. Nenhuma corrida, pagamento ou perfil foi alterado.

A primeira compilação Android detectou o qualifier incorreto `pt-BR` produzido pelo prebuild. O plugin e o sincronizador agora normalizam para `pt-rBR`; o build final passou. As primeiras execuções unitárias detectaram fixtures antigas e um teste que não atualizava o contexto de um mapa memoizado; a execução final acima passou.

## Evidências

Logs, round trip da API e verificações de binários estão em `evidence/settings-*`. Prints do simulador em `screenshots/leaf-settings-*`. O simulador usa a sessão QA existente e uma casca nativa anterior com o bundle final: valida a interface e a API observadas, **não comprova reprodução da nova voz no aparelho**.

Metadados e hashes atuais dos binários: [artifacts.json](/Users/izaakdias/Documents/Leaf-new/docs/validation/ui-parity-release-2026-10-04/artifacts.json). O pacote `Leaf-1.0.6-38-device.ipa` inclui o widget e perfis de desenvolvimento para dois dispositivos, ambos no Team Leaf. APK para aparelho: `Leaf-1.0.6-132-device.apk`, assinatura verificada e versão 1.0.6/132. Nenhuma OTA ou submissão de loja foi feita.

## Riscos e pendências reais

1. `/api/account/places` respondeu **404** na API production com token QA. O patch autenticado de endereços está pronto, mas falta implantá-lo e exercer CRUD/reinício/segunda sessão.
2. A VPS responde com uma identidade SSH diferente de `known_hosts`. O arquivo e a chave de acesso já estão localizados e autorizados; não falta localizar credenciais. Não há sessão Contabo autenticada nos navegadores abertos. Falta confirmar a impressão digital pelo console antes do rollout, conforme o registro persistente em `RELEASE-STATUS.md`.
3. Instalação física iOS tentada duas vezes: **CoreDevice 1011**, dispositivo pareado com **túnel indisponível**. Android continua ausente do ADB. Não declarar instalação concluída ou atribuir o aviso antigo de desenvolvedor a outra equipe.
4. Após reconectar, executar a viagem bilateral completa com esses binários, incluindo confirmação Pix, chegada, embarque, navegação/voz, término, recibo, avaliação e exceções. O canary e testes locais não comprovam essa aceitação.

## Rollback

`settings-completion.patch.gz` contém somente esta rodada; a verificação reversa passou na árvore principal. Reverter esse patch primeiro e validar os patches anteriores antes de usá-los. Os candidatos anteriores estão preservados em `pre-settings/`. Não houve mudança remota de backend, publicação ou OTA para desfazer.

## Fora do escopo preservado

Pix, taxa, split, saldo, pedágio, saque, estorno, KYC/liveness, elegibilidade, dashboard, legado e alterações de outras tarefas. OpenCode e Maestri não foram utilizados.
