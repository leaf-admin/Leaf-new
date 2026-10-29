import { Easing } from 'react-native';

// Sistema de movimento da Leaf (canvas de UI/UX, estudo 4.1, aprovado em 2026-10-29).
// Três níveis pela importância do momento, todos calmos: nada quica, nada passa do ponto.
//   1 · toque: botões, chaves, listas.
//   2 · estado: card que troca de estado, sheet, banner.
//   3 · marco da corrida: Pix pago, motorista aceitou, viagem concluída, saldo subindo.
export const LEAF_MOTION_DURATION = Object.freeze({
  tap: 140,
  standard: 220,
  enter: 360,
  milestone: 900,
});

// Desacelera devagar e para no ponto (ease-out quint).
export const LEAF_MOTION_EASING = Easing.bezier(0.22, 1, 0.36, 1);

export const LEAF_PRESS = Object.freeze({
  scale: 0.98,
  opacity: 0.92,
});

// Háptico por nível: toque comum só na confirmação; marco sempre.
export const LEAF_MOTION_HAPTIC = Object.freeze({
  tap: 'selection',
  state: 'light',
  milestone: 'success',
});

export default {
  duration: LEAF_MOTION_DURATION,
  easing: LEAF_MOTION_EASING,
  press: LEAF_PRESS,
  haptic: LEAF_MOTION_HAPTIC,
};
