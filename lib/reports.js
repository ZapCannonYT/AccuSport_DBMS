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
  decline_cause:     { view: 'v_report_decline_cause', limit: 25 },
  fragile_metric:    { view: 'v_report_fragile_metric' },
  leaderboard:       { view: 'mv_leaderboard', byYear: true, where: 'position <= 10', order: 'position' },
};

export const YEARS = [2026, 2025, 2024, 2023];
