CREATE TABLE IF NOT EXISTS donations (
    time_received TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    email TEXT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL
);