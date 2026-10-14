import {
  ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

interface BranchDetails {
  name: string;
  code: string;
  address: string;
  latitude: number;
  longitude: number;
}
interface BranchUpdate {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
}

@Injectable()
export class AdminBranchSetupService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  private async owner(auth: string | undefined): Promise<string> {
    const user = await this.auth.principal(auth);
    if (user.role !== "OWNER") throw new ForbiddenException("OWNER_REQUIRED");
    return user.id;
  }

  private details(input: Partial<BranchDetails>): Partial<BranchDetails> {
    return {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.code === undefined ? {} : { code: input.code.trim() }),
      ...(input.address === undefined ? {} : { address: input.address.trim() }),
      ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
      ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
    };
  }

  async create(auth: string | undefined, input: BranchDetails) {
    const userId = await this.owner(auth);
    const details = this.details(input) as BranchDetails;
    // New stores are OFF until real opening hours and delivery policy are saved.
    try {
      return await this.prisma.database.branch.create({
        data: { ...details, isActive: false,
          memberships: { create: { userId, role: "OWNER" } } },
        select: { id: true, code: true, name: true, address: true,
          latitude: true, longitude: true, isActive: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("BRANCH_CODE_ALREADY_EXISTS");
      }
      throw error;
    }
  }

  async update(auth: string | undefined, branchId: string, input: BranchUpdate) {
    await this.owner(auth);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new NotFoundException("BRANCH_NOT_FOUND");
    if (input.isActive === true) {
      const [hours, policy] = await Promise.all([
        this.prisma.database.branchOpeningHour.count({ where: { branchId } }),
        this.prisma.database.deliveryPolicyVersion.findFirst({
          where: { branchId }, orderBy: { version: "desc" }, select: { id: true },
        }),
      ]);
      if (hours !== 7 || !policy) throw new ConflictException("BRANCH_SETUP_INCOMPLETE");
    }
    try {
      return await this.prisma.database.branch.update({
        where: { id: branchId },
        data: { ...this.details(input), ...(input.isActive === undefined ? {} :
          { isActive: input.isActive }) },
        select: { id: true, code: true, name: true, address: true,
          latitude: true, longitude: true, isActive: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException("BRANCH_NOT_FOUND");
      }
      throw error;
    }
  }
}
