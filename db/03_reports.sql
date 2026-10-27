-- AccuSports: helper views, report views, leaderboard and the playstyle fingerprint
-- Depends on 01_schema.sql and 02_cusum.sql. Query any report with: SELECT * FROM <view>;

-- ===========================================================================
-- Helper views
-- ===========================================================================

-- Every map a player played, in time order (rn = 1 for their first map)
CREATE OR REPLACE VIEW v_player_maps AS
SELECT pa.player_id, pa.map_play_id, mp.started_at, pa.team_id, pa.agent_id, ag.role,
       pa.result, se.tournament_id, tr.year, tr.tier,
       ROW_NUMBER() OVER (PARTITION BY pa.player_id ORDER BY mp.started_at, mp.map_play_id) AS rn
FROM map_participants pa
JOIN map_plays mp   ON mp.map_play_id = pa.map_play_id
JOIN agents ag      ON ag.agent_id = pa.agent_id
JOIN series se      ON se.series_id = mp.series_id
JOIN tournaments tr ON tr.tournament_id = se.tournament_id;

-- Every metric value with the context needed by most reports
CREATE OR REPLACE VIEW v_metric_values AS
SELECT pm.player_id, pm.map_play_id, md.code, md.category, pm.value,
       pa.team_id, pa.result, ag.name AS agent, ag.role, tr.year, tr.tier, mp.started_at
FROM participant_metrics pm
JOIN metric_definitions md ON md.metric_id = pm.metric_id
JOIN map_participants pa   ON pa.map_play_id = pm.map_play_id AND pa.player_id = pm.player_id
JOIN agents ag             ON ag.agent_id = pa.agent_id
JOIN map_plays mp          ON mp.map_play_id = pm.map_play_id
JOIN series se             ON se.series_id = mp.series_id
JOIN tournaments tr        ON tr.tournament_id = se.tournament_id;

-- Every alert with readable names
CREATE OR REPLACE VIEW v_alert_details AS
SELECT a.*, p.name AS player, md.code AS metric_code, md.label AS metric, md.category,
       (md.category IS NOT NULL) AS is_common, mp.started_at, m.name AS map,
       tr.name AS tournament, tr.year, u.display_name AS reviewed_by_name
FROM drift_alerts a
JOIN players p             ON p.player_id = a.player_id
JOIN metric_definitions md ON md.metric_id = a.metric_id
JOIN map_plays mp          ON mp.map_play_id = a.triggered_map_play_id
JOIN maps m                ON m.map_id = mp.map_id
JOIN series se             ON se.series_id = mp.series_id
JOIN tournaments tr        ON tr.tournament_id = se.tournament_id
LEFT JOIN users u          ON u.user_id = a.reviewed_by;

-- Each player's latest form rating and current team
CREATE OR REPLACE VIEW v_player_current AS
SELECT DISTINCT ON (p.player_id)
       p.player_id, p.name, p.region, t.name AS team, f.form, f.recorded_at
FROM players p
JOIN form_ratings f      ON f.player_id = p.player_id
JOIN map_participants pa ON pa.player_id = p.player_id AND pa.map_play_id = f.map_play_id
JOIN teams t             ON t.team_id = pa.team_id
ORDER BY p.player_id, f.recorded_at DESC, f.map_play_id DESC;

-- ===========================================================================
-- Reports
-- ===========================================================================

-- Report 1: team averages per season ("average salary per department": teams are departments)
CREATE OR REPLACE VIEW v_report_team_stats AS
SELECT v.year, t.name AS team, t.region,
       COUNT(DISTINCT v.map_play_id) AS maps_played,
       ROUND(100.0 * COUNT(DISTINCT v.map_play_id) FILTER (WHERE v.result = 'win')
             / COUNT(DISTINCT v.map_play_id), 1)                   AS map_win_pct,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'kast_pct'), 1)   AS avg_kast_pct,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'adr'), 1)        AS avg_adr,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'acs'), 1)        AS avg_acs,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'vlr_rating'), 3) AS avg_rating
FROM v_metric_values v
JOIN teams t ON t.team_id = v.team_id
GROUP BY v.year, t.name, t.region
HAVING COUNT(DISTINCT v.map_play_id) >= 10
ORDER BY v.year DESC, map_win_pct DESC;

-- Report 2: common metrics by region
CREATE OR REPLACE VIEW v_report_region_stats AS
SELECT p.region,
       COUNT(DISTINCT p.player_id)                                        AS players,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'kills_per_round'), 3)   AS avg_kills_per_round,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'kast_pct'), 1)          AS avg_kast_pct,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'adr'), 1)               AS avg_adr,
       ROUND(AVG(v.value) FILTER (WHERE v.code = 'headshot_pct'), 1)      AS avg_headshot_pct
FROM v_metric_values v
JOIN players p ON p.player_id = v.player_id
GROUP BY p.region
HAVING COUNT(DISTINCT p.player_id) >= 5
ORDER BY avg_adr DESC;

-- Report 3: performance by agent role
CREATE OR REPLACE VIEW v_report_role_stats AS
SELECT COALESCE(role, 'unknown') AS role,
       COUNT(*) FILTER (WHERE code = 'acs')                             AS player_maps,
       ROUND(AVG(value) FILTER (WHERE code = 'acs'), 1)                 AS avg_acs,
       ROUND(AVG(value) FILTER (WHERE code = 'kast_pct'), 1)            AS avg_kast_pct,
       ROUND(AVG(value) FILTER (WHERE code = 'first_kill_rate'), 3)     AS avg_first_kills_per_round,
       ROUND(AVG(value) FILTER (WHERE code = 'vlr_rating'), 3)          AS avg_rating
FROM v_metric_values
GROUP BY COALESCE(role, 'unknown')
HAVING COUNT(*) FILTER (WHERE code = 'acs') >= 100
ORDER BY avg_acs DESC;

-- Report 4: agent meta per season (pick share uses a window SUM over the season)
CREATE OR REPLACE VIEW v_report_agent_meta AS
SELECT year, agent, role, picks,
       ROUND(100.0 * picks / SUM(picks) OVER (PARTITION BY year) * 5, 1) AS pick_rate_pct,  -- 5 picks per team per map
       win_pct,
       RANK() OVER (PARTITION BY year ORDER BY picks DESC) AS popularity_rank
FROM (
    SELECT tr.year, ag.name AS agent, ag.role, COUNT(*) AS picks,
           ROUND(100.0 * AVG(CASE WHEN pa.result = 'win' THEN 1 ELSE 0 END), 1) AS win_pct
    FROM map_participants pa
    JOIN agents ag      ON ag.agent_id = pa.agent_id
    JOIN map_plays mp   ON mp.map_play_id = pa.map_play_id
    JOIN series se      ON se.series_id = mp.series_id
    JOIN tournaments tr ON tr.tournament_id = se.tournament_id
    GROUP BY tr.year, ag.name, ag.role
) t
ORDER BY year DESC, picks DESC;

-- Report 5: attack vs defence per map (rounds won on each side, overtime excluded)
CREATE OR REPLACE VIEW v_report_map_sides AS
SELECT m.name AS map,
       COUNT(*) AS times_played,
       ROUND(AVG(mp.rounds), 1) AS avg_rounds,
       ROUND(100.0 * SUM(mp.team_a_attack_won + mp.team_b_attack_won)
             / NULLIF(SUM(mp.team_a_attack_won + mp.team_b_attack_won
                          + mp.team_a_defense_won + mp.team_b_defense_won), 0), 1) AS attack_round_win_pct
FROM map_plays mp
JOIN maps m ON m.map_id = mp.map_id
GROUP BY m.name
HAVING COUNT(*) >= 10
ORDER BY attack_round_win_pct DESC;

-- Report 6: do star players perform differently at international events?
-- Stars = career average vlr rating >= 1.10 over at least 50 maps (scalar subquery in a CTE).
CREATE OR REPLACE VIEW v_report_tier_performance AS
WITH career AS (
    SELECT player_id, AVG(value) AS avg_rating
    FROM v_metric_values
    WHERE code = 'vlr_rating'
    GROUP BY player_id
    HAVING COUNT(*) >= 50
)
SELECT v.tier,
       COUNT(DISTINCT v.map_play_id) AS maps,
       ROUND(AVG(v.value), 3) AS avg_rating_all,
       ROUND(AVG(v.value) FILTER (WHERE v.player_id IN (SELECT player_id FROM career WHERE avg_rating >= 1.10)), 3)
           AS avg_rating_stars,
       ROUND(AVG(v.value) FILTER (WHERE v.player_id IN (SELECT player_id FROM career WHERE avg_rating < 1.10)), 3)
           AS avg_rating_others
FROM v_metric_values v
WHERE v.code = 'vlr_rating'
GROUP BY v.tier
ORDER BY avg_rating_all DESC;

-- Report 7: player career by season, with year-over-year change (LAG window function)
CREATE OR REPLACE VIEW v_report_player_years AS
SELECT p.name AS player, y.year, y.maps, y.avg_rating, y.avg_acs,
       ROUND(y.avg_rating - LAG(y.avg_rating) OVER (PARTITION BY y.player_id ORDER BY y.year), 3) AS rating_change
FROM (
    SELECT player_id, year,
           COUNT(DISTINCT map_play_id) AS maps,
           ROUND(AVG(value) FILTER (WHERE code = 'vlr_rating'), 3) AS avg_rating,
           ROUND(AVG(value) FILTER (WHERE code = 'acs'), 1)        AS avg_acs
    FROM v_metric_values
    GROUP BY player_id, year
    HAVING COUNT(DISTINCT map_play_id) >= 20
) y
JOIN players p ON p.player_id = y.player_id
ORDER BY p.name, y.year;

-- Report 8 (novelty): lead time. How many maps after a decline alert did the
-- player's form rating fall 50+ points below its level at alert time?
CREATE OR REPLACE VIEW v_report_alert_lead_time AS
SELECT a.metric,
       COUNT(*)                                     AS decline_alerts,
       COUNT(a.form_drop_map_play_id)               AS followed_by_form_drop,
       ROUND(100.0 * COUNT(a.form_drop_map_play_id) / COUNT(*), 1) AS pct_followed_by_drop,
       ROUND(AVG(d.rn - t.rn) FILTER (WHERE a.form_drop_map_play_id IS NOT NULL), 1) AS avg_lead_maps
FROM v_alert_details a
JOIN v_player_maps t      ON t.player_id = a.player_id AND t.map_play_id = a.triggered_map_play_id
LEFT JOIN v_player_maps d ON d.player_id = a.player_id AND d.map_play_id = a.form_drop_map_play_id
WHERE a.direction = 'decline'
GROUP BY a.metric
ORDER BY pct_followed_by_drop DESC;

-- Report 9 (novelty): did a decline alert predict worse play?
-- vlr rating over the 10 maps AFTER the alert vs the player's career average.
CREATE OR REPLACE VIEW v_report_alert_followup AS
WITH ratings AS (
    SELECT pm.player_id, pm.map_play_id, pm.value AS rating, pmaps.rn,
           AVG(pm.value) OVER (PARTITION BY pm.player_id) AS career_avg
    FROM participant_metrics pm
    JOIN metric_definitions md ON md.metric_id = pm.metric_id AND md.code = 'vlr_rating'
    JOIN v_player_maps pmaps   ON pmaps.player_id = pm.player_id AND pmaps.map_play_id = pm.map_play_id
),
alerts AS (
    SELECT a.alert_id, a.metric, a.player_id, r.rn, r.career_avg
    FROM v_alert_details a
    JOIN ratings r ON r.player_id = a.player_id AND r.map_play_id = a.triggered_map_play_id
    WHERE a.direction = 'decline'
),
followup AS (
    SELECT al.metric, al.career_avg, AVG(r.rating) AS next10_avg
    FROM alerts al
    JOIN ratings r ON r.player_id = al.player_id AND r.rn BETWEEN al.rn + 1 AND al.rn + 10
    GROUP BY al.alert_id, al.metric, al.career_avg
    HAVING COUNT(*) = 10                       -- only alerts with 10 full maps after them
)
SELECT metric,
       COUNT(*)                                     AS alerts,
       ROUND(AVG(career_avg), 3)                    AS avg_career_rating,
       ROUND(AVG(next10_avg), 3)                    AS avg_rating_next_10_maps,
       ROUND(AVG(next10_avg - career_avg), 3)       AS avg_change,
       ROUND(100.0 * AVG(CASE WHEN next10_avg < career_avg THEN 1 ELSE 0 END), 1) AS pct_below_career
FROM followup
GROUP BY metric
ORDER BY avg_change;

-- Report 10 (novelty): do alerts cluster around real disruptions?
-- Events found in the data itself:
--   roster move: the player's team differs from their previous map
--   role change: the player's main agent role in a tournament differs from the previous tournament
-- Compares decline alerts per 100 maps within 5 maps of an event vs everywhere else.
CREATE OR REPLACE VIEW v_report_alerts_near_events AS
WITH team_events AS (
    SELECT player_id, rn
    FROM (SELECT player_id, rn, team_id,
                 LAG(team_id) OVER (PARTITION BY player_id ORDER BY rn) AS prev_team
          FROM v_player_maps) x
    WHERE prev_team IS NOT NULL AND prev_team <> team_id
),
tournament_roles AS (
    SELECT player_id, tournament_id, MIN(rn) AS first_rn,
           MODE() WITHIN GROUP (ORDER BY role) AS main_role
    FROM v_player_maps
    GROUP BY player_id, tournament_id
),
role_events AS (
    SELECT player_id, first_rn AS rn
    FROM (SELECT player_id, first_rn, main_role,
                 LAG(main_role) OVER (PARTITION BY player_id ORDER BY first_rn) AS prev_role
          FROM tournament_roles) x
    WHERE prev_role IS NOT NULL AND prev_role <> main_role
),
alert_maps AS (
    SELECT DISTINCT player_id, triggered_map_play_id AS map_play_id, alert_id
    FROM drift_alerts WHERE direction = 'decline'
),
flagged AS (
    SELECT pm.player_id, pm.rn,
           EXISTS (SELECT 1 FROM team_events e WHERE e.player_id = pm.player_id AND ABS(e.rn - pm.rn) <= 5) AS near_team,
           EXISTS (SELECT 1 FROM role_events e WHERE e.player_id = pm.player_id AND ABS(e.rn - pm.rn) <= 5) AS near_role,
           (SELECT COUNT(*) FROM alert_maps am
            WHERE am.player_id = pm.player_id AND am.map_play_id = pm.map_play_id) AS alerts
    FROM v_player_maps pm
    WHERE pm.rn > 20                                    -- alerts are only possible after the baseline
)
SELECT event_type,
       SUM(maps) FILTER (WHERE near)      AS maps_near_event,
       SUM(alerts) FILTER (WHERE near)    AS alerts_near_event,
       ROUND(100.0 * SUM(alerts) FILTER (WHERE near) / NULLIF(SUM(maps) FILTER (WHERE near), 0), 2)
                                          AS alerts_per_100_maps_near,
       SUM(maps) FILTER (WHERE NOT near)  AS maps_elsewhere,
       SUM(alerts) FILTER (WHERE NOT near) AS alerts_elsewhere,
       ROUND(100.0 * SUM(alerts) FILTER (WHERE NOT near) / NULLIF(SUM(maps) FILTER (WHERE NOT near), 0), 2)
                                          AS alerts_per_100_maps_elsewhere
FROM (
    SELECT 'roster move' AS event_type, near_team AS near, COUNT(*) AS maps, SUM(alerts) AS alerts
    FROM flagged GROUP BY near_team
    UNION ALL
    SELECT 'role change', near_role, COUNT(*), SUM(alerts)
    FROM flagged GROUP BY near_role
) t
GROUP BY event_type;

-- Report 11 (novelty): why is a player declining?
CREATE OR REPLACE VIEW v_report_decline_cause AS
SELECT player,
       COUNT(*)                                             AS decline_alerts,
       COUNT(*) FILTER (WHERE is_common)                    AS core_metric_alerts,
       COUNT(*) FILTER (WHERE context = 'team_change')      AS after_roster_move,
       COUNT(*) FILTER (WHERE context = 'role_change')      AS after_role_change,
       CASE
           WHEN COUNT(*) FILTER (WHERE context = 'team_change') >= 0.5 * COUNT(*) THEN 'roster move'
           WHEN COUNT(*) FILTER (WHERE context = 'role_change') >= 0.5 * COUNT(*) THEN 'role change'
           WHEN COUNT(*) FILTER (WHERE is_common) >= 0.6 * COUNT(*)              THEN 'core-skill decline'
           ELSE 'mixed'
       END AS likely_cause
FROM v_alert_details
WHERE direction = 'decline'
GROUP BY player
HAVING COUNT(*) >= 3
ORDER BY decline_alerts DESC;

-- Report 12: which metric raises the most decline alerts? (RANK window function)
CREATE OR REPLACE VIEW v_report_fragile_metric AS
SELECT metric, COALESCE(category, 'valorant-specific') AS category, decline_alerts,
       RANK() OVER (ORDER BY decline_alerts DESC) AS fragility_rank
FROM (
    SELECT metric, category, COUNT(*) AS decline_alerts
    FROM v_alert_details
    WHERE direction = 'decline'
    GROUP BY metric, category
) t;

-- ===========================================================================
-- Leaderboard: materialized (stored) view, refreshed by the importer, or with
--   REFRESH MATERIALIZED VIEW mv_leaderboard;
-- Best average vlr rating per season, at least 20 maps.
-- ===========================================================================
DROP MATERIALIZED VIEW IF EXISTS mv_leaderboard;
CREATE MATERIALIZED VIEW mv_leaderboard AS
SELECT year, p.name AS player, p.region, s.maps, s.avg_rating,
       RANK() OVER (PARTITION BY year ORDER BY s.avg_rating DESC) AS position
FROM (
    SELECT player_id, year, COUNT(*) AS maps, ROUND(AVG(value), 3) AS avg_rating
    FROM v_metric_values
    WHERE code = 'vlr_rating'
    GROUP BY player_id, year
    HAVING COUNT(*) >= 20
) s
JOIN players p ON p.player_id = s.player_id;

-- ===========================================================================
-- Playstyle fingerprint: 4 numbers per player, sent to Qdrant.
-- One per common category, in the fixed order fragging, survival, damage, precision.
-- Average of the player's last 20 maps, z-normalised against all players, and
-- sign-flipped for lower-is-better metrics so higher always means "better".
-- A category the source never reported for this player becomes 0 (= average).
-- ===========================================================================
CREATE OR REPLACE VIEW v_player_fingerprint AS
WITH player_avg AS (
    SELECT pm.player_id, md.category, md.higher_is_better, AVG(pm.value) AS avg_value
    FROM v_player_maps r
    JOIN (SELECT player_id, MAX(rn) AS last_rn FROM v_player_maps GROUP BY player_id) l
         ON l.player_id = r.player_id
    JOIN participant_metrics pm ON pm.player_id = r.player_id AND pm.map_play_id = r.map_play_id
    JOIN metric_definitions md  ON md.metric_id = pm.metric_id
    WHERE r.rn > l.last_rn - 20 AND md.category IS NOT NULL
    GROUP BY pm.player_id, md.category, md.higher_is_better
),
z AS (
    SELECT player_id, category,
           CASE WHEN higher_is_better THEN 1 ELSE -1 END
           * (avg_value - AVG(avg_value) OVER w) / NULLIF(STDDEV_POP(avg_value) OVER w, 0) AS z_value
    FROM player_avg
    WINDOW w AS (PARTITION BY category)
)
SELECT p.player_id,
       ARRAY_AGG(ROUND(COALESCE(z.z_value, 0), 4) ORDER BY c.pos) AS vector
FROM (SELECT DISTINCT player_id FROM player_avg) p
CROSS JOIN UNNEST(ARRAY['fragging', 'survival', 'damage', 'precision']::VARCHAR[])
           WITH ORDINALITY AS c(category, pos)
LEFT JOIN z ON z.player_id = p.player_id AND z.category = c.category
GROUP BY p.player_id;
