-- Copy team data from users to teams
-- We use a window function to grab the team info from the user 
-- with the most recent login time for each unique team_id.
INSERT
OR REPLACE INTO teams (id, name, name_short, flag_url)
SELECT
    team_id,
    team_name,
    team_name_short,
    team_flag_url
FROM
    (
        SELECT
            team_id,
            team_name,
            team_name_short,
            team_flag_url,
            ROW_NUMBER() OVER (
                PARTITION BY
                    team_id
                ORDER BY
                    last_login_time DESC
            ) as rn
        FROM
            users
        WHERE
            team_id IS NOT NULL
    )
WHERE
    rn = 1;

-- Clean up the users table
ALTER TABLE users
DROP COLUMN team_name;

ALTER TABLE users
DROP COLUMN team_name_short;

ALTER TABLE users
DROP COLUMN team_flag_url;