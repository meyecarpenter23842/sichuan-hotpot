# L03 — Reusable modifier library and image ownership

- Migration `20261015150000_l03_reusable_modifiers`: append Branch-scoped identity to original ModifierGroup/ModifierOption **without regenerating IDs**. ProductModifierGroupAssignment is the sole explicit sharing relationship; legacy productId retains its original owner for backwards compatibility. Backfill 1:1 for each old group.
- Group templates are mutable within a branch; UI must explicitly confirm that edits to a shared group or option change **all attached products**. Existing orders retain immutable OrderItemModifierSnapshot (name/price). Cart/checkout on changed data always reprices from current DB, never trusts client amounts; stale cart must be reselected.
- Cross-branch attachment is rejected in API **inside a transaction**; owner/manager authorization comes from existing AuthService.adminAccess. Create library group without attaching a product; attach/detach independently.
- Reordering is kept on the assignment; group min/max and isAvailable apply across attached products. Hide group/option rather than destructive removal when used.
- Category/Group/Option imageKey remains nullable for old rows. New uploads get unique scoped keys and verified HEAD metadata, no overwrite. A new item without an image is draft/inactive until explicit publication. Images live in media bucket `hot-pot`, NOT backup.
- No production migration/deploy in L03. Run Prisma migration + backup/restore against disposable CI only; production release gate #135.
