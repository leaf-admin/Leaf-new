// Figtree on both platforms (Leaf Ride Lifecycle Spec). Fonts are loaded at
// startup (App.js) and embedded by the expo-font plugin for release builds.
const families = {
  regular: 'Figtree-Regular',
  light: 'Figtree-Light',
  medium: 'Figtree-Medium',
  semiBold: 'Figtree-SemiBold',
  bold: 'Figtree-Bold',
};
const leafTypography = Object.fromEntries(
  Object.entries(families).map(([key, fontFamily]) => [key, { fontFamily }]),
);

export default leafTypography;
