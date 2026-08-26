-- Crew sharing: SharedAccess + SharedAccessScope.
--
-- Purely additive — creates one enum, one table, two indexes, two FKs. Touches
-- no existing table and drops nothing.
--
-- Apply through the SESSION pooler (5432). The transaction pooler on 6543 hangs
-- on DDL:
--   ~/Systems/01-HUB/ai-cos-rag/dbq.sh "$(cat sql/migrations/2026-08-26_shared_access.sql)"
-- (dbq.sh is already pointed at 5432.)

set search_path to myfit, public;

CREATE TYPE "SharedAccessScope" AS ENUM ('Summary', 'Sessions');

CREATE TABLE "SharedAccess" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "viewerEmail" TEXT NOT NULL,
    "viewerId" TEXT,
    "scope" "SharedAccessScope" NOT NULL DEFAULT 'Summary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedAccess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SharedAccess_viewerId_idx" ON "SharedAccess"("viewerId");

CREATE UNIQUE INDEX "SharedAccess_ownerId_viewerEmail_key" ON "SharedAccess"("ownerId", "viewerEmail");

ALTER TABLE "SharedAccess" ADD CONSTRAINT "SharedAccess_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SharedAccess" ADD CONSTRAINT "SharedAccess_viewerId_fkey"
  FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
