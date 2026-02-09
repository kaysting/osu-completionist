CREATE TABLE
	IF NOT EXISTS "user_passes" (
		"user_id" INTEGER NOT NULL,
		"mapset_id" INTEGER NOT NULL,
		"map_id" INTEGER NOT NULL,
		"mode" TEXT NOT NULL,
		"time_passed" INTEGER NOT NULL DEFAULT 1763938577564,
		PRIMARY KEY ("user_id", "mapset_id", "map_id", "mode")
	);

CREATE INDEX IF NOT EXISTS idx_user_passes_covering ON user_passes (time_passed DESC, user_id, map_id, mode);

CREATE INDEX IF NOT EXISTS idx_user_passes_lookup ON user_passes (user_id, map_id, mode);

CREATE INDEX IF NOT EXISTS idx_user_passes_recent ON user_passes (user_id, mode, time_passed DESC);

CREATE INDEX IF NOT EXISTS idx_user_passes_map_id ON user_passes (map_id);

CREATE TABLE
	IF NOT EXISTS "users" (
		"id" INTEGER,
		"name" TEXT NOT NULL,
		"avatar_url" TEXT,
		"banner_url" INTEGER,
		"country_code" TEXT,
		"team_id" INTEGER,
		last_pass_time INTEGER NOT NULL DEFAULT 0,
		last_import_time INTEGER NOT NULL DEFAULT 0,
		time_created INTEGER NOT NULL DEFAULT 1766376098955,
		last_profile_update_time INTEGER NOT NULL DEFAULT 0,
		last_login_time INTEGER NOT NULL DEFAULT 0,
		api_key TEXT,
		has_full_import INTEGER DEFAULT 0,
		default_category TEXT NOT NULL DEFAULT 'osu-ranked',
		is_default_category_auto INTEGER NOT NULL DEFAULT 1,
		PRIMARY KEY ("id")
	);

CREATE INDEX IF NOT EXISTS idx_users_name ON users (name);

CREATE INDEX IF NOT EXISTS idx_users_last_pass ON users (last_pass_time);

CREATE TABLE
	IF NOT EXISTS user_previous_names (user_id INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (user_id, name));

CREATE VIRTUAL TABLE IF NOT EXISTS users_search USING fts5 (names);

CREATE TABLE
	IF NOT EXISTS "user_import_queue" (
		"user_id" INTEGER NOT NULL UNIQUE,
		"time_queued" INTEGER DEFAULT 0,
		"time_started" INTEGER DEFAULT 0,
		"percent_complete" REAL DEFAULT 0,
		"count_passes_imported" INTEGER DEFAULT 0,
		playcounts_count INTEGER DEFAULT 0,
		is_full INTEGER DEFAULT 0
	);

CREATE TABLE
	IF NOT EXISTS "beatmapsets" (
		"id" INTEGER NOT NULL,
		"status" TEXT NOT NULL,
		"title" TEXT,
		"artist" TEXT,
		"mapper" TEXT,
		"time_ranked" INTEGER NOT NULL,
		PRIMARY KEY ("id")
	);

CREATE INDEX IF NOT EXISTS idx_beatmapsets_time_ranked ON beatmapsets (time_ranked);

CREATE TABLE
	IF NOT EXISTS "beatmaps" (
		"id" INTEGER NOT NULL,
		"mapset_id" INTEGER NOT NULL,
		"mode" TEXT NOT NULL,
		"status" TEXT NOT NULL,
		"name" TEXT,
		"stars" REAL NOT NULL,
		"is_convert" INTEGER NOT NULL,
		"duration_secs" INTEGER NOT NULL DEFAULT 0,
		cs REAL,
		ar REAL,
		od REAL,
		hp REAL,
		bpm REAL,
		PRIMARY KEY ("id", "mapset_id", "mode")
	);

-- FTS5 Virtual Table for Map Search
CREATE VIRTUAL TABLE IF NOT EXISTS beatmaps_search USING fts5 (title, artist, name, map_id UNINDEXED, mode UNINDEXED);

/* beatmaps_search(title,artist,name,map_id,mode) */
CREATE TABLE
	IF NOT EXISTS "user_category_stats" (
		"user_id" INTEGER NOT NULL,
		"category" TEXT NOT NULL,
		"count" INTEGER NOT NULL DEFAULT 0,
		"seconds" INTEGER NOT NULL DEFAULT 0,
		best_rank INTEGER NOT NULL DEFAULT 0,
		best_rank_time INTEGER NOT NULL DEFAULT 0,
		best_percent REAL NOT NULL DEFAULT 0,
		best_percent_time INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY ("user_id", "category")
	);

CREATE INDEX IF NOT EXISTS idx_category_stats_leaderboard ON user_category_stats (category, seconds DESC);

CREATE TABLE
	IF NOT EXISTS "user_category_stats_yearly" (
		"user_id" INTEGER NOT NULL,
		"category" TEXT NOT NULL,
		"year" INTEGER NOT NULL,
		"count" INTEGER NOT NULL DEFAULT 0,
		"seconds" INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY ("user_id", "category", "year")
	);

CREATE TABLE
	IF NOT EXISTS "user_category_stats_history" (
		"date" TEXT NOT NULL,
		"user_id" INTEGER NOT NULL,
		"category" TEXT NOT NULL,
		"count" INTEGER NOT NULL DEFAULT 0,
		"seconds" INTEGER NOT NULL DEFAULT 0,
		"percent" REAL NOT NULL DEFAULT 0,
		"rank" INTEGER NOT NULL DEFAULT 0,
		"time" INTEGER NOT NULL,
		PRIMARY KEY ("user_id", "category", "date")
	);

CREATE TABLE
	IF NOT EXISTS "user_full_completions" (
		"user_id" INTEGER NOT NULL,
		"category" TEXT NOT NULL,
		"count" INTEGER NOT NULL DEFAULT 0,
		"seconds" INTEGER NOT NULL DEFAULT 0,
		"time" INTEGER NOT NULL
	);

CREATE INDEX IF NOT EXISTS idx_full_completions_user ON user_full_completions (user_id);

CREATE TABLE
	IF NOT EXISTS "analytics" (
		"date" TEXT NOT NULL,
		"metric" TEXT NOT NULL,
		"value" INTEGER NOT NULL,
		PRIMARY KEY ("date", "metric")
	);

CREATE TABLE
	IF NOT EXISTS "country_names" ("code" TEXT NOT NULL, "name" TEXT NOT NULL, PRIMARY KEY ("code"));

CREATE TABLE
	IF NOT EXISTS "user_api_usage" (
		"user_id" INTEGER NOT NULL,
		"expire_time" INTEGER NOT NULL,
		"count" INTEGER NOT NULL,
		PRIMARY KEY ("user_id")
	);

CREATE TABLE
	IF NOT EXISTS global_recents_cursors (mode TEXT NOT NULL PRIMARY KEY, cursor TEXT NOT NULL);

CREATE TABLE
	IF NOT EXISTS misc (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE
	IF NOT EXISTS teams (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		name_short TEXT NOT NULL,
		flag_url TEXT
	);

CREATE TABLE
	IF NOT EXISTS donations (
		time_received TEXT NOT NULL,
		transaction_id TEXT NOT NULL,
		email TEXT,
		amount REAL NOT NULL,
		currency TEXT NOT NULL,
		is_claimed INTEGER NOT NULL DEFAULT 0,
		user_id TEXT
	);