# UI audit checklist (mark PASS / FAIL / NOT TESTED)
## Visual
- Hierarchy answers location / next task / priorities.
- Consistent spacing, typography and Vietnamese glyphs.
- Semantic color/icon vocabulary with non-color warnings.
- Consistent buttons/badges/dialogs/filters; no gratuitous gradients or nested cards.
## Responsive
- No accidental horizontal scroll.
- Important actions available on mobile, tablet, desktop.
- Tables, menus, drawers, charts, dialogs usable.
- Sticky/footer navigation does not hide content.
- Images retain aspect and avoid clipping critical info.
## Interaction
- Every control has a real action; keyboard Tab/Enter/Escape/focus where relevant.
- Forms labeled, validated, errors recoverable.
- Empty/error/permission/slow network differentiated.
- Long text, many/zero rows, large numbers handled.
- Destructive actions confirmed; no premature success.
## Accessibility / performance / handoff
- Contrast and focus visible; alt/accessible labels.
- Reduced motion and stable layout.
- Real test commands/screenshots documented; only evidence-backed PASS.
- Remaining risks and production verification status stated honestly.
