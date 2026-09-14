ALTER TABLE "task" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(next_action, '') || ' ' || coalesce(waiting_for, ''))) STORED;--> statement-breakpoint
ALTER TABLE "household_case" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(next_action, '') || ' ' || coalesce(external_reference, ''))) STORED;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(description, '') || ' ' || coalesce(merchant, '') || ' ' || coalesce(notes, ''))) STORED;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(counterparty, '') || ' ' || coalesce(external_reference, ''))) STORED;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(destination, '') || ' ' || coalesce(notes, ''))) STORED;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(manufacturer, '') || ' ' || coalesce(identifier, '') || ' ' || coalesce(location, ''))) STORED;--> statement-breakpoint
ALTER TABLE "document_reference" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(title_override, '') || ' ' || coalesce(note, ''))) STORED;--> statement-breakpoint
CREATE INDEX "task_search_idx" ON "task" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "case_search_idx" ON "household_case" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "expense_search_idx" ON "expense" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "reimbursement_search_idx" ON "reimbursement" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "trip_search_idx" ON "trip" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "asset_search_idx" ON "asset" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "document_search_idx" ON "document_reference" USING gin ("search_vector");