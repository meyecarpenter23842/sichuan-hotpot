# Frontend and UX quality gate

Source skill: [professional-frontend-qa](../../.agents/skills/professional-frontend-qa/SKILL.md) uploaded by project owner. Use reference files for admin/enterprise UI, mobile PWA and test checklist.

## Before implementation
Inspect mockups and real routes/components, user journeys, roles, shared tokens and app stack. Mark expected states and accessible interaction semantics. Do not replace functional layout solely for aesthetics.

## Login / username registration visual acceptance
- Owner has provided **`LoginScreen.png`** (login screen composition) and **`login-hero.png`** (login hero). These must be compared against actual running login UI first; the eight original locked references still govern brand consistency. Do not declare an image/pixel match based on source code or a successful bundle alone.
- Design both customer and admin sign-in, direct Google action, username/password registration/sign-in and recovery states. Password show/hide, clear actions, inline validation and errors must work.
- Read `.agents/skills/professional-frontend-qa/SKILL.md` and its relevant references **before** coding. Compare screenshot of actual running UI side-by-side with reference mockups. Test 320/360/390/428/768/1280/1440 widths, Android emulator, Safari iPhone PWA, keyboard/safe area, touch, accessible focus, Vietnamese glyphs, error/loading/offline/success.
- Never mark UI PASS without screenshots and interaction evidence; use PASS/FAIL/NOT TESTED.

## Per-screen checks
- Main action discoverable, consistent restrained red/cream tokens, readable Vietnamese accents and long text.
- Functional inputs, modal/back behavior, no fake button, >=44px touch areas, visible focus.
- Screens 320/360/390/428/768/1280/1440 widths as practical; iOS safe area/bottom bar, keyboard pan/resizing, Android notch/navigation.
- Loading / empty / slow network / error / retry / offline / disabled / success / no-permission.
- Customer: menu price display, modifiers, cart persistence, address GPS fallback, quote fee/surcharge transparency, idempotent checkout, order progress.
- Admin: compact queue and actionable alert, kitchen options, driver scope/COD, permission denial and concurrent status handling.
- Test real Android emulator where available; iPhone Safari installed PWA, GPS permission and Web Push eligibility. Never claim tests passed without logs or device evidence.
- Record test name, environment, screenshot/browser artifact where available, PASS/FAIL/NOT TESTED, reviewer and blockers.

Mockup image references are aesthetic examples only: no fabricated KPI, ratings, driver live location or guaranteed delivery ETA.
