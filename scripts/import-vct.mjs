// Imports real Valorant pro data (VCT 2023-2026, per-player per-map stats
// originally from vlr.gg, published as a Kaggle dataset) into AccuSports.
//
// Reads, for each year folder in data/vct/:
//   overview.csv                               one row per player per map (we use Side = both)
//   maps_scores.csv                            map score, attack/defence rounds, duration
//   scores.csv                                 series score (maps won)
//   tournaments_stages_matches_games_ids.csv   vlr.gg tournament, match (series) and game (map) ids
//   players_ids.csv, teams_ids.csv             vlr.gg player and team ids
//
// The dataset has no dates. vlr.gg game ids increase through the season, so maps
// are imported in game-id order and started_at is ESTIMATED by spreading the ids
// over the season's real date range. CUSUM only needs the order to be right.
//
// Safe to re-run: maps already imported (same vlr_game_id) are skipped.
// Usage: npm run import-vct   (also run automatically by npm run setup-db)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const DATA_DIR = fileURLToPath(new URL('../data/vct/', import.meta.url));

// Approximate first and last day of each VCT season in the data
const SEASONS = {
  2023: ['2023-02-13T12:00:00Z', '2023-08-26T12:00:00Z'],   // LOCK//IN Sao Paulo .. Champions Los Angeles
  2024: ['2024-02-16T12:00:00Z', '2024-08-25T12:00:00Z'],   // Kickoff .. Champions Seoul
  2025: ['2025-01-15T12:00:00Z', '2025-10-05T12:00:00Z'],   // Kickoff .. Champions Paris
  2026: ['2026-01-15T12:00:00Z', '2026-06-21T12:00:00Z'],   // Kickoff .. Masters London (season in progress)
};

// Agent roles (names as they appear in the data, lower case)
const AGENT_ROLES = {
  duelist: ['jett', 'raze', 'neon', 'yoru', 'reyna', 'phoenix', 'iso', 'waylay'],
  initiator: ['sova', 'fade', 'skye', 'breach', 'kayo', 'gekko', 'tejo'],
  controller: ['omen', 'viper', 'astra', 'brimstone', 'harbor', 'clove'],
  sentinel: ['killjoy', 'cypher', 'chamber', 'sage', 'deadlock', 'vyse', 'veto'],
};
const roleOf = (agent) => Object.keys(AGENT_ROLES).find((r) => AGENT_ROLES[r].includes(agent)) || null;
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const readCsv = (year, file) =>
  parse(readFileSync(path.join(DATA_DIR, year, file)), { columns: true, skip_empty_lines: true, relax_quotes: true });
const num = (s) => (s === undefined || s === '' ? null : Number(String(s).replace('%', '')));
const seriesKey = (r) => [r.Tournament, r.Stage, r['Match Type'], r['Match Name']].join('|');
const mapKey = (r) => [seriesKey(r), r.Map].join('|');

function durationSec(text, rounds) {
  const parts = (text || '').split(':').map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) return rounds * 100;   // about 100 s per round
  return parts.reduce((total, p) => total * 60 + p, 0);
}

function tierOf(name) {
  if (/kickoff/i.test(name)) return 'kickoff';
  if (/lock-in/i.test(name)) return 'lock_in';
  if (/masters/i.test(name)) return 'masters';
  if (/qualifier/i.test(name)) return 'qualifier';
  if (/^valorant champions/i.test(name)) return 'champions';
  return 'league';                                      // Stage 1/2, Americas League, ...
}

function regionOf(name) {
  if (/americas/i.test(name)) return 'AMER';
  if (/emea/i.test(name)) return 'EMEA';
  if (/pacific/i.test(name)) return 'PAC';
  if (/china/i.test(name)) return 'CN';
  return null;                                          // international event
}

// One overview.csv row -> our metric codes (blank stats are skipped)
function metricsFor(row, rounds) {
  const kills = num(row.Kills), fk = num(row['First Kills']), fd = num(row['First Deaths']);
  const values = {
    kills_per_round: kills === null ? null : kills / rounds,
    kast_pct: num(row['Kill, Assist, Trade, Survive %']),
    adr: num(row['Average Damage Per Round']),
    headshot_pct: num(row['Headshot %']),
    fk_fd_ratio: fk === null || fd === null ? null : (fk + 1) / (fd + 1),   // +1 so 0 first deaths is not a divide by zero
    first_kill_rate: fk === null ? null : fk / rounds,
    acs: num(row['Average Combat Score']),
    vlr_rating: num(row.Rating),
  };
  return Object.fromEntries(Object.entries(values)
    .filter(([, v]) => v !== null && Number.isFinite(v) && v >= 0)
    .map(([k, v]) => [k, Number(v.toFixed(3))]));
}

// INSERT a row unless its unique key exists; return its id either way
async function upsertId(query, sql, params) {
  const { rows } = await query(sql, params);
  return Object.values(rows[0])[0];
}

export async function importVct(query, log = console.log) {
  if (!existsSync(DATA_DIR)) {
    log('No data/vct folder found, skipping the VCT import.');
    return;
  }
  const years = readdirSync(DATA_DIR).filter((y) => SEASONS[y]).sort();

  // ---- 1. Read every year into one list of maps -------------------------------
  const maps = [];
  for (const year of years) {
    const playerIds = new Map(readCsv(year, 'players_ids.csv').map((r) => [r.Player, Number(r['Player ID'])]));
    const teamIds = new Map(readCsv(year, 'teams_ids.csv').map((r) => [r.Team, Number(r['Team ID'])]));
    const ids = new Map(readCsv(year, 'tournaments_stages_matches_games_ids.csv').map((r) => [mapKey(r), r]));
    const seriesScores = new Map(readCsv(year, 'scores.csv').map((r) => [seriesKey(r), r]));
    const mapScores = new Map(readCsv(year, 'maps_scores.csv').map((r) => [mapKey(r), r]));

    const rowsByMap = new Map();
    for (const row of readCsv(year, 'overview.csv')) {
      if (row.Side !== 'both' || row.Map === 'All Maps') continue;
      const key = mapKey(row);
      if (!rowsByMap.has(key)) rowsByMap.set(key, []);
      rowsByMap.get(key).push(row);
    }

    const yearMaps = [];
    for (const [key, rows] of rowsByMap) {
      const id = ids.get(key), score = mapScores.get(key), series = seriesScores.get(seriesKey(rows[0]));
      if (!id || !score || !series) continue;
      const aRounds = num(score['Team A Score']), bRounds = num(score['Team B Score']);
      if (!(aRounds + bRounds)) continue;
      yearMaps.push({ year, id, score, series, rows, playerIds, teamIds,
        vlrGameId: Number(id['Game ID']), aRounds, bRounds });
    }
    const gameIds = yearMaps.map((x) => x.vlrGameId);
    const [lo, hi] = [Math.min(...gameIds), Math.max(...gameIds)];
    const [from, to] = SEASONS[year].map((d) => new Date(d).getTime());
    for (const x of yearMaps) {
      x.startedAt = new Date(from + ((x.vlrGameId - lo) / (hi - lo || 1)) * (to - from));
    }
    maps.push(...yearMaps);
  }
  maps.sort((a, b) => a.vlrGameId - b.vlrGameId);

  // ---- 2. Skip maps already imported ------------------------------------------
  const { rows: done } = await query('SELECT vlr_game_id FROM map_plays');
  const imported = new Set(done.map((r) => r.vlr_game_id));
  const todo = maps.filter((x) => !imported.has(x.vlrGameId));

  // ---- 3. Look up / create reference rows (cached) -----------------------------
  const cache = { team: new Map(), player: new Map(), tournament: new Map(), series: new Map(), map: new Map(), agent: new Map() };

  const teamId = async (name, teamIds) => {
    const vlr = teamIds.get(name) || null;
    const key = vlr ? `id:${vlr}` : `name:${name}`;
    if (!cache.team.has(key)) {
      const id = vlr
        ? await upsertId(query, `INSERT INTO teams (vlr_team_id, name) VALUES ($1, $2)
            ON CONFLICT (vlr_team_id) DO UPDATE SET name = EXCLUDED.name RETURNING team_id`, [vlr, name.slice(0, 40)])
        : (await query(`SELECT team_id FROM teams WHERE vlr_team_id IS NULL AND name = $1`, [name])).rows[0]?.team_id
          ?? await upsertId(query, `INSERT INTO teams (name) VALUES ($1) RETURNING team_id`, [name.slice(0, 40)]);
      cache.team.set(key, id);
    }
    return cache.team.get(key);
  };

  const playerId = async (name, playerIds) => {
    const vlr = playerIds.get(name) || null;
    const key = vlr ? `id:${vlr}` : `name:${name}`;
    if (!cache.player.has(key)) {
      const id = vlr
        ? await upsertId(query, `INSERT INTO players (vlr_player_id, name) VALUES ($1, $2)
            ON CONFLICT (vlr_player_id) DO UPDATE SET name = EXCLUDED.name RETURNING player_id`, [vlr, name.slice(0, 40)])
        : (await query(`SELECT player_id FROM players WHERE vlr_player_id IS NULL AND name = $1`, [name])).rows[0]?.player_id
          ?? await upsertId(query, `INSERT INTO players (name) VALUES ($1) RETURNING player_id`, [name.slice(0, 40)]);
      cache.player.set(key, id);
    }
    return cache.player.get(key);
  };

  const tournamentId = async (r, year) => {
    const vlr = Number(r['Tournament ID']);
    if (!cache.tournament.has(vlr)) {
      cache.tournament.set(vlr, await upsertId(query,
        `INSERT INTO tournaments (vlr_tournament_id, name, year, tier, region) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (vlr_tournament_id) DO UPDATE SET name = EXCLUDED.name RETURNING tournament_id`,
        [vlr, r.Tournament, Number(year), tierOf(r.Tournament), regionOf(r.Tournament)]));
    }
    return cache.tournament.get(vlr);
  };

  const seriesId = async (x) => {
    const vlr = Number(x.id['Match ID']);
    if (!cache.series.has(vlr)) {
      const s = x.series;
      cache.series.set(vlr, await upsertId(query,
        `INSERT INTO series (vlr_match_id, tournament_id, stage, match_type, team_a_id, team_b_id, team_a_score, team_b_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (vlr_match_id) DO UPDATE SET stage = EXCLUDED.stage RETURNING series_id`,
        [vlr, await tournamentId(x.id, x.year), s.Stage.slice(0, 60), s['Match Type'].slice(0, 60),
          await teamId(s['Team A'], x.teamIds), await teamId(s['Team B'], x.teamIds),
          num(s['Team A Score']) ?? 0, num(s['Team B Score']) ?? 0]));
    }
    return cache.series.get(vlr);
  };

  const mapId = async (name) => {
    if (!cache.map.has(name)) {
      cache.map.set(name, await upsertId(query,
        `INSERT INTO maps (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING map_id`, [name]));
    }
    return cache.map.get(name);
  };

  const agentId = async (raw) => {
    const name = raw.trim().toLowerCase();
    if (!cache.agent.has(name)) {
      cache.agent.set(name, await upsertId(query,
        `INSERT INTO agents (name, role) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET role = EXCLUDED.role RETURNING agent_id`, [titleCase(name), roleOf(name)]));
    }
    return cache.agent.get(name);
  };

  // ---- 4. Record each map through fn_record_map, oldest first -----------------
  let count = 0;
  for (const x of todo) {
    const s = x.score;
    const teamA = await teamId(s['Team A'], x.teamIds), teamB = await teamId(s['Team B'], x.teamIds);
    if (teamA === teamB) continue;
    const rounds = x.aRounds + x.bRounds;
    const seen = new Set();
    const players = [];
    for (const r of x.rows) {
      const pid = await playerId(r.Player, x.playerIds);
      if (seen.has(pid) || !r.Agents) continue;          // guard against duplicate rows
      seen.add(pid);
      players.push({
        player_id: pid,
        team_id: r.Team === s['Team A'] ? teamA : r.Team === s['Team B'] ? teamB : await teamId(r.Team, x.teamIds),
        agent_id: await agentId(r.Agents),
        metrics: metricsFor(r, rounds),
      });
    }
    await query(
      `SELECT fn_record_map($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
      [x.vlrGameId, await seriesId(x), await mapId(x.rows[0].Map), teamA, teamB, x.aRounds, x.bRounds,
        num(s['Team A Attacker Score']), num(s['Team A Defender Score']),
        num(s['Team B Attacker Score']), num(s['Team B Defender Score']),
        durationSec(s.Duration, rounds), x.startedAt.toISOString(), JSON.stringify(players)]);
    count++;
    if (count % 500 === 0) log(`  ...${count} / ${todo.length} maps`);
  }

  // ---- 5. Regions: a team's / player's most-played regional league -------------
  for (const [table, col] of [['teams', 'team_id'], ['players', 'player_id']]) {
    await query(`
      UPDATE ${table} t SET region = sub.region
      FROM (
        SELECT pa.${col} AS id, tr.region,
               ROW_NUMBER() OVER (PARTITION BY pa.${col} ORDER BY COUNT(*) DESC) AS rn
        FROM map_participants pa
        JOIN map_plays mp   ON mp.map_play_id = pa.map_play_id
        JOIN series se      ON se.series_id = mp.series_id
        JOIN tournaments tr ON tr.tournament_id = se.tournament_id
        WHERE tr.region IS NOT NULL
        GROUP BY pa.${col}, tr.region
      ) sub
      WHERE sub.id = t.${col} AND sub.rn = 1`);
  }
  await query('REFRESH MATERIALIZED VIEW mv_leaderboard');
  log(`Imported VCT ${years.join(', ')}: ${count} new maps (${maps.length} in files).`);
}

// Run directly: npm run import-vct
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const { connectPostgres } = await import('./clients.mjs');
  const client = await connectPostgres();
  try {
    await importVct((text, params) => client.query(text, params));
  } finally {
    await client.end();
  }
}
