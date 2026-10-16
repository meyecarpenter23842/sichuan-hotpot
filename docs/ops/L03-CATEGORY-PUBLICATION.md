## Publication gating for new categories (L03 #130)
- Legacy categories remain published by default, even without images, preserving existing menus.
- New categories are created unpublished; Admin can stage products but Customer catalogue omits the category.
- Upload ticket + R2 HEAD-verified attach atomically sets imageKey and isPublished=true.
- Remove photo sets isPublished=false, preventing a customer-facing category without its photo.
- Order history and price snapshots are not modified. Migration is additive and no production deploy is authorized.
