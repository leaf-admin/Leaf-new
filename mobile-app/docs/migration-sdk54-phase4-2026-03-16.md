# Fase 4 - Limpeza de deprecacoes (SDK 54)

Data: 2026-03-16
Branch: codex/migracao-expo-sdk54-zero-debito

## Objetivo da fase

Reduzir debito tecnico de APIs deprecadas e alinhar o projeto ao runtime do SDK 54.

## Mudancas aplicadas

1. Audio (`expo-av` -> `expo-audio`)
- Dependencia `expo-av` removida.
- Dependencia `expo-audio` mantida e plugin configurado no app config.
- Fluxo de buzina no `AppCommon.js` migrado para:
  - `setAudioModeAsync`
  - `createAudioPlayer`
  - listener `playbackStatusUpdate`
- Arquivo legado `src/screens/AppCommon.js` limpo de imports/estados de audio obsoletos.

2. FileSystem legado isolado explicitamente
- Todos os pontos que ainda usam API legada (`readAsStringAsync`, `getInfoAsync`, `downloadAsync`, etc.) foram migrados para import explicito de `expo-file-system/legacy`.
- Isso evita runtime throw da API principal `expo-file-system` no SDK 54 para metodos legados.

3. Notificacoes iOS (handler moderno)
- `Notifications.setNotificationHandler` atualizado de `shouldShowAlert` (deprecated) para:
  - `shouldShowBanner`
  - `shouldShowList`
- Mantidos `shouldPlaySound` e `shouldSetBadge`.

4. Configuracoes de plugin
- Adicionado `expo-audio` no array `plugins` de:
  - `app.config.js`
  - `app.config.simple.js`
  - `apk/app.config.js`

5. Excecoes do doctor
- Removida excecao antiga de `expo-av` do bloco `reactNativeDirectoryCheck.exclude` em `mobile-app/package.json`.

## Validacoes

- `expo-doctor`: 17/17 checks passed.
- `expo start --offline`: Metro inicia normalmente.
- `expo prebuild --platform android --no-install --clean`: sucesso.
- `expo prebuild --platform ios --no-install --clean`: sucesso.

## Observacoes

- O plugin custom `withGradleNodeFix` continua sem encontrar o alvo antigo no `expo-dev-launcher` (indicando que a correcoes desse pacote evoluiram no upstream). A reavaliacao/remocao desse plugin permanece como item de hardening.
