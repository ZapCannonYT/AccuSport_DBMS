// GET  /api/admin/users          -> list app accounts
// POST /api/admin/users { email, display_name, role, password } -> create one (INSERT)
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';

export async function GET() {
  if (!(await requireRole('admin'))) return forbidden();
  const { rows } = await query(`
    SELECT u.user_id, u.email, u.display_name, u.role, p.name AS follows, u.created_at
    FROM users u LEFT JOIN players p ON p.player_id = u.followed_player_id
    ORDER BY u.user_id`);
  return Response.json(rows);
}

export async function POST(req) {
  if (!(await requireRole('admin'))) return forbidden();
  const { email, display_name, role, password } = await req.json();
  if (!email || !display_name || !password || password.length < 8) {
    return Response.json({ error: 'Email, name and a password of 8+ characters are required.' }, { status: 400 });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING user_id`,
      [email, hash, display_name, role]);
    return Response.json(rows[0], { status: 201 });
  } catch (err) {
    // The database enforces the rules: UNIQUE email, CHECK role and email shape
    const message = err.code === '23505' ? 'That email is already registered.'
      : err.code === '23514' ? `Rejected by a CHECK constraint (${err.constraint}).` : 'Could not create the user.';
    return Response.json({ error: message }, { status: 400 });
  }
}
