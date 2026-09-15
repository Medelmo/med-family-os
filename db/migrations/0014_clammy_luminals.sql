CREATE TYPE "public"."ai_suggestion_kind" AS ENUM('CASE_NEXT_ACTION', 'CASE_TASK', 'CASE_SUMMARY');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_status" AS ENUM('PROPOSED', 'ACCEPTED', 'REJECTED', 'STALE');--> statement-breakpoint
CREATE TABLE "ai_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "ai_suggestion_kind" NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'PROPOSED' NOT NULL,
	"payload" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"result_type" text,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestion_household_status_idx" ON "ai_suggestion" USING btree ("household_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_suggestion_result_idx" ON "ai_suggestion" USING btree ("result_type","result_id");