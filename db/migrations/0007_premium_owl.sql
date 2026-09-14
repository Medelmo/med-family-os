CREATE TYPE "public"."trip_item_kind" AS ENUM('ITINERARY', 'PACKING', 'ACCESSIBILITY');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('PLANNED', 'CONFIRMED', 'CANCELLED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('UNVERIFIED', 'CONFIRMED', 'REFUSED');--> statement-breakpoint
CREATE TABLE "trip_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"trip_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "trip_item_kind" NOT NULL,
	"title" text NOT NULL,
	"on_date" date,
	"person_id" uuid,
	"done" boolean DEFAULT false NOT NULL,
	"verification" "verification_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"verification_source" text,
	"verified_on" date,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_item_verification_has_source" CHECK ("trip_item"."verification" = 'UNVERIFIED' or "trip_item"."verification_source" is not null)
);
--> statement-breakpoint
CREATE TABLE "trip_participant" (
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "trip_participant_trip_id_person_id_pk" PRIMARY KEY("trip_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"destination" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "trip_status" DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"archived_at" timestamp with time zone,
	"visibility" "visibility" DEFAULT 'HOUSEHOLD' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'NORMAL' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trip_dates_ordered" CHECK ("trip"."ends_on" >= "trip"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "trip_item" ADD CONSTRAINT "trip_item_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_item" ADD CONSTRAINT "trip_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_item" ADD CONSTRAINT "trip_item_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_item" ADD CONSTRAINT "trip_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_participant" ADD CONSTRAINT "trip_participant_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_participant" ADD CONSTRAINT "trip_participant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_item_trip_kind_idx" ON "trip_item" USING btree ("trip_id","kind");--> statement-breakpoint
CREATE INDEX "trip_household_starts_idx" ON "trip" USING btree ("household_id","starts_on");--> statement-breakpoint
CREATE INDEX "trip_household_status_idx" ON "trip" USING btree ("household_id","status");