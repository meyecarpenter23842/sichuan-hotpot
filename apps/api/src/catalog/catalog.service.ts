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
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  async menu(branchId: string) {
    const branch = await this.prisma.database.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        categories: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            sortOrder: true,
            products: {
              orderBy: [{ name: "asc" }, { id: "asc" }],
              select: {
                id: true, name: true, priceVnd: true, isAvailable: true,
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
    return branch;
  }
}
