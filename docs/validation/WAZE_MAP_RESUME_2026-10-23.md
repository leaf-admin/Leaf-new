# Retorno do Waze ao Leaf — QA físico de 2026-10-23

Objetivo: concluir a validação da #411 e investigar a falha de encerramento
observada no E2E anterior, com GPS contínuo até depois dos recibos.

## Ambiente e resultado físico

Dois aparelhos reais, apps de loja 1.0.11, sessões QA existentes; backend
Santiago com #414, #416 e #417 publicados. GPS simulado e Pix **sandbox**, perfil
`qa-test-users-sandbox-durable`. Nenhum pagamento operacional, nova publicação,
build nativo, mudança de permissão ou desconexão induzida nesta rodada.

Corrida: `booking_1792765169453_3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2`.

| Etapa (UTC) | Evidência |
| --- | --- |
| 14:19:37 | Aceite confirmado; Waze abriu automaticamente. |
| 14:21:54 | Mesma corrida e socket após mais de 137 s; passageiro sem retorno à busca. Capturas a aproximadamente 170 m, 90 m e poucos metros mantiveram o enquadramento amplo do embarque. |
| 14:22:49 / 14:23:16 | Chegada e início confirmados nos dois apps; pagamento em garantia. |
| 14:23:36–14:39:04 | Percurso de 14,16 km sobre a geometria da corrida; emissor contínuo de GPS, incluindo pausas e destino. Waze na frente durante o trajeto, com posições chegando ao servidor e passageiro. |
| 14:39:11 | Última posição recebida antes da falha, já no retorno do Leaf à frente. O emissor continuou entregando fixes. |
| 14:39:16 / 14:39:19 | Android registrou `APP_SCOUT_WARNING` e `APP_SCOUT_HANG` no processo Leaf. A stack de main passa por `MapModule.pointForCoordinate` → `GoogleMap.getProjection` → Binder, durante montagem Fabric. |
| 14:40:15 | Hash de localização e presença expirados; vínculo e booking ainda IN_PROGRESS. Um único gesto de encerramento ficou pendente; passageiro mostrou sinal instável. Não houve repetição enquanto pendente. |
| 14:42–14:43 | Voltar ao Waze não recuperou a presença. Reiniciar somente o processo Leaf recuperou o mesmo booking e um novo socket, sem limpar dados ou login. Um novo gesto após essa recuperação concluiu às 14:43:18.608. |

**E2E reprovado no retorno/encerramento:** a conclusão precisou de reinício.
O zoom de rua no embarque não reapareceu. A interrupção do emissor de GPS não
explica esta rodada. A stack identifica um caminho nativo bloqueado, mas não
prova que ele seja a única causa da perda de presença ou do alerta anterior.

## Conferência financeira e limpeza

Recibos físicos nos dois apps e recibo autoritativo RTDB conferidos: passageiro
R$ 42,56; motorista R$ 41,07. Snapshot final: bruto 4.256 centavos, incluindo
pedágio explícito de 995; Leaf 99; Pix 50. Ledger sandbox
`ride_settlement_ed126e6c74fce8f6075c44d7be4dc624`, posted e balanceado:
débito/crédito de 4.256 centavos.

Conclusão `SERVER_DESTINATION_COMPLETION`, qualificada, sem revisão pendente.
Redis e checkpoint Firestore: sandbox **2 → 3**, com uma ocorrência da corrida;
operacional **0 → 0**. Vínculo ativo removido. Às 14:45:03, motorista Offline e
sem booking ativo; passageiro voltou ao mapa inicial; emissor e serviço mock
GPS parados, com permissões e sessões preservadas.

Não reapareceu alerta tardio durante mais de um minuto no recibo após a
recuperação; isso não resolve nem reproduz a condição do alerta anterior.
A UI ainda agrupa R$ 1,49 como “Taxa Leaf”; o recibo persistido separa os custos.

## Correção preparada e validação local

Escopo: `PrototypeMapLayer.js`, testes de viewport e este relatório.
Com carros nativos habilitados, os hooks ainda consultavam a projeção de
sobreposições de carro não renderizadas. A correção só habilita consultas para
sobreposições efetivamente usadas e pausa a inspeção nativa da câmera fora do
estado ativo. Preserva os marcadores nativos e o cálculo de heading existente.

Regressões antes da correção: duas chamadas de projeção no mapa do passageiro
e quatro no do motorista; depois, zero com o mesmo marcador nativo visível.
Teste de pausa/retomada e remoção do listener incluído. Suíte direcionada:
**38 testes aprovados**. A execução padrão inicialmente parou na resolução de
duas instalações React Native; a validação usa o resolver local já existente,
com a configuração do repositório e uma única instância das dependências.
Nenhuma dependência instalada ou substituída.

Guardas de produção, governança, varreduras de segredos e diff check aprovados.
Suíte mobile completa: **223 suítes / 1.777 testes aprovados** com o mesmo resolver
local. CI do commit e publicação permanecem etapas separadas.

Risco: queries necessárias aos overlays legados continuam existindo quando
usados; não há prova física da correção até uma OTA aprovada e novo E2E.
Rollback: reverter o commit mobile e republicar o JS anterior pelo fluxo aprovado;
preservar o backend, ledger, contadores e dados dos aparelhos.

Fora de escopo: backend, valores/regras financeiras, KYC, permissões, dependências,
builds nativos, lojas, testes de falhas adicionais e primeira corrida operacional.
Capturas, logs e JSONs fora do Git em
`release-e2e/followup-414/release-417/visual-closeout/full-e2e`, nas evidências
locais de `waze-camera-investigation-2026-10-23` deste chat.
