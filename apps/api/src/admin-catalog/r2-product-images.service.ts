import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

type AllowedImageType = "image/png" | "image/jpeg" | "image/webp";
const extensions: Record<AllowedImageType, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
};
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char =>
    "%" + char.charCodeAt(0).toString(16).toUpperCase());
}
function config() {
  const account = process.env.R2_ACCOUNT_ID ?? "";
  const access = process.env.R2_ACCESS_KEY_ID ?? "";
  const secret = process.env.R2_SECRET_ACCESS_KEY ?? "";
  const bucket = process.env.R2_BUCKET ?? "hot-pot";
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-zA-Z0-9]{12,128}$/.test(access)
      || secret.length < 20 || bucket !== "hot-pot") {
    throw new ServiceUnavailableException("R2_UPLOAD_NOT_CONFIGURED");
  }
  return { account, access, secret, bucket };
}

/** Pure presign helper for R2 S3-compatible API. Only host is signed. */
export function signedR2Url(method: "PUT" | "HEAD", key: string, now = new Date(),
  ttlSeconds = 300): string {
  const { account, access, secret, bucket } = config();
  const host = account + ".r2.cloudflarestorage.com";
  const path = "/" + bucket + "/" + key.split("/").map(encode).join("/");
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const scope = day + "/auto/s3/aws4_request";
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", access + "/" + scope],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(ttlSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ].map(([k, v]) => encode(k!) + "=" + encode(v!)).sort().join("&");
  const canonical = [method, path, query, "host:" + host + "\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const digest = requireSha256(canonical);
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, digest].join("\n");
  const kDate = hmac("AWS4" + secret, day);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  const signingKey = hmac(kService, "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return "https://" + host + path + "?" + query + "&X-Amz-Signature=" + signature;
}
function requireSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class R2ProductImagesService {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  private async check(auth: string | undefined, branchId: string, productId: string) {
    await this.auth.adminAccess(auth, branchId);
    const product = await this.prisma.database.product.findFirst({
      where: { id: productId, category: { branchId } }, select: { id: true },
    });
    if (!product) throw new NotFoundException("PRODUCT_NOT_FOUND");
  }

  async ticket(auth: string | undefined, branchId: string, productId: string,
    input: { contentType: string; byteSize: number }) {
    await this.check(auth, branchId, productId);
    const extension = extensions[input.contentType as AllowedImageType];
    if (!extension || !Number.isSafeInteger(input.byteSize)
      || input.byteSize <= 0 || input.byteSize > MAX_IMAGE_BYTES) {
      throw new BadRequestException("INVALID_IMAGE_SIZE_OR_TYPE");
    }
    const key = "products-image/" + branchId + "/" + productId + "/" + randomUUID() + extension;
    return {
      key, uploadUrl: signedR2Url("PUT", key), expiresInSeconds: 300,
      contentType: input.contentType,
      maxBytes: MAX_IMAGE_BYTES,
    };
  }

  async attach(auth: string | undefined, branchId: string, productId: string, key: string) {
    await this.check(auth, branchId, productId);
    const prefix = "products-image/" + branchId + "/" + productId + "/";
    if (!key.startsWith(prefix) ||
      !/^[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(key.slice(prefix.length))) {
      throw new BadRequestException("INVALID_IMAGE_KEY");
    }
    let response: Response;
    try {
      response = await fetch(signedR2Url("HEAD", key), {
        method: "HEAD", signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ServiceUnavailableException("R2_UPLOAD_VERIFICATION_UNAVAILABLE");
    }
    if (!response.ok) throw new ConflictException("IMAGE_NOT_UPLOADED");
    const actualSize = Number(response.headers.get("content-length"));
    const mediaType = (response.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase();
    const extension = extensions[mediaType as AllowedImageType];
    if (!Number.isSafeInteger(actualSize) || actualSize < 1 || actualSize > MAX_IMAGE_BYTES
        || !extension || !key.endsWith(extension)) {
      throw new BadRequestException("IMAGE_METADATA_MISMATCH");
    }
    return this.prisma.database.product.update({
      where: { id: productId }, data: { imageKey: key },
      select: { id: true, imageKey: true },
    });
  }
}
