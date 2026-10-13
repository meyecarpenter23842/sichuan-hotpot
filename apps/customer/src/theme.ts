export const palette = {
  red: "#B3262D",
  redPressed: "#951F27",
  white: "#FFFFFF",
  text: "#20252B",
  muted: "#667085",
  placeholder: "#98A2B3",
  line: "#E4E7EC",
  softRed: "#FFF0F0",
  graySurface: "#F8F9FB",
} as const;

// Compact mobile-first hierarchy. Keep TextInput at 16px on iOS Safari.
export const typeScale = {
  caption: 11,
  small: 12,
  body: 13,
  action: 14,
  section: 16,
  page: 20,
  hero: 22,
  loginHero: 24,
} as const;
