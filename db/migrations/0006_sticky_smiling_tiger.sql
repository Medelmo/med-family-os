CREATE TYPE "public"."expense_category" AS ENUM('HOUSING', 'UTILITIES', 'GROCERIES', 'HEALTH', 'INSURANCE', 'TRANSPORT', 'CHILDCARE', 'EDUCATION', 'LEISURE', 'TRAVEL', 'HOUSEHOLD', 'FEES', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."reimbursement_status" AS ENUM('PLANNED', 'SUBMITTED', 'WAITING', 'APPROVED', 'PARTIALLY_REIMBURSED', 'PAID', 'REJECTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "budget" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"category" "expense_category" NOT NULL,
	"currency" text NOT NULL,
	"monthly_limit_minor" bigint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "budget_currency_iso" CHECK ("budget"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "budget_limit_positive" CHECK ("budget"."monthly_limit_minor" > 0),
	CONSTRAINT "budget_period_ordered" CHECK ("budget"."ends_on" is null or "budget"."ends_on" >= "budget"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" "expense_category" DEFAULT 'OTHER' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"incurred_on" date NOT NULL,
	"person_id" uuid,
	"paid_by_person_id" uuid,
	"merchant" text,
	"notes" text,
	"reimbursement_id" uuid,
	"archived_at" timestamp with time zone,
	"visibility" "visibility" DEFAULT 'HOUSEHOLD' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'SENSITIVE' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "expense_currency_iso" CHECK ("expense"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "reimbursement_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reimbursement_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "reimbursement_status" DEFAULT 'PLANNED' NOT NULL,
	"counterparty" text,
	"external_reference" text,
	"currency" text NOT NULL,
	"claimed_amount_minor" bigint DEFAULT 0 NOT NULL,
	"approved_amount_minor" bigint,
	"reimbursed_amount_minor" bigint DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"waiting_since" timestamp with time zone,
	"follow_up_at" timestamp with time zone,
	"waiting_no_follow_up_reason" text,
	"follow_up_notified_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"notes" text,
	"visibility" "visibility" DEFAULT 'HOUSEHOLD' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'SENSITIVE' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reimbursement_currency_iso" CHECK ("reimbursement"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "reimbursement_amounts_non_negative" CHECK ("reimbursement"."claimed_amount_minor" >= 0 and "reimbursement"."reimbursed_amount_minor" >= 0 and ("reimbursement"."approved_amount_minor" is null or "reimbursement"."approved_amount_minor" >= 0))
);
--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_paid_by_person_id_person_id_fk" FOREIGN KEY ("paid_by_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_reimbursement_id_reimbursement_id_fk" FOREIGN KEY ("reimbursement_id") REFERENCES "public"."reimbursement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_event" ADD CONSTRAINT "reimbursement_event_reimbursement_id_reimbursement_id_fk" FOREIGN KEY ("reimbursement_id") REFERENCES "public"."reimbursement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_event" ADD CONSTRAINT "reimbursement_event_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_event" ADD CONSTRAINT "reimbursement_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_household_category_currency_open_uq" ON "budget" USING btree ("household_id","category","currency") WHERE "budget"."ends_on" is null;--> statement-breakpoint
CREATE INDEX "expense_household_incurred_idx" ON "expense" USING btree ("household_id","incurred_on");--> statement-breakpoint
CREATE INDEX "expense_household_category_idx" ON "expense" USING btree ("household_id","category");--> statement-breakpoint
CREATE INDEX "expense_reimbursement_idx" ON "expense" USING btree ("reimbursement_id");--> statement-breakpoint
CREATE INDEX "reimbursement_event_claim_created_idx" ON "reimbursement_event" USING btree ("reimbursement_id","created_at");--> statement-breakpoint
CREATE INDEX "reimbursement_household_status_idx" ON "reimbursement" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "reimbursement_household_follow_up_idx" ON "reimbursement" USING btree ("household_id","follow_up_at");