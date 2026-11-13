CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"scope" varchar(100) NOT NULL,
	"key" varchar(255) NOT NULL,
	"request_hash" varchar(255) NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"result_reference" varchar(255),
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_idempotency_scope_key" UNIQUE("scope","key")
);
