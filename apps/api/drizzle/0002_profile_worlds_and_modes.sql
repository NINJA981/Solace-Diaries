ALTER TABLE "profiles" ADD COLUMN "world" text DEFAULT 'lamplight' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "sound_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "haptics_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "companion_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "mode" text DEFAULT 'adult' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "age_band" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "consent_status" text DEFAULT 'not_required' NOT NULL;