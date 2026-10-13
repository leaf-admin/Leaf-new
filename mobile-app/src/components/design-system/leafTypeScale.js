import { Dimensions } from 'react-native';
import leafTypography from '../prototype/LeafTypography';

// Ride-lifecycle type scale (see the "Leaf Ride Lifecycle Spec" canvas).
// Narrow phones (< 400 pt, e.g. 360 dp Android) use the compact column so
// cards don't dominate the screen; wide phones keep the regular sizes.
export const IS_COMPACT_SCREEN = (Dimensions.get('window')?.width || 400) < 400;
export const compact = (regular, small) => (IS_COMPACT_SCREEN ? small : regular);

export const leafInk = Object.freeze({
  primary: '#111410',
  secondary: '#5F665B',
  brand: '#1A330E',
  route: '#2E8B4A',
  surface: '#F4F5F1',
  divider: '#EDEFEA',
  danger: '#A3263A',
  surge: '#D9632B',
});

const tabular = { fontVariant: ['tabular-nums'] };

export const leafType = Object.freeze({
  // One hero per screen: money for the driver, arrival for the passenger.
  display: {
    ...leafTypography.bold,
    ...tabular,
    fontSize: compact(34, 30),
    lineHeight: compact(40, 36),
    letterSpacing: -0.4,
    color: leafInk.primary,
  },
  title: {
    ...leafTypography.semiBold,
    fontSize: compact(22, 20),
    lineHeight: compact(28, 25),
    color: leafInk.primary,
  },
  headline: {
    ...leafTypography.semiBold,
    fontSize: 17,
    lineHeight: 22,
    color: leafInk.primary,
  },
  body: {
    ...leafTypography.regular,
    fontSize: 15,
    lineHeight: 20,
    color: leafInk.primary,
  },
  caption: {
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
    color: leafInk.secondary,
  },
  plate: {
    ...leafTypography.bold,
    ...tabular,
    fontSize: compact(20, 18),
    letterSpacing: 1.6,
    color: leafInk.primary,
  },
  number: {
    ...leafTypography.semiBold,
    ...tabular,
  },
});

export const leafRadius = Object.freeze({
  control: 24,
  card: 28,
  button: compact(18, 16),
  chip: 999,
});

export const leafTouch = Object.freeze({
  minimum: 48,
  primaryHeight: compact(56, 52),
});
