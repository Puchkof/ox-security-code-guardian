-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('Queued', 'Scanning', 'Finished', 'Failed');

-- CreateTable
CREATE TABLE "scans" (
    "id" UUID NOT NULL,
    "repo_url" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL,
    "critical_count" INTEGER,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vulnerabilities" (
    "id" BIGSERIAL NOT NULL,
    "scan_id" UUID NOT NULL,
    "vulnerability_id" TEXT NOT NULL,
    "pkg_name" TEXT NOT NULL,
    "installed_version" TEXT NOT NULL,
    "fixed_version" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT,
    "primary_url" TEXT,
    "target" TEXT NOT NULL,

    CONSTRAINT "vulnerabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vulnerabilities_scan_id_id_idx" ON "vulnerabilities"("scan_id", "id");

-- AddForeignKey
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

