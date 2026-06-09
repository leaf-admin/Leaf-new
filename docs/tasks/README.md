# LEAF Agent Task Workflow

This folder contains templates for slicing work into small, reviewable tasks.

## Daily Flow

```text
Feature idea
  -> Codex slices into 3 to 8 tasks
  -> GitHub issue per task
  -> OpenCode executes one issue
  -> Pull request
  -> Codex reviews
  -> OpenCode fixes review comments
  -> Human approves merge
```

## Codex Task Breakdown Prompt

```text
Voce e o tech lead da LEAF.

Transforme a feature abaixo em tasks pequenas para execucao por OpenCode.

Para cada task, gere:
- objetivo
- contexto tecnico
- escopo
- fora de escopo
- regras de negocio afetadas
- arquivos provaveis
- criterios de aceite
- testes obrigatorios
- riscos
- prompt pronto para o OpenCode executar

Feature:
[descreva aqui]
```

## OpenCode Execution Prompt

```text
Implemente a task abaixo seguindo AGENTS.md e PROJECT_RULES.md.

Crie uma branch nova.
Nao altere nada fora do escopo.
Nao mude regra de negocio sem aprovacao explicita.
Nao adicione chamada paga externa.
Use rg antes de editar.
Rode lint/test/build relevantes se existirem.
Ao final, entregue resumo, arquivos alterados, riscos, rollback e testes executados.

TASK:
[colar task]
```

## Codex Review Prompt

```text
@codex review

Priorize:
- regressao de regra de negocio;
- dinheiro, Pix, ledger, saldo, saque e recibo;
- KYC, safety e driver online;
- aumento de custo por APIs;
- escopo fora da issue;
- falta de testes/evidencias;
- diferencas iOS/Android quando houver mobile.
```

## OpenCode Fix Prompt

```text
/oc apply Codex review comments.

Follow AGENTS.md strictly.
Do not refactor unrelated code.
Do not change business rules.
Run tests again.
Update PR summary with evidence.
```

