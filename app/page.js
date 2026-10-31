// Dashboard: headline numbers, the reports, and the novelty results
import Link from 'next/link';
import { query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import ReportPanel from '@/components/ReportPanel';
import Warmup from '@/components/Warmup';
import { YEARS } from '@/lib/reports';

export const dynamic = 'force-dynamic';
const TABS = [['overview', 'Overview'], ['leaderboard', 'Leaderboard'], ['reports', 'Reports'], ['warning', 'Early warning']];

export default async function Dashboard({ searchParams }) {
  const session = await getSession();
  const sp = await searchParams;
  const denied = sp.denied;
  const year = YEARS.includes(Number(sp.year)) ? Number(sp.year) : null;   // null = all seasons
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab : 'overview';
  const href = (t, y) => `/?${new URLSearchParams({ ...(t !== 'overview' && { tab: t }), ...(y && { year: String(y) }) })}`;
  const { rows: [stats] } = await query(`
    SELECT (SELECT COUNT(*) FROM map_plays mp JOIN series se ON se.series_id = mp.series_id
              JOIN tournaments tr ON tr.tournament_id = se.tournament_id
              WHERE $1::int IS NULL OR tr.year = $1::int) AS maps,
           (SELECT COUNT(*) FROM series se JOIN tournaments tr ON tr.tournament_id = se.tournament_id
              WHERE $1::int IS NULL OR tr.year = $1::int) AS series,
           (SELECT COUNT(*) FROM players p WHERE $1::int IS NULL OR EXISTS
              (SELECT 1 FROM v_player_maps v WHERE v.player_id = p.player_id AND v.year = $1::int)) AS players,
           (SELECT COUNT(*) FROM teams t WHERE $1::int IS NULL OR EXISTS
              (SELECT 1 FROM v_player_maps v WHERE v.team_id = t.team_id AND v.year = $1::int)) AS teams,
           (SELECT COUNT(*) FROM tournaments WHERE $1::int IS NULL OR year = $1::int) AS tournaments,
           (SELECT COUNT(*) FROM v_alert_details WHERE status = 'open' AND direction = 'decline'
              AND ($1::int IS NULL OR year = $1::int)) AS open_alerts`, [year]);
  const { rows: [followed] } = await query(`
    SELECT p.player_id, p.name, c.team, c.form,
           (SELECT COUNT(*) FROM drift_alerts a WHERE a.player_id = p.player_id
              AND a.direction = 'decline' AND a.status = 'open') AS open_alerts
    FROM users u
    JOIN players p ON p.player_id = u.followed_player_id
    LEFT JOIN v_player_current c ON c.player_id = p.player_id
    WHERE u.user_id = $1`, [session.user.id]);

  const statCards = [
    ['Maps', stats.maps], ['Series', stats.series], ['Players', stats.players],
    ['Teams', stats.teams], ['Tournaments', stats.tournaments], ['Open decline alerts', stats.open_alerts],
  ];

  return (
    <>
      {denied && <div className="notice">Your role does not have access to that page.</div>}
      <h1>Dashboard</h1>
      <p className="sub">Real VCT pro matches, 2023 to 2026 (2026 in progress). Stats per player per map from vlr.gg.</p>

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <Link key={key} href={href(key, year)} className={tab === key ? 'on' : ''}>{label}</Link>))}
      </div>

      {tab !== 'warning' && <Warmup />}

      {tab !== 'warning' && (
        <div className="chips">
          <span className="muted">Season:</span>
          <Link href={href(tab, null)} className={year ? '' : 'on'}>All</Link>
          {YEARS.map((y) => (
            <Link key={y} href={href(tab, y)} className={year === y ? 'on' : ''}>{y}{y === 2026 ? ' (partial)' : ''}</Link>))}
          {year && tab === 'reports' && <span className="muted">Only Agent meta has a per-season version; the other reports cover all seasons.</span>}
        </div>
      )}

      {tab === 'overview' && (
        <>
          <div className="grid cols-5">
            {statCards.map(([label, value]) => (
              <div className="card stat" key={label}><div className="value">{Number(value).toLocaleString()}</div><div className="label">{label}</div></div>
            ))}
          </div>
          {followed && (
            <div className="card section">
              <h2>You follow <Link href={`/players/${followed.player_id}`}>{followed.name}</Link></h2>
              <p style={{ margin: 0 }}>
                {followed.team} - form {followed.form ?? '-'} - {Number(followed.open_alerts)} open decline alert(s)
              </p>
            </div>
          )}
          <div className="card section">
            <h2>Where to look</h2>
            <p className="muted" style={{ margin: 0 }}>
              <b>Leaderboard</b>: best players by rating. <b>Reports</b>: roles, agents, map sides, regions.
              <b> Early warning</b>: the CUSUM detector and whether its alerts hold up. Player and team pages are in the sidebar.
            </p>
          </div>
        </>
      )}

      {tab === 'leaderboard' && (
        <ReportPanel key={`leaderboard-${year}`} name="leaderboard" byYear initialYear={year} title="Leaderboard (materialized view)"
          note="Best average vlr.gg rating in the season, at least 20 maps. Raise Min maps (or lower Max maps) to compare players with a similar number of maps."
          columns={['#', 'player', 'region', 'maps', 'avg_rating']}
          controls={{
            filters: [{ key: 'maps', label: 'Min maps', type: 'min' }, { key: 'maps', label: 'Max maps', type: 'max' }],
            sorts: [
              { key: 'avg_rating', label: 'Highest rating', dir: 'desc' },
              { key: 'maps', label: 'Most maps', dir: 'desc' },
              { key: 'maps', label: 'Fewest maps', dir: 'asc' },
            ],
            tops: [10, 25, 50],
            rank: true,
          }} />
      )}

      {tab === 'reports' && (
        <div className="grid cols-2">
        <ReportPanel name="role_stats" title="Performance by agent role"
          chart={{ x: 'role', bars: [{ key: 'avg_acs', name: 'avg ACS' }] }} />
        <ReportPanel key={`agent-${year}`} name="agent_meta" byYear initialYear={year} title="Agent meta"
          note="Pick rate = % of team compositions that included the agent."
          chart={{ x: 'agent', bars: [{ key: 'pick_rate_pct', name: 'pick rate %' }], top: 12 }} showTable={false} />
        <ReportPanel name="map_sides" title="Attack vs defence by map"
          chart={{ x: 'map', bars: [{ key: 'attack_round_win_pct', name: 'attack round win %' }], domain: [45, 55] }} />
        <ReportPanel name="region_stats" title="Common metrics by region" />
        </div>
      )}

      {tab === 'warning' && (
        <>
          <p className="sub">CUSUM watches every player's per-map metrics against their own baseline and raises an alert on a sustained decline.</p>
          <div className="grid cols-2">
        <ReportPanel name="alerts_near_events" title="Do alerts cluster around real disruptions?"
          note="Decline alerts per 100 maps within 5 maps of a roster move or role change, vs everywhere else."
          chart={{ x: 'event_type', bars: [
            { key: 'alerts_per_100_maps_near', name: 'near event' },
            { key: 'alerts_per_100_maps_elsewhere', name: 'elsewhere' }] }} showTable={false} />
        <ReportPanel name="alert_lead_time" title="Lead time: alert to form drop"
          note="Share of decline alerts followed by a 50+ point form drop, and how many maps later."
          info={<>
            <p><b>Form</b> is a running average of a player's vlr.gg rating (x1000, so 1000 = average).</p>
            <p>When a decline alert fires we remember the form at that moment. If form later falls 50+ points below it, the alert is "followed by a form drop".</p>
            <p><b>avg_lead_maps</b> = how many maps passed between the alert and that drop. A positive number means the alert came first, which is the point of an early warning.</p>
          </>} />
        <ReportPanel name="alert_followup" title="Rating in the 10 maps after an alert"
          note="Did the alert predict worse play? Compares the next 10 maps with the player's career average."
          info={<>
            <p>For every decline alert we take the player's vlr.gg rating over the <b>10 maps after</b> the alert and compare it with their <b>career average</b> rating. One row per metric that raised the alerts.</p>
            <p><b>avg_change</b>: below 0 means players did worse than usual after the alert, so the alert was right. <b>pct_below_career</b>: share of alerts followed by a worse-than-career stretch.</p>
            <p><b>alerts</b>: how many alerts the row is based on. Only alerts with 10 full maps after them count. Rows with few alerts are noisy, so use the Min alerts box.</p>
          </>}
          controls={{ filters: [{ key: 'alerts', label: 'Min alerts', type: 'min' }] }} />
        <ReportPanel name="decline_cause" title="Why is a player declining?"
          note={<>
            Players with 3 or more decline alerts, and what the alerts look like. <b>likely_cause</b> is a hint for a moderator, not proof:
            <ul>
              <li><b>roster move</b>: at least half the alerts came right after the player changed team</li>
              <li><b>role change</b>: at least half came right after the player switched agent role</li>
              <li><b>core-skill decline</b>: 60%+ of alerts are on skills every shooter has (kills, ADR, KAST...), so no obvious outside cause</li>
              <li><b>mixed</b>: none of the above</li>
            </ul>
          </>}
          info={<>
            <p>A decline alert means one of the player's stats has been sliding below <i>their own</i> normal for a while. This table asks: <b>what was going on around those alerts?</b></p>
            <p><b>decline_alerts</b>: total alerts. <b>core_metric_alerts</b>: alerts on common skills. <b>after_roster_move</b> and <b>after_role_change</b>: alerts raised when the player had changed team in the last 5 maps, or was playing a different agent role from their usual one.</p>
            <p>A dip after a roster or role change is expected and usually not a skill problem. A decline with no such cause is the one worth a closer look.</p>
          </>}
          controls={{
            filters: [{ key: 'decline_alerts', label: 'Min alerts', type: 'min' }, { key: 'likely_cause', label: 'Cause', type: 'select' }],
            tops: [12, 25, 50],
          }} />
          </div>
        </>
      )}
    </>
  );
}
