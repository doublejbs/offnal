CREATE TABLE "member_change_acks" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"acked_revision" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_change_acks_team_id_user_id_year_month_pk" PRIMARY KEY("team_id","user_id","year_month"),
	CONSTRAINT "member_change_acks_year_month_check" CHECK ("member_change_acks"."year_month" ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "member_shared_team_months" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_shared_team_months_team_id_user_id_year_month_pk" PRIMARY KEY("team_id","user_id","year_month"),
	CONSTRAINT "member_shared_team_months_year_month_check" CHECK ("member_shared_team_months"."year_month" ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "team_invites_max_uses_check" CHECK ("team_invites"."max_uses" is null or "team_invites"."max_uses" > 0)
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"linked_row_key" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_user_unique" UNIQUE("team_id","user_id"),
	CONSTRAINT "team_members_role_check" CHECK ("team_members"."role" in ('admin', 'member')),
	CONSTRAINT "team_members_status_check" CHECK ("team_members"."status" in ('pending', 'active', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "team_roster_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roster_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"date" text NOT NULL,
	"from_code" text,
	"to_code" text
);
--> statement-breakpoint
CREATE TABLE "team_roster_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roster_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"display_name" text NOT NULL,
	"same_name_ordinal" integer DEFAULT 1 NOT NULL,
	"position" integer NOT NULL,
	"source_row_id" text,
	"entries" jsonb NOT NULL,
	"source_cells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"extract_status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"extract_error_code" text,
	"review_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_roster_rows_roster_row_key_unique" UNIQUE("roster_id","row_key"),
	CONSTRAINT "team_roster_rows_extract_status_check" CHECK ("team_roster_rows"."extract_status" in ('pending', 'processing', 'done', 'failed', 'manual')),
	CONSTRAINT "team_roster_rows_extract_error_code_check" CHECK ("team_roster_rows"."extract_error_code" in ('no_table', 'unreadable', 'month_not_found', 'no_names', 'provider_error', 'provider_timeout', 'provider_not_configured', 'source_missing'))
);
--> statement-breakpoint
CREATE TABLE "team_rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"year_month" text,
	"status" text NOT NULL,
	"revision" integer,
	"base_revision" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_job_id" uuid,
	"definitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows_created_at" timestamp with time zone,
	"authority_confirmed_at" timestamp with time zone,
	"created_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_rosters_team_month_revision_unique" UNIQUE("team_id","year_month","revision"),
	CONSTRAINT "team_rosters_year_month_check" CHECK ("team_rosters"."year_month" ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$'),
	CONSTRAINT "team_rosters_status_check" CHECK ("team_rosters"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "team_rosters_revision_check" CHECK (("team_rosters"."status" = 'draft') = ("team_rosters"."revision" is null))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"share_roster_with_members" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_change_acks" ADD CONSTRAINT "member_change_acks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_change_acks" ADD CONSTRAINT "member_change_acks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_shared_team_months" ADD CONSTRAINT "member_shared_team_months_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_shared_team_months" ADD CONSTRAINT "member_shared_team_months_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roster_changes" ADD CONSTRAINT "team_roster_changes_roster_id_team_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."team_rosters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roster_rows" ADD CONSTRAINT "team_roster_rows_roster_id_team_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."team_rosters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_rosters" ADD CONSTRAINT "team_rosters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_rosters" ADD CONSTRAINT "team_rosters_source_job_id_recognition_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."recognition_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_rosters" ADD CONSTRAINT "team_rosters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_shared_team_months_user_idx" ON "member_shared_team_months" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_invites_team_id_idx" ON "team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_active_row_unique" ON "team_members" USING btree ("team_id","linked_row_key") WHERE "team_members"."status" = 'active' and "team_members"."linked_row_key" is not null;--> statement-breakpoint
CREATE INDEX "team_roster_changes_roster_row_idx" ON "team_roster_changes" USING btree ("roster_id","row_key");--> statement-breakpoint
CREATE UNIQUE INDEX "team_rosters_published_unique" ON "team_rosters" USING btree ("team_id","year_month") WHERE "team_rosters"."status" = 'published';--> statement-breakpoint
CREATE INDEX "team_rosters_team_id_idx" ON "team_rosters" USING btree ("team_id");