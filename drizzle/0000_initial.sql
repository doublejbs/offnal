CREATE TABLE "anonymous_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_subject_unique" UNIQUE("provider","provider_subject"),
	CONSTRAINT "auth_identities_provider_check" CHECK ("auth_identities"."provider" in ('google', 'dev'))
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"share_enabled" boolean DEFAULT false NOT NULL,
	"share_token_hash" text,
	"share_token_ciphertext" text,
	"share_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendars_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "calendars_share_token_hash_unique" UNIQUE("share_token_hash")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recognition_job_id" uuid,
	"person_row_id" text,
	"year_month" text NOT NULL,
	"display_name" text NOT NULL,
	"definitions" jsonb NOT NULL,
	"entries" jsonb NOT NULL,
	"source_cells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_year_month_check" CHECK ("drafts"."year_month" ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$'),
	CONSTRAINT "drafts_status_check" CHECK ("drafts"."status" in ('editing', 'published', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"source" text NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_user_month_unique" UNIQUE("user_id","year_month"),
	CONSTRAINT "entitlements_year_month_check" CHECK ("entitlements"."year_month" ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$'),
	CONSTRAINT "entitlements_source_check" CHECK ("entitlements"."source" in ('trial', 'purchase'))
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_events_provider_event_key_unique" UNIQUE("provider","event_key"),
	CONSTRAINT "payment_events_provider_check" CHECK ("payment_events"."provider" in ('toss', 'mock'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_key" text,
	"status" text NOT NULL,
	"failure_code" text,
	"draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "payments_provider_payment_key_unique" UNIQUE("provider_payment_key"),
	CONSTRAINT "payments_year_month_check" CHECK ("payments"."year_month" ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payments_provider_check" CHECK ("payments"."provider" in ('toss', 'mock')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('pending', 'paid', 'failed', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "published_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"share_visible" boolean DEFAULT false NOT NULL,
	"definitions" jsonb NOT NULL,
	"entries" jsonb NOT NULL,
	"source_draft_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_months_calendar_month_unique" UNIQUE("calendar_id","year_month"),
	CONSTRAINT "published_months_year_month_check" CHECK ("published_months"."year_month" ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "recognition_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_session_id" text,
	"user_id" uuid,
	"status" text NOT NULL,
	"error_code" text,
	"source_object_key" text,
	"source_mime" text NOT NULL,
	"source_deleted_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"table_result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recognition_jobs_status_check" CHECK ("recognition_jobs"."status" in ('uploaded', 'processing', 'recognized', 'failed', 'expired')),
	CONSTRAINT "recognition_jobs_error_code_check" CHECK ("recognition_jobs"."error_code" in ('no_table', 'unreadable', 'month_not_found', 'no_names', 'provider_error', 'provider_timeout', 'provider_not_configured', 'source_missing'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Seoul' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_recognition_job_id_recognition_jobs_id_fk" FOREIGN KEY ("recognition_job_id") REFERENCES "public"."recognition_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_months" ADD CONSTRAINT "published_months_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_jobs" ADD CONSTRAINT "recognition_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_user_id_idx" ON "drafts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_job_row_month_unique" ON "drafts" USING btree ("recognition_job_id","person_row_id","year_month") WHERE "drafts"."recognition_job_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_user_month_idx" ON "payments" USING btree ("user_id","year_month");--> statement-breakpoint
CREATE INDEX "recognition_jobs_user_id_idx" ON "recognition_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recognition_jobs_anonymous_session_id_idx" ON "recognition_jobs" USING btree ("anonymous_session_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");