import { StyleSheet } from "react-native";
import { palette } from "../theme";

// Shared, restrained elevation for primary/secondary actions on Android and PWA.
export const actionDepth = StyleSheet.create({
  primary: {
    shadowColor: palette.redPressed, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  secondary: {
    shadowColor: palette.text, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 3, elevation: 1,
  },
  pressed: { transform: [{ translateY: 1 }], elevation: 0, shadowOpacity: 0.04 },
});
