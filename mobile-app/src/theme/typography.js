import { StyleSheet } from "react-native";
import { fonts } from "./runtimeTokens";

export const cardTypography = StyleSheet.create({
  title: {
    fontFamily: fonts.Bold,
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 0.1,
  },
  subtitle: {
    fontFamily: fonts.Regular,
    fontSize: 12,
    letterSpacing: 0.1,
  },
  helper: {
    fontFamily: fonts.Regular,
    fontSize: 11,
    letterSpacing: 0.1,
  },
});
