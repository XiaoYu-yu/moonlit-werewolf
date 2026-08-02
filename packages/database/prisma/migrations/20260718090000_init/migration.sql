-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('LOBBY', 'PLAYING', 'FINISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SeatKind" AS ENUM ('HUMAN', 'AI', 'AI_TAKEOVER');

-- CreateEnum
CREATE TYPE "PlayerSessionStatus" AS ENUM ('ONLINE', 'OFFLINE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'RUNNING', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GamePhase" AS ENUM ('LOBBY', 'ROLE_REVEAL', 'NIGHT_GUARD', 'NIGHT_WEREWOLVES', 'NIGHT_SEER', 'NIGHT_WITCH', 'DAWN', 'LAST_WORDS', 'DISCUSSION', 'VOTING', 'HUNTER_SHOT', 'RESOLUTION', 'ENDED');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('OPENAI_COMPATIBLE', 'DASHSCOPE', 'VOLCENGINE_ARK');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('CHAT', 'TRANSCRIPTION');

-- CreateEnum
CREATE TYPE "UsageStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REJECTED_BUDGET');

-- CreateEnum
CREATE TYPE "TranscriptionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "label" TEXT,
    "status" "InviteStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxUses" INTEGER NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "dailyRoomLimit" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "preset" INTEGER NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'LOBBY',
    "inviteId" TEXT NOT NULL,
    "hostSessionId" TEXT,
    "settings" JSONB NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    "kind" "SeatKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT,
    "alive" BOOLEAN NOT NULL DEFAULT true,
    "takeoverAt" TIMESTAMP(3),
    "aiModelId" TEXT,
    "aiPersonality" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSession" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "status" "PlayerSessionStatus" NOT NULL DEFAULT 'ONLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "phase" "GamePhase" NOT NULL DEFAULT 'LOBBY',
    "dayNumber" INTEGER NOT NULL DEFAULT 0,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "roleSnapshot" JSONB NOT NULL,
    "winner" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "audienceSeatId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 2,
    "timeoutMs" INTEGER NOT NULL DEFAULT 25000,
    "dailyBudgetCents" INTEGER NOT NULL DEFAULT 0,
    "capabilities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB NOT NULL,
    "inputPriceCentsPerMillion" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "outputPriceCentsPerMillion" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "status" "UsageStatus" NOT NULL,
    "matchId" TEXT,
    "modelId" TEXT,
    "providerSlug" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "durationMs" INTEGER,
    "costCents" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "requestHash" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptionJob" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "providerId" TEXT,
    "status" "TranscriptionStatus" NOT NULL DEFAULT 'QUEUED',
    "objectKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "transcript" TEXT,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TranscriptionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_codeHash_key" ON "InviteCode"("codeHash");

-- CreateIndex
CREATE INDEX "InviteCode_status_expiresAt_idx" ON "InviteCode"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE INDEX "Room_inviteId_createdAt_idx" ON "Room"("inviteId", "createdAt");

-- CreateIndex
CREATE INDEX "Room_status_updatedAt_idx" ON "Room"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Seat_roomId_kind_idx" ON "Seat"("roomId", "kind");

-- CreateIndex
CREATE INDEX "Seat_aiModelId_idx" ON "Seat"("aiModelId");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_roomId_seatNumber_key" ON "Seat"("roomId", "seatNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSession_seatId_key" ON "PlayerSession"("seatId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSession_tokenHash_key" ON "PlayerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PlayerSession_roomId_status_idx" ON "PlayerSession"("roomId", "status");

-- CreateIndex
CREATE INDEX "PlayerSession_expiresAt_idx" ON "PlayerSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Match_roomId_createdAt_idx" ON "Match"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "Match_status_updatedAt_idx" ON "Match"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "GameEvent_matchId_createdAt_idx" ON "GameEvent"("matchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameEvent_matchId_sequence_key" ON "GameEvent"("matchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "GameEvent_matchId_idempotencyKey_key" ON "GameEvent"("matchId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfig_slug_key" ON "ProviderConfig"("slug");

-- CreateIndex
CREATE INDEX "ProviderConfig_enabled_kind_idx" ON "ProviderConfig"("enabled", "kind");

-- CreateIndex
CREATE INDEX "AiModel_enabled_idx" ON "AiModel"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_providerId_modelKey_key" ON "AiModel"("providerId", "modelKey");

-- CreateIndex
CREATE INDEX "UsageRecord_createdAt_kind_idx" ON "UsageRecord"("createdAt", "kind");

-- CreateIndex
CREATE INDEX "UsageRecord_matchId_idx" ON "UsageRecord"("matchId");

-- CreateIndex
CREATE INDEX "UsageRecord_modelId_createdAt_idx" ON "UsageRecord"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_status_createdAt_idx" ON "TranscriptionJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_expiresAt_idx" ON "TranscriptionJob"("expiresAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_roomId_createdAt_idx" ON "TranscriptionJob"("roomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "InviteCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSession" ADD CONSTRAINT "PlayerSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSession" ADD CONSTRAINT "PlayerSession_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModel" ADD CONSTRAINT "AiModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlayerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
