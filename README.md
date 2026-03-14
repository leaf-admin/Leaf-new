# Leaf Monorepo

Este repositório usa `npm workspaces` no modo mínimo para os apps ativos:

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

## Scripts raiz

- `npm run bootstrap`
- `npm run dev:backend`
- `npm run dev:dashboard`
- `npm run dev:mobile`
- `npm run build:dashboard`
- `npm run lint:dashboard`
- `npm run test:backend`

## Decisão de produto

- Dashboard legado removido.
- Toda feature nova de admin/dashboard deve ser implementada em `leaf-dashboard-js`.
