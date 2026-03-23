# Design System Robotaxi - Rollout V2 (Passageiro + Motorista)

## Objetivo
Escalar o visual premium/light atual do prototipo para todas as telas-chave do app, com consistencia de tokens, componentes, motion e comportamento de mapa.

## Principios de consistencia
- Mapa como camada base sempre persistente.
- Modais/sheets sobrepostos, sem recriar mapa por tela.
- Hierarquia unica de tipografia e espacamento (4/8/12/16/20/24/32).
- Componentes reutilizaveis e estados previsiveis (loading, empty, action, error).
- Transicoes curtas, fluidas e funcionais, sem over-animation.

## Tokens (fonte unica)
Arquivo base:
- `src/components/design-system/robotaxiPrototypeTokens.js`

Regras:
- Nao hardcodear cor/tamanho fora do token quando houver equivalente.
- Estado selecionado usa apenas `color.accent.primary`.
- Cards e ilhas com opacidade controlada e sombra padronizada.

## Mapa e composicao global
- Mapa ocupa 100% da tela (inclui status bar area).
- Controles superiores e ilha inferior fixos.
- Sheets ocupam area inferior com margem lateral de 10px.
- `fitToCoordinates` com edge padding dinamico para manter rota visivel acima do card.

## Ondas de entrega

### Onda 1 - Foundation (concluida nesta rodada)
- Home + destino + booking + busca de motorista + viagem (base overlay).
- Ajustes de polyline em 2000ms.

### Onda 2 - Passageiro expandido (concluida nesta rodada)
- Modal de pagamento.
- Tela de chat.
- Tela de suporte.
- Tela de recibo/historico.
- Integracao de navegacao a partir de perfil/viagem.

### Onda 3 - Motorista MVP (concluida nesta rodada)
- Painel principal do motorista.
- Tela de oferta de corrida.
- Tela de viagem ativa do motorista.
- Fluxo navegavel entre painel -> oferta -> viagem ativa.

### Onda 4 - Hardening visual e UX (concluida nesta rodada)
- Revisao de contraste e opacidade de superficies por estado.
- Revisao de toque (>=44px) para controles de retorno e acao.
- Refino de motion snappy premium (sheet + transicoes de conteudo).
- Ajustes finos de densidade e separadores para leitura mais limpa.

### Onda 5 - Integracao funcional real (pendente)
- Conectar dados reais (corridas, chat, pagamento, recibos).
- Ligar eventos de websocket e estados de corrida.
- Validar regressao funcional com cenarios e2e.

## Backlog por fluxo

### Passageiro
- [x] Home com mapa persistente
- [x] Selecao/confirmacao de destino
- [x] Escolha de categoria/tarifa
- [x] Procura de motorista (radar)
- [x] Viagem em andamento
- [x] Pagamento (modal)
- [x] Chat
- [x] Suporte
- [x] Recibo/historico

### Motorista
- [x] Dashboard do motorista (status + metricas + corridas)
- [x] Oferta de corrida (aceitar/recusar)
- [x] Viagem ativa (navegacao + status)
- [ ] Fila em tempo real (websocket)
- [ ] Ganhos e repasse detalhado
- [ ] Chat com passageiro em tempo real

## Criterios de aceite V2
- Todas as telas novas usam o mesmo conjunto de tokens.
- Nao ha recriacao de mapa ao trocar overlays.
- Fluxos principais navegaveis de ponta a ponta em prototipo.
- Componentes e estilos compartilhados, sem divergencia visual entre passageiro/motorista.
- Overlays do prototipo sem animacao de tela inteira no navigator (animacao local no sheet).

## Proximos passos recomendados
1. Aplicar o mesmo padrao nas telas legadas fora da pasta `prototype`.
2. Conectar dados reais de corrida/chat/pagamento mantendo os contratos visuais.
3. Executar checklist de acessibilidade e performance antes de promover para o fluxo principal.
