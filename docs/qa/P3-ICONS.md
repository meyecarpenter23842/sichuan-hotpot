# Customer app icon pipeline

- Approved source: repository-root `icon-ltx.png`, never an invented placeholder.
- `npm run icons:generate --workspace @hotpot/customer` produces 192/512 PNGs, Apple touch icon, Android 1024 icon and transparent adaptive foreground.
- Edge-connected near-white padding is removed while protected interior white artwork remains. Product branding uses #B3262D and white.
- Expo start/build scripts regenerate icons, including CI PWA output. Android packaging outside npm scripts must run icons:generate first.
- Generated PNGs are ignored so binary previews do not diverge from the approved source.
- Android emulator / real iPhone icon launch tests: NOT TESTED. CI source tests and Expo web export will validate generation.
