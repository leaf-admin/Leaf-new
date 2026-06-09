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

## GitHub Automation

OpenCode can be triggered from GitHub when an authorized comment starts with `/oc` or `/opencode` after repository secrets and variables are configured.

See `docs/tasks/OPENCODE_GITHUB_AUTOMATION.md` for the workflow setup, required GitHub variables, safe slash-command prompts, and stop conditions.

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

Se estiver rodando via GitHub Actions `/oc`, use a branch atual criada pela action. Nao crie nem troque branch.
Nao altere nada fora do escopo.
Nao mude regra de negocio sem aprovacao explicita.
Nao adicione chamada paga externa.
Use rg antes de editar.
Rode lint/test/build relevantes se existirem.
Se validacao/smoke nao estabilizar apos uma tentativa focada de correcao, pare e comente diagnostico curto em vez de continuar depurando indefinidamente.
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
Use the current GitHub Actions branch. Do not create or switch branches.
Do not refactor unrelated code.
Do not change business rules.
Run tests again.
If validation still fails after one focused fix attempt, stop and comment the blocker instead of continuing broad debugging.
Update PR summary with evidence.
```
