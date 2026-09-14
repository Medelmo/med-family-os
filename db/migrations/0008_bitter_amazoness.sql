CREATE TYPE "public"."asset_category" AS ENUM('APPLIANCE', 'ELECTRONICS', 'FURNITURE', 'MOBILITY', 'MEDICAL', 'VEHICLE', 'TOOL', 'OTHER');--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "asset_category" DEFAULT 'OTHER' NOT NULL,
	"location" text,
	"manufacturer" text,
	"identifier" text,
	"purchased_on" date,
	"purchase_price_minor" bigint,
	"currency" text,
	"person_id" uuid,
	"notes" text,
	"disposed_on" date,
	"disposal_note" text,
	"archived_at" timestamp with time zone,
	"visibility" "visibility" DEFAULT 'HOUSEHOLD' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'NORMAL' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "asset_currency_iso" CHECK ("asset"."currency" is null or "asset"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "asset_price_non_negative" CHECK ("asset"."purchase_price_minor" is null or "asset"."purchase_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_record" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"asset_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"performed_on" date NOT NULL,
	"summary" text NOT NULL,
	"performed_by" text,
	"cost_minor" bigint,
	"currency" text,
	"next_due_on" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_next_due_after_performed" CHECK ("maintenance_record"."next_due_on" is null or "maintenance_record"."next_due_on" >= "maintenance_record"."performed_on"),
	CONSTRAINT "maintenance_currency_iso" CHECK ("maintenance_record"."currency" is null or "maintenance_record"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "warranty" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"asset_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reference" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "warranty_dates_ordered" CHECK ("warranty"."ends_on" >= "warranty"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_record" ADD CONSTRAINT "maintenance_record_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_record" ADD CONSTRAINT "maintenance_record_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_record" ADD CONSTRAINT "maintenance_record_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty" ADD CONSTRAINT "warranty_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty" ADD CONSTRAINT "warranty_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty" ADD CONSTRAINT "warranty_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_household_category_idx" ON "asset" USING btree ("household_id","category");--> statement-breakpoint
CREATE INDEX "maintenance_asset_performed_idx" ON "maintenance_record" USING btree ("asset_id","performed_on");--> statement-breakpoint
CREATE INDEX "maintenance_household_next_due_idx" ON "maintenance_record" USING btree ("household_id","next_due_on");--> statement-breakpoint
CREATE INDEX "warranty_household_ends_idx" ON "warranty" USING btree ("household_id","ends_on");--> statement-breakpoint
CREATE INDEX "warranty_asset_idx" ON "warranty" USING btree ("asset_id");