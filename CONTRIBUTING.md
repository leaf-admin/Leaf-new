# Contributing

Este repo trabalha com uma base limpa e branches curtas por tarefa.

## Base de trabalho

- Base limpa: `codex/clean-workbase-20260516`
- Checkpoint de rollback: `checkpoint/pre-cleanup-20260516-current-state`
- Branch de auditoria da limpeza: `codex/project-cleanup-20260516`

Nao codar direto na base limpa. Abra uma branch de tarefa.

```bash
npm run branch:task -- LIN-123 nome-curto-da-tarefa
```

Sem Linear ainda:

```bash
npm run branch:task -- nome-curto-da-tarefa
```

## Fluxo padrao

1. Criar ou escolher uma issue no Linear.
2. Criar branch a partir de `codex/clean-workbase-20260516`.
3. Fazer mudancas pequenas e coesas.
4. Rodar a validacao proporcional ao risco.
5. Abrir PR com checklist preenchido.
6. Mergear apenas depois de validação verde ou exceção documentada.

## Areas ativas

- Mobile: `mobile-app`
- Backend: `leaf-websocket-backend`
- Dashboard: `leaf-dashboard-js`
- Landing/legal: `landing-page`
- Docs canonicos: `docs`

## Regras de limpeza

- Nao criar dependencia nova em `mobile-app/src/common-local`.
- Nao introduzir entradas alternativas ao `leaf-websocket-backend/server.js`; rollback deve restaurar uma revisao versionada e validada.
- Relatorio temporario vai para `reports/`, que e ignorado.
- Decisao duradoura vai para `docs/` ou Linear.
- Resultado de Maestro vai para `mobile-app/.maestro/results/`, que e ignorado.

## Validacao minima

Para mudancas pequenas de docs/processo:

```bash
git diff --check
```

Para dashboard:

```bash
npm run lint:dashboard
npm run build:dashboard
```

Para mobile/backend:

```bash
npm run test:mobile
npm run test:backend
npm run test:route-guards --workspace leaf-websocket-backend
```

Para release:

```bash
npm run test:all
npm run prelaunch:audit
```
