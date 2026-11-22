import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { now, textKey, HttpError } from './domain.js';
import { transaction } from './db.js';

const derive = promisify(scrypt);
const sessionDuration = 7 * 24 * 60 * 60;
const sessionName = 'san_vot_session';
const retiredPassword = 'SanVotDemo2026';
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const phoneKey = (phone) => phone.replace(/\s/g,'').replace(/^\+84/, '0');

export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
}

export async function matchPassword(password, encoded) {
  const [salt, key] = encoded?.split(':') ?? ['unknown-user', '00'.repeat(64)];
  const actual = await derive(password, salt, 64);
  return Boolean(key && /^[a-f0-9]{128}$/.test(key)) && timingSafeEqual(Buffer.from(key, 'hex'), actual);
}

export function userView(user) {
  if (!user) return null;
  const { id, name, phone, email, role } = user;
  return { id, name, phone, email, role };
}

export function sessionUser(db, req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)san_vot_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  return db.prepare(`SELECT u.*,s.id AS session_id FROM sessions s JOIN users u ON s.user_id=u.id
    WHERE s.id=? AND s.expires>?`).get(digest(token), now()) ?? null;
}

const cookieOptions = (secure) => ({ httpOnly: true, sameSite: 'lax', secure, path: '/' });

export function logIn(db, res, user, oldUser, secure) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires<=? OR id=?').run(now(), oldUser?.session_id ?? '');
  db.prepare('INSERT INTO sessions(id,user_id,expires) VALUES (?,?,?)').run(digest(token), user.id, now() + sessionDuration);
  res.cookie(sessionName, token, { ...cookieOptions(secure), maxAge: sessionDuration * 1000 });
}

export function logOut(db, res, user, secure) {
  if (user) db.prepare('DELETE FROM sessions WHERE id=?').run(user.session_id);
  res.clearCookie(sessionName, cookieOptions(secure));
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Đăng nhập để tiếp tục.'));
  next();
}

export async function seedAdmin(db, config) {
  const password = config.adminPassword;
  if (password && (password.length < 12 || password.length > 128 || password === retiredPassword)) {
    throw new Error('ADMIN_PASSWORD must be a private password between 12 and 128 characters.');
  }
  const admin = db.prepare("SELECT id,password FROM users WHERE role='admin'").get();
  if (!admin) {
    if (password) db.prepare("INSERT INTO users(name,name_key,phone,email,password,role) VALUES(?,?,?,?,?,'admin')")
      .run('Quản trị Sân Vợt', textKey('Quản trị Sân Vợt'), '0900000000', 'admin@sanvot.local', await passwordHash(password));
    return;
  }
  const retired = admin.password === '!' || await matchPassword(retiredPassword, admin.password);
  if (!retired) return;
  const replacement = password ? await passwordHash(password) : '!';
  transaction(db, () => {
    if (db.prepare('UPDATE users SET password=? WHERE id=? AND password=?').run(replacement, admin.id, admin.password).changes) {
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(admin.id);
    }
  });
}
