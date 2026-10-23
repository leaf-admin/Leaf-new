# Complemento do contrato de reembolso — 2026-10-23

## Objetivo e escopo

Completar a requisição de reembolso à Woovi com o `correlationID` obrigatório,
usando o `refundRequestId` já reservado duravelmente no Firestore. Não gerar
identificador novo a cada chamada nem adicionar retry para resultado ambíguo.

Runtime: `services/payment-service/04-refunds-and-release.js` propaga o ID;
`services/woovi-driver-service.js` exige o ID antes do envio, codifica o identificador
no caminho, limita o comentário a 140 caracteres e preserva a referência de
correlação retornada no `refundId`. Recusas HTTP registram apenas status e classe
de entrega, sem corpo ou credenciais. Três arquivos de testes cobrem o contrato,
a correlação com a reserva durável e sua estabilidade na repetição permitida.

Referência primária: [contrato oficial de reembolso OpenPix/Woovi](https://developers.openpix.com.br/api).
O POST `/api/v1/charge/{id}/refund` exige `correlationID` no corpo. A resposta
documentada contém `refund.correlationID`, podendo estar IN_PROCESSING. Isso
não equivale a confirmação final de estorno; conferir a lista do provedor.

## Evidência anterior e limite de diagnóstico

O #416 foi publicado em `44251e1e5c1fef36c8489b88448c4e3b06f05447`, dois
gateways saudáveis, hashes e smoke aprovados. Backup:
`/opt/leaf-app/backups/modular-rollout-20261023-025448`.

Após GET dos reembolsos retornar HTTP 200 e lista vazia, houve uma tentativa
normal de cancelamento pelo app às 05:56:41Z. O backend calculou taxa de
1.776 centavos e reembolso de 3.158 centavos; falhou sem fechar a corrida.
A consulta posterior continuou com zero reembolsos. Não houve nova tentativa
manual. A resposta específica da recusa não ficou registrada; não afirmar que
o campo ausente seja a única causa. O envio sem campo obrigatório é comprovado
no código e na regressão de contrato, e precisa ser corrigido.

Na retomada às 12:48:12Z, após os telefones ficarem indisponíveis, a mesma corrida
QA estava REASSIGNMENT_PENDING / SEARCHING, sem motorista vinculado e sem início.
O pagamento continuava CONFIRMED, provedor com zero reembolsos, contador sandbox
2 e operacional 0. Isso não contradiz o teste de recuperação dentro dos 90 s;
o desligamento prolongado dos aparelhos não está protegido indefinidamente.
Mock GPS já parado, sessões e permissões preservadas. Nenhum dado financeiro
foi editado manualmente para liberar a corrida.

## Testes

- Antes do complemento: 6 falhas / 98 aprovações em três suítes direcionadas.
- Depois: 104 testes direcionados aprovados.
- Backend completo: 352 suítes / 3.105 testes aprovados, em espelho local com
  dependências existentes e os cinco arquivos de backend byte a byte idênticos.
- Rodar também diff check, governança, segredo rastreado, hardcoded e configuração
  sintética antes do commit. CI e estado publicado devem ser conferidos à parte.

## Riscos, rollback e fora de escopo

O ID de correlação não autoriza repetir resultado UNKNOWN automaticamente.
Os critérios de retry e revisão existentes permanecem. Chamadas sem o ID durável
falham antes do envio; `rg` identificou apenas o wrapper de pagamento como chamador
de runtime do adapter. A validação HTTP é compartilhada entre ambientes.

Rollback: reverter os dois arquivos de runtime pelo rollout guardado e preservar
ledger, cobranças, reembolsos, contadores e credenciais. O rollback restaura a
limitação conhecida de requisição sem o campo obrigatório.

Não alterar taxa, split, política de cancelamento/reembolso, valores, saldo,
credenciais/perfis, flags, dependências, jobs, workers, compose, Contabo, mobile,
OTA ou lojas. Publicação limitada ao complemento e à única corrida sandbox QA
conhecida; aguardar se outra corrida estiver ativa. Não declarar E2E/limpeza
concluídos sem conferir resultado real, persistência e estado dos aparelhos.
