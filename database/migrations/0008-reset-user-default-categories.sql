ALTER TABLE users DROP COLUMN primary_category;
ALTER TABLE users DROP COLUMN is_primary_category_auto;
ALTER TABLE users ADD COLUMN default_category TEXT NOT NULL DEFAULT 'osu-ranked';