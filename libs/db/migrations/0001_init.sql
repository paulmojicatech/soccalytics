CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"period" integer NOT NULL,
	"t" real NOT NULL,
	"type" text NOT NULL,
	"start" jsonb NOT NULL,
	"end" jsonb NOT NULL,
	"success" boolean NOT NULL,
	"body_part" text NOT NULL,
	"play_pattern" text NOT NULL,
	"recipient_id" text,
	"xg" real,
	"xt" real,
	"progressive" boolean NOT NULL,
	"confidence" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineups" (
	"match_id" text NOT NULL,
	"team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"starter" boolean NOT NULL,
	"minutes_played" real NOT NULL,
	"position" text NOT NULL,
	CONSTRAINT "lineups_match_id_player_id_pk" PRIMARY KEY("match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"stop_reason" text,
	"ok" boolean NOT NULL,
	"error" text,
	"subject_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_reports" (
	"match_id" text NOT NULL,
	"team_id" text NOT NULL,
	"report" jsonb NOT NULL,
	"meta" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_reports_match_id_team_id_pk" PRIMARY KEY("match_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"home_team_id" text NOT NULL,
	"away_team_id" text NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"competition" text NOT NULL,
	"venue" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"duration_sec" integer,
	"video_key" text,
	"tracking_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_evaluations" (
	"player_id" text PRIMARY KEY NOT NULL,
	"evaluation" jsonb NOT NULL,
	"meta" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_match_stats" (
	"match_id" text NOT NULL,
	"player_id" text NOT NULL,
	"team_id" text NOT NULL,
	"position" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"rating" real NOT NULL,
	"avg_position" jsonb NOT NULL,
	CONSTRAINT "player_match_stats_match_id_player_id_pk" PRIMARY KEY("match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"player_id" text PRIMARY KEY NOT NULL,
	"profile" jsonb NOT NULL,
	"embedding" vector(23) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"shirt_number" integer NOT NULL,
	"position" text NOT NULL,
	"birth_date" text NOT NULL,
	"height_cm" integer,
	"foot" text NOT NULL,
	"nationality" text,
	"latent_attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"stages" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_match_stats" (
	"match_id" text NOT NULL,
	"team_id" text NOT NULL,
	"stats" jsonb NOT NULL,
	CONSTRAINT "team_match_stats_match_id_team_id_pk" PRIMARY KEY("match_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"level" text NOT NULL,
	"primary_color" text NOT NULL,
	"secondary_color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reports" ADD CONSTRAINT "match_reports_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_evaluations" ADD CONSTRAINT "player_evaluations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_match_stats" ADD CONSTRAINT "team_match_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_match_idx" ON "events" USING btree ("match_id","type");--> statement-breakpoint
CREATE INDEX "events_player_idx" ON "events" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "llm_calls_task_idx" ON "llm_calls" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "pms_player_idx" ON "player_match_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_profiles_embedding_idx" ON "player_profiles" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "players_team_idx" ON "players" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "jobs_match_idx" ON "processing_jobs" USING btree ("match_id");