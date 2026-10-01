DROP INDEX "team_rosters_team_id_idx";--> statement-breakpoint
CREATE INDEX "team_rosters_source_job_id_idx" ON "team_rosters" USING btree ("source_job_id");