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

## Complemento do backend publicado no #414

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

Após CI aprovado e autorização específica de Izaak, o #414 foi integrado em
`6d8b128059a0fef63f867a38266299340e0a0113` e os três arquivos foram publicados
nos dois gateways. Smoke público, saúde, SHA e hashes conferidos; 90 s preservados.
Backup: `/opt/leaf-app/backups/modular-rollout-20261023-020519`.
Sem outra OTA, alteração de workers, compose, Contabo ou configuração financeira.

### Desconexão única autorizada com Waze em primeiro plano

Corrida sandbox `booking_1792732084159_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`.
Pagamento sandbox de R$ 49,34 confirmado pelo helper de QA; perfil e namespace
conferidos antes. Aceite às 05:08:11.388Z, com abertura automática do Waze.
Emissor de GPS mantido a 1 Hz, inclusive parado, até o fim da observação.

- Às aproximadamente 05:08:30.409Z, um script de execução única desconectou
  apenas o ID do socket QA, depois de conferir os dois usuários, ACCEPTED,
  namespace sandbox, vínculo e socket único no adapter. Não abriu porta ou serviço.
- A chave independente de tolerância apareceu com TTL restante de 73,7 s,
  enquanto o hash de localização tinha 42,4 s. Não foi feita escrita manual
  em booking, ledger, contadores ou configurações.
- Às 05:09:02.673Z houve presença autenticada de um novo socket, cerca de
  32,3 s após a desconexão, sem trazer Leaf para a frente.
- Às 05:10:12.762Z, mais de 100 s após a desconexão, a mesma corrida seguia
  ACCEPTED com o mesmo motorista e novas posições. O Waze continuava na frente;
  passageiro permanecia em “Motorista a caminho”, sem retorno à busca.

Esse teste físico passou para recuperação em segundo plano e preservação do
vínculo depois do timer antigo. A expiração efetiva do hash antes da recuperação,
socket vivo em outro gateway e erro do adapter continuam cobertos pelas regressões
unitárias; não foram induzidos separadamente nos aparelhos nesta rodada.

### Limpeza interrompida por erro no reembolso sandbox

Uma tentativa de cancelamento normal pelo passageiro às 05:10:42Z falhou no
reembolso, mantendo a corrida ACCEPTED. Não houve segunda tentativa ou estorno
manual. O backend calculou taxa de cancelamento de R$ 3,40 e tentativa de
reembolso parcial de R$ 45,94; não era reembolso integral nesse estado da viagem.
O retorno inicial foi HTTP 502, sem prova de resultado definitivo do estorno.

Consulta somente de leitura identificou a divergência: o resolver do reembolso
reconstruía a configuração apenas por `providerEnvironment`, perdendo o perfil
Firestore gravado na cobrança. Essa configuração respondeu HTTP 401 “appID
inválido”; consulta com o perfil original `qa-test-users-sandbox-durable`
respondeu COMPLETED, valor 4.934 centavos. Essa consulta não prova, isoladamente,
ausência de estorno parcial. Credenciais não foram exibidas, editadas ou copiadas.

Reconciliação posterior às 05:50:16.976Z: GET somente de leitura dos reembolsos
da cobrança, com o perfil original sandbox, respondeu HTTP 200,
`refunds: []` (nenhum estorno registrado naquele instante).
Endpoint conferido na [referência oficial OpenPix/Woovi](https://developers.openpix.com.br/api).
Conferir novamente esse estado imediatamente antes de qualquer nova tentativa.

A correção local, vinculada à issue #415, em
`services/payment-service/02-events-and-status-cache.js`
busca o documento pelo ID do perfil original para cobranças sandbox originadas
no Firestore. Não reclassifica o usuário; aceita perfil pausado/expirado para
liquidar cobrança existente; perfil ausente, ambiente divergente ou erro de leitura
impedem usar credenciais genéricas. O caminho operacional permanece inalterado.
Exige uma leitura adicional desse perfil por resolução; não cria provider ou job.

A revisão do mesmo fluxo também reproduziu uma falha no cliente HTTP: `createApi`
resolve respostas 4xx, mas `processRefund` as devolvia como sucesso. O complemento
em `services/woovi-driver-service.js` exige HTTP 2xx antes de informar sucesso,
classificando 4xx como REJECTED e 5xx como UNKNOWN, sem retry novo. Essa validação
é compartilhada entre ambientes; não altera valores ou política financeira.
Os cinco casos novos (400/401/404/422/502) falharam antes da correção.

Validação local do complemento financeiro: a nova regressão falhou antes da
correção (8 falhas / 4 aprovações) e passou depois. Testes direcionados de resolução
e liquidação parcial: 24 aprovados; cliente HTTP: 9 aprovados.
Backend completo final: **352 suítes / 3.103
testes aprovados**. Fixtures dos testes antigos passaram a incluir o perfil
original e a conferir a credencial escolhida; sem mudar suas expectativas de
valor, saldo, duplicação ou revisão de resultado ambíguo. Houve falhas intermediárias
por fixture incompleta e uma falha transitória em rota de autenticação inalterada;
não estão presentes na execução completa final.
Os testes usaram cópias idênticas dos arquivos alterados no espelho local de
validação, com dependências já existentes; nenhuma instalação/substituição de
dependências do usuário. Configuração de desenvolvimento/sandbox sintética,
governança, segredos e diff check aprovados.

A corrida QA continua aberta até cancelamento, após nova conferência do provedor. Contadores
conferidos: sandbox 2, operacional 0. Mock GPS foi parado, permissões e sessões
preservadas; Leaf motorista foi trazido à frente. Não declarar motorista Offline
ou passageiro no mapa inicial antes de confirmar a conclusão dessa limpeza.
Novo deploy e intervenção para recuperar o cancelamento exigem aprovação própria.

Rollback da correção financeira: reverter os dois arquivos de runtime e
republicá-los pelo rollout guardado, sem tocar credenciais ou dados financeiros.
Isso restabelece a limitação de perfil e o tratamento incorreto de respostas 4xx.
A correção não resolve
rotação de credenciais dentro do mesmo documento; depende do perfil original
continuar disponível com credenciais válidas. A ausência de reembolsos foi
reconciliada somente no instante descrito acima; exige nova conferência antes
de qualquer repetição.

Rollback: reverter o complemento e republicar os três arquivos anteriores pelo
rollout guardado; a chave nova expira sozinha. Backend/OTA do #412 têm rollback
para o backup acima e OTA anterior `efc68ff1`. Não apagar contadores ou ledger.

Logs, JSONs e capturas ficam fora do Git em
`waze-camera-investigation-2026-10-23/release-e2e`, nas evidências deste chat.
A primeira corrida operacional com passageiro pagando Pix real segue pendente.
