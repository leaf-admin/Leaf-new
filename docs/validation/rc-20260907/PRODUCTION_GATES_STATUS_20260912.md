# Status dos gates de produção — 12/09/2026

## Objetivo

Registrar o que foi fechado após o E3 bilateral e separar os itens que ainda
dependem de segredo, deploy, device físico ou decisão formal. O piloto
controlado e a abertura ampla são decisões diferentes.

## Estado atual

| Gate | Estado | Evidência/ação restante |
| --- | --- | --- |
| E3 bilateral | **PASS** | Mesmo `rideId`, dois papéis iOS, Pix sandbox, lifecycle, movimento, conclusão, settlement e avaliações. |
| Reconciliação financeira | **PASS** | 14/14 checks; cotação, charge, holding, distribuição, ledger e recibo balanceados. |
| Geofence | **PASS** | Pickup e destino aprovados pela região operacional. |
| Pilot controlled | **CONFIGURADO** | `LEAF_PILOT_CONTROLLED=true`, coortes de passageiro/motorista e região configuradas no runtime remoto. |
| KYC estrito | **CONFIGURADO / evidência operacional pendente** | Flags AWS, admission, cost guard e provedor aparecem configurados no `.env` remoto; não houve fluxo KYC real nesta E3. |
| CPF review HMAC | **PASS — provisionado** | Chave dedicada gerada diretamente no host, registrada somente por fingerprint operacional e carregada nos três gateways; valor nunca foi escrito no Git ou na resposta. |
| Dashboard contextualizado — código | **PASS** | Serviço e rotas locais selecionam coleções pelo `financialContext`; 76 testes focados passaram. |
| Dashboard contextualizado — publicado | **BLOCKED** | Containers remotos ainda executam o serviço legado; publicar o SHA revisado e repetir GET/POST autenticados. |
| iPhone físico | **BLOCKED MANUAL** | O device está `unavailable` após reboot e exige um desbloqueio físico único. |
| Woovi | **PASS para piloto sandbox** | Charge confirmada em `api.woovi-sandbox.com`; nenhuma liquidação ou saque bancário real. |
| Dependências Expo/Metro | **PÓS-PILOTO** | Não bloqueia o piloto controlado; migração coordenada permanece necessária antes de expansão ampla. |
| Manifesto/CI/RC | **PENDENTE** | Worktree ainda contém alterações anteriores; consolidar SHA limpo, CI e rollback antes de qualquer deploy. |
| Abertura ampla | **NO-GO** | Requer métricas do piloto, HA/failover, CI/manifesto, dependências e aprovação formal de expansão. |

O `config:validate` executado dentro do container remoto retornou `ok=true`,
mas esse container ainda contém o serviço legado e a versão anterior do
validator. Portanto, esse resultado confirma a configuração carregada no
runtime atualmente publicado; ele não substitui a validação do SHA candidato
nem o teste do código contextualizado após o deploy.

As sondagens públicas de `/health`, `/health/readiness`, `/health/liveness` e
`/health/runtime-flags` responderam saudáveis. O polling Socket.IO público
retornou `400` porque `SOCKET_ALLOW_POLLING=false` é a política atual; isso não
é tratado como falha do transporte WebSocket.

## Evidência fechada

- [Execução E3](/Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/E3_RUN_20260912.md)
- [Reconciliação do mesmo ride](/Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/same-ride-reconciliation.md)
- [Booking final](/Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/booking-final.json)
- [Pagamento Woovi sandbox](/Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/sandbox-payment-confirmation.json)
- [Ledger](/Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/ledger-evidence.json)
- [Dashboard/financeiro sandbox](/Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/dashboard-evidence.json)
- [Avaliações](/Users/izaakdias/Documents/Leaf-new/docs/validation/rc-20260907/e3-run-20260912/ratings-evidence.json)

## Atualização de fechamento — `CPF_REVIEW_HMAC_KEY` — 12/09/2026

- A chave dedicada foi gerada diretamente no host `62.169.31.231` com 32 bytes
  aleatórios (64 caracteres hexadecimais). O valor não foi exibido, transportado
  para o repositório ou gravado em logs do aplicativo.
- O `.env` remoto foi copiado antes da alteração para
  `/opt/leaf-app/backups/cpf-review-key-20260912T161917Z/.env.before`, com modo
  restrito. O fingerprint SHA-256 foi salvo somente em
  `key.fingerprint` no mesmo diretório protegido (modo `600`); o valor da chave
  não é recuperável a partir deste documento.
- `CPF_REVIEW_ENABLED=true` foi explicitado no ambiente de produção. Os
  containers `leaf-websocket`, `leaf-websocket-gateway-2` e
  `leaf-websocket-gateway-3` foram recriados individualmente e confirmados com
  64 bytes carregados, `running/healthy` e sem erros críticos recentes.
- As sondagens públicas `/health`, `/health/readiness`, `/health/liveness` e
  `/health/runtime-flags` responderam HTTP 200. O validator disponível no
  container retornou `ok=true` e `blockers=[]`; ele ainda é a imagem publicada
  anterior e deve ser repetido no SHA candidato junto com o deploy do dashboard.

O segredo continua sujeito à política de rotação: não trocar a chave enquanto
existirem casos em `cpf_review_restrictions` sem uma migração dual-key planejada.

## Próxima sequência

1. Consolidar os arquivos de código em um SHA de release limpo; preservar as
   alterações do usuário fora do pacote.
2. Publicar o backend/dashboard contextualizado com backup e rollback, sem
   alterar regras financeiras ou habilitar saque.
3. Repetir `config:validate`, health/readiness, endpoint financeiro autenticado,
   reconciliation e testes focados no SHA publicado.
4. Desbloquear o iPhone físico e repetir somente a coleta exigida pelo runbook.
5. Fazer o GO formal do piloto controlado; manter `LEAF_BROAD_LAUNCH_APPROVED`
   desligado até métricas e revisão pós-piloto.

## Rollback

- Restaurar o backup de ambiente QA
  `/opt/leaf-app/.env.e3-qa-backup-20260912T044841Z` se a janela temporária
  precisar ser revertida.
- Para o deploy contextualizado, usar o backup de source/compose gerado pelo
  rollout e o rollback automático do script de deploy.
- Remover os artefatos locais não altera o backend nem o ledger sandbox.
