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
