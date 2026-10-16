import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

export interface CategoryInput { name: string; sortOrder: number }
export interface ProductInput {
  categoryId: string; name: string; priceVnd: number; isAvailable: boolean; isFeatured?: boolean;
  kind?: "STANDARD" | "COMBO";
  description?: string | null; ingredients?: string | null;
  productNotes?: string | null; allergenNotice?: string | null;
}
export interface ComboConfigInput {
  fixedItems: { productId: string; quantity: number; sortOrder: number }[];
  groups: {
    name: string; minSelect: number; maxSelect: number; sortOrder: number;
    options: { productId: string; quantity: number; priceDeltaVnd: number; sortOrder: number }[];
  }[];
}
export interface VariantInput { name: string; priceDeltaVnd: number; isAvailable: boolean }
export interface ModifierGroupInput { name: string; minSelect: number; maxSelect: number; sortOrder: number }
export interface ModifierOptionInput { name: string; priceDeltaVnd: number; isAvailable: boolean }
export interface OpeningHourInput {
  weekday: number; opensAt: string; closesAt: string; isClosed: boolean;
}
const PRODUCT_TEXT_LIMITS = {
  description: 1200, ingredients: 1200, productNotes: 800, allergenNotice: 800,
} as const;
type ProductTextField = keyof typeof PRODUCT_TEXT_LIMITS;
function cleanProductText(value: string | null, field: ProductTextField): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFC").replace(/\r\n?/g, "\n");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    throw new BadRequestException("INVALID_PRODUCT_TEXT");
  }
  const clean = normalized.split("\n").map(line => line.trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  if (Array.from(clean).length > PRODUCT_TEXT_LIMITS[field]) {
    throw new BadRequestException("PRODUCT_TEXT_TOO_LONG");
  }
  return clean || null;
}

@Injectable()
export class AdminCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  private async authorize(authorization: string | undefined, branchId: string): Promise<void> {
    await this.auth.adminAccess(authorization, branchId);
    const exists = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!exists) throw new NotFoundException("BRANCH_NOT_FOUND");
  }

  async branches(authorization: string | undefined) {
    const principal = await this.auth.principal(authorization);
    // Global OWNER sees all branches. A MANAGER may have global CUSTOMER role
    // and is authorized only by a per-branch OWNER/MANAGER membership.
    if (principal.role === "OWNER") {
      return this.prisma.database.branch.findMany({
        select: { id: true, name: true, code: true, address: true,
          catalogVersion: true, provinceCode: true, wardCode: true,
          latitude: true, longitude: true, isActive: true },
        orderBy: { name: "asc" },
      });
    }
    const branches = await this.prisma.database.branch.findMany({
      where: { memberships: { some: { userId: principal.id, role: { in: ["OWNER", "MANAGER"] } } } },
      select: { id: true, name: true, code: true, address: true,
          catalogVersion: true, provinceCode: true, wardCode: true,
          latitude: true, longitude: true, isActive: true },
      orderBy: { name: "asc" },
    });
    if (branches.length === 0) {
      throw new ForbiddenException("STAFF_CATALOG_PERMISSION_REQUIRED");
    }
    return branches;
  }

  async catalogue(authorization: string | undefined, branchId: string) {
    await this.authorize(authorization, branchId);
    const snapshot = await this.prisma.database.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: {
        id: true, name: true, code: true, isActive: true, catalogRevision: true,
        openingHours: { orderBy: { weekday: "asc" },
          select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
        modifierLibrary: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true, name: true, minSelect: true, maxSelect: true, sortOrder: true,
            isAvailable: true, imageKey: true, branchId: true,
            assignments: { select: { productId: true, sortOrder: true } },
            options: { orderBy: [{ name: "asc" }, { id: "asc" }],
              select: { id: true, name: true, priceDeltaVnd: true,
                isAvailable: true, imageKey: true } },
          },
        },
        categories: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true, name: true, sortOrder: true, imageKey: true, isPublished: true,
            products: {
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
              select: {
                id: true, categoryId: true, name: true, priceVnd: true, kind: true,
                description: true, ingredients: true, productNotes: true, allergenNotice: true,
                isAvailable: true, isFeatured: true, sortOrder: true, imageKey: true,
                comboFixedItems: {
                  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                  select: { id: true, quantity: true, sortOrder: true,
                    childProduct: { select: { id: true, name: true, priceVnd: true,
                      kind: true, isAvailable: true, imageKey: true } } },
                },
                comboGroups: {
                  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                  select: {
                    id: true, name: true, minSelect: true, maxSelect: true, sortOrder: true,
                    options: {
                      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                      select: { id: true, quantity: true, priceDeltaVnd: true, sortOrder: true,
                        childProduct: { select: { id: true, name: true, priceVnd: true,
                          kind: true, isAvailable: true, imageKey: true } } },
                    },
                  },
                },
                variants: { orderBy: { name: "asc" },
                  select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
                modifierGroups: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                  select: {
                    id: true, name: true, minSelect: true, maxSelect: true, sortOrder: true,
                    isAvailable: true, imageKey: true, branchId: true,
                    options: { orderBy: { name: "asc" },
                      select: { id: true, name: true, priceDeltaVnd: true,
                        isAvailable: true, imageKey: true } },
                  },
                },
                modifierAssignments: {
                  orderBy: { sortOrder: "asc" },
                  select: { sortOrder: true, group: {
                    select: { id: true, name: true, minSelect: true, maxSelect: true,
                      sortOrder: true, isAvailable: true, imageKey: true,
                      options: { orderBy: { name: "asc" }, select: {
                        id: true, name: true, priceDeltaVnd: true,
                        isAvailable: true, imageKey: true,
                      } },
                    } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const ids = snapshot.categories.flatMap(category => category.products.map(product => product.id));
    // Count delivered quantities, not the number of orders or cart additions.
    const sold = await this.prisma.database.orderItem.groupBy({
      by: ["productId"], where: { productId: { in: ids }, order: { branchId, status: "DELIVERED" } },
      _sum: { quantity: true },
    });
    const soldById = new Map(sold.map(row => [row.productId, row._sum.quantity ?? 0]));
    return { ...snapshot,
      modifierLibrary: snapshot.modifierLibrary.map(group => ({
        ...group, usedByProductIds: group.assignments.map(assignment => assignment.productId),
      })),
      categories: snapshot.categories.map(category => ({
      ...category, products: category.products.map(product => ({
        ...product, soldCount: soldById.get(product.id) ?? 0,
        modifierGroups: [...new Map([
          ...product.modifierGroups.filter(g => g.branchId === null).map(g => [g.id, g] as const),
          ...product.modifierAssignments.map(a => [a.group.id, a.group] as const),
        ]).values()].sort((a, b) => a.sortOrder - b.sortOrder),
        modifierAssignments: undefined,
      })),
    })) };
  }

  private async change<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (["P2002", "P2003", "P2014", "P2034"].includes(error.code)) {
          throw new ConflictException("CATALOG_CONFLICT");
        }
        if (error.code === "P2025") throw new NotFoundException("CATALOG_ITEM_NOT_FOUND");
      }
      throw error;
    }
  }

  private async category(branchId: string, categoryId: string) {
    const record = await this.prisma.database.catalogCategory.findFirst({
      where: { id: categoryId, branchId }, select: { id: true },
    });
    if (!record) throw new NotFoundException("CATEGORY_NOT_FOUND");
  }
  private async product(branchId: string, productId: string) {
    const record = await this.prisma.database.product.findFirst({
      where: { id: productId, category: { branchId } }, select: { id: true },
    });
    if (!record) throw new NotFoundException("PRODUCT_NOT_FOUND");
  }

  private async assertComboSellable(branchId: string, productId: string): Promise<void> {
    const combo = await this.prisma.database.product.findFirst({
      where: { id: productId, category: { branchId }, kind: "COMBO" },
      select: {
        comboFixedItems: { select: { childProduct: {
          select: { kind: true, isAvailable: true },
        } } },
        comboGroups: { select: {
          minSelect: true, maxSelect: true,
          options: { select: { childProduct: {
            select: { kind: true, isAvailable: true },
          } } },
        } },
      },
    });
    if (!combo || (combo.comboFixedItems.length === 0 && combo.comboGroups.length === 0)) {
      throw new ConflictException("COMBO_CONFIG_REQUIRED_BEFORE_ENABLE");
    }
    if (combo.comboFixedItems.some(item =>
      item.childProduct.kind !== "STANDARD" || !item.childProduct.isAvailable)) {
      throw new ConflictException("COMBO_FIXED_ITEM_UNAVAILABLE");
    }
    for (const group of combo.comboGroups) {
      if (group.minSelect < 0 || group.maxSelect < group.minSelect
        || group.maxSelect > 30 || group.options.length === 0
        || group.options.filter(option =>
          option.childProduct.kind === "STANDARD" && option.childProduct.isAvailable
        ).length === 0) {
        throw new ConflictException("COMBO_GROUP_UNAVAILABLE");
      }
    }
  }

  async saveCombo(auth: string | undefined, branchId: string, productId: string,
    input: ComboConfigInput) {
    await this.authorize(auth, branchId);
    if (input.fixedItems.length === 0 && input.groups.length === 0) {
      throw new BadRequestException("COMBO_REQUIRES_COMPONENTS");
    }
    const combo = await this.prisma.database.product.findFirst({
      where: { id: productId, category: { branchId } },
      select: { id: true, kind: true },
    });
    if (!combo) throw new NotFoundException("PRODUCT_NOT_FOUND");
    if (combo.kind !== "COMBO") throw new BadRequestException("PRODUCT_IS_NOT_COMBO");

    const fixedIds = input.fixedItems.map(item => item.productId);
    if (new Set(fixedIds).size !== fixedIds.length) {
      throw new BadRequestException("COMBO_DUPLICATE_FIXED_ITEM");
    }
    const groupNames = input.groups.map(group => group.name.trim().normalize("NFC"));
    if (groupNames.some(name => !name || name.length > 160)
      || new Set(groupNames).size !== groupNames.length) {
      throw new BadRequestException("COMBO_INVALID_GROUP_NAMES");
    }
    let optionCount = 0;
    for (const group of input.groups) {
      optionCount += group.options.length;
      if (group.minSelect < 0 || group.maxSelect < group.minSelect || group.maxSelect > 30) {
        throw new BadRequestException("COMBO_INVALID_GROUP_LIMITS");
      }
      const ids = group.options.map(option => option.productId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException("COMBO_DUPLICATE_GROUP_OPTION");
      }
    }
    if (optionCount > 300) throw new BadRequestException("COMBO_TOO_MANY_OPTIONS");

    const childIds = [...new Set([
      ...fixedIds,
      ...input.groups.flatMap(group => group.options.map(option => option.productId)),
    ])];
    if (childIds.includes(productId)) throw new BadRequestException("COMBO_SELF_REFERENCE");
    const children = await this.prisma.database.product.findMany({
      where: { id: { in: childIds }, category: { branchId } },
      select: { id: true, kind: true },
    });
    if (children.length !== childIds.length || children.some(child => child.kind !== "STANDARD")) {
      throw new BadRequestException("COMBO_CHILD_MUST_BE_STANDARD_SAME_BRANCH");
    }

    return this.change(() => this.prisma.database.$transaction(async tx => {
      await tx.productComboOption.deleteMany({
        where: { group: { comboProductId: productId } },
      });
      await tx.productComboGroup.deleteMany({ where: { comboProductId: productId } });
      await tx.productComboFixedItem.deleteMany({ where: { comboProductId: productId } });

      if (input.fixedItems.length) {
        await tx.productComboFixedItem.createMany({
          data: input.fixedItems.map(item => ({
            comboProductId: productId, childProductId: item.productId,
            quantity: item.quantity, sortOrder: item.sortOrder,
          })),
        });
      }
      for (let index = 0; index < input.groups.length; index++) {
        const group = input.groups[index]!;
        const saved = await tx.productComboGroup.create({
          data: {
            comboProductId: productId, name: groupNames[index]!,
            minSelect: group.minSelect, maxSelect: group.maxSelect, sortOrder: group.sortOrder,
          },
          select: { id: true },
        });
        await tx.productComboOption.createMany({
          data: group.options.map(option => ({
            groupId: saved.id, childProductId: option.productId,
            quantity: option.quantity, priceDeltaVnd: option.priceDeltaVnd,
            sortOrder: option.sortOrder,
          })),
        });
      }
      await tx.branch.update({
        where: { id: branchId }, data: { catalogRevision: { increment: 1 } },
      });
      return { status: "saved", fixedCount: input.fixedItems.length,
        groupCount: input.groups.length, optionCount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }
  private async variant(branchId: string, variantId: string) {
    const record = await this.prisma.database.productVariant.findFirst({
      where: { id: variantId, product: { category: { branchId } } },
      select: { id: true },
    });
    if (!record) throw new NotFoundException("VARIANT_NOT_FOUND");
  }
  private async group(branchId: string, groupId: string) {
    const record = await this.prisma.database.modifierGroup.findFirst({
      where: { id: groupId, OR: [{ branchId },
        { branchId: null, product: { category: { branchId } } }] },
      select: { id: true },
    });
    if (!record) throw new NotFoundException("MODIFIER_GROUP_NOT_FOUND");
  }
  private async option(branchId: string, optionId: string) {
    const record = await this.prisma.database.modifierOption.findFirst({
      where: { id: optionId, group: { OR: [{ branchId },
        { branchId: null, product: { category: { branchId } } }] } },
      select: { id: true },
    });
    if (!record) throw new NotFoundException("MODIFIER_OPTION_NOT_FOUND");
  }

  async createCategory(auth: string | undefined, branchId: string, input: CategoryInput) {
    await this.authorize(auth, branchId);
    return this.change(() => this.prisma.database.catalogCategory.create({
      data: { branchId, name: input.name.trim(), sortOrder: input.sortOrder,
        isPublished: false },
    }));
  }
  async updateCategory(auth: string | undefined, branchId: string, id: string,
    input: Partial<CategoryInput>) {
    await this.authorize(auth, branchId);
    await this.category(branchId, id);
    return this.change(() => this.prisma.database.catalogCategory.update({
      where: { id }, data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      },
    }));
  }
  async deleteCategory(auth: string | undefined, branchId: string, id: string) {
    await this.authorize(auth, branchId);
    await this.category(branchId, id);
    const count = await this.prisma.database.product.count({ where: { categoryId: id } });
    if (count) throw new ConflictException("CATEGORY_HAS_PRODUCTS");
    await this.change(() => this.prisma.database.catalogCategory.delete({ where: { id } }));
    return { status: "deleted" };
  }
  async createProduct(auth: string | undefined, branchId: string, input: ProductInput) {
    await this.authorize(auth, branchId);
    await this.category(branchId, input.categoryId);
    return this.change(() => this.prisma.database.product.create({
      data: {
        categoryId: input.categoryId, name: input.name.trim(),
        description: cleanProductText(input.description ?? null, "description"),
        ingredients: cleanProductText(input.ingredients ?? null, "ingredients"),
        productNotes: cleanProductText(input.productNotes ?? null, "productNotes"),
        allergenNotice: cleanProductText(input.allergenNotice ?? null, "allergenNotice"),
        priceVnd: input.priceVnd, kind: input.kind ?? "STANDARD",
        isAvailable: input.kind === "COMBO" ? false : input.isAvailable,
        isFeatured: input.isFeatured ?? false,
      },
    }));
  }
  async updateProduct(auth: string | undefined, branchId: string, id: string,
    input: Partial<ProductInput>) {
    await this.authorize(auth, branchId);
    const current = await this.prisma.database.product.findFirst({
      where: { id, category: { branchId } },
      select: {
        id: true, kind: true,
        _count: { select: { comboFixedItems: true, comboGroups: true } },
      },
    });
    if (!current) throw new NotFoundException("PRODUCT_NOT_FOUND");
    if (input.categoryId !== undefined) await this.category(branchId, input.categoryId);
    if (input.kind && input.kind !== current.kind) {
      if (current.kind === "COMBO"
        && (current._count.comboFixedItems > 0 || current._count.comboGroups > 0)) {
        throw new ConflictException("COMBO_CONFIG_REMOVE_BEFORE_KIND_CHANGE");
      }
      if (input.kind === "COMBO") {
        const [fixedUse, optionUse] = await Promise.all([
          this.prisma.database.productComboFixedItem.count({ where: { childProductId: id } }),
          this.prisma.database.productComboOption.count({ where: { childProductId: id } }),
        ]);
        if (fixedUse || optionUse) {
          throw new ConflictException("PRODUCT_USED_BY_COMBO_CANNOT_NEST");
        }
        if (input.isAvailable === true) {
          throw new ConflictException("COMBO_CONFIG_REQUIRED_BEFORE_ENABLE");
        }
      }
    }
    if (input.isAvailable === true && (input.kind ?? current.kind) === "COMBO") {
      await this.assertComboSellable(branchId, id);
    }
    return this.change(() => this.prisma.database.product.update({
      where: { id },
      data: {
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.description === undefined ? {} :
          { description: cleanProductText(input.description ?? null, "description") }),
        ...(input.ingredients === undefined ? {} :
          { ingredients: cleanProductText(input.ingredients ?? null, "ingredients") }),
        ...(input.productNotes === undefined ? {} :
          { productNotes: cleanProductText(input.productNotes ?? null, "productNotes") }),
        ...(input.allergenNotice === undefined ? {} :
          { allergenNotice: cleanProductText(input.allergenNotice ?? null, "allergenNotice") }),
        ...(input.priceVnd === undefined ? {} : { priceVnd: input.priceVnd }),
        ...(input.isAvailable === undefined ? {} : { isAvailable: input.isAvailable }),
        ...(input.isFeatured === undefined ? {} : { isFeatured: input.isFeatured }),
      },
    }));
  }
  async setFeaturedProducts(auth: string | undefined, branchId: string,
    ids: string[], revision: number) {
    await this.authorize(auth, branchId);
    if (new Set(ids).size !== ids.length) throw new ConflictException("FEATURED_DUPLICATE_PRODUCTS");
    return this.change(() => this.prisma.database.$transaction(async tx => {
      const available = await tx.product.findMany({
        where: { category: { branchId } }, select: { id: true },
      });
      const allowed = new Set(available.map(product => product.id));
      if (ids.some(id => !allowed.has(id))) {
        throw new ConflictException("FEATURED_CROSS_BRANCH_OR_REMOVED");
      }
      const locked = await tx.branch.updateMany({
        where: { id: branchId, catalogRevision: revision },
        data: { catalogRevision: { increment: 1 } },
      });
      if (locked.count !== 1) throw new ConflictException("FEATURED_CHANGED_RELOAD");
      await tx.product.updateMany({
        where: { category: { branchId } }, data: { isFeatured: false },
      });
      if (ids.length) await tx.product.updateMany({
        where: { id: { in: ids }, category: { branchId } }, data: { isFeatured: true },
      });
      return { catalogRevision: revision + 1, featuredCount: ids.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async reorderProducts(auth: string | undefined, branchId: string,
    ids: string[], revision: number) {
    await this.authorize(auth, branchId);
    if (new Set(ids).size !== ids.length) throw new ConflictException("ORDER_HAS_DUPLICATE_PRODUCTS");
    return this.change(() => this.prisma.database.$transaction(async tx => {
      const current = await tx.product.findMany({
        where: { category: { branchId } }, select: { id: true },
      });
      if (current.length !== ids.length ||
          current.some(item => !ids.includes(item.id))) {
        throw new ConflictException("ORDER_SCOPE_CHANGED_RELOAD");
      }
      // Optimistic branch revision: concurrent sort operations cannot overwrite each other.
      const locked = await tx.branch.updateMany({
        where: { id: branchId, catalogRevision: revision },
        data: { catalogRevision: { increment: 1 } },
      });
      if (locked.count !== 1) throw new ConflictException("ORDER_CHANGED_RELOAD");
      for (let i = 0; i < ids.length; i++) {
        await tx.product.update({ where: { id: ids[i]! }, data: { sortOrder: i } });
      }
      return { catalogRevision: revision + 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async deleteProduct(auth: string | undefined, branchId: string, id: string) {
    await this.authorize(auth, branchId);
    await this.product(branchId, id);
    const [orderCount, variantCount, groupCount, comboFixedUse, comboOptionUse] = await Promise.all([
      this.prisma.database.orderItem.count({ where: { productId: id } }),
      this.prisma.database.productVariant.count({ where: { productId: id } }),
      this.prisma.database.modifierGroup.count({ where: { productId: id } }),
      this.prisma.database.productComboFixedItem.count({ where: { childProductId: id } }),
      this.prisma.database.productComboOption.count({ where: { childProductId: id } }),
    ]);
    if (orderCount || variantCount || groupCount || comboFixedUse || comboOptionUse) {
      throw new ConflictException(comboFixedUse || comboOptionUse
        ? "PRODUCT_USED_BY_COMBO_USE_OUT_OF_STOCK"
        : "PRODUCT_HAS_HISTORY_OR_OPTIONS_USE_OUT_OF_STOCK");
    }
    await this.change(() => this.prisma.database.$transaction(async tx => {
      const previous = await tx.product.findFirst({
        where: { id, category: { branchId } }, select: { imageKey: true, kind: true },
      });
      if (!previous) throw new NotFoundException("PRODUCT_NOT_FOUND");
      if (previous.kind === "COMBO") {
        await tx.productComboOption.deleteMany({
          where: { group: { comboProductId: id } },
        });
        await tx.productComboGroup.deleteMany({ where: { comboProductId: id } });
        await tx.productComboFixedItem.deleteMany({ where: { comboProductId: id } });
      }
      const deleted = await tx.product.deleteMany({
        where: { id, imageKey: previous.imageKey },
      });
      if (deleted.count !== 1) throw new ConflictException("PRODUCT_CHANGED_RETRY");
      if (previous.imageKey?.startsWith("products-image/")) {
        await tx.r2ImageCleanup.upsert({
          where: { key: previous.imageKey },
          create: { key: previous.imageKey }, update: {},
        });
      }
    }));
    return { status: "deleted" };
  }

  async createVariant(auth: string | undefined, branchId: string, productId: string, input: VariantInput) {
    await this.authorize(auth, branchId);
    await this.product(branchId, productId);
    return this.change(() => this.prisma.database.productVariant.create({
      data: { ...input, name: input.name.trim(), productId },
    }));
  }
  async updateVariant(auth: string | undefined, branchId: string, id: string,
    input: Partial<VariantInput>) {
    await this.authorize(auth, branchId);
    await this.variant(branchId, id);
    return this.change(() => this.prisma.database.productVariant.update({
      where: { id }, data: { ...input,
        ...(input.name === undefined ? {} : { name: input.name.trim() }) },
    }));
  }
  async deleteVariant(auth: string | undefined, branchId: string, id: string) {
    await this.authorize(auth, branchId);
    await this.variant(branchId, id);
    await this.change(() => this.prisma.database.productVariant.delete({ where: { id } }));
    return { status: "deleted" };
  }

  async createGroup(auth: string | undefined, branchId: string, productId: string,
    input: ModifierGroupInput) {
    await this.authorize(auth, branchId);
    await this.product(branchId, productId);
    if (input.minSelect > input.maxSelect) throw new BadRequestException("INVALID_SELECTION_LIMIT");
    return this.change(() => this.prisma.database.modifierGroup.create({
      data: { ...input, name: input.name.trim(), productId, branchId,
        assignments: { create: { productId, sortOrder: input.sortOrder } } },
    }));
  }
  async updateGroup(auth: string | undefined, branchId: string, id: string,
    input: Partial<ModifierGroupInput>) {
    await this.authorize(auth, branchId);
    await this.group(branchId, id);
    const current = await this.prisma.database.modifierGroup.findUniqueOrThrow({ where: { id } });
    if ((input.minSelect ?? current.minSelect) > (input.maxSelect ?? current.maxSelect)) {
      throw new BadRequestException("INVALID_SELECTION_LIMIT");
    }
    return this.change(() => this.prisma.database.modifierGroup.update({
      where: { id }, data: { ...input,
        ...(input.name === undefined ? {} : { name: input.name.trim() }) },
    }));
  }
  async deleteGroup(auth: string | undefined, branchId: string, id: string) {
    await this.authorize(auth, branchId);
    await this.group(branchId, id);
    const count = await this.prisma.database.modifierOption.count({ where: { groupId: id } });
    if (count) throw new ConflictException("GROUP_HAS_OPTIONS");
    await this.change(() => this.prisma.database.modifierGroup.delete({ where: { id } }));
    return { status: "deleted" };
  }
  async createOption(auth: string | undefined, branchId: string, groupId: string,
    input: ModifierOptionInput) {
    await this.authorize(auth, branchId);
    await this.group(branchId, groupId);
    return this.change(() => this.prisma.database.modifierOption.create({
      data: { ...input, name: input.name.trim(), groupId },
    }));
  }
  async updateOption(auth: string | undefined, branchId: string, id: string,
    input: Partial<ModifierOptionInput>) {
    await this.authorize(auth, branchId);
    await this.option(branchId, id);
    return this.change(() => this.prisma.database.modifierOption.update({
      where: { id }, data: { ...input,
        ...(input.name === undefined ? {} : { name: input.name.trim() }) },
    }));
  }
  async deleteOption(auth: string | undefined, branchId: string, id: string) {
    await this.authorize(auth, branchId);
    await this.option(branchId, id);
    await this.change(() => this.prisma.database.modifierOption.delete({ where: { id } }));
    return { status: "deleted" };
  }

  async openingHours(auth: string | undefined, branchId: string, items: OpeningHourInput[]) {
    await this.authorize(auth, branchId);
    if (items.length !== 7 || new Set(items.map(x => x.weekday)).size !== 7 ||
        items.some(x => x.weekday < 0 || x.weekday > 6 || (!x.isClosed && x.opensAt >= x.closesAt))) {
      throw new BadRequestException("INVALID_WEEKLY_HOURS");
    }
    return this.prisma.database.$transaction(async tx => {
      await tx.branchOpeningHour.deleteMany({ where: { branchId } });
      await tx.branchOpeningHour.createMany({ data: items.map(x => ({ branchId, ...x })) });
      return tx.branchOpeningHour.findMany({ where: { branchId }, orderBy: { weekday: "asc" } });
    });
  }
}
