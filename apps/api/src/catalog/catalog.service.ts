import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

/**
 * Catalogue is read directly from PostgreSQL, without fake/demo data.
 * Prices are visible estimates only: all cart checkout prices must be
 * recalculated by the backend from authoritative product/variant records.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  branches() {
    return this.prisma.database.branch.findMany({
      // A closed store stays browseable; checkout is gated independently.
      select: { id: true, name: true, code: true, isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  async menu(branchId: string) {
    const branch = await this.prisma.database.branch.findFirst({
      where: { id: branchId },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        categories: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            sortOrder: true, imageKey: true,
            products: {
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
              select: {
                id: true, name: true, priceVnd: true, isAvailable: true,
                isFeatured: true, sortOrder: true, imageKey: true,
                modifierGroups: {
                  orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                  select: { id: true, name: true, minSelect: true, maxSelect: true,
                    isAvailable: true, imageKey: true, branchId: true,
                    options: { orderBy: [{ name: "asc" }, { id: "asc" }],
                      select: { id: true, name: true, priceDeltaVnd: true,
                        isAvailable: true, imageKey: true } },
                  },
                },
                modifierAssignments: {
                  orderBy: { sortOrder: "asc" },
                  select: { group: {
                    select: { id: true, name: true, minSelect: true, maxSelect: true,
                      isAvailable: true, imageKey: true,
                      options: { orderBy: [{ name: "asc" }, { id: "asc" }],
                        select: { id: true, name: true, priceDeltaVnd: true,
                          isAvailable: true, imageKey: true } },
                    },
                  } },
                },
                variants: {
                  orderBy: [{ name: "asc" }, { id: "asc" }],
                  select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true },
                },
              },
            },
          },
        },
      },
    });
    if (!branch) throw new NotFoundException("Store branch unavailable");
    return { ...branch, categories: branch.categories.map(category => ({
      ...category, products: category.products.map(product => {
        const combined = new Map(product.modifierGroups.filter(g => g.branchId === null)
          .map(g => [g.id, g] as const));
        for (const a of product.modifierAssignments) combined.set(a.group.id, a.group);
        return { ...product,
          modifierGroups: [...combined.values()].filter(g => g.isAvailable),
          modifierAssignments: undefined };
      }),
    })) };
  }
}
