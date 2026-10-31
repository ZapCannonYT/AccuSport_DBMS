// The report views the web app may read. Only names in this list can be
// queried through /api/reports/[name], so no SQL is ever built from user input.
export const REPORTS = {
  team_stats:        { view: 'v_report_team_stats', byYear: true },
  region_stats:      { view: 'v_report_region_stats' },
  role_stats:        { view: 'v_report_role_stats' },
  agent_meta:        { view: 'v_report_agent_meta', byYear: true },
  map_sides:         { view: 'v_report_map_sides' },
  tier_performance:  { view: 'v_report_tier_performance' },
  alert_lead_time:   { view: 'v_report_alert_lead_time' },
  alert_followup:    { view: 'v_report_alert_followup' },
  alerts_near_events:{ view: 'v_report_alerts_near_events' },
  decline_cause:     { view: 'v_report_decline_cause', limit: 100 },
  fragile_metric:    { view: 'v_report_fragile_metric' },
  // all ranked players of the season; the dashboard filters and sorts them (min/max maps, most maps)
  leaderboard:       { view: 'mv_leaderboard', byYear: true, order: 'position' },
};

export const YEARS = [2026, 2025, 2024, 2023];

// Heavy views (window functions over every map). The API caches them for a few minutes,
// and the dashboard pre-loads them in the background.
export const SLOW_REPORTS = ['alerts_near_events', 'alert_lead_time', 'alert_followup', 'decline_cause'];
