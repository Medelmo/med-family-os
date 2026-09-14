ALTER TABLE "task" ADD COLUMN "follow_up_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deadline" ADD COLUMN "reminded_for_due_on" date;--> statement-breakpoint
ALTER TABLE "household_case" ADD COLUMN "follow_up_notified_at" timestamp with time zone;