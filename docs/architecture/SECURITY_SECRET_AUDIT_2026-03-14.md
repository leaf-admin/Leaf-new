# SECURITY SECRET AUDIT (2026-03-14 / atualizado 2026-03-15)

## Escopo
- Hardening em runtime paths mais críticos (backend services + mobile config/screens/plugins).
- Revisão de gitignore para evitar novos vazamentos de artefatos sensíveis.

## O que foi saneado
- Removidos fallbacks hardcoded de API key em:
  - `leaf-websocket-backend/services/places-cache-service.js`
  - `mobile-app/config/GoogleMapApiConfig.js`
  - `mobile-app/config/api-keys.js`
  - `mobile-app/plugins/withGoogleMapsApiKey.js`
  - `mobile-app/src/screens/NewMapScreen.js`
  - `mobile-app/config/FirebaseConfig.js`
  - `mobile-app/src/screens/EditProfile.js`
  - `mobile-app/src/screens/DriverDocumentsScreen.js`
  - `mobile-app/src/screens/MapScreen.js`
- Removidos do versionamento (mantidos localmente) artefatos sensíveis:
  - `mobile-app/google-services.json`
  - `mobile-app/GoogleService-Info.plist`
  - `config/firebase/GoogleService-Info.plist`
  - `leaf-websocket-backend/config.production.env`
- Adicionados templates seguros para onboarding:
  - `mobile-app/google-services.example.json`
  - `mobile-app/GoogleService-Info.example.plist`
  - `config/firebase/GoogleService-Info.example.plist`
- Criado guia de setup local:
  - `docs/architecture/SECRET_FILES_LOCAL_SETUP.md`

## Gitignore reforcado
- Incluídos:
  - `**/google-services.json`
  - `**/GoogleService-Info.plist`
  - `**/firebase-credentials.json`
  - `mobile-app/reports/`

## Evidência de scan
- Ocorrências totais no monorepo (excluindo markdown/txt/log): `56`.
- Concentração principal residual:
  - `mobile-app/common/**`
  - `mobile-app/src/common-local/**`
- Nessas áreas há cópias legadas com chaves hardcoded que ainda precisam sanitização em lote.

## Conclusão
- Runtime principal foi endurecido sem quebrar smoke local.
- Ainda não há “zero-secret footprint” no monorepo completo por causa de legado duplicado.
- Artefatos de Firebase e env sensível mais críticos não ficam mais versionados.

## Próxima ação recomendada
- Executar bloco dedicado de migração/remoção de `common` e `common-local` para eliminar chaves hardcoded remanescentes.
