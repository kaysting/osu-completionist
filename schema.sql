CREATE TABLE IF NOT EXISTS "users" (
	"id"	INTEGER,
	"name"	TEXT NOT NULL,
	"avatar_url"	TEXT,
	"banner_url"	INTEGER,
	"mode"	TEXT NOT NULL,
	"last_score_update"	INTEGER DEFAULT 0,
	PRIMARY KEY("id")
);
CREATE TABLE IF NOT EXISTS "user_passes" (
	"user_id"	INTEGER,
	"mapset_id"	INTEGER,
	"map_id"	INTEGER,
	"mode"	TEXT NOT NULL,
	"status"	TEXT NOT NULL,
	"is_convert"	INTEGER NOT NULL,
	PRIMARY KEY("user_id","mapset_id","map_id")
);
CREATE TABLE IF NOT EXISTS "user_update_tasks" (
	"user_id"	INTEGER NOT NULL UNIQUE,
	"time_queued"	INTEGER DEFAULT 0,
	"last_mapset_id"	TEXT DEFAULT 0,
	"count_new_passes"	INTEGER DEFAULT 0,
	"percent_complete"	REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "beatmaps" (
	"id"	INTEGER,
	"mapset_id"	INTEGER,
	"mode"	TEXT NOT NULL,
	"status"	TEXT NOT NULL,
	"name"	TEXT,
	"stars"	REAL NOT NULL,
	"is_convert"	INTEGER NOT NULL,
	PRIMARY KEY("id","mapset_id","mode")
);
CREATE TABLE IF NOT EXISTS "beatmapsets" (
	"id"	INTEGER,
	"status"	TEXT,
	"title"	TEXT,
	"artist"	TEXT,
	"time_ranked"	INTEGER NOT NULL,
	PRIMARY KEY("id")
);
CREATE TABLE IF NOT EXISTS "beatmap_stats" (
	"mode"	TEXT,
	"includes_loved"	TEXT,
	"includes_converts"	INTEGER,
	"count"	INTEGER,
	PRIMARY KEY("mode","includes_loved","includes_converts")
);
CREATE TABLE IF NOT EXISTS "user_stats" (
	"user_id"	INTEGER,
	"mode"	TEXT,
	"includes_loved"	TEXT,
	"includes_converts"	INTEGER,
	"count"	INTEGER DEFAULT 0,
	"rank"	INTEGER DEFAULT -1,
	PRIMARY KEY("user_id","mode","includes_loved","includes_converts")
);
