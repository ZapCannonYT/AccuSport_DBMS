// Dashboard: headline numbers, the reports, and the novelty results
import Link from 'next/link';
import { query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import ReportPanel from '@/components/ReportPanel';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ searchParams }) {
  const session = await getSession();
  const { denied } = await searchParams;
  const { rows: [stats] } = await query(`
    SELECT (SELECT COUNT(*) FROM map_plays)   AS maps,
           (SELECT COUNT(*) FROM series)      AS series,
           (SELECT COUNT(*) FROM players)     AS players,
           (SELECT COUNT(*) FROM teams)       AS teams,
           (SELECT COUNT(*) FROM tournaments) AS tournaments,
           (SELECT COUNT(*) FROM drift_alerts WHERE status = 'open' AND direction = 'decline') AS open_alerts`);
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

      <div className="section">
        <ReportPanel name="team_stats" byYear title="Team averages per season"
          note="Our 'average salary per department' report: teams are the departments. JOIN + GROUP BY + AVG with FILTER, HAVING >= 10 maps."
          chart={{ x: 'team', bars: [{ key: 'map_win_pct', name: 'map win %' }], top: 12 }} maxRows={20} />
      </div>

      <div className="grid cols-2 section">
        <ReportPanel name="role_stats" title="Performance by agent role"
          chart={{ x: 'role', bars: [{ key: 'avg_acs', name: 'avg ACS' }] }} />
        <ReportPanel name="agent_meta" byYear title="Agent meta"
          note="Pick rate = % of team compositions that included the agent."
          chart={{ x: 'agent', bars: [{ key: 'pick_rate_pct', name: 'pick rate %' }], top: 12 }} showTable={false} />
        <ReportPanel name="map_sides" title="Attack vs defence by map"
          chart={{ x: 'map', bars: [{ key: 'attack_round_win_pct', name: 'attack round win %' }], domain: [45, 55] }} />
        <ReportPanel name="region_stats" title="Common metrics by region" />
      </div>

      <h1 className="section">Early-warning detector (novelty)</h1>
      <p className="sub">CUSUM watches every player's per-map metrics against their own baseline and raises an alert on a sustained decline.</p>

      <div className="grid cols-2">
        <ReportPanel name="alerts_near_events" title="Do alerts cluster around real disruptions?"
          note="Decline alerts per 100 maps within 5 maps of a roster move or role change, vs everywhere else."
          chart={{ x: 'event_type', bars: [
            { key: 'alerts_per_100_maps_near', name: 'near event' },
            { key: 'alerts_per_100_maps_elsewhere', name: 'elsewhere' }] }} showTable={false} />
        <ReportPanel name="alert_lead_time" title="Lead time: alert to form drop"
          note="Share of decline alerts followed by a 50+ point form drop, and how many maps later." />
        <ReportPanel name="alert_followup" title="Rating in the 10 maps after an alert"
          note="vs the player's career average; below 0 = the alert predicted worse play." />
        <ReportPanel name="decline_cause" title="Why is a player declining?" maxRows={12} />
      </div>

      <div className="section">
        <ReportPanel name="leaderboard" byYear title="Leaderboard (materialized view)" note="Best average vlr.gg rating, at least 20 maps." />
      </div>
    </>
  );
}
