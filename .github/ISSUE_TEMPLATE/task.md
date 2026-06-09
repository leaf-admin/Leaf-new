---
name: Task LEAF
about: Task executavel por agente
title: "[TASK] "
labels: task
---

## Objetivo

## Contexto tecnico

## Escopo

-

## Fora de escopo

-

## Regras de negocio afetadas

- Nenhuma esperada.

## Arquivos provaveis

-

## Criterios de aceite

-

## Testes obrigatorios

- [ ] `git diff --check`
- [ ] `npm run governance:check`
- [ ] `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
- [ ] `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
- [ ] Testes especificos do dominio:

## Riscos

## Rollback

## Prompt para OpenCode

```text
Implemente esta issue seguindo AGENTS.md e PROJECT_RULES.md.
Se estiver rodando via GitHub Actions `/oc`, use a branch atual criada pela action. Nao crie nem troque branch.
Nao altere nada fora do escopo.
Nao mude regra de negocio sem aprovacao explicita.
Nao adicione chamada paga externa.
Use rg antes de editar.
Rode lint/test/build relevantes.
Abra PR com resumo, arquivos alterados, riscos, rollback e testes executados.
```
