-- Create teams table
CREATE TABLE
    IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        name_short TEXT NOT NULL,
        flag_url TEXT
    );