CREATE TYPE "public"."document_provider" AS ENUM('PAPERLESS', 'NEXTCLOUD', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('PAPERLESS', 'NEXTCLOUD', 'CALDAV');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'RETRYING');--> statement-breakpoint
CREATE TABLE "document_reference" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"provider" "document_provider" DEFAULT 'MANUAL' NOT NULL,
	"external_id" text,
	"connection_id" uuid,
	"title" text NOT NULL,
	"title_override" text,
	"document_date" date,
	"url" text,
	"note" text,
	"archived_at" timestamp with time zone,
	"visibility" "visibility" DEFAULT 'HOUSEHOLD' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'SENSITIVE' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_reference_url_scheme" CHECK ("document_reference"."url" is null or "document_reference"."url" ~* '^https?://')
);
--> statement-breakpoint
CREATE TABLE "integration_connection" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" text,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "integration_connection_base_url_scheme" CHECK ("integration_connection"."base_url" ~* '^https?://')
);
--> statement-breakpoint
CREATE TABLE "integration_credential" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"key_id" text NOT NULL,
	"sealed" text NOT NULL,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" "sync_run_status" DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_imported" integer DEFAULT 0 NOT NULL,
	"items_skipped" integer DEFAULT 0 NOT NULL,
	"cursor_before" text,
	"cursor_after" text,
	"error_kind" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_reference" ADD CONSTRAINT "document_reference_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference" ADD CONSTRAINT "document_reference_connection_id_integration_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference" ADD CONSTRAINT "document_reference_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_connection_id_integration_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_connection_id_integration_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_reference_provider_external_uq" ON "document_reference" USING btree ("household_id","provider","external_id") WHERE "document_reference"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "document_reference_household_date_idx" ON "document_reference" USING btree ("household_id","document_date");--> statement-breakpoint
CREATE INDEX "integration_connection_household_idx" ON "integration_connection" USING btree ("household_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_connection_purpose_uq" ON "integration_credential" USING btree ("connection_id","purpose");--> statement-breakpoint
CREATE INDEX "integration_credential_key_idx" ON "integration_credential" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "sync_run_connection_created_idx" ON "sync_run" USING btree ("connection_id","created_at");