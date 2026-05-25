# Analise de Falhas EAS Antes da Migracao

Data: 2026-03-16  
Objetivo: analisar as falhas existentes antes de disparar novas builds longas.

## Builds analisadas

- Android (erro): `2634b9e2-0e64-44e1-b7ac-58fe0e584b54`
- iOS (erro): `969c835c-bdfb-467b-95b7-00361cb8255a`

## Causas raiz encontradas

### Android

1. Falha no `expo-dev-launcher` ao resolver `react-native`:

- Erro: `Process 'command 'node'' finished with non-zero exit value 1`
- Contexto: `expo-dev-launcher/android/build.gradle` linha 124.
- Diagnostico local confirmou:
  - executando `node -e "console.log(require('react-native/package.json').version)"` em `node_modules/expo-dev-launcher/android` falha com `MODULE_NOT_FOUND`.
  - `react-native` existe em `mobile-app/node_modules`, mas nao em `root/node_modules`.

2. Falha de configuracao do `expo-modules-core`:

- Erro: `Could not get unknown property 'release' ...`
- Contexto: `ExpoModulesCorePlugin.gradle` linha 95.
- Indica que o patch do projeto para AGP/Gradle nao estava sendo aplicado no build remoto.

### iOS

1. Falha de compilacao em `BoringSSL-GRPC`:

- Erro: `clang: error: unsupported option '-G' for target 'arm64-apple-ios15.1'`
- Target que falhou: `BoringSSL-GRPC` ao compilar `tls_record.cc`.
- O patch customizado para remover flags `-G*` nao persistiu na geracao final de Podfile/build settings.

## Correcao aplicada no codigo (antes de nova build)

1. `app.config.js`
- Plugin `withExpoModulesCoreFix` passou para referencia por caminho string (garante carregamento consistente no pipeline de plugins).
- `withBoringSSLFix` foi movido para apos `expo-build-properties` para evitar sobrescrita de alteracoes no Podfile.

2. `plugins/withExpoModulesCoreFix.js`
- Tornado mais robusto para localizar `expo-modules-core` em layouts diferentes de `node_modules`.
- Mantido patch `components.release -> components.findByName("release")`.

3. `plugins/withGradleNodeFix.js`
- Mantido fallback de `reactNativeVersion`.
- Adicionado patch em `expo-dev-launcher/android/build.gradle` para injetar `NODE_PATH`:
  - `${rootProject.projectDir}/mobile-app/node_modules`
  - `${rootProject.projectDir}/node_modules`
- Isso permite o `require('react-native/package.json')` funcionar em monorepo no EAS.

## Builds de baseline iniciadas nesta sessao

- Android: `c0a4ad7f-e8f3-4961-a546-0e8f1e21b3fe`
- iOS: `ad750f3d-2e1a-4ffc-8f82-034c445126e9`

Status final: ambas canceladas para evitar custo/tempo enquanto a analise e as correcoes eram aplicadas.

## Proximo passo recomendado

Disparar uma nova rodada de build (Android primeiro, depois iOS) ja com os patches acima, e somente entao retomar o fluxo de migracao de SDK.

## Atualizacao 2 - Fila EAS (mesma data)

### Builds canceladas mais recentes (sem erro de compilacao)

- Android SDK 54: `1cb285de-9945-4c89-a15a-58abccb3f8f0`
- Android SDK 53: `61e23055-9b4f-41e0-9c22-18af7768b6e2`
- Android SDK 52: `3137a6f8-1563-44f5-a847-e96b8b4c18c1`

Trecho comum dos logs:
- `You have reached the concurrency limit. Build is waiting to enter the queue.`
- `Waiting on: https://expo.dev/builds/fc89eb87-9e3e-4067-87be-beeef28ddc60`

Conclusao: os cancelamentos acima ocorreram por limite de concorrencia/fila, nao por falha tecnica de Gradle/Xcode.

### Builds atualmente em fila

- Android preview SDK 54: `9ff0a20e-b223-4c58-b3b1-815eb853bfad` (status `NEW`)
- iOS production SDK 54: `b97c9e79-8547-45c0-9b13-3f58a2d84915` (status `NEW`)

Ambas tambem aguardando capacidade de fila por concorrencia.

## Atualizacao 3 - Pos validacao local (mesma data)

### Falha de runtime detectada no Android (apos build local)

- Sintoma: `TypeError: undefined is not a function` no fluxo de autenticacao (BottomSheet), com fatal via `expo-updates` error recovery.
- Causa raiz: incompatibilidade entre `@gorhom/bottom-sheet@4.6.1` e `react-native-reanimated@4.1.1` (hook `useWorkletCallback` nao disponivel nessa combinacao).

### Correcao aplicada

- Upgrade de `@gorhom/bottom-sheet` para `5.2.8` (linha compativel com Reanimated 4).

### Validacao apos correcao

- `npm run build:local:android:release`: `BUILD SUCCESSFUL`.
- `npm run qa:run` com emulator: `PASS`.
- Gate de qualidade: `Logs criticos Android: 0`.
- Simulacao de corrida: `ok: true`, com ciclo completo (booking/payment/accept/start/complete).

## Atualizacao 4 - Hardening de rede Android (mesma data)

### Mudanca aplicada

- `android:usesCleartextTraffic` alterado para `false` no `main`.
- `network_security_config` endurecido:
  - `main`: `base-config cleartext=false`, com allowlist HTTP minima apenas para hosts backend atuais.
  - `debug` e `debugOptimized`: allowlist HTTP para hosts dev/homolog.
- Plugin `withNetworkSecurityConfig` atualizado para gerar esta politica por source set (evita regressao apos `prebuild`).

### Validacao apos hardening

- `npm run build:local:android:release`: `BUILD SUCCESSFUL`.
- Reinstalacao do APK em emulator: `adb install -r` OK.
- `npm run qa:run`: `PASS` em `test-results/qa_run_20260316_180559`.
- Gate de qualidade: `Logs criticos Android: 0`.

## Atualizacao 5 - Archive iOS local sem assinatura (mesma data)

### Contexto

- Ambiente local sem credenciais Apple Developer no Keychain:
  - `security find-identity -v -p codesigning` => `0 valid identities found`
  - sem provisioning profiles locais

### Acao

- Validado `xcodebuild archive` com:
  - `CODE_SIGNING_ALLOWED=NO`
  - `CODE_SIGNING_REQUIRED=NO`
  - `CODE_SIGN_IDENTITY=""`
- Resultado: `ARCHIVE SUCCEEDED` com artefato:
  - `mobile-app/ios/build/Leaf-unsigned.xcarchive`

### Padronizacao no projeto

- `scripts/build-local-ios.sh` atualizado:
  - Em `archive`, detecta ausência de identidade e faz fallback automático para archive sem assinatura.
- `scripts/local-build-doctor.sh` atualizado:
  - passa a reportar alertas de assinatura iOS (sem quebrar diagnóstico quando faltam certificados).

## Atualizacao 6 - QA local robusto sem dependencia de PATH global (mesma data)

### Sintoma observado

- `qa:run` falhou em ambiente local por dependencias de PATH:
  - `node: command not found` em `qa-asserts.sh`.
  - falha de simulacao por `firebase_api_key_missing` quando a chave nao estava exportada no shell.

### Correcao aplicada

- `scripts/qa-run.sh`:
  - autodetecta `node/nodejs` (`NODE_BIN`);
  - autodetecta `adb` em paths locais comuns (incluindo `$HOME/Android/Sdk/platform-tools/adb`);
  - extrai `FIREBASE_API_KEY` automaticamente de `mobile-app/google-services.json` quando ausente no ambiente;
  - integra gate `scripts/check-runtime-endpoints.sh` para bloquear hardcode local em runtime monitorado.
- `scripts/qa-asserts.sh`:
  - passa a usar `NODE_BIN` em todos os comandos Node.
- Novo script:
  - `scripts/check-runtime-endpoints.sh` (PASS no estado atual).

### Validacao

- Rodada intermediaria: `qa_run_20260316_184320` (FAIL esperado antes da correcao final: `firebase_api_key_missing`).
- Rodada apos ajustes: `qa_run_20260316_184727` (PASS; health/socket OK, corrida simulada completa, logs criticos Android = 0).
- Rodada final sem export manual de `NODE_BIN`: `qa_run_20260316_185118` (PASS; autodeteccao local confirmada).
- Build Android release revalidado no mesmo contexto local: `BUILD SUCCESSFUL`.

## Atualizacao 7 - Dev-client Android e assinatura iOS local (mesma data)

### Dev-client Android (pendencia de Fase 2)

- `npm run build:local:android:debug`: `BUILD SUCCESSFUL`.
- Instalação/launch em emulator: OK.
- Evidência de atividade dev-client (`expo.modules.devlauncher.launcher.DevLauncherActivity`) e processo ativo.
- Sem crash fatal no log de smoke (`test-results/devclient_smoke_20260316_android.log`).

### Assinatura iOS local (destravamento operacional)

- `scripts/build-local-ios.sh` atualizado para aceitar:
  - `IOS_DEVELOPMENT_TEAM=<TEAM_ID>`
  - `IOS_CODE_SIGN_STYLE=Automatic|Manual`
  - `FORCE_SIGNED_ARCHIVE=1` (falha explícita se faltar identidade local).
- Em archive assinado, o script passa `-allowProvisioningUpdates`.
- `scripts/local-build-doctor.sh` agora alerta quando `DEVELOPMENT_TEAM` não está configurado no projeto iOS.

## Atualizacao 8 - Regressao E2E principal desbloqueada localmente (mesma data)

### Bloqueio inicial

- `npm run test:e2e:stable` falhava por ausência de `adb` no PATH do shell.
- `maestro` não estava instalado e exigia Java disponível no PATH.

### Correcao aplicada

- Instalação do Maestro CLI local (`$HOME/.maestro/bin`).
- Execução com Java 17 local (`$HOME/.local/mobile-build-tools/jdk-17`).
- `scripts/run-e2e-stable-guarded.sh` atualizado para autodetectar `adb` em paths locais comuns.

### Validacao

- `npm run test:e2e:stable` => `PASS`.
- Artefato: `.maestro/results/stable_guarded_20260316_185940` (2 fluxos executados, 0 falhas).

## Atualizacao 9 - Tentativa de archive iOS assinado com Team ID (mesma data)

### Entrada utilizada

- `DEVELOPMENT_TEAM=DTA8W5KA5D`
- `CODE_SIGN_STYLE=Automatic`
- `-allowProvisioningUpdates`

### Resultado

- `xcodebuild archive` falhou (code 65) por ausência de assets de assinatura vinculados ao Team:
  - `Your team has no devices from which to generate a provisioning profile.`
  - `No profiles for 'br.com.leaf.ride' were found.`

### Conclusao

- O bloqueio atual não é mais “Team ID ausente”; é falta de dispositivo/provisioning/certificado efetivo no Apple Developer para esse bundle.
- Próximo passo obrigatório: conectar iPhone real no Team (ou cadastrar UDID no portal Apple) e gerar profile de Development para `br.com.leaf.ride`.

## Atualizacao 10 - Certificados .cer importados sem identidade válida (mesma data)

### Ações executadas

- Importados certificados locais:
  - `~/Downloads/ios_development.cer`
  - `~/Downloads/ios_distribution.cer`
- Team configurado no projeto iOS:
  - `DEVELOPMENT_TEAM = DTA8W5KA5D`
  - `CODE_SIGN_STYLE = Automatic`

### Resultado

- `security find-identity -v -p codesigning` continua retornando `0 valid identities found`.
- Interpretação: os certificados estão no keychain, mas sem private key correspondente no Mac (caso típico de importação apenas de `.cer`).

### Mitigação

- Importar `.p12` com private key (do mesmo certificado) **ou** recriar certificados pelo Xcode nesse próprio Mac.
- Garantir profile/provisioning para `br.com.leaf.ride` (automaticamente com device conectado ou manual via portal).
