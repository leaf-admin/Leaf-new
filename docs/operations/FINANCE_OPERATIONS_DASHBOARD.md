# Operação financeira no dashboard

Este documento registra os fluxos administrativos que podem ser alterados sem nova versão do app móvel.

## Catálogo de pedágios

O catálogo é servido por `GET /api/pricing/toll-catalog` e publicado por `PUT /api/pricing/toll-catalog`. Os dois endpoints exigem JWT de dashboard com papel `admin`, `super-admin` ou `manager`; a publicação também respeita `ENABLE_ADMIN_MUTATIONS`.

O documento persistido é `systemConfig/tollCatalog`. Cada publicação incrementa `version`, registra o operador e passa a valer para novas cotações depois do cache curto do backend. Quotes já emitidos continuam protegidos pelo quote lock e não são recalculados retroativamente.

O catálogo exige IDs únicos, coordenadas válidas, sentido conhecido, tarifas não negativas e no máximo 200 praças. `enabled=false` desliga a detecção geométrica sem apagar os dados cadastrados.

O dashboard opera o catálogo em `/tolls`. A tabela oficial da concessionária deve ser conferida antes da publicação; o código não presume que os valores legados sejam a tarifa vigente.

## Saques

O dashboard opera a fila em `/withdrawals`:

1. `GET /api/payment/withdrawals/pending` lista pedidos `pending` e `ledger_pending`.
2. O operador revisa motorista, valor, tarifas, ledger e chave Pix mascarada.
3. A confirmação chama `POST /api/payment/withdrawals/:withdrawalId/process`.
4. O backend usa o ID do operador autenticado para auditoria; `actorId` enviado pelo cliente é ignorado.

O endpoint continua protegido por `driverWithdrawalsEnabled`, pelo papel financeiro e por `ENABLE_ADMIN_MUTATIONS`. `ledger_pending` não deve ser enviado ao Pix Out enquanto o ledger não for reparado pelo próprio fluxo do backend.

O app móvel continua respeitando o perfil de piloto e não foi alterado. Habilitar saques para usuários finais exige a decisão operacional correspondente e entrega do bundle mobile já prevista no plano de lançamento.

## Política financeira

`ride-financial-contract.js` é a fonte canônica da taxa Leaf por corrida e da taxa Woovi. `PaymentService` apenas expõe aliases compatíveis com código legado e deriva seus valores da política canônica, evitando divergência entre cotação, pagamento e repasse.

Alterar valores monetários exige uma tabela aprovada, atualização da política canônica e testes de cotação, snapshot final, ledger e recibo. Esta entrega não altera os valores vigentes.
