CREATE TABLE "run_traces" (
	"run_id" integer PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_batches" ADD COLUMN "flaky" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "flaky" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "retry_error" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
ALTER TABLE "run_traces" ADD CONSTRAINT "run_traces_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;