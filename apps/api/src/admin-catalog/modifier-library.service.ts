import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

interface GroupPayload {
  name: string; minSelect: number; maxSelect: number; sortOrder: number;
  isAvailable?: boolean;
}
interface OptionPayload { name: string; priceDeltaVnd: number; isAvailable?: boolean; }

/** Branch-level modifier library. Existing legacy IDs are retained; group and option
 * identities are stable across all attached products in this branch. */
@Injectable()
export class ModifierLibraryService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  private async access(authorization: string | undefined, branchId: string) {
    await this.auth.adminAccess(authorization, branchId);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new NotFoundException("BRANCH_NOT_FOUND");
  }
  private async group(branchId: string, id: string) {
    const group = await this.prisma.database.modifierGroup.findFirst({
      where: { id, branchId },
      include: { options: true, assignments: true },
    });
    if (!group) throw new NotFoundException("GROUP_NOT_FOUND");
    return group;
  }
  private bounds(input: GroupPayload): void {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 160
      || !Number.isInteger(input.minSelect) || input.minSelect < 0
      || !Number.isInteger(input.maxSelect) || input.maxSelect < 1
      || input.maxSelect > 30 || input.minSelect > input.maxSelect
      || !Number.isInteger(input.sortOrder) || input.sortOrder < -1000 || input.sortOrder > 1000) {
      throw new BadRequestException("INVALID_MODIFIER_GROUP");
    }
  }
  async create(auth: string | undefined, branchId: string, input: GroupPayload) {
    await this.access(auth, branchId);
    this.bounds(input);
    // Inactive draft until a verified image is attached and options are configured.
    return this.prisma.database.modifierGroup.create({
      data: { branchId, productId: null, name: input.name.trim(),
        minSelect: input.minSelect, maxSelect: input.maxSelect,
        sortOrder: input.sortOrder, isAvailable: false },
    });
  }
  async update(auth: string | undefined, branchId: string, id: string,
    input: Partial<GroupPayload>) {
    await this.access(auth, branchId);
    const current = await this.group(branchId, id);
    const merged: GroupPayload = { name: input.name ?? current.name,
      minSelect: input.minSelect ?? current.minSelect,
      maxSelect: input.maxSelect ?? current.maxSelect,
      sortOrder: input.sortOrder ?? current.sortOrder };
    this.bounds(merged);
    if (input.isAvailable === true) {
      if (!current.imageKey || current.options.length === 0 || current.options.length < merged.minSelect
        || current.options.filter(o => o.isAvailable).length < merged.minSelect
        || current.options.some(o => o.isAvailable && !o.imageKey)) {
        throw new ConflictException("GROUP_REQUIRES_IMAGES_AND_VALID_OPTIONS");
      }
    }
    // Updating shared group or any option affects all attached products.
    return this.prisma.database.modifierGroup.update({
      where: { id }, data: { name: merged.name.trim(), minSelect: merged.minSelect,
        maxSelect: merged.maxSelect, sortOrder: merged.sortOrder,
        ...(input.isAvailable === undefined ? {} : { isAvailable: input.isAvailable }) },
    });
  }
  async addOption(auth: string | undefined, branchId: string, groupId: string,
    input: OptionPayload) {
    await this.access(auth, branchId);
    await this.group(branchId, groupId);
    if (!input.name?.trim() || input.name.length > 160 ||
      !Number.isSafeInteger(input.priceDeltaVnd) || input.priceDeltaVnd < 0
      || input.priceDeltaVnd > 100000000) throw new BadRequestException("INVALID_MODIFIER_OPTION");
    return this.prisma.database.modifierOption.create({
      data: { groupId, name: input.name.trim(),
        priceDeltaVnd: input.priceDeltaVnd, isAvailable: false },
    });
  }
  async updateOption(auth: string | undefined, branchId: string, optionId: string,
    input: Partial<OptionPayload>) {
    await this.access(auth, branchId);
    const current = await this.prisma.database.modifierOption.findFirst({
      where: { id: optionId, group: { branchId } }, include: { group: { include: { options: true } } },
    });
    if (!current) throw new NotFoundException("OPTION_NOT_FOUND");
    if (input.name !== undefined && (!input.name.trim() || input.name.length > 160)) {
      throw new BadRequestException("INVALID_MODIFIER_OPTION");
    }
    if (input.priceDeltaVnd !== undefined && (!Number.isSafeInteger(input.priceDeltaVnd)
      || input.priceDeltaVnd < 0 || input.priceDeltaVnd > 100000000))
      throw new BadRequestException("INVALID_MODIFIER_OPTION");
    if (input.isAvailable === true && !current.imageKey) {
      throw new ConflictException("TOPPING_IMAGE_REQUIRED");
    }
    return this.prisma.database.$transaction(async tx => {
      const group = await tx.modifierGroup.findUniqueOrThrow({ where: { id: current.groupId },
        include: { options: true } });
      const available = group.options.filter(option => option.id === optionId
        ? input.isAvailable ?? option.isAvailable : option.isAvailable).length;
      if (group.isAvailable && available < group.minSelect) {
        throw new ConflictException("GROUP_MIN_SELECTION_UNAVAILABLE");
      }
      return tx.modifierOption.update({
        where: { id: optionId }, data: {
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.priceDeltaVnd === undefined ? {} : { priceDeltaVnd: input.priceDeltaVnd }),
          ...(input.isAvailable === undefined ? {} : { isAvailable: input.isAvailable }),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async attach(auth: string | undefined, branchId: string, productId: string,
    groupIds: string[], revision: number) {
    await this.access(auth, branchId);
    if (!Array.isArray(groupIds) || groupIds.length > 30
      || groupIds.some(id => typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id))
      || new Set(groupIds).size !== groupIds.length || !Number.isSafeInteger(revision))
      throw new BadRequestException("INVALID_GROUP_ASSIGNMENT");
    try {
      return await this.prisma.database.$transaction(async tx => {
        const product = await tx.product.findFirst({
          where: { id: productId, category: { branchId } }, select: { id: true },
        });
        if (!product) throw new NotFoundException("PRODUCT_NOT_FOUND");
        const groups = await tx.modifierGroup.findMany({
          where: { id: { in: groupIds }, branchId }, select: { id: true },
        });
        if (groups.length !== groupIds.length) throw new ForbiddenException("CROSS_BRANCH_GROUP_FORBIDDEN");
        const changed = await tx.branch.updateMany({
          where: { id: branchId, catalogRevision: revision },
          data: { catalogRevision: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ConflictException("CATALOG_REVISION_STALE");
        await tx.productModifierGroupAssignment.deleteMany({ where: { productId } });
        if (groupIds.length) await tx.productModifierGroupAssignment.createMany({
          data: groupIds.map((groupId, sortOrder) => ({ productId, groupId, sortOrder })),
        });
        return { productId, groupIds, revision: revision + 1 };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002","P2034"].includes(e.code)) throw new ConflictException("CATALOG_REVISION_STALE");
      throw e;
    }
  }
}
