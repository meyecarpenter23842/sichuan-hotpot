# Customer/Admin approved hotpot icon pipeline

- Approved source: `assets/brand-hotpot-approved-20261016.png`, the exact owner's PNG on branch `meyecarpenter23842-patch-5` (`Logo lẩu Tứ Xuyên đỏ trắng.png`).
- This source is RGB with checkerboard baked into its pixels; do not use it directly as an icon. Both Expo generators extract the circular hotpot logo using red/white color segmentation and actual RGBA alpha.
- Version `v20261016d` covers icon-192, icon-512, Apple touch icon and web favicon (cache bust).
- Android: generated 1024px icon and 1024px transparent adaptive foreground on a white background. Same approved mark on both Customer and Admin.
- `npm run icons:generate --workspace @hotpot/customer` and equivalent Admin workspace command.
- Icon images are generated before builds and intentionally not committed. Android/iOS real-device validation must not be claimed without testing.
