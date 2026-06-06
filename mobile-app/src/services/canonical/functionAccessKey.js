const functionAccessKey =
  process.env.LEAF_ACCESS_KEY ||
  process.env.EXPO_PUBLIC_LEAF_ACCESS_KEY ||
  '';

export default functionAccessKey;
