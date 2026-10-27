-- AccuSports: relational schema (PostgreSQL 16+), Valorant pro play (VCT 2023-2026)
-- Run order: 01_schema.sql -> 02_cusum.sql -> 03_reports.sql

DROP TABLE IF EXISTS drift_alerts, cusum_state, form_ratings, participant_metrics,
    map_participants, metric_definitions, map_plays, series, agents, maps,
    tournaments, teams, players, users CASCADE;
-- tables from earlier versions of this project
DROP TABLE IF EXISTS match_participants, matches, skill_ratings, player_accounts, games CASCADE;

-- ---------------------------------------------------------------------------
-- Who
-- ---------------------------------------------------------------------------

-- 1. players: professional players found in the VCT data
CREATE TABLE players (
    player_id     SERIAL PRIMARY KEY,
    vlr_player_id INT UNIQUE,                         -- vlr.gg id (NULL if the source has none)
    name          VARCHAR(40) NOT NULL,
    region        VARCHAR(4)  NOT NULL DEFAULT 'INTL'
                  CHECK (region IN ('AMER', 'EMEA', 'PAC', 'CN', 'INTL'))
);

-- 2. users: people who log in to the web app (not the pros)
CREATE TABLE users (
    user_id            SERIAL PRIMARY KEY,
    email              VARCHAR(255) NOT NULL UNIQUE,
    password_hash      VARCHAR(100) NOT NULL,         -- bcrypt hash, never plain text
    display_name       VARCHAR(40)  NOT NULL,
    role               VARCHAR(10)  NOT NULL DEFAULT 'analyst'
                       CHECK (role IN ('admin', 'moderator', 'analyst')),
    followed_player_id INT REFERENCES players(player_id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (email LIKE '%_@_%')
);

-- 3. teams
CREATE TABLE teams (
    team_id     SERIAL PRIMARY KEY,
    vlr_team_id INT UNIQUE,
    name        VARCHAR(40) NOT NULL,
    region      VARCHAR(4)  NOT NULL DEFAULT 'INTL'
                CHECK (region IN ('AMER', 'EMEA', 'PAC', 'CN', 'INTL'))
);

-- ---------------------------------------------------------------------------
-- Where and with what
-- ---------------------------------------------------------------------------

-- 4. tournaments: one VCT event (Kickoff, Masters, league stage, Champions, ...)
CREATE TABLE tournaments (
    tournament_id     SERIAL PRIMARY KEY,
    vlr_tournament_id INT UNIQUE,
    name              VARCHAR(80) NOT NULL UNIQUE,
    year              SMALLINT    NOT NULL CHECK (year BETWEEN 2020 AND 2100),
    tier              VARCHAR(10) NOT NULL
                      CHECK (tier IN ('kickoff', 'lock_in', 'league', 'masters', 'champions', 'qualifier')),
    region            VARCHAR(4)  CHECK (region IN ('AMER', 'EMEA', 'PAC', 'CN'))   -- NULL = international
);

-- 5. maps
CREATE TABLE maps (
    map_id SERIAL PRIMARY KEY,
    name   VARCHAR(20) NOT NULL UNIQUE
);

-- 6. agents, with their in-game role
CREATE TABLE agents (
    agent_id SERIAL PRIMARY KEY,
    name     VARCHAR(20) NOT NULL UNIQUE,
    role     VARCHAR(10) CHECK (role IN ('duelist', 'initiator', 'controller', 'sentinel'))  -- NULL = unknown/new
);

-- ---------------------------------------------------------------------------
-- What happened
-- ---------------------------------------------------------------------------

-- 7. series: one best-of-1/3/5 between two teams
CREATE TABLE series (
    series_id     SERIAL PRIMARY KEY,
    vlr_match_id  INT NOT NULL UNIQUE,
    tournament_id INT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    stage         VARCHAR(60) NOT NULL,
    match_type    VARCHAR(60) NOT NULL,
    team_a_id     INT NOT NULL REFERENCES teams(team_id),
    team_b_id     INT NOT NULL REFERENCES teams(team_id),
    team_a_score  SMALLINT NOT NULL CHECK (team_a_score >= 0),     -- maps won
    team_b_score  SMALLINT NOT NULL CHECK (team_b_score >= 0),
    CHECK (team_a_id <> team_b_id)
);

-- 8. map_plays: one map played inside a series
CREATE TABLE map_plays (
    map_play_id        SERIAL PRIMARY KEY,
    vlr_game_id        INT NOT NULL UNIQUE,              -- importing the same map twice fails
    series_id          INT NOT NULL REFERENCES series(series_id) ON DELETE CASCADE,
    map_id             INT NOT NULL REFERENCES maps(map_id),
    team_a_id          INT NOT NULL REFERENCES teams(team_id),
    team_b_id          INT NOT NULL REFERENCES teams(team_id),
    team_a_rounds      SMALLINT NOT NULL CHECK (team_a_rounds >= 0),
    team_b_rounds      SMALLINT NOT NULL CHECK (team_b_rounds >= 0),
    team_a_attack_won  SMALLINT CHECK (team_a_attack_won >= 0),  -- rounds won on attack / defence
    team_a_defense_won SMALLINT CHECK (team_a_defense_won >= 0),
    team_b_attack_won  SMALLINT CHECK (team_b_attack_won >= 0),
    team_b_defense_won SMALLINT CHECK (team_b_defense_won >= 0),
    rounds             SMALLINT GENERATED ALWAYS AS (team_a_rounds + team_b_rounds) STORED,
    winner_team_id     INT REFERENCES teams(team_id),            -- NULL for a draw
    duration_sec       INT NOT NULL CHECK (duration_sec > 0),
    started_at         TIMESTAMPTZ NOT NULL,                     -- estimated from vlr_game_id order
    CHECK (team_a_id <> team_b_id),
    CHECK (team_a_rounds + team_b_rounds > 0)
);

-- 9. map_participants: who played a map, for which team, on which agent
CREATE TABLE map_participants (
    map_play_id INT NOT NULL REFERENCES map_plays(map_play_id) ON DELETE CASCADE,
    player_id   INT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    team_id     INT NOT NULL REFERENCES teams(team_id),
    agent_id    INT NOT NULL REFERENCES agents(agent_id),
    result      VARCHAR(4) NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
    PRIMARY KEY (map_play_id, player_id)
);

-- ---------------------------------------------------------------------------
-- What we measure
-- ---------------------------------------------------------------------------

-- 10. metric_definitions: 4 common metrics (one per category) + extras
CREATE TABLE metric_definitions (
    metric_id        SERIAL PRIMARY KEY,
    code             VARCHAR(40) NOT NULL UNIQUE,
    label            VARCHAR(60) NOT NULL,
    unit             VARCHAR(20) NOT NULL,
    higher_is_better BOOLEAN     NOT NULL,
    category         VARCHAR(10) UNIQUE                -- NULLs are distinct: many extras allowed
                     CHECK (category IN ('fragging', 'survival', 'damage', 'precision')),
    monitored        BOOLEAN     NOT NULL DEFAULT true -- false = stored but not watched by CUSUM
);

-- 11. participant_metrics: one value per player per metric per map
CREATE TABLE participant_metrics (
    map_play_id INT NOT NULL,
    player_id   INT NOT NULL,
    metric_id   INT NOT NULL REFERENCES metric_definitions(metric_id),
    value       NUMERIC(10, 3) NOT NULL CHECK (value >= 0),
    PRIMARY KEY (map_play_id, player_id, metric_id),
    FOREIGN KEY (map_play_id, player_id)
        REFERENCES map_participants(map_play_id, player_id) ON DELETE CASCADE
);

-- 12. form_ratings: each player's running form after every map, kept by a trigger.
--     form = exponentially weighted average of vlr.gg rating x 1000 (1000 = average)
CREATE TABLE form_ratings (
    player_id   INT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    map_play_id INT NOT NULL REFERENCES map_plays(map_play_id) ON DELETE CASCADE,
    form        NUMERIC(7, 2) NOT NULL CHECK (form >= 0),
    recorded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (player_id, map_play_id)
);

-- ---------------------------------------------------------------------------
-- What the detector found
-- ---------------------------------------------------------------------------

-- 13. cusum_state: running detector state per player per metric
CREATE TABLE cusum_state (
    player_id     INT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    metric_id     INT NOT NULL REFERENCES metric_definitions(metric_id) ON DELETE CASCADE,
    n_baseline    INT     NOT NULL DEFAULT 0,      -- maps seen during baseline
    baseline_mean NUMERIC NOT NULL DEFAULT 0,
    baseline_m2   NUMERIC NOT NULL DEFAULT 0,      -- Welford sum of squares
    s_neg         NUMERIC NOT NULL DEFAULT 0 CHECK (s_neg >= 0),
    s_pos         NUMERIC NOT NULL DEFAULT 0 CHECK (s_pos >= 0),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, metric_id)
);

-- 14. drift_alerts: raised by the CUSUM trigger, reviewed by moderators in the app
CREATE TABLE drift_alerts (
    alert_id              SERIAL PRIMARY KEY,
    player_id             INT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    metric_id             INT NOT NULL REFERENCES metric_definitions(metric_id) ON DELETE CASCADE,
    direction             VARCHAR(7) NOT NULL CHECK (direction IN ('decline', 'improve')),
    cusum_value           NUMERIC(8, 3) NOT NULL,
    triggered_map_play_id INT NOT NULL REFERENCES map_plays(map_play_id) ON DELETE CASCADE,
    context               VARCHAR(12) CHECK (context IN ('team_change', 'role_change')),  -- NULL = none
    form_at_alert         NUMERIC(7, 2),
    form_drop_map_play_id INT REFERENCES map_plays(map_play_id) ON DELETE SET NULL,
    status                VARCHAR(12) NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'acknowledged', 'resolved')),
    reviewed_by           INT REFERENCES users(user_id) ON DELETE SET NULL,
    review_note           TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ,
    CHECK (resolved_at IS NULL OR status = 'resolved')
);

-- Indexes for the common access paths
CREATE INDEX idx_map_plays_time        ON map_plays (started_at);
CREATE INDEX idx_map_plays_series      ON map_plays (series_id);
CREATE INDEX idx_participants_player   ON map_participants (player_id);
CREATE INDEX idx_participants_team     ON map_participants (team_id);
CREATE INDEX idx_pm_player_metric      ON participant_metrics (player_id, metric_id);
CREATE INDEX idx_form_player_time      ON form_ratings (player_id, recorded_at);
CREATE INDEX idx_alerts_player         ON drift_alerts (player_id);
CREATE INDEX idx_alerts_open           ON drift_alerts (status) WHERE status = 'open';
CREATE INDEX idx_players_name_lower    ON players (lower(name));          -- case-insensitive search

-- ALTER example (required by the course): add a column after creation
ALTER TABLE teams ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
