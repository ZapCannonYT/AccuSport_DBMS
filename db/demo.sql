-- AccuSports demo script (pgAdmin Query Tool, tab title must start with "accusports/")
-- DO NOT run the whole file: pgAdmin only shows the last result and stops at the first error.
-- Select ONE query with the mouse, then press F5.

SET TIME ZONE 'Asia/Kolkata';
SELECT current_database();                -- must say accusports

-- 0. What is in the database: real VCT data, 2023-2026
SELECT tr.year, COUNT(DISTINCT tr.tournament_id) AS tournaments, COUNT(DISTINCT se.series_id) AS series,
       COUNT(DISTINCT mp.map_play_id) AS maps, COUNT(DISTINCT pa.player_id) AS players
FROM tournaments tr
JOIN series se          ON se.tournament_id = tr.tournament_id
JOIN map_plays mp       ON mp.series_id = se.series_id
JOIN map_participants pa ON pa.map_play_id = mp.map_play_id
GROUP BY ROLLUP (tr.year)
ORDER BY tr.year;

-- 0b. What we track: 4 common metrics (one per category) + Valorant-specific extras
SELECT COALESCE(category, '(valorant-specific)') AS category, label, unit, higher_is_better, monitored
FROM metric_definitions
ORDER BY category NULLS LAST, label;

-- 1. "Average salary per department": team averages per season (teams = departments)
SELECT * FROM v_report_team_stats WHERE year = 2025;

-- 1b. The same idea written out by hand: average KAST and ADR per agent role
SELECT ag.role, COUNT(*) AS player_maps,
       ROUND(AVG(pm.value) FILTER (WHERE md.code = 'kast_pct'), 1) AS avg_kast_pct,
       ROUND(AVG(pm.value) FILTER (WHERE md.code = 'adr'), 1)      AS avg_adr
FROM participant_metrics pm
JOIN metric_definitions md ON md.metric_id = pm.metric_id
JOIN map_participants pa   ON pa.map_play_id = pm.map_play_id AND pa.player_id = pm.player_id
JOIN agents ag             ON ag.agent_id = pa.agent_id
WHERE md.code IN ('kast_pct', 'adr')
GROUP BY ag.role
HAVING COUNT(*) > 100
ORDER BY avg_adr DESC;

-- 2. Reports
SELECT * FROM v_report_region_stats;      -- common metrics by region
SELECT * FROM v_report_role_stats;        -- duelist vs initiator vs controller vs sentinel
SELECT * FROM v_report_agent_meta WHERE year = 2026;   -- pick rate (window SUM) + RANK
SELECT * FROM v_report_map_sides;         -- attack vs defence round win % per map
SELECT * FROM v_report_tier_performance;  -- stars vs others at Masters / Champions (CTE + subquery)
SELECT * FROM v_report_player_years WHERE player IN ('aspas', 'Derke', 'something');  -- LAG()

-- 3. Novelty: the early-warning detector on real data
SELECT * FROM v_report_alerts_near_events;  -- alerts cluster around real roster moves
SELECT * FROM v_report_alert_lead_time;     -- maps between alert and form drop
SELECT * FROM v_report_alert_followup;      -- rating in the 10 maps after an alert
SELECT * FROM v_report_decline_cause;       -- core-skill vs roster move vs role change
SELECT * FROM v_report_fragile_metric;      -- RANK()

-- 4. Leaderboard (materialized view)
REFRESH MATERIALIZED VIEW mv_leaderboard;
SELECT * FROM mv_leaderboard WHERE position <= 5 ORDER BY year DESC, position;

-- 5. Look inside the detector for one player (aspas)
SELECT md.label AS metric, cs.n_baseline, ROUND(cs.baseline_mean, 2) AS baseline_mean,
       ROUND(cs.s_neg, 2) AS s_neg, ROUND(cs.s_pos, 2) AS s_pos
FROM cusum_state cs
JOIN metric_definitions md ON md.metric_id = cs.metric_id
WHERE cs.player_id = (SELECT player_id FROM players WHERE name = 'aspas');

SELECT alert_id, metric, direction, ROUND(cusum_value, 2) AS cusum, context,
       tournament, map, started_at::date AS approx_date, status
FROM v_alert_details
WHERE player = 'aspas'
ORDER BY started_at;

-- 5b. aspas's form rating over time (every 10th map)
SELECT f.recorded_at::date AS approx_date, f.form
FROM form_ratings f
JOIN v_player_maps pm ON pm.player_id = f.player_id AND pm.map_play_id = f.map_play_id
WHERE f.player_id = (SELECT player_id FROM players WHERE name = 'aspas') AND pm.rn % 10 = 0
ORDER BY f.recorded_at;

-- 6. Moderator action (UPDATE): acknowledge one open alert
UPDATE drift_alerts SET status = 'acknowledged', reviewed_by = 2, review_note = 'Checked in demo'
WHERE alert_id = (SELECT MIN(alert_id) FROM drift_alerts WHERE status = 'open')
RETURNING alert_id, status, reviewed_by;

-- ===================================================================
-- EVERYTHING BELOW IS MEANT TO FAIL. The ERROR is the proof.
-- Run one statement at a time.
-- ===================================================================

-- 7. Transaction: a map with an unknown metric is rolled back completely
SELECT COUNT(*) FROM map_plays;           -- note the number (4096)
SELECT fn_record_map(999999999, 1, 1, 1, 2, 13, 5, 7, 6, 2, 3, 2400, now(),
  '[{"player_id": 1, "team_id": 1, "agent_id": 1, "metrics": {"bogus": 1}}]');
                                          -- EXPECTED ERROR: Unknown metric bogus
SELECT COUNT(*) FROM map_plays;           -- still 4096: the map row was rolled back too

-- 7b. The same real map cannot be imported twice
SELECT fn_record_map((SELECT MIN(vlr_game_id) FROM map_plays), 1, 1, 1, 2, 13, 5, 7, 6, 2, 3, 2400, now(), '[]');
                                          -- EXPECTED ERROR: duplicate key ... "map_plays_vlr_game_id_key"

-- 8. Constraints reject bad data
INSERT INTO users (email, password_hash, display_name, role)
VALUES ('x@y.com', 'h', 'Tester', 'superuser');
                                          -- EXPECTED ERROR: violates check constraint "users_role_check"
INSERT INTO metric_definitions (code, label, unit, higher_is_better, category)
VALUES ('bad', 'Second damage metric', 'x', true, 'damage');
                                          -- EXPECTED ERROR: only ONE metric per common category
INSERT INTO series (vlr_match_id, tournament_id, stage, match_type, team_a_id, team_b_id, team_a_score, team_b_score)
VALUES (1, 1, 'x', 'x', 5, 5, 2, 0);
                                          -- EXPECTED ERROR: a team cannot play itself (CHECK team_a_id <> team_b_id)
