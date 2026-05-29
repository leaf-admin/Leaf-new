# Runbook - Segredos Locais e Artefatos Sensíveis

Data: 2026-05-29
Branch: `codex/project-cleanup-baby-steps`

## Status Atual

- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`: PASS.
- Nenhum segredo sensivel foi encontrado em arquivo versionado.
- `node scripts/maintenance/security/scan-secrets.cjs`: FAIL esperado no workspace local porque ainda existem segredos necessarios para build, canary e operacao local.

## Artefatos Locais Ainda Presentes

Estes arquivos nao estao versionados, mas continuam dentro do diretorio do projeto:

- `leaf-dashboard-js/.env.local`
- `leaf-websocket-backend/.env`
- `leaf-websocket-backend/.env.production`
- `leaf-websocket-backend/.env.production.sandbox`
- `leaf-websocket-backend/firebase-credentials.json`
- `leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json`
- `mobile-app/.env`
- `mobile-app/.env.local`
- `mobile-app/.env.production`
- `mobile-app/.env.production.local`
- `mobile-app/@freedom-tech-organization__leaf.jks`
- `mobile-app/android/app/debug.keystore`
- `mobile-app/android/app/google-services.json`
- `mobile-app/config/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json`
- `mobile-app/ios/Leaf/GoogleService-Info.plist`
- `mobile-app/leaf-production-release.keystore`
- `mobile-app/leaf-release-key.keystore`
- `services/face-compare-service/.env`

## Regra De Ouro

Nao remover esses arquivos no meio de uma rodada de build/canary. Primeiro criar uma fonte externa de segredos, validar builds Android/iOS e backend usando essa fonte, e so entao limpar o workspace.

## Caminho Seguro Recomendado

1. Criar um cofre local fora do repo:
   - exemplo: `~/.leaf/secrets/local/`
   - exemplo: `~/.leaf/secrets/canary/`
   - exemplo: `~/.leaf/secrets/release/`
2. Mover arquivos sensiveis para esse cofre, preservando nomes e checksums.
3. Criar script local nao versionado ou runbook para materializar os arquivos no lugar esperado antes da build.
4. Ajustar scripts de build para aceitar variaveis de caminho quando possivel:
   - `GOOGLE_SERVICES_JSON_PATH`
   - `GOOGLE_SERVICE_INFO_PLIST_PATH`
   - `FIREBASE_ADMIN_CREDENTIALS_PATH`
   - `ANDROID_KEYSTORE_PATH`
5. Rodar validacoes:
   - backend config validate
   - smoke Woovi sandbox
   - `expo config --json`
   - build debug Android/iOS
   - build release Android/iOS
6. Depois de validado, apagar copias locais dentro do repo.
7. Rotacionar credenciais se algum arquivo sensivel tiver sido exposto fora do ambiente local controlado.

## Proximo Bloco Sugerido

Criar `scripts/local/materialize-secrets.example.sh` sem valores reais, documentando os caminhos esperados. O script real deve ficar fora do git.

