// GET /api/alerts?status=open&direction=decline&context=&q=&year=2025  (moderator, admin)
import { query, toNumbers } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';

export async function GET(req) {
  if (!(await requireRole('moderator', 'admin'))) return forbidden();
  const sp = new URL(req.url).searchParams;
  const values = [];
  const where = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  if (sp.get('status')) add('status = ?', sp.get('status'));
  if (sp.get('direction')) add('direction = ?', sp.get('direction'));
  if (sp.get('context') === 'none') where.push('context IS NULL');
  else if (sp.get('context')) add('context = ?', sp.get('context'));
  if (sp.get('q')) add('player ILIKE ?', `%${sp.get('q')}%`);
  if (Number.isInteger(Number(sp.get('year'))) && sp.get('year')) add('year = ?', Number(sp.get('year')));

  const { rows } = await query(`
    SELECT alert_id, player_id, player, metric, direction, ROUND(cusum_value, 2) AS cusum, context,
           tournament, map, started_at AS approx_date, status, reviewed_by_name AS reviewed_by, review_note
    FROM v_alert_details
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY started_at DESC
    LIMIT 200`, values);
  return Response.json(toNumbers(rows));
}
