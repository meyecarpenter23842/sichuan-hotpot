CREATE TABLE "ChatbotConfig" (
  "branchId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "zaloEnabled" BOOLEAN NOT NULL DEFAULT true,
  "projectId" VARCHAR(128),
  "credentialCiphertext" TEXT,
  "credentialIv" VARCHAR(64),
  "credentialTag" VARCHAR(64),
  "agentResourceName" VARCHAR(512),
  "agentDisplayName" VARCHAR(200),
  "agentLocation" VARCHAR(64),
  "defaultLanguageCode" VARCHAR(24),
  "environmentResourceName" VARCHAR(512),
  "environmentDisplayName" VARCHAR(200),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatbotConfig_pkey" PRIMARY KEY ("branchId"),
  CONSTRAINT "ChatbotConfig_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "ChatbotConfig_credentials_all_or_none_check" CHECK (
    ("credentialCiphertext" IS NULL AND "credentialIv" IS NULL AND "credentialTag" IS NULL)
    OR
    ("credentialCiphertext" IS NOT NULL AND "credentialIv" IS NOT NULL AND "credentialTag" IS NOT NULL)
  )
);

ALTER TABLE "ChatbotConfig"
  ADD CONSTRAINT "ChatbotConfig_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
