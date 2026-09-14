CREATE TYPE "public"."linkable_type" AS ENUM('case', 'task', 'expense', 'reimbursement', 'trip', 'asset', 'document');--> statement-breakpoint
CREATE TABLE "record_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"source_type" "linkable_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"target_type" "linkable_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_link_not_self" CHECK (not ("record_link"."source_type" = "record_link"."target_type" and "record_link"."source_id" = "record_link"."target_id")),
	CONSTRAINT "record_link_canonical_order" CHECK (("record_link"."source_type", "record_link"."source_id") <= ("record_link"."target_type", "record_link"."target_id"))
);
--> statement-breakpoint
ALTER TABLE "record_link" ADD CONSTRAINT "record_link_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_link" ADD CONSTRAINT "record_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_link_pair_uq" ON "record_link" USING btree ("household_id","source_type","source_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "record_link_source_idx" ON "record_link" USING btree ("household_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "record_link_target_idx" ON "record_link" USING btree ("household_id","target_type","target_id");