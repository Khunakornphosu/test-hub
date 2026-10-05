CREATE TABLE "backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"file" text,
	"bytes" integer,
	"ok" boolean NOT NULL,
	"error" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
