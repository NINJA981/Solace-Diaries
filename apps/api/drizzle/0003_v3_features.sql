CREATE TABLE "capsules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"unlock_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capsules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"color" text NOT NULL,
	"cast" text[] DEFAULT '{}'::text[] NOT NULL,
	"key_entry_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"source_watermark" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "growth_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"text" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "growth_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intention_checkins" (
	"intention_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intention_checkins_intention_id_date_pk" PRIMARY KEY("intention_id","date")
);
--> statement-breakpoint
ALTER TABLE "intention_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"cadence" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"memory_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "parental_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_email_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"policy_version" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parental_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "past_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "past_letters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "mode" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "wordless" jsonb;--> statement-breakpoint
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_notes" ADD CONSTRAINT "growth_notes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intention_checkins" ADD CONSTRAINT "intention_checkins_intention_id_intentions_id_fk" FOREIGN KEY ("intention_id") REFERENCES "public"."intentions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intention_checkins" ADD CONSTRAINT "intention_checkins_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intentions" ADD CONSTRAINT "intentions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intentions" ADD CONSTRAINT "intentions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parental_consents" ADD CONSTRAINT "parental_consents_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "past_letters" ADD CONSTRAINT "past_letters_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "past_letters" ADD CONSTRAINT "past_letters_reply_entry_id_entries_id_fk" FOREIGN KEY ("reply_entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capsules_user_unlock_idx" ON "capsules" USING btree ("user_id","unlock_at");--> statement-breakpoint
CREATE INDEX "chapters_user_from_idx" ON "chapters" USING btree ("user_id","from_date");--> statement-breakpoint
CREATE INDEX "growth_notes_user_week_idx" ON "growth_notes" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "intention_checkins_user_idx" ON "intention_checkins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "intentions_user_status_idx" ON "intentions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "parental_consents_token_uq" ON "parental_consents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "parental_consents_user_idx" ON "parental_consents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "past_letters_user_month_uq" ON "past_letters" USING btree ("user_id","month");