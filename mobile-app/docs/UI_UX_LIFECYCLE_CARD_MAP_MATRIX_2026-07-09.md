# Matriz de UX — ciclo de corrida, cards e mapa

## Objetivo

Unificar as superfícies operacionais de passageiro e motorista em uma interface calma,
direcional e verificável. Esta matriz orienta a implementação e a auditoria visual do
runtime canônico (`RobotaxiHomeScreen` e overlays associados).

Ela não altera regras de preço, Pix, despacho, cancelamento ou segurança. Quando um
estado depende de confirmação remota, a interface só pode representar o estado
confirmado pelo runtime.

## Princípios de decisão

1. **Uma decisão por estado.** O card apresenta uma ação primária inequívoca. Ações de
   segurança, suporte e saída continuam acessíveis, mas não disputam o mesmo peso visual.
2. **Divulgação progressiva.** O card fechado mostra estado, consequência imediata e
   próximo passo. Detalhes de rota, preço e preferências abrem em sheet contextual.
3. **Mapa explica espaço; card explica decisão.** O mapa mostra posição, rota, progresso
   e mudança espacial. O card mostra o que aconteceu e o que fazer agora. Nenhum repete
   a informação do outro sem necessidade de segurança.
4. **Transparência sem densidade.** Valor total, método de pagamento e efeitos de uma
   ação permanecem claros; composição, regras e detalhes históricos ficam expansíveis.
5. **Mesma linguagem para os dois papéis.** Superfície clara, raio, respiro, tipografia,
   botão primário, ação secundária discreta e feedback háptico/animado seguem os tokens
   existentes. Não usar bullets, caixas pesadas ou vários CTAs preenchidos.
6. **Movimento informa mudança.** Animações são curtas e funcionais: entrada/saída de
   estado, progresso, atualização de ETA e foco de câmera. Respeitar redução de movimento
   e nunca esconder uma mudança importante apenas pela animação.

## Hierarquia fixa do card

| Camada | Conteúdo | Regra |
| --- | --- | --- |
| 1. Estado | Uma frase humana e específica do evento | Sempre visível; não repetir em título e subtítulo. |
| 2. Prova | Um dado que reduz incerteza: ETA, valor, código Pix ou progresso | Um dado dominante por estado. |
| 3. Decisão | Um CTA primário | Somente um CTA preenchido. |
| 4. Contexto | Até duas linhas de rota, identidade ou proteção financeira | Oculto ou resumido quando não muda a decisão. |
| 5. Detalhe | Recibo, composição, preferências, suporte não urgente | Sheet, expansão ou tela dedicada. |

## Matriz do passageiro

| Estado | Pergunta respondida | Ação primária | Card fechado | Detalhe sob demanda | Evento do mapa |
| --- | --- | --- | --- | --- | --- |
| Home | De onde você sai? | Escolher destino | Origem e campo de destino | Recentes e favoritos após tocar o campo | Centraliza na origem; veículos próximos são contexto discreto. |
| Busca de destino | Para onde você vai? | Selecionar destino | Origem editável e busca | Sugestões, recentes e endereço completo | Não recalcula rota a cada tecla; foca resultado selecionado. |
| Categoria/cotação | Qual viagem confirma? | Continuar para Pix | Categoria padrão, preço total e ETA | Comparação de categorias, rota e composição do preço | Mostra rota prévia e ajusta viewport à categoria/rota, sem competir com o CTA. |
| Pix pendente | Como concluir a reserva? | Copiar código Pix | Valor, expiração e código/QR | Resumo da rota e categoria | Mantém rota estável; não cria animação de busca antes da confirmação. |
| Procurando motorista | O que está acontecendo? | Cancelar busca | Busca ativa, tarifa protegida e tempo/raio em uma única linha | Rota, categoria e suporte | Anima raio/veículos com baixa intensidade; câmera permanece na origem. |
| Sem motorista | O que ocorreu com meu pagamento? | Tentar novamente | Indisponibilidade e situação do Pix | Alterar rota e suporte | Retorna a visão da rota/origem, removendo sinais de busca. |
| Motorista aceitou | Quem vem e quando? | Acompanhar chegada | ETA, nome, carro e placa | Tarifa, rota, contato, compartilhar e segurança | Anima marcador até a origem e mantém ambos visíveis. |
| Motorista chegou | O que faço agora? | Encontrar o motorista | Carro, placa e mensagem/tempo de embarque | Contato, segurança e cancelamento | Fecha a câmera na origem e marcador, sem repetir cronômetro em dois locais. |
| Em viagem | Quando chego? | Nenhuma ação operacional principal; acompanhar | ETA final e destino | Progresso, valor, compartilhar, segurança, suporte e alteração de destino | Câmera de navegação e progresso de rota; recente toque do usuário suspende recentralização. |
| Interrupção operacional | A corrida continua com segurança? | Escolher continuação segura | Motivo confirmado e consequência | Suporte e histórico do evento | Congela rota no último estado confirmado e sinaliza incerteza sem falsa precisão. |
| Concluída | A viagem foi finalizada corretamente? | Avaliar viagem | Total pago e confirmação | Recibo completo e ajuda | Enquadra destino; encerra animações de rota. |

## Matriz do motorista

| Estado | Pergunta respondida | Ação primária | Card fechado | Detalhe sob demanda | Evento do mapa |
| --- | --- | --- | --- | --- | --- |
| Offline | Como começo a dirigir? | Ficar online | Disponibilidade e pré-requisito pendente, se houver | Ganhos, destino e configurações | Região operacional neutra; sem falsa demanda. |
| Online aguardando | O que acontece agora? | Ficar disponível | Status online e uma métrica útil do dia | Ganhos, preferências e destino | Área de operação e demanda apenas se confirmada. |
| Nova oferta | Esta corrida vale aceitar? | Aceitar corrida | Ganho líquido, retirada e distância/tempo de chegada | Destino, pagamento e detalhes da solicitação | Enquadra retirada e destino; anima oferta uma vez, sem pulsos contínuos. |
| A caminho da retirada | Onde vou agora? | Abrir navegação | Próxima instrução/ETA e retirada | Passageiro, contato e detalhes financeiros | Navegação para retirada com câmera ancorada. |
| No local | O passageiro embarcou? | Iniciar corrida quando elegível | Identidade mínima, local e condição de início | Contato, suporte e cancelamento permitido | Foco curto na retirada; remove a rota de aproximação depois do início. |
| Em viagem | Qual é a próxima ação? | Abrir navegação ou concluir quando elegível | Próxima instrução/ETA e destino | Passageiro, ganho líquido e suporte | Navegação para destino; progresso de rota é contínuo. |
| Interrupção operacional | Como resolvo sem perder contexto? | Ação segura indicada pelo runtime | Motivo e consequência confirmada | Suporte e histórico | Congela último trecho confirmado; não simula progresso. |
| Concluída | Quanto recebi e o que segue? | Voltar a ficar disponível | Ganho líquido confirmado | Composição, pedágios e recibo | Enquadra destino e limpa rota com transição breve. |

## Contrato de movimento e interação

- **Entrada de card:** fade + deslocamento vertical curto, somente quando o estado muda.
- **Mudança de conteúdo:** cross-fade/altura interpolada; nunca trocar bloco inteiro de forma abrupta.
- **CTA:** feedback tátil leve e escala sutil no toque; estado de processamento bloqueia repetição e explica o que está aguardando.
- **Atualização de ETA/valor:** transição numérica discreta; mudanças relevantes recebem um rótulo temporal, não um alarme visual.
- **Mapa:** uma animação de câmera por evento; interação manual do usuário tem precedência temporária; rotas e marcadores usam animação contínua apenas durante deslocamento real.
- **Acessibilidade:** reduzir movimento remove deslocamento e mantém troca de conteúdo imediata; todos os controles preservam rótulo e área de toque adequada.

## Critérios de auditoria por estado

Um estado só é aceito quando:

1. um observador identifica o estado e o próximo passo em até cinco segundos;
2. há no máximo um CTA preenchido e nenhuma dupla decisão concorrente;
3. preço, pagamento, motorista, placa e segurança aparecem quando são necessários, sem dados inventados;
4. o mapa acrescenta contexto espacial e não é encoberto por um card sem motivo;
5. detalhes expansíveis podem ser alcançados e fechados sem perda do estado;
6. a transição foi registrada em simulador (captura e vídeo) e não cria tela legada, flicker ou mudança falsa de estado.

## Ordem de implementação

1. Passageiro: home, busca de destino e categoria/cotação — referência visual já mais madura.
2. Passageiro: Pix, busca, aceite, chegada e corrida.
3. Motorista: offline/online, oferta, retirada e corrida.
4. Estados de exceção, recibos, avaliação, suporte e compartilhamento.
5. Mapa, movimento, acessibilidade e auditoria integral no simulador.

## Base de decisão

Aplicamos os mecanismos de **hierarquia de atenção**, **efeito Von Restorff**, **redução de
carga cognitiva** e **defaults éticos**: a interface direciona a próxima ação, sem esconder
informação material. A matriz também usa o filtro **Swiss Knife Index**: itens pouco usados ou
não decisórios deixam o card principal e passam a ser contextuais, em vez de acrescentar mais
uma superfície permanente.
