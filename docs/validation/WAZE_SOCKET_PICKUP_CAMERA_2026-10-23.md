# Waze, reconexão após aceite e câmera do passageiro

Atualização: o #412 foi publicado e o ciclo físico foi executado. Consulte
[resultados e complemento](WAZE_SOCKET_E2E_RESULTADOS_2026-10-23.md) para o estado
atual; as etapas pendentes abaixo registram o plano anterior à publicação.

## Objetivo e escopo

Investigar a perda da corrida aceita com o Waze em primeiro plano e o zoom
excessivo do passageiro perto do embarque; preparar correções e validar o ciclo
completo nos dois aparelhos. Base inspecionada: `c974d227e` (#410).
Nenhuma regra financeira, de KYC ou de promoção foi alterada.

## O que foi comprovado no código e em testes

1. `register-socket-disconnect-handler.js` ignorava a janela configurada de
   reconexão quando havia corrida aceita. Agora aplica a mesma janela e publica
   seu prazo no hash Redis do motorista para o monitor respeitá-la também.
   Ao expirar, consulta os gateways; erro nessa consulta não comprova ausência.
   A recuperação continua funcionando depois do prazo sem reconexão.
2. `accepted-ride-recovery-monitor.js` consultava apenas o mapa local de sockets.
   Agora usa também a presença distribuída existente, com validação de identidade,
   sala e validade. Respeita o prazo compartilhado, inclusive se a desconexão
   acontecer durante a passagem do monitor. Prazos vencidos ou acima da janela
   configurada não protegem um motorista ausente.
3. `LocationBufferService.js` descartava presença ou guardava posições quando o
   socket estava indisponível, sem solicitar recuperação da sessão. A tarefa
   existente agora solicita o orquestrador autenticado, sem aguardar a rede,
   agrupando tentativas pendentes e limitando novas tentativas a uma a cada 10 s.
4. `PrototypeMapLayer.js` podia chamar `fitToCoordinates` com pontos quase iguais
   quando a geometria da rota desaparecia. Isso ignorava a região de fallback
   limitada pelo passageiro. Agora preserva essa região enquanto não há geometria.
   Testes exercitam a transição em iOS e Android. O limite de zoom não foi alterado.

A origem física do `transport error` relatado na corrida anterior não foi
comprovada nesta investigação. O caminho da câmera é uma causa reproduzida em
teste, cuja participação no incidente do aparelho ainda requer confirmação.

## Validação local

- Backend: 350 suítes / 3.074 testes aprovados; direcionados: 3 suítes / 18 testes.
- Mobile: 223 suítes / 1.774 testes aprovados, incluindo mapa e presença de fundo.
- Governança, segredo rastreado, segredo hardcoded, production guards e
  `git diff --check`: aprovados.
- `config:validate`: aprovado com perfil local development/sandbox e token fictício;
  isso não valida configuração nem credenciais de produção.
- Regressões também executadas contra os arquivos anteriores às correções.

O checkout tem dependências locais divergentes: um link `node_modules/node_modules`
aponta para outro checkout, e o backend encontra dotenv 17 em vez do 16.6.1 travado.
Para não alterar dependências do usuário, o mobile foi executado com resolver
externo que mantém uma única instância de React/React Native. O backend foi
executado em cópia isolada dos fontes com as dependências existentes do backend
`leaf-wave`, incluindo dotenv 16.6.1. Logs e configurações de validação estão fora
do Git em `waze-camera-investigation-2026-10-23` na pasta de evidências deste chat.

## E2E físico ainda pendente

Pré-condições: aprovação específica para merge/deploy/OTA, CI aprovado, confirmação
da janela efetiva `DRIVER_DISCONNECT_GRACE_MS`, backend atualizado e mesma OTA JS
carregada nos dois aparelhos de produção 1.0.11. O registro do Claude menciona
90 s; esse valor ainda não foi conferido no runtime nesta rodada.
Usar Android USB `irsgaiscr4j7cenv` como motorista e iPhone físico
`00008130-000C70510A93803A` como passageiro, nas sessões já autenticadas.
Confirmar escopo sandbox antes de qualquer pagamento de QA. Não digitar senha/OTP,
limpar dados, reinstalar ou alterar permissões/configurações dos aparelhos.

| Etapa | Evidência e aceitação |
| --- | --- |
| Solicitar e pagar | Booking sandbox, pagamento confirmado antes do início; IDs e horários correlacionados nos dois apps. |
| Aceitar e abrir Waze | Manter Waze em primeiro plano por mais de 2 min; mesmo motorista e booking permanecem vinculados, sem `SEARCHING`/substituição; posições e conexão verificadas nos dois gateways. |
| Aproximar do embarque | Percorrer pontos progressivos até poucos metros usando o mock GPS já configurado; capturar câmera do passageiro antes, durante e após a chegada, incluindo eventual desaparecimento da linha. |
| Chegar e iniciar | Chegada confirmada no servidor e passageiro atualizado; corrida inicia somente com pagamento confirmado. |
| Percorrer e concluir | Outra permanência com Waze em primeiro plano durante o trajeto; concluir no destino, sem travamento nem recuperação indevida da corrida. |
| Recibo e contador | Conferir bruto do passageiro, líquido do motorista e R$ 0,99 Leaf + Pix separado enquanto elegível; contador sandbox incrementa uma vez e operacional não muda. |

Waze usa a posição física do telefone; a posição simulada do Leaf não comprova
fidelidade da rota exibida pelo Waze. Este cenário avalia continuidade do Leaf
em segundo plano. Não provocar falha de rede por alteração de configuração do
telefone sem autorização específica; os controles de expiração da tolerância
estão cobertos nos testes unitários.

## Riscos, rollback e itens fora do escopo

A janela existente também passa a proteger corridas aceitas, o que pode atrasar
a recuperação de uma ausência real até o prazo configurado. A presença de outro
gateway deve estar fresca. Sem execução física, não há aceite final da solução.
Rollback: reverter este PR e, se publicado, fazer rollout do backend anterior e
republicar a OTA anterior compatível com 1.0.11 pelos processos aprovados.
Não apagar contadores nem alterar dados financeiros.

Primeira corrida operacional paga com Pix real continua separada: observar o
contador e o recibo quando ela ocorrer, sem convertê-la em corrida de QA.
Sem build nativo, submissão às lojas, nova dependência, serviço, chamada paga,
mudança de promoção, correção da tela de busca ou de outros problemas históricos.
