CREATE TYPE "public"."case_status" AS ENUM('DRAFT', 'ACTIVE', 'WAITING', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "case_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"case_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_person" (
	"case_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "case_person_case_id_person_id_pk" PRIMARY KEY("case_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "case_task" (
	"case_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	CONSTRAINT "case_task_case_id_task_id_pk" PRIMARY KEY("case_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "household_case" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "case_status" DEFAULT 'DRAFT' NOT NULL,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"owner_person_id" uuid,
	"next_action" text,
	"waiting_for" text,
	"waiting_since" timestamp with time zone,
	"follow_up_at" timestamp with time zone,
	"waiting_no_follow_up_reason" text,
	"external_reference" text,
	"blocked_reason" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"archived_at" timestamp with time zone,
	"visibility" "visibility" DEFAULT 'HOUSEHOLD' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'NORMAL' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "case_event" ADD CONSTRAINT "case_event_case_id_household_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."household_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_event" ADD CONSTRAINT "case_event_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_event" ADD CONSTRAINT "case_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_person" ADD CONSTRAINT "case_person_case_id_household_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."household_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_person" ADD CONSTRAINT "case_person_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_case_id_household_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."household_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_case" ADD CONSTRAINT "household_case_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_case" ADD CONSTRAINT "household_case_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_case" ADD CONSTRAINT "household_case_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_event_case_created_idx" ON "case_event" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "case_household_status_idx" ON "household_case" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "case_household_follow_up_idx" ON "household_case" USING btree ("household_id","follow_up_at");--> statement-breakpoint
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_case_id_household_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."household_case"("id") ON DELETE set null ON UPDATE no action;