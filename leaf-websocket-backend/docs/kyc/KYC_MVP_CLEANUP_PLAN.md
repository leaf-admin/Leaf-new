# KYC MVP Cleanup Plan (Mobile-first)

## Objetivo
Consolidar o KYC leve (match facial diário com validade de 24h) sem remover segurança de produção.

## Bloco 1 - Diário (online gate)
- Manter a regra de bloqueio para ficar online quando não houver verificação diária válida.
- Padronizar erro de gate (`code=kycRequired`) e motivo amigável para app.
- Garantir cache Redis `kyc_verification:{driverId}` com TTL de 24h e renovação após validação bem-sucedida.
- Garantir telemetria mínima: tentativas, sucesso/falha, latência.

## Bloco 2 - Onboarding (âncora)
- Definir onboarding KYC como etapa canônica para criar referência facial (foto âncora).
- Confirmar fluxo CNH + selfie com resultado:
  - `approved` -> libera conta.
  - `needsReview` -> revisão manual no dashboard.
  - `rejected` -> conta bloqueada até revalidação.
- Documentar exatamente quais campos/statuses são gravados em `users`/`drivers`.

## Bloco 3 - Limpeza de legado/mocks
- Eliminar mock silencioso de cliente KYC em runtime (mock só via env explícita).
- Remover validações incorretas de UUID para Firebase UID nas rotas KYC.
- Revisar endpoints não usados pelo app e marcar/deprecar gradualmente.

## Ordem de execução recomendada
1. Estabilizar gate diário (Bloco 1).
2. Consolidar onboarding como fonte de âncora (Bloco 2).
3. Limpar legado/mocks e deprecar rotas antigas (Bloco 3).

## Critérios de aceite
- Motorista sem verificação válida do dia não fica online.
- Motorista validado consegue ficar online sem fricção por 24h.
- Erros de verificação são reproduzíveis e observáveis no dashboard/logs.
- Nenhum bypass de mock ativo sem variável de ambiente explícita.
