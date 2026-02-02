ALTER TABLE users ADD COLUMN primary_category TEXT NOT NULL DEFAULT 'osu-ranked';
ALTER TABLE users ADD COLUMN is_primary_category_auto INTEGER NOT NULL DEFAULT 1;