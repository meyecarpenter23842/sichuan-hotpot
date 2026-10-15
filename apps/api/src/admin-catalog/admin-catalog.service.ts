import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

export interface CategoryInput { name: string; sortOrder: number }
export interface ProductInput { categoryId: string; name: string; priceVnd: number; isAvailable: boolean; isFeatured?: boolean }
export interface VariantInput { name: string; priceDeltaVnd: number; isAvailable: boolean }
export interface ModifierGroupInput { name: string; minSelect: number; maxSelect: number; sortOrder: number }
export interface ModifierOptionInput { name: string; priceDeltaVnd: number; isAvailable: boolean }
export interface OpeningHourInput {
  weekday: number; opensAt: string; closesAt: string; isClosed: boolean;
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
          latitude: true, longitude: true, isActive: true },
        orderBy: { name: "asc" },
      });
    }
    const branches = await this.prisma.database.branch.findMany({
      where: { memberships: { some: { userId: principal.id, role: { in: ["OWNER", "MANAGER"] } } } },
      select: { id: true, name: true, code: true, address: true,
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
        categories: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true, name: true, sortOrder: true,
            products: {
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
              select: {
                id: true, categoryId: true, name: true, priceVnd: true,
                isAvailable: true, isFeatured: true, sortOrder: true, imageKey: true,
                variants: { orderBy: { name: "asc" },
                  select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
                modifierGroups: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                  select: {
                    id: true, name: true, minSelect: true, maxSelect: true, sortOrder: true,
                    options: { orderBy: { name: "asc" },
                      select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const ids = snapshot.categories.flatMap(category => category.products.map(product => product.id));
    if (!ids.length) return snapshot;
    // Count delivered quantities, not the number of orders or cart additions.
    const sold = await this.prisma.database.orderItem.groupBy({
      by: ["productId"], where: { productId: { in: ids }, order: { branchId, status: "DELIVERED" } },
      _sum: { quantity: true },
    });
    const soldById = new Map(sold.map(row => [row.productId, row._sum.quantity ?? 0]));
    return { ...snapshot, categories: snapshot.categories.map(category => ({
      ...category, products: category.products.map(product => ({
        ...product, soldCount: soldById.get(product.id) ?? 0,
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
  private async variant(branchId: string, variantId: string) {
    const record = await this.prisma.database.productVariant.findFirst({
      where: { id: variantId, product: { category: { branchId } } },
      select: { id: true },
    });
    if (!record) throw new NotFoundException("VARIANT_NOT_FOUND");
  }
  private async group(branchId: string, groupId: string) {
    const record = await this.prisma.database.modifierGroup.findFirst({
      where: { id: groupId, product: { category: { branchId } } },
      select: { id: true },
    });
    if (!record) throw new NotFoundException("MODIFIER_GROUP_NOT_FOUND");
  }
  private async option(branchId: string, optionId: string) {
    const record = await this.prisma.database.modifierOption.findFirst({
      where: { id: optionId, group: { product: { category: { branchId } } } },
      select: { id: true },
    });
    if (!record) throw new NotFoundException("MODIFIER_OPTION_NOT_FOUND");
  }

  async createCategory(auth: string | undefined, branchId: string, input: CategoryInput) {
    await this.authorize(auth, branchId);
    return this.change(() => this.prisma.database.catalogCategory.create({
      data: { branchId, name: input.name.trim(), sortOrder: input.sortOrder },
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
      data: { categoryId: input.categoryId, name: input.name.trim(),
        priceVnd: input.priceVnd, isAvailable: input.isAvailable,
        isFeatured: input.isFeatured ?? false },
    }));
  }
  async updateProduct(auth: string | undefined, branchId: string, id: string,
    input: Partial<ProductInput>) {
    await this.authorize(auth, branchId);
    await this.product(branchId, id);
    if (input.categoryId !== undefined) await this.category(branchId, input.categoryId);
    return this.change(() => this.prisma.database.product.update({
      where: { id },
      data: {
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.priceVnd === undefined ? {} : { priceVnd: input.priceVnd }),
        ...(input.isAvailable === undefined ? {} : { isAvailable: input.isAvailable }),
        ...(input.isFeatured === undefined ? {} : { isFeatured: input.isFeatured }),
      },
    }));
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
    const [orderCount, variantCount, groupCount] = await Promise.all([
      this.prisma.database.orderItem.count({ where: { productId: id } }),
      this.prisma.database.productVariant.count({ where: { productId: id } }),
      this.prisma.database.modifierGroup.count({ where: { productId: id } }),
    ]);
    if (orderCount || variantCount || groupCount) {
      throw new ConflictException("PRODUCT_HAS_HISTORY_OR_OPTIONS_USE_OUT_OF_STOCK");
    }
    await this.change(() => this.prisma.database.$transaction(async tx => {
      const previous = await tx.product.findFirst({
        where: { id, category: { branchId } }, select: { imageKey: true },
      });
      if (!previous) throw new NotFoundException("PRODUCT_NOT_FOUND");
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
      data: { ...input, name: input.name.trim(), productId },
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
