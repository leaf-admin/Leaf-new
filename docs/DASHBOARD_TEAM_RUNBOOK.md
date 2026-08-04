# Runbook de operação do dashboard

Este é o roteiro mínimo para uma equipe operar o backoffice sem depender de conhecimento tácito do projeto. O dashboard é leitura agregada por padrão; ações administrativas passam por RBAC, confirmação visual e guard de lançamento no backend.

## Ordem de abertura

1. **Hoje → Visão geral**: confirmar status, cache recente, motoristas ativos, corridas, GMV, receita e Woovi.
2. **Atenção agora**: executar somente os itens priorizados pelo snapshot. Cada item aponta para a tela responsável.
3. **Operação**: tratar suporte fora do SLA, documentos pendentes, motoristas e geofence.
4. **Financeiro**: conferir reconciliação e runtime de pagamento após canary ou divergência.
5. **Sistema**: abrir observabilidade, auditoria e métricas somente para investigação.

Não manter todas as telas abertas em paralelo. O Command Center é a fonte diária cacheada; telas de detalhe devem ser abertas sob demanda.

## Perfis e responsabilidade

| Perfil | Pode operar | Limites principais |
| --- | --- | --- |
| `admin` / `super-admin` | Pessoas, território, financeiro, comunicação e sistema | Toda mutação ainda exige confirmação e respeita o launch flag do backend |
| `manager` | Operação diária, financeiro e comunicação | Não substitui o guard de lançamento nem a auditoria |
| `development` | Diagnóstico, notificações e saúde técnica | Não acessa simulador financeiro; não publica operações financeiras |
| `support` | Suporte, usuários e leitura operacional | Sem documentos de motorista, financeiro ou mutações administrativas |

O menu é uma conveniência. A autorização efetiva permanece no backend; link escondido não é controle de segurança.

## Como agir em incidentes

- **Status unhealthy / fonte falhou**: abrir `/observability`, registrar horário e fonte, e não repetir refresh em massa.
- **Suporte fora do SLA**: abrir `/support`, assumir o ticket ou atribuir dono antes de responder.
- **Documento pendente**: abrir `/drivers/review-queue`; revisar evidência e usar a ação confirmada. Nunca contornar KYC no dashboard.
- **Divergência financeira**: abrir `/financial-reconciliation`; o valor final do backend/ledger prevalece sobre estimativa de cotação.
- **Mutações bloqueadas**: respeitar a mensagem do perfil de lançamento e registrar a tentativa. Não habilitar flag manualmente durante operação.
- **Custo Firestore em warning/danger/limit**: voltar ao `/dashboard`, pausar telas de detalhe e investigar o contador Redis antes de insistir.

## Validação antes de liberar uma mudança

```bash
npm --prefix leaf-dashboard-js run qa:backoffice
npm --prefix leaf-websocket-backend run test:unit -- --runInBand
git diff --check
```

O smoke do dashboard percorre as rotas protegidas, verifica headings, contratos financeiros, launch flags, exportação autenticada e bloqueia chamadas diretas a Google, Firebase e Woovi.

## Rollback

1. Identificar o commit da alteração no branch de release.
2. Reverter o commit em branch própria, preservando o log de auditoria.
3. Reexecutar `qa:backoffice` e o teste unitário do backend.
4. Só então solicitar publicação/deploy conforme o procedimento de release.

Não editar regras de negócio, flags de produção ou credenciais diretamente pelo navegador.
