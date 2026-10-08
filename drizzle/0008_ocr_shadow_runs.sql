CREATE TABLE "ocr_shadow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"error_name" text,
	"day_count" integer,
	"agree_cells" integer,
	"disagree_cells" integer,
	"ocr_null_cells" integer,
	"ai_null_cells" integer,
	"unresolved_cells" integer,
	"review_cells" integer,
	"would_fallback" boolean NOT NULL,
	"ocr_ms" integer NOT NULL,
	"cold_start" boolean NOT NULL,
	"rss_mb" integer NOT NULL,
	CONSTRAINT "ocr_shadow_runs_status_check" CHECK ("ocr_shadow_runs"."status" in ('ok', 'table_failed', 'row_not_found', 'timeout', 'error'))
);
--> statement-breakpoint
CREATE INDEX "ocr_shadow_runs_created_at_idx" ON "ocr_shadow_runs" USING btree ("created_at");