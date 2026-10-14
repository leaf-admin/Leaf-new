# Plano — sair do 3D: botões flutuantes, tab bar e mapa de fundo (2026-10-14)

Pedido do Izaak: os ícones e a tab bar em 3D não combinam com a proposta. Seguir a
referência de vídeo (botões superiores flutuantes com sombra leve e linha bem sutil,
animação leve ao tocar; tab bar na mesma linha, com seleção animada suave). No
passageiro, o mapa volta a ser o fundo da tela (hoje está dentro de um card) e o
"Seu embarque" sai do rodapé e vai para o mapa, logo abaixo do pino.

## Inventário do 3D hoje

- `LeafObjectIcon` (`components/prototype/LeafVisualElements.js`): 13 imagens 3D
  (`assets/leaf-ui/leafA*.png`) + fallback; usado em **28 arquivos** (menu, conta,
  configurações, recibo, suporte, chat, histórico, pagamento, lugares salvos,
  onboarding/login, busca e landing do passageiro).
- Tab bar: `components/prototype/LeafNativeTabBar.js` com `leafNav*` / `leafSoft*`
  (3D, @2x/@3x) e o `TabView` nativo do iOS (`withLeafMaterial`, imagens no
  `Images.xcassets`).
- Botões superiores do mapa: controles redondos do `RobotaxiHomeScreen`
  (centralizar, notificações, voltar), cada um com estilo próprio.

## Linguagem nova (uma só, para o app inteiro)

- **Ícone**: traço (line icon) 1.75 pt, cor `#1A330E` / `#222222`, sem volume.
- **Botão flutuante**: círculo 44 pt, fundo branco 96%, linha 0,5 pt `rgba(0,0,0,0.08)`,
  sombra `0 4 14 rgba(18,38,26,0.10)`. Toque: escala 0,94 em 90 ms e volta com mola
  curta (sem quique), háptico `selection`.
- **Tab bar**: pílula flutuante com a mesma superfície do botão; o item ativo ganha
  um fundo que **desliza** até ele (220 ms ease-out) e o ícone passa de traço para
  preenchido; rótulo sempre visível.
- **Mapa de fundo** no passageiro: o mapa ocupa a tela; a busca "Para onde?" e os
  controles flutuam por cima.
- **"Seu embarque"**: etiqueta pequena presa ao pino no mapa (abaixo dele), com o
  endereço curto; some quando o pino se move e volta quando para (o mesmo "levanta e
  assenta" do pino). Precisa respeitar o mapa (não sair da tela, não cobrir o pino).

## Ordem de execução (cada fase com teste nos dois celulares)

1. **Base**: `LeafFloatingButton` e `LeafIcon` (traço) com a animação de toque.
   Trocar a implementação de `LeafObjectIcon` para o ícone de traço — isso troca os
   28 usos de uma vez, sem mexer tela a tela. Ajustar os poucos lugares que dependiam
   do tamanho/visual 3D.
2. **Tab bar** flutuante com seleção deslizante (Android: JS; iOS: decidir entre o
   `TabView` nativo com símbolos SF de traço ou a mesma pílula em JS — recomendo a
   mesma pílula nos dois para ficar idêntico).
3. **Botões superiores** do mapa (passageiro e motorista) usando `LeafFloatingButton`.
4. **Mapa de fundo** no passageiro + **"Seu embarque" no pino**.
5. Remover as imagens 3D que ficarem sem uso (`rg` provando zero referências) e
   atualizar o plugin `withLeafMaterial` (imagens da tab do iOS).

Precisa de build nativo novo só na fase 2 se a tab do iOS continuar nativa; nas
outras é JS (OTA/Metro).

## Pendências que dependem do Izaak

- Frames da referência de vídeo (não está nesta sessão) para calibrar sombra/linha.

## Andamento (2026-10-14)

- Fases 1–3 feitas (`9adb10d35`): ícones de traço no `LeafObjectIcon`, tab bar flutuante com
  seleção deslizante (a mesma em JS no Android e iOS; a tab nativa do iOS foi desligada),
  botões do topo flutuantes. Validado no Android e no iPhone.
- Fase 4 feita (`343efa793`): mapa de fundo no passageiro e "Seu embarque" preso ao ponto
  de embarque. Validado no iPhone.
- Fase 5 feita: arquivos 3D sem uso removidos. Ficam `leafAHome/Activity/Account` e
  `leafNav*`, ainda copiados pelo plugin `withLeafMaterial` para a tab nativa (desligada).
  Remover junto com o redesenho ou a remoção definitiva da tab nativa (exige build nativo).
