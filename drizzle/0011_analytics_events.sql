CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"actor_key" text,
	"subject_key" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_event_check" CHECK ("analytics_events"."event" in ('upload_started', 'recognition_completed', 'login_completed', 'job_claimed', 'draft_created', 'review_completed', 'month_published', 'next_month_registered', 'calendar_viewed', 'export_link', 'shared_calendar_viewed', 'export_ics', 'export_png', 'team_created', 'roster_published', 'team_member_joined', 'payment_shown', 'payment_succeeded'))
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "initial_entries" jsonb;--> statement-breakpoint
CREATE INDEX "analytics_events_event_created_at_idx" ON "analytics_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_actor_key_created_at_idx" ON "analytics_events" USING btree ("actor_key","created_at");