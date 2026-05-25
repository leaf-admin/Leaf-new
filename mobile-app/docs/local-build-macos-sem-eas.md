# Build Local no macOS (Sem depender do EAS cloud)

Data: 2026-03-16

## Objetivo

Padronizar build local de Android e iOS no Mac, sem fila do EAS cloud.

## Fluxo rápido

1. Setup inicial do ambiente:

```bash
cd mobile-app
npm run env:local:setup:mac
```

2. Diagnóstico do ambiente:

```bash
npm run env:local:doctor
```

3. Build local Android:

```bash
npm run build:local:android:debug
npm run build:local:android:release
npm run build:local:android:aab
```

4. Build local iOS:

```bash
npm run build:local:ios:simulator
npm run build:local:ios:archive
npm run build:local:ios:ipa
```

## Onde saem os artefatos

- Android APK debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- Android APK release: `android/app/build/outputs/apk/release/app-release.apk`
- Android AAB release: `android/app/build/outputs/bundle/release/app-release.aab`
- iOS simulator build: `ios/build`
- iOS archive assinado: `ios/build/<Scheme>.xcarchive`
- iOS archive sem assinatura (fallback automático): `ios/build/<Scheme>-unsigned.xcarchive`
- iOS IPA assinado local: `ios/build/export-appstore/Leaf.ipa`

## Observações importantes

- O setup instala Java 17 e Android SDK localmente no usuário (`$HOME/.local/mobile-build-tools` e `$HOME/Android/Sdk`).
- Para iOS com SDK 54, use CocoaPods `>= 1.15.2` (necessário por `visionOS` em dependências como `lottie-react-native`).
- Build Android local com New Architecture pode exigir codegen JNI antes do `assemble`; o script já executa `generateCodegenArtifactsFromSchema` automaticamente.
- Para forçar limpeza completa no Android, use `ANDROID_BUILD_CLEAN=1 npm run build:local:android:debug`.
- Para iOS `archive` de distribuição, assinatura Apple (certificados/profiles) continua necessária no Xcode.
- O profile pode ficar em um destes caminhos (dependendo da versão do Xcode):
  - `$HOME/Library/MobileDevice/Provisioning Profiles`
  - `$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles`
- Se não houver certificado/profile no Mac, o script agora gera automaticamente um `xcarchive` sem assinatura para validação técnica de release.
- Para forçar manualmente o modo sem assinatura, use `FORCE_UNSIGNED_ARCHIVE=1 npm run build:local:ios:archive`.
- Para publicação em loja, o EAS pode continuar sendo opcional para distribuição, mas não é obrigatório para compilar localmente.
- O QA local (`npm run qa:run`) agora resolve automaticamente:
  - `node/nodejs` via `NODE_BIN` (auto-detect);
  - `adb` via `ADB_BIN` (auto-detect em paths locais comuns);
  - `FIREBASE_API_KEY` via `google-services.json` quando não exportada no shell.
- Para forçar manualmente caminhos no QA:

```bash
NODE_BIN=/Users/seu-user/.nvm/versions/node/vX/bin/node \
ADB_BIN=/Users/seu-user/Android/Sdk/platform-tools/adb \
npm run qa:run
```

## Desbloquear `build:local:ios:archive`

Se aparecer o erro `Signing for "Leaf" requires a development team`:

1. Abra o projeto em `ios/Leaf.xcworkspace`.
2. Selecione target `Leaf` -> `Signing & Capabilities`.
3. Defina seu `Team` (Apple Developer).
4. Garanta que `Bundle Identifier` não conflita com outro app da conta.
5. Rode novamente:

```bash
npm run build:local:ios:archive
```

### Modo recomendado para archive assinado (CLI)

Com Team ID configurado na sua conta Apple Developer:

```bash
IOS_DEVELOPMENT_TEAM=SEU_TEAM_ID \
FORCE_SIGNED_ARCHIVE=1 \
npm run build:local:ios:archive
```

Notas:
- O script agora usa `-allowProvisioningUpdates` para facilitar assinatura automática.
- Se quiser validar rapidamente o estado local, rode antes:

```bash
npm run env:local:doctor
```

Se aparecer erro do Xcode informando que o team não possui device para gerar profile:
- `Your team has no devices from which to generate a provisioning profile`

Faça um destes passos antes de repetir o archive:
1. Conectar um iPhone físico no Xcode com a mesma conta/team.
2. Ou cadastrar o UDID manualmente em Apple Developer > Certificates, Identifiers & Profiles.

Se o doctor mostrar certificados mas `0 valid identities found`:
- os `.cer` foram importados sem private key local.
- nesse caso, importe o `.p12` correspondente (com senha) ou recrie o certificado pelo Xcode neste Mac.

## Gerar IPA assinado local (App Store Connect) sem EAS

Quando o `archive` assinado via `build:local:ios:archive` cair em profile de Development, use fluxo em 2 passos:

1. Gerar archive sem assinatura:

```bash
FORCE_UNSIGNED_ARCHIVE=1 npm run build:local:ios:archive
```

2. Exportar IPA assinado com provisioning automático:

```bash
npm run build:local:ios:ipa
```

Saída esperada:
- `ios/build/export-appstore/Leaf.ipa`
- `** EXPORT SUCCEEDED **`

Se o processo travar em `codesign`:
- abra o Keychain Access;
- libere a chave privada do certificado `Apple Distribution` para `/usr/bin/codesign` (ou `Always Allow` no prompt).
