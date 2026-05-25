# Design System Passageiro (Robotaxi-Inspired) - Leaf v1

## 1) Objetivo
Fechar um design system para a experiencia do passageiro no mapa, mantendo 100% dos itens funcionais atuais (busca, selecao de carro, status da corrida, contato, cancelamento, seguranca e pagamento), mas com novo layout visual inspirado em interfaces "vehicle-first" como Robotaxi.

Principio: mudar forma e hierarquia visual, sem quebrar contrato funcional.

Contexto de prototipagem:
- Branch de trabalho isolada: `feature/ui-ux-redesign-prototype`
- Prototipo dedicado: tela `RobotaxiPrototype` no app mobile

## 1.1) Referencias visuais usadas (anexos de 2026-03-17)
- Referencia A: seletor de veiculo + card de reserva sobre mapa (dark + highlight dourado)
- Referencia B: mapa central com barra de busca premium, categorias e lista de destinos em painel
- Referencia C: sequencia de estados Tesla com foco em mapa escuro e paineis minimalistas

Elementos de linguagem extraidos:
- Dark surfaces com profundidade suave
- Accent dourado para estados de conversao (CTA / demanda)
- Mapa como protagonista; painel como modulo funcional
- Densidade baixa e tipografia limpa para leitura rapida

## 2) Diagnostico do estado atual
Arquivos-base analisados:
- `mobile-app/src/screens/NewMapScreen.js`
- `mobile-app/src/components/map/PassengerUI.js`
- `mobile-app/src/components/map/PassengerWaitingUI.js`
- `mobile-app/src/components/map/PassengerEnRouteUI.js`
- `mobile-app/src/components/map/PassengerOnTripUI.js`
- `mobile-app/src/common-local/theme.js`
- `mobile-app/src/components/design-system/Typography.js`
- `mobile-app/src/components/design-system/AnimatedButton.js`

Achados principais:
- Existem 4 estados de tela do passageiro corretos no fluxo, mas com linguagem visual diferente entre si.
- Tema ainda nao esta realmente centralizado (`useTheme` retorna apenas light por padrao), causando inconsistencia.
- O app ja tem fundamentos de design system (typography/button/input), mas faltam tokens de layout, elevacao, motion e componentes de painel de corrida unificados.

## 3) Fluxo funcional que precisa permanecer
Mapeamento por status (sem alteracao de regra):
- `SEM BOOKING`: `PassengerUI`
- `ACCEPTED`/`REACHED`: `PassengerEnRouteUI`
- `STARTED`: `PassengerOnTripUI`
- `COMPLETE`: `RatingUI`

Contrato funcional minimo (nao remover):
- Endereco origem/destino editavel
- Opcoes de carro + preco/estimativa
- Acao principal de solicitar corrida
- Estado de busca por motorista (tempo/mensagem)
- Dados do motorista (foto/nome/carro/placa/rating)
- Acoes: ligar/chat/compartilhar
- Acoes criticas: cancelar / emergencia
- Atualizacao de localizacao do motorista

## 4) Direcao visual v1 (inspirada em Robotaxi)
### 4.1 Linguagem
- "Glass + solid cards": mapa como protagonista, paineis com foco em legibilidade.
- Alta hierarquia no CTA principal (1 acao primaria por estado).
- Painel inferior modular por estado (sheet compacto -> expandido).
- Status chips fortes para leitura rapida (a caminho, em viagem, procurando).

### 4.2 Paleta semantica (tokens)
Use estes tokens como fonte unica para passageiro:

```js
color.bg.canvas = '#F4F6F8'
color.bg.surface = '#FFFFFF'
color.bg.overlay = 'rgba(10,18,24,0.55)'

color.text.primary = '#0D141C'
color.text.secondary = '#5B6673'
color.text.inverse = '#FFFFFF'

color.brand.primary = '#1A330E'
color.brand.accent = '#2A4D1D'

color.status.success = '#2A4D1D'
color.status.warning = '#F4A300'
color.status.danger = '#E5484D'
color.status.info = '#1A330E'

color.border.soft = '#E6EAF0'
color.border.strong = '#CBD4E1'
```

Observacao: manter `leafGreen` como token de compatibilidade durante migracao.

### 4.3 Tipografia
Fonte-base: `Poppins` (ja padrao no app).

Escala:
- Display: 28/34 bold
- Title: 22/28 semibold
- Subtitle: 18/24 medium
- Body: 15/22 regular
- Caption: 13/18 regular
- Micro: 11/14 medium

### 4.4 Espacamento e raio
- Grid: multiplo de 4
- Espacamentos canonicos: 4, 8, 12, 16, 20, 24, 32
- Raio: 12 (sm), 16 (md), 24 (lg), 32 (xl)

### 4.5 Elevacao
- `elevation.1`: cartao leve (conteudo)
- `elevation.2`: painel flutuante (sheet)
- `elevation.3`: CTA fixo/alerta

### 4.6 Motion
- Duracao: 160ms (micro), 240ms (padrao), 360ms (entrada de sheet)
- Curva: `ease-out` para entrada, `ease-in-out` para transicao de estado

## 5) Componentes obrigatorios do DS v1
- `RideBottomSheetShell`
- `RideStateHeader` (status chip + timer/ETA)
- `DriverIdentityCard` (avatar, nome, carro, placa, nota)
- `TripPathCard` (origem -> destino)
- `TripMetaRow` (tempo, distancia, tarifa)
- `RideQuickActions` (ligar/chat/compartilhar)
- `PrimaryRideCTA` (solicitar, cancelar, emergencia)
- `InlineSafetyBanner`

## 6) Blueprint visual (passageiro)
### 6.1 Estado: sem booking (busca)
```text
[Top controls map]

[Mapa em destaque]

[Bottom Sheet - collapsed]
  Origem
  Destino
  ----------------------
  Carrossel tipos de carro
  Tarifa estimada
  [ CTA: Solicitar corrida ]
```

### 6.2 Estado: motorista a caminho
```text
[Mapa com rota + motorista]

[Bottom Sheet - medium]
  [Chip: Motorista a caminho] [ETA]
  [DriverIdentityCard]
  [TripPathCard]
  [RideQuickActions]
  [CTA secundario: Cancelar]
```

### 6.3 Estado: em viagem
```text
[Mapa com rota ativa]

[Bottom Sheet - medium]
  [Chip: Em viagem] [Cronometro]
  [DriverIdentityCard]
  [TripMetaRow: tempo/distancia/tarifa]
  [RideQuickActions]
  [SafetyBanner]
  [CTA critico: Emergencia]
```

## 7) Regras de composicao por estado
- Sempre 1 CTA primario por estado.
- Acoes destrutivas nunca competem com CTA primario (ficam secundarias ou em area de risco).
- Dados do motorista sempre acima das acoes.
- Origem/destino sempre com iconografia fixa e contraste AA.

## 8) Plano de migracao sem regressao
Fase 1 (estrutura visual):
- Criar shell unico de painel inferior para passageiro.
- Aplicar tokens de cor/espaco/raio em `PassengerWaitingUI`, `PassengerEnRouteUI`, `PassengerOnTripUI`.

Fase 2 (unificacao funcional):
- Extrair blocos compartilhados (DriverIdentityCard, TripPathCard, RideQuickActions).
- Reduzir duplicacao entre os 3 componentes de estado.

Fase 3 (hardening):
- Ajustar dark mode real no hook de tema.
- Validar contraste, touch targets (>=44) e performance de animacao.

## 9) Criterios de aceite para considerar "fechado"
- 100% dos estados do fluxo renderizados pelo mesmo sistema de tokens.
- 0 cores hardcoded fora dos tokens (exceto fallback legado documentado).
- 0 diferenca de comportamento funcional entre layout antigo e novo.
- Paridade visual entre os 3 estados do passageiro (mesma linguagem).
- Checklist de acessibilidade aprovado (contraste, leitura e alvo de toque).

## 10) Decisoes travadas (v1)
- Manter `Poppins` como familia oficial.
- Manter semantica de status de corrida existente no `NewMapScreen`.
- Inspiracao visual Robotaxi sem copiar componentes proprietarios.
- Migracao incremental por componentes de mapa do passageiro, sem tocar backend.
