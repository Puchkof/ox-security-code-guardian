-- Optimistic concurrency and per-attempt ownership of findings.
ALTER TABLE "scans" ADD COLUMN "run_id" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "vulnerabilities" ADD COLUMN "run_id" UUID;

-- Reads are now (scan_id, run_id) ordered by id.
DROP INDEX "vulnerabilities_scan_id_id_idx";
CREATE INDEX "vulnerabilities_scan_id_run_id_id_idx" ON "vulnerabilities"("scan_id", "run_id", "id");

-- Reaper: non-terminal scans by age.
CREATE INDEX "scans_status_updated_at_idx" ON "scans"("status", "updated_at");
