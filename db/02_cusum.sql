-- AccuSports: CUSUM early-warning detector, form rating, alert context and fn_record_map
-- Depends on 01_schema.sql

-- Tuning constants (see docs/02-cusum-novelty.md)
--   CUSUM: baseline maps N = 20, slack k = 0.5, alert threshold h = 5.0
--   form rating: EWMA weight alpha = 0.2; a drop of 50 form points (0.05 vlr rating) confirms a decline

-- Remove functions from older versions of this project (different signatures
-- would otherwise live on as extra overloads)
DROP FUNCTION IF EXISTS fn_record_match(INT, TIMESTAMPTZ, INT, JSONB);
DROP FUNCTION IF EXISTS fn_record_match(INT, TIMESTAMPTZ, INT, JSONB, VARCHAR, VARCHAR, VARCHAR, INT, VARCHAR);
DROP FUNCTION IF EXISTS fn_link_rating_drop() CASCADE;

-- ---------------------------------------------------------------------------
-- fn_alert_context: was a team or role change happening when this alert fired?
--   team_change: the player played for a different team in their previous 5 maps
--   role_change: this map's agent role differs from their most-played role in
--                the previous 10 maps (e.g. duelist -> controller)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_alert_context(p_player_id INT, p_map_play_id INT)
RETURNS VARCHAR AS $$
DECLARE
    v_started   TIMESTAMPTZ;
    v_team      INT;
    v_role      VARCHAR;
    v_main_role VARCHAR;
BEGIN
    SELECT mp.started_at, pa.team_id, ag.role INTO v_started, v_team, v_role
    FROM map_participants pa
    JOIN map_plays mp ON mp.map_play_id = pa.map_play_id
    JOIN agents ag    ON ag.agent_id = pa.agent_id
    WHERE pa.player_id = p_player_id AND pa.map_play_id = p_map_play_id;

    IF EXISTS (
        SELECT 1 FROM (
            SELECT pa.team_id
            FROM map_participants pa
            JOIN map_plays mp ON mp.map_play_id = pa.map_play_id
            WHERE pa.player_id = p_player_id AND mp.started_at < v_started
            ORDER BY mp.started_at DESC
            LIMIT 5
        ) prev WHERE prev.team_id <> v_team
    ) THEN
        RETURN 'team_change';
    END IF;

    SELECT MODE() WITHIN GROUP (ORDER BY prev.role) INTO v_main_role
    FROM (
        SELECT ag.role
        FROM map_participants pa
        JOIN map_plays mp ON mp.map_play_id = pa.map_play_id
        JOIN agents ag    ON ag.agent_id = pa.agent_id
        WHERE pa.player_id = p_player_id AND mp.started_at < v_started
        ORDER BY mp.started_at DESC
        LIMIT 10
    ) prev;

    IF v_main_role IS NOT NULL AND v_role IS NOT NULL AND v_role <> v_main_role THEN
        RETURN 'role_change';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Trigger function: CUSUM detector, runs for every new row in participant_metrics
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_cusum() RETURNS TRIGGER AS $$
DECLARE
    c_baseline CONSTANT INT     := 20;
    c_k        CONSTANT NUMERIC := 0.5;
    c_h        CONSTANT NUMERIC := 5.0;
    v_higher    BOOLEAN;
    v_monitored BOOLEAN;
    st          cusum_state%ROWTYPE;
    v_delta     NUMERIC;
    v_std       NUMERIC;
    v_z         NUMERIC;
    v_form      NUMERIC;
    v_context   VARCHAR;
BEGIN
    SELECT higher_is_better, monitored INTO v_higher, v_monitored
    FROM metric_definitions WHERE metric_id = NEW.metric_id;
    IF NOT v_monitored THEN
        RETURN NEW;                        -- stored, but not watched (e.g. vlr rating itself)
    END IF;

    INSERT INTO cusum_state (player_id, metric_id)
    VALUES (NEW.player_id, NEW.metric_id)
    ON CONFLICT DO NOTHING;

    SELECT * INTO st FROM cusum_state
    WHERE player_id = NEW.player_id AND metric_id = NEW.metric_id
    FOR UPDATE;

    -- Phase 1: learn the player's personal baseline (Welford's online mean/variance)
    IF st.n_baseline < c_baseline THEN
        st.n_baseline    := st.n_baseline + 1;
        v_delta          := NEW.value - st.baseline_mean;
        st.baseline_mean := st.baseline_mean + v_delta / st.n_baseline;
        st.baseline_m2   := st.baseline_m2 + v_delta * (NEW.value - st.baseline_mean);

        UPDATE cusum_state
        SET n_baseline = st.n_baseline, baseline_mean = st.baseline_mean,
            baseline_m2 = st.baseline_m2, updated_at = now()
        WHERE player_id = st.player_id AND metric_id = st.metric_id;
        RETURN NEW;
    END IF;

    -- Phase 2: standardise the new value and update both CUSUM sums
    v_std := GREATEST(sqrt(st.baseline_m2 / (st.n_baseline - 1)), 0.0001);
    v_z   := (NEW.value - st.baseline_mean) / v_std;
    IF NOT v_higher THEN
        v_z := -v_z;                       -- so that negative z always means "worse"
    END IF;

    st.s_neg := GREATEST(0, st.s_neg - v_z - c_k);
    st.s_pos := GREATEST(0, st.s_pos + v_z - c_k);

    IF st.s_neg > c_h OR st.s_pos > c_h THEN
        -- form before this map (the form trigger may already have added this map's row)
        SELECT form INTO v_form FROM form_ratings
        WHERE player_id = NEW.player_id AND map_play_id <> NEW.map_play_id
        ORDER BY recorded_at DESC, map_play_id DESC LIMIT 1;
        v_context := fn_alert_context(NEW.player_id, NEW.map_play_id);
    END IF;

    -- Raise an alert, unless one is already open for this player/metric/direction
    -- (a moderator has to acknowledge or resolve it first, so the queue is not flooded)
    IF st.s_neg > c_h THEN
        INSERT INTO drift_alerts (player_id, metric_id, direction, cusum_value,
                                  triggered_map_play_id, context, form_at_alert)
        SELECT NEW.player_id, NEW.metric_id, 'decline', st.s_neg, NEW.map_play_id, v_context, v_form
        WHERE NOT EXISTS (
            SELECT 1 FROM drift_alerts
            WHERE player_id = NEW.player_id AND metric_id = NEW.metric_id
              AND direction = 'decline' AND status = 'open');
        st.s_neg := 0;                     -- reset after the threshold is crossed
    END IF;

    IF st.s_pos > c_h THEN
        INSERT INTO drift_alerts (player_id, metric_id, direction, cusum_value,
                                  triggered_map_play_id, context, form_at_alert)
        SELECT NEW.player_id, NEW.metric_id, 'improve', st.s_pos, NEW.map_play_id, v_context, v_form
        WHERE NOT EXISTS (
            SELECT 1 FROM drift_alerts
            WHERE player_id = NEW.player_id AND metric_id = NEW.metric_id
              AND direction = 'improve' AND status = 'open');
        st.s_pos := 0;
    END IF;

    UPDATE cusum_state
    SET s_neg = st.s_neg, s_pos = st.s_pos, updated_at = now()
    WHERE player_id = st.player_id AND metric_id = st.metric_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_participant_metrics_cusum
AFTER INSERT ON participant_metrics
FOR EACH ROW EXECUTE FUNCTION fn_update_cusum();

-- ---------------------------------------------------------------------------
-- Trigger function: keep the player's form rating up to date.
-- Runs on every new participant_metrics row; only the vlr_rating metric counts.
--   form = 0.2 * (rating x 1000) + 0.8 * previous form
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_form() RETURNS TRIGGER AS $$
DECLARE
    c_alpha CONSTANT NUMERIC := 0.2;
    v_code  VARCHAR;
    v_prev  NUMERIC;
    v_time  TIMESTAMPTZ;
BEGIN
    SELECT code INTO v_code FROM metric_definitions WHERE metric_id = NEW.metric_id;
    IF v_code <> 'vlr_rating' THEN
        RETURN NEW;
    END IF;

    SELECT started_at INTO v_time FROM map_plays WHERE map_play_id = NEW.map_play_id;
    SELECT form INTO v_prev FROM form_ratings
    WHERE player_id = NEW.player_id
    ORDER BY recorded_at DESC, map_play_id DESC LIMIT 1;

    INSERT INTO form_ratings (player_id, map_play_id, form, recorded_at)
    VALUES (NEW.player_id, NEW.map_play_id,
            CASE WHEN v_prev IS NULL THEN NEW.value * 1000
                 ELSE c_alpha * NEW.value * 1000 + (1 - c_alpha) * v_prev END,
            v_time);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_participant_metrics_form
AFTER INSERT ON participant_metrics
FOR EACH ROW EXECUTE FUNCTION fn_update_form();

-- ---------------------------------------------------------------------------
-- Trigger function: when form falls 50+ points below the form at alert time,
-- link that map to the open decline alert (this measures lead time)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_link_form_drop() RETURNS TRIGGER AS $$
BEGIN
    UPDATE drift_alerts
    SET form_drop_map_play_id = NEW.map_play_id
    WHERE player_id = NEW.player_id
      AND direction = 'decline'
      AND form_drop_map_play_id IS NULL
      AND form_at_alert IS NOT NULL
      AND triggered_map_play_id <> NEW.map_play_id
      AND NEW.form <= form_at_alert - 50;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_form_ratings_drop
AFTER INSERT ON form_ratings
FOR EACH ROW EXECUTE FUNCTION fn_link_form_drop();

-- ---------------------------------------------------------------------------
-- fn_record_map: stores one whole map (the map row, every participant, every
-- metric) atomically. A function body runs inside a single transaction, so if
-- any insert fails (unknown metric code, duplicate vlr_game_id, CHECK
-- violation, ...) nothing from this map is kept. The importer calls this once
-- per map, in time order.
--
-- p_players example:
-- [{"player_id": 3, "team_id": 7, "agent_id": 2,
--   "metrics": {"kills_per_round": 0.81, "kast_pct": 74, "adr": 152.3,
--               "headshot_pct": 27, "fk_fd_ratio": 1.5, "vlr_rating": 1.21}}, ...]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_map(
    p_vlr_game_id  INT,
    p_series_id    INT,
    p_map_id       INT,
    p_team_a_id    INT,
    p_team_b_id    INT,
    p_a_rounds     INT,
    p_b_rounds     INT,
    p_a_attack     INT,
    p_a_defense    INT,
    p_b_attack     INT,
    p_b_defense    INT,
    p_duration_sec INT,
    p_started_at   TIMESTAMPTZ,
    p_players      JSONB
) RETURNS INT AS $$
DECLARE
    v_map_play_id INT;
    v_winner      INT;
    p             JSONB;
    m             RECORD;
    v_metric      INT;
BEGIN
    v_winner := CASE WHEN p_a_rounds > p_b_rounds THEN p_team_a_id
                     WHEN p_b_rounds > p_a_rounds THEN p_team_b_id END;

    INSERT INTO map_plays (vlr_game_id, series_id, map_id, team_a_id, team_b_id,
                           team_a_rounds, team_b_rounds, team_a_attack_won, team_a_defense_won,
                           team_b_attack_won, team_b_defense_won, winner_team_id,
                           duration_sec, started_at)
    VALUES (p_vlr_game_id, p_series_id, p_map_id, p_team_a_id, p_team_b_id,
            p_a_rounds, p_b_rounds, p_a_attack, p_a_defense, p_b_attack, p_b_defense,
            v_winner, p_duration_sec, p_started_at)
    RETURNING map_play_id INTO v_map_play_id;

    FOR p IN SELECT * FROM jsonb_array_elements(p_players) LOOP
        INSERT INTO map_participants (map_play_id, player_id, team_id, agent_id, result)
        VALUES (v_map_play_id, (p->>'player_id')::INT, (p->>'team_id')::INT, (p->>'agent_id')::INT,
                CASE WHEN v_winner IS NULL THEN 'draw'
                     WHEN v_winner = (p->>'team_id')::INT THEN 'win'
                     ELSE 'loss' END);

        FOR m IN SELECT key, value FROM jsonb_each_text(p->'metrics') LOOP
            SELECT metric_id INTO v_metric FROM metric_definitions WHERE code = m.key;
            IF v_metric IS NULL THEN
                RAISE EXCEPTION 'Unknown metric %', m.key;
            END IF;
            INSERT INTO participant_metrics (map_play_id, player_id, metric_id, value)
            VALUES (v_map_play_id, (p->>'player_id')::INT, v_metric, m.value::NUMERIC);
        END LOOP;
    END LOOP;

    RETURN v_map_play_id;
END;
$$ LANGUAGE plpgsql;
