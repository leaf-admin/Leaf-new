## Resumo

-

## Linear

-

## Escopo

- Issue/task:
- Fora de escopo preservado:
- Regras de negocio alteradas? Se sim, quais e com aprovacao de quem:

## Tipo

- [ ] Mobile
- [ ] Backend
- [ ] Dashboard
- [ ] Release
- [ ] Docs/processo
- [ ] Cleanup

## Validacao

- [ ] Li `AGENTS.md` e `PROJECT_RULES.md`
- [ ] `git diff --check`
- [ ] `npm run governance:check`
- [ ] `npm run lint:dashboard`
- [ ] `npm run build:dashboard`
- [ ] `npm run test:mobile`
- [ ] `npm run test:backend`
- [ ] `npm run test:route-guards --workspace leaf-websocket-backend`
- [ ] `npm run prelaunch:audit`
- [ ] Dispositivo/simulador quando aplicavel

## Risco e rollback

-

## Evidencias

-

## Checklist de agente

- [ ] O diff esta limitado ao escopo da task
- [ ] Nao houve chamada paga nova sem aprovacao
- [ ] Nao houve segredo, token, chave ou fallback inseguro adicionado
- [ ] Nao houve mock apresentado como evidencia real
- [ ] Areas de pagamento, KYC, safety, lojas e infra foram revisadas com cuidado quando aplicavel
