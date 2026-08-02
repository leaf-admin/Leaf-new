# Leaf Monorepo

Este repositório usa `npm workspaces` para os apps ativos:

- `leaf-websocket-backend`
- `leaf-dashboard-js`
- `mobile-app`

## Fluxo rápido

```bash
# instalar dependências dos workspaces
npm run bootstrap

# desenvolvimento por app
npm run dev:backend
npm run dev:dashboard
npm run dev:mobile
```

## Documentação canônica

- [Índice de docs](/Users/izaakdias/Documents/Leaf-new/docs/README.md)
- [Estado atual do projeto](/Users/izaakdias/Documents/Leaf-new/docs/PROJECT_STATE_2026-05-16.md)
- [Plano de migração e limpeza](/Users/izaakdias/Documents/Leaf-new/docs/MIGRATION_CLEANUP_PLAN_2026-05-16.md)
- [Manifesto de freeze e rollback](/Users/izaakdias/Documents/Leaf-new/docs/RELEASE_FREEZE_MANIFEST_2026-05-16.md)
- [Perfil canônico de testes](/Users/izaakdias/Documents/Leaf-new/docs/TEST_EXECUTION_CANONICAL_PROFILE.md)
- [Workflow de trabalho](/Users/izaakdias/Documents/Leaf-new/docs/workflow/README.md)
- [Guia de contribuicao](/Users/izaakdias/Documents/Leaf-new/CONTRIBUTING.md)

Docs históricos e relatórios gerados ficam em `docs/archive/`.

## Scripts raiz

- `npm run bootstrap`
- `npm run dev:backend`
- `npm run dev:dashboard`
- `npm run dev:mobile`
- `npm run build:dashboard`
- `npm run lint:dashboard`
- `npm run test:mobile`
- `npm run test:backend`
- `npm run test:all`
- `npm run branch:task -- LIN-123 nome-curto`

## Decisão de produto

- O app mobile atual entra por `mobile-app/index.js` -> `mobile-app/App.js`.
- A experiência principal do app é a UI Robotaxi, registrada em `mobile-app/src/navigation/AppNavigator.js`.
- O backend possui uma única entrada executável e canônica: `leaf-websocket-backend/server.js`.
- Toda feature nova de admin/dashboard deve ser implementada em `leaf-dashboard-js`.
- `mobile-app/src/common-local` ainda é legado vivo: não criar novas dependências nele; migrar por domínio antes de remover.
