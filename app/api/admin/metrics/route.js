// GET /api/admin/metrics -> metric definitions with how many values / alerts each has
import { query, toNumbers } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';

export async function GET() {
  if (!(await requireRole('admin'))) return forbidden();
  const { rows } = await query(`
    SELECT md.metric_id, md.code, md.label, md.unit, md.category, md.higher_is_better, md.monitored,
           (SELECT COUNT(*) FROM participant_metrics pm WHERE pm.metric_id = md.metric_id) AS values_stored,
           (SELECT COUNT(*) FROM drift_alerts a WHERE a.metric_id = md.metric_id) AS alerts
    FROM metric_definitions md ORDER BY md.category NULLS LAST, md.code`);
  return Response.json(toNumbers(rows));
}
