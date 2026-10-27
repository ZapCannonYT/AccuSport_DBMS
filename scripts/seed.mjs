// Base configuration data for AccuSports. There is NO synthetic match data:
// every match, player and team comes from the real VCT dataset (import-vct.mjs).
// This file only creates:
//   - the metric definitions (what we measure and how CUSUM treats it)
//   - the web app's login accounts (admin, moderators, analysts)
import bcrypt from 'bcryptjs';

const APP_PASSWORD = 'password123';   // demo logins for the web app only, see README

// category = one of the 4 common categories, or null for a Valorant-specific extra.
// monitored = false: stored and shown, but not watched by CUSUM (the vlr rating is
// the outcome we compare alerts against, so it must not raise alerts itself)
export const METRICS = [
  { code: 'kills_per_round', label: 'Kills per round', unit: 'kills/round', higher: true, category: 'fragging' },
  { code: 'kast_pct', label: 'KAST', unit: '%', higher: true, category: 'survival' },
  { code: 'adr', label: 'Average damage per round', unit: 'dmg/round', higher: true, category: 'damage' },
  { code: 'headshot_pct', label: 'Headshot %', unit: '%', higher: true, category: 'precision' },
  { code: 'fk_fd_ratio', label: 'First kills / first deaths (smoothed)', unit: 'ratio', higher: true, category: null },
  { code: 'first_kill_rate', label: 'First kills per round', unit: 'fk/round', higher: true, category: null },
  { code: 'acs', label: 'Average combat score', unit: 'acs', higher: true, category: null },
  { code: 'vlr_rating', label: 'vlr.gg rating', unit: 'rating', higher: true, category: null, monitored: false },
];

const APP_USERS = [
  ['admin@accusports.test', 'Admin', 'admin'],
  ['mod1@accusports.test', 'Moderator One', 'moderator'],
  ['mod2@accusports.test', 'Moderator Two', 'moderator'],
  ['analyst1@accusports.test', 'Analyst One', 'analyst'],
  ['analyst2@accusports.test', 'Analyst Two', 'analyst'],
];

export async function seed(query, log = console.log) {
  for (const x of METRICS) {
    await query(
      `INSERT INTO metric_definitions (code, label, unit, higher_is_better, category, monitored)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [x.code, x.label, x.unit, x.higher, x.category, x.monitored ?? true]);
  }
  const hash = await bcrypt.hash(APP_PASSWORD, 10);
  for (const [email, name, role] of APP_USERS) {
    await query(
      `INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4)`,
      [email, hash, name, role]);
  }
  log(`Seeded ${METRICS.length} metric definitions and ${APP_USERS.length} app accounts.`);
}
