# Checkpoint UI/UX motion — 2026-10-14

Ponto de retomada para continuar o trabalho de micro-interações e marcador de carro
em outra sessão/conta sem começar do zero.

## Onde está o código

- Worktree: `/Users/izaakdias/.codex/worktrees/leaf-ui-rc106/Leaf-new`
- Branch: `codex/leaf-motion-microinteractions` (base: `codex/vehicle-marker-refinement`)
- Nada foi enviado (push) ainda. Nenhum PR aberto.
- Commits relevantes:
  - `afde8d8aa` câmera do motorista (vehicle-marker-refinement)
  - `4d2263eec` aliases Map/MapScreen/TabRoot redirecionam para a home única
  - `e5784358d` motion lab (dev-only)
  - `53e5f82ac` lab v2 + conceitos de carro + este checkpoint
  - `1c0839a59` marcador SUV (conceito C) em produção — suíte mobile 1660/1660 e production-guards OK

## Motion lab (somente __DEV__)

- Abrir no iPhone: `xcrun devicectl device process launch --device 00008130-000C70510A93803A --payload-url "leafapp://dev/motion-lab" br.com.leaf.ride`
- Arquivo: `mobile-app/src/screens/prototype/lab/LeafMotionLab.js`
- Cenas (chips): Tudo, Abertura, Rota, Categoria, Busca, Encontrou, Carros.
- Estado aprovado pelo Izaak:
  - Abertura: splash atual parada; o mapa sobe de baixo com borda convexa (Skia clip). Igual à referência Dribbble (Tesla RoboTaxi, 3.3–3.9 s).
  - Rota: traço com "cometa" — aprovado; falta validar com rota real (usar polyline que o backend já devolve, sem chamada paga nova).
  - Categoria: barra desliza 220 ms sem quique. Estrutura do card de preço atual mantida.
  - Busca: esfera de rede (Skia) centralizada na tela; carros da região esmaecidos ao fundo; card com "Valor protegido · R$ X · Pix".
  - Encontrou: sem carro "brotando"; card do motorista (nome, nota, corridas, carro, placa Mercosul, valor protegido, ações).
    - Chip "⚡ Encontrado em N s" quando busca < 30 s.
    - Chip "Embarque rápido" quando ETA < 2 min (no real, usar ETA do backend).
    - Ações Mensagem/Compartilhar/Segurança são sugestão; alinhar com o fluxo real antes de portar.

## Marcador de carro

- Conceitos: `mobile-app/src/screens/prototype/lab/labVehicleConcepts.js`
  - A · Sedã, B · Minimal (vidro único), C · Hatch/SUV. Proporção ~2.4:1, sombra em 2 camadas, rim light, reflexo no vidro, LEDs. Sem filtros SVG.
- 2026-10-14: Izaak escolheu **C (Hatch/SUV)**. Já portado para produção em `leafVehicleArtwork.js` (sombra segue a luz por heading, 13 cores, abóbora mantida).
- Produção continua em `mobile-app/src/components/prototype/leafVehicleArtwork.js` (`createLeafVehicleSvg`) — só trocar depois da escolha; manter `resolveVehicleArtworkPose`, cores `PAINTS`, shape `halloween_pumpkin` e o teste `__tests__/leaf-vehicle-artwork.test.js`.
- Pendente: marcador próprio para moto.

## Próximos passos

1. ~~Escolher carro~~ feito (C, em produção no branch).
2. Portar peças aprovadas do lab para as telas reais (passageiro): abertura, rota, categoria, busca, encontrou.
3. Validar com rota/corrida real (não editar código durante corrida em andamento).
4. Push das branches + PR quando Izaak autorizar.
5. Roadmap de lançamento: `docs/validation/ROADMAP_LANCAMENTO_2026-10-13.md`.

## Ferramentas de QA

- `/Users/izaakdias/.codex/worktrees/qa-tools/` (DEVICE_PLAYBOOK.md, lib.sh).
- Evidências: `qa-tools/evidence/motion-lab-v2-2026-10-13/`.
- Metro roda a partir de `mobile-app` do worktree na porta 8081; driver do iPhone em `localhost:22087`.

## Retomar daqui (estado final em 2026-10-14)

- Árvore limpa (só `mobile-app/runtime-debug-history.json` não rastreado, ignorar).
- Próxima tarefa: portar as animações aprovadas do lab para as telas reais do passageiro,
  uma cena por vez (abertura → rota → categoria → busca → encontrou), com teste no iPhone
  a cada passo. Ler `LeafMotionLab.js` como referência; achar as telas reais com `rg`
  (ex.: `RobotaxiHomeScreen.js`, `passenger-driver-search`, `passenger-trip-accepted`).
- Não editar código mobile durante corrida em andamento. Push/PR só quando o Izaak pedir.

## Progresso do porte (2026-10-14, sessão seguinte)

- Cena 1 · Abertura — portada (`968ec37e3`): `LeafSplashReveal` na home; capa idêntica ao splash
  até o canvas Skia e o mapa do Android pintarem (280 ms), depois a borda convexa (760 ms).
  Validado por gravação no Android; no iPhone a captura por screenshot é lenta demais para o quadro a quadro.
- Cena 2 · Rota — portada (`5f368989c`): ponta "cometa" no traçado real. Bug achado e corrigido: as cores de
  trânsito cobriam a rota inteira desde o primeiro quadro, então o traçado progressivo nunca aparecia.
  Validado no iPhone com a duração desacelerada temporariamente (já restaurada).
- Próximas: Categoria, Busca, Encontrou.
