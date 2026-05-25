# Linear

## Uso esperado

Linear e o backlog oficial. GitHub PR fica para revisao de codigo; Linear fica para priorizacao, escopo e historico de produto.

## Estrutura sugerida

Times ou labels, conforme o workspace permitir:

- `mobile`
- `backend`
- `dashboard`
- `release`
- `ops`
- `cleanup`
- `product`

Estados:

- `Backlog`
- `Ready`
- `In Progress`
- `Review`
- `Blocked`
- `Done`

Prioridade:

- `Urgent`: loja/producao quebrada, seguranca, pagamento.
- `High`: fluxo principal de corrida/auth/release.
- `Normal`: melhoria planejada.
- `Low`: organizacao, docs, polish sem urgencia.

## Modelo de issue

```markdown
## Objetivo

## Escopo

## Fora de escopo

## Validacao

## Risco / rollback
```

## Ligacao com Git

- Branch deve incluir o ID da issue quando existir.
- PR deve mencionar o ID da issue.
- Ao finalizar, comentar no Linear quais validacoes passaram.
