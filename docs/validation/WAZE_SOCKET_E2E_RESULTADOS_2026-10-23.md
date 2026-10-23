# E2E físico e complemento da reconexão — 2026-10-23

## Publicação autorizada e verificada

- #412 integrado em `d49fc0e128165ca595305d4a9c5e495e3a6e7b82`.
- Santiago: dois arquivos de runtime publicados, gateways saudáveis, smoke
  público aprovado e hashes dos arquivos conferidos em ambos os containers.
  Workers, compose, flags e Contabo preservados. Tolerância efetiva: 90 s.
- Backup: `/opt/leaf-app/backups/modular-rollout-20261023-010158`.
- OTA production: grupo `fe321a6d-578a-46fc-89eb-d673e8cd5cbf`, runtime 1.0.11.
  Manifestos iOS/Android confirmados, configuração pública idêntica à OTA anterior.
  iPhone: banco Expo local confirmou início bem-sucedido do novo update
  `01a166ef-9b26-78c3-8722-a8608f237192`. Android foi reiniciado duas vezes para
  carregar a OTA; seu identificador em execução não foi confirmado diretamente.
- Sentry: mapas das duas plataformas processados; artifact bundle
  `96a46dde-2e9e-5397-b4ed-eff1462ca6f6`. Sem build nativo ou loja.

## Corrida física com GPS e pagamento sandbox

Android motorista `irsgaiscr4j7cenv`, iPhone passageiro
`00008130-000C70510A93803A`, sessões existentes de QA.
Corrida: `booking_1792729195895_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`.
Escopo financeiro sandbox verificado antes do primeiro pagamento; a rota de
confirmação de QA também valida o escopo. Nenhum Pix operacional foi realizado.

| Etapa | Evidência observada |
| --- | --- |
| Primeira tentativa | Oferta expirou durante leitura lenta da UI Android. O passageiro cancelou e a UI confirmou reembolso sandbox integral de R$ 36,70 e taxa zero. Não conta como teste de desconexão após aceite. |
| Aceite da segunda tentativa | 04:19:59Z: ACCEPTED no servidor, motorista vinculado, Waze abriu automaticamente, passageiro em viagem ativa. |
| Waze após aceite | 04:22:29Z: mesma corrida e socket após 150 s em Waze; novas posições recebidas. Sem retorno à busca. |
| Aproximação | Capturas a aproximadamente 170 m, 90 m, 10 m e 0 m. O zoom de rua relatado não reapareceu. |
| Chegada/início | ARRIVED confirmado nos dois lados; IN_PROGRESS às 04:28:52Z, com pagamento em garantia. |
| Trajeto | Cerca de 12,3 km de posições simuladas sobre a geometria da rota, divididas em duas etapas; Waze em primeiro plano e passageiro acompanhando a viagem. |
| Encerramento | Ao parar o emissor de GPS de QA no fim da rota, houve perda de presença/conexão e os primeiros gestos não concluíram. Após retomar fixes a 1 Hz, a conexão recuperou com novo socket e a corrida concluiu às 04:44:39Z, sem reiniciar o app. |
| Recibos | Passageiro R$ 35,78; motorista R$ 34,29. Um alerta tardio de indisponibilidade apareceu sobre o recibo concluído do motorista após as tentativas de encerramento. Capturado e dispensado. A rodada não é um E2E sem ressalvas. |

O emissor de mock GPS envia uma posição por comando; não continua emitindo ao
terminar o script. A interrupção foi uma condição do teste, não prova de perda
espontânea de GPS no aparelho. A causa exata da queda de conexão e do alerta
tardio permanece sem diagnóstico fechado. Waze lê GPS físico; esta rodada avalia
a continuidade do Leaf em segundo plano, não a fidelidade da rota visual Waze.

## Conferência financeira e encerramento do QA

Snapshot autoritativo final e recibo RTDB sandbox conferidos:

- Conclusão qualificada: `SERVER_DESTINATION_COMPLETION`, sem revisão pendente.
- Bruto 3.578 centavos; Leaf 99; Pix 50; líquido 3.429; snapshot balanceado.
- Contador Redis e checkpoint Firestore sandbox: **1 → 2**, uma ocorrência da corrida.
- Contador operacional: **0 → 0**; nenhum valor de QA consumiu a promoção operacional.
- A UI do passageiro agrega R$ 1,49 em “Taxa Leaf”; o recibo persistido separa
  R$ 0,99 operacional e R$ 0,50 Woovi. A apresentação permanece uma ressalva.
- Motorista devolvido ao estado Offline, passageiro ao mapa, mock GPS parado;
  permissões e sessões preservadas. Nenhuma senha/OTP, limpeza ou reinstalação.

## Complemento necessário no backend, ainda sem publicação

A revisão da rodada expôs dois casos reproduzidos em regressões locais:

1. O hash de localização em viagem tem TTL de 60 s. HSET do prazo de reconexão
   nesse hash preservava seu TTL, podendo perder a proteção antes dos 90 s.
   O prazo agora fica em chave Redis própria, com PX igual à tolerância existente.
2. A presença distribuída pode vencer com socket vivo em outro gateway. O monitor
   agora consulta o adapter Socket.IO quando o cache não comprova presença.
   Falha da consulta impede inferir ausência. Um timer antigo também respeita
   uma janela posterior registrada em outro gateway.

Escopo: três arquivos de runtime backend e quatro arquivos de testes; sem nova
dependência, processo, provider pago, flag, tolerância ou regra financeira.
Backend completo: **351 suítes / 3.086 testes** aprovados; direcionados: 33 testes.
Uma execução completa anterior falhou em dois testes de rotas inalterados (401
em vez de 503); ambos passaram no recheck isolado e na nova execução completa.
Governança, segredo rastreado, segredo hardcoded e diff check aprovados.

Esse complemento exige CI, aprovação específica e novo deploy restrito dos três
arquivos, sem outra OTA. Depois, validar a proteção até 90 s e o reconhecimento
de socket remoto. Não provocar falhas no telefone ou desconectar sockets por
escrita manual no servidor sem autorização específica para essa injeção de falha.

Rollback: reverter o complemento e republicar os três arquivos anteriores pelo
rollout guardado; a chave nova expira sozinha. Backend/OTA do #412 têm rollback
para o backup acima e OTA anterior `efc68ff1`. Não apagar contadores ou ledger.

Logs, JSONs e capturas ficam fora do Git em
`waze-camera-investigation-2026-10-23/release-e2e`, nas evidências deste chat.
A primeira corrida operacional com passageiro pagando Pix real segue pendente.
