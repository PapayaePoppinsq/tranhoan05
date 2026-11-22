import { randomInt, randomUUID } from 'node:crypto';
import { transaction } from './db.js';

export const now = () => Math.floor(Date.now() / 1000);
export const textKey = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('đ','d').trim();
export const dateAt = (offset = 0) => new Date(Date.now() + (7 + offset * 24) * 3600000).toISOString().slice(0, 10);
export const seconds = (date, hour) => Date.parse(`${date}T${hour}:00+07:00`) / 1000;
export const minute = (hour) => Number(hour.slice(0, 2)) * 60 + Number(hour.slice(3));
export const timeOf = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
export const slotDate = (ts) => new Date(ts * 1000 + 7 * 3600000).toISOString().slice(0, 10);
export const slotTime = (ts) => new Date(ts * 1000 + 7 * 3600000).toISOString().slice(11, 16);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function validDate(day) {
  const value = seconds(day, '00:00');
  return Number.isFinite(value) && slotDate(value) === day && day >= dateAt() && day <= dateAt(30);
}

const venueSelect = `SELECT v.*, (SELECT count(*) FROM courts c WHERE c.venue_id=v.id AND c.active=1 AND c.is_demo=0) AS court_count
  FROM venues v`;
function publicVenue({ owner_id, ...venue }) { return venue; }
export function listVenues(db) {
  return db.prepare(`${venueSelect} WHERE v.active=1 ORDER BY v.featured DESC, v.id`).all().map(publicVenue);
}
export function getVenue(db, id, demo = false) {
  const venue = db.prepare(`${venueSelect} WHERE v.id=? AND v.active=1`).get(id);
  if (!venue) throw new HttpError(404, 'Không tìm thấy cụm sân.');
  const courts = db.prepare('SELECT id,name FROM courts WHERE venue_id=? AND active=1 AND (?=1 OR is_demo=0) ORDER BY id').all(id, Number(demo));
  return { ...publicVenue(venue), courts };
}

export const activeBlocks = `status='confirmed' OR (status='pending' AND hold_until > unixepoch())`;
const intersects = (row, start, end) => row.starts < end && row.ends > start;

function slotsFor(venue, date, duration, bookings) {
  const output = [];
  for (let n = minute(venue.open); n + duration <= minute(venue.close); n += 30) {
    const time = timeOf(n);
    const start = seconds(date, time);
    const end = start + duration * 60;
    const collisions = bookings.filter((row) => intersects(row, start, end));
    const status = start <= now() ? 'past' : collisions.some((row) => row.status === 'confirmed') ? 'booked' :
      collisions.length ? 'held' : 'available';
    output.push({ time, end: timeOf(n + duration), status, amount: Math.round(venue.price * duration / 60) });
  }
  return output;
}

function blocksForVenue(db, venueId, date) {
  const startOfDay = seconds(date, '00:00');
  return db.prepare(`SELECT b.court_id,b.starts,b.ends,b.status FROM bookings b JOIN courts c ON c.id=b.court_id
    WHERE c.venue_id=? AND b.starts < ? AND b.ends > ? AND (${activeBlocks})`)
    .all(venueId, startOfDay + 86400, startOfDay);
}

export function availability(db, venue, date, duration) {
  if (!validDate(date)) throw new HttpError(400, 'Chọn ngày hợp lệ trong 30 ngày tới.');
  const blocks = blocksForVenue(db, venue.id, date);
  return venue.courts.map((court) => ({ ...court, slots: slotsFor(venue, date, duration,
    blocks.filter((row) => row.court_id === court.id)) }));
}

export function quoteBooking(db, { courtId, date, time, duration }, demo) {
  const court = db.prepare(`SELECT c.id, c.name AS court_name, v.id AS venue_id, v.name AS venue_name, v.open, v.close,
    v.price, v.address, v.verified FROM courts c JOIN venues v ON v.id=c.venue_id
    WHERE c.id=? AND c.active=1 AND v.active=1 AND (?=1 OR c.is_demo=0)`).get(courtId, Number(demo));
  if (!court || (!demo && !court.verified)) throw new HttpError(404, 'Sân này chưa mở đặt trực tuyến.');
  if (!validDate(date) || minute(time) % 30 || minute(time) < minute(court.open) ||
    minute(time) + duration > minute(court.close)) throw new HttpError(400, 'Khung giờ nằm ngoài lịch hoạt động.');
  const starts = seconds(date, time), ends = starts + duration * 60;
  if (starts <= now()) throw new HttpError(409, 'Khung giờ đã qua. Hãy chọn lại.');
  if (db.prepare(`SELECT id FROM bookings WHERE court_id=? AND starts < ? AND ends > ? AND (${activeBlocks})`)
    .get(courtId, ends, starts)) throw new HttpError(409, 'Khung giờ vừa hết chỗ. Hãy chọn giờ khác.');
  return { courtId, venueId: court.venue_id, venueName: court.venue_name, courtName: court.court_name,
    address: court.address, date, time, end: slotTime(ends), amount: Math.round(court.price * duration / 60),
    starts, ends, duration, verified: Boolean(court.verified) };
}

export const bookingSelect = `SELECT b.*, c.name AS courtName, v.name AS venueName,
  v.id AS venueId, v.address FROM bookings b JOIN courts c ON c.id=b.court_id JOIN venues v ON v.id=c.venue_id`;
export function showBooking(row) {
  if (!row) return null;
  const status = row.status === 'pending' && row.hold_until <= now() ? 'expired' : row.status;
  return { id: row.id, code: row.code, venueId: row.venueId, venueName: row.venueName, courtName: row.courtName,
    address: row.address, date: slotDate(row.starts), time: slotTime(row.starts), end: slotTime(row.ends),
    amount: row.amount, expiresAt: row.hold_until, status, paymentStatus: row.payment_status,
    provider: row.provider, duration: (row.ends - row.starts) / 60, courtId: row.court_id,
    checkoutUrl: status === 'pending' ? row.checkout : null };
}

export function reserve(db, userId, request, config) {
  try {
    return transaction(db, () => {
      const existing = db.prepare(`${bookingSelect} WHERE b.user_id=? AND b.court_id=? AND b.starts=?
        AND b.ends=? AND b.amount=? AND b.provider=? AND b.status='pending' AND b.hold_until > unixepoch()`)
        .get(userId, request.courtId, seconds(request.date, request.time),
          seconds(request.date, request.time) + request.duration * 60, request.amount, config.paymentMode);
      if (existing) return showBooking(existing);
      const quote = quoteBooking(db, request, config.demo);
      if (request.amount !== quote.amount) throw new HttpError(409, 'Giá đã thay đổi. Hãy xem lại đơn.');
      if (config.paymentMode === 'payos' && !quote.verified) throw new HttpError(409, 'Chỉ sân đã xác minh mới nhận thanh toán thật.');
      if (config.paymentMode === 'off') throw new HttpError(503, 'Thanh toán chưa được cấu hình.');
      const activeHolds = db.prepare(`SELECT count(*) AS count FROM bookings
        WHERE user_id=? AND status='pending' AND hold_until > unixepoch()`).get(userId).count;
      if (activeHolds >= 3) throw new HttpError(429, 'Bạn đang giữ 3 đơn. Hãy thanh toán hoặc chờ một đơn hết hạn.');
      const id = randomUUID();
      const code = Date.now() * 1000 + randomInt(1000);
      const holdUntil = Math.min(now() + 600, quote.starts);
      db.prepare(`INSERT INTO bookings(id,user_id,court_id,starts,ends,amount,hold_until,code,provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, request.courtId, quote.starts, quote.ends,
        quote.amount, holdUntil, code, config.paymentMode);
      return showBooking(db.prepare(`${bookingSelect} WHERE b.id=?`).get(id));
    });
  } catch (error) {
    if (error.message.includes('slot_conflict')) throw new HttpError(409, 'Khung giờ vừa hết chỗ. Hãy chọn giờ khác.');
    throw error;
  }
}

export function recordPayment(db, { bookingId, eventId, amount, addAmount = false }) {
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
    if (!row) return;
    const { changes } = db.prepare(`INSERT INTO payment_events(id,booking_id,amount) VALUES(?,?,?)
      ON CONFLICT(id) DO NOTHING`).run(eventId, bookingId, amount);
    if (!changes) return;
    const total = addAmount ? db.prepare('SELECT coalesce(sum(amount),0) AS total FROM payment_events WHERE booking_id=?')
      .get(bookingId).total : amount;
    if (row.status === 'confirmed' || row.status === 'review' && row.payment_status === 'paid') {
      if (addAmount && total > row.amount) db.prepare("UPDATE bookings SET payment_status='review' WHERE id=?").run(bookingId);
      return;
    }
    if (total !== row.amount) {
      const status = row.hold_until <= now() ? 'review' : row.status;
      db.prepare("UPDATE bookings SET status=?, payment_status='review' WHERE id=?").run(status, bookingId);
      return;
    }
    const status = row.status === 'pending' && row.hold_until > now() && row.starts > now() ? 'confirmed' : 'review';
    db.prepare("UPDATE bookings SET status=?, payment_status='paid' WHERE id=?").run(status, bookingId);
  });
}

export function distanceKm({ lat, lng }, venue) {
  if (venue.lat == null || venue.lng == null) return null;
  const radians = (deg) => deg * Math.PI / 180;
  const a = Math.sin(radians(venue.lat - lat) / 2) ** 2 + Math.cos(radians(lat)) *
    Math.cos(radians(venue.lat)) * Math.sin(radians(venue.lng - lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function suggest(db, { date, after, before, duration = 60, area, maxPrice, origin, venueId }, user, demo) {
  if (!validDate(date)) throw new HttpError(400, 'Chọn ngày trong 30 ngày tới.');
  const saved = new Set(user ? db.prepare('SELECT venue_id FROM favorites WHERE user_id=?').all(user.id)
    .map(({ venue_id }) => venue_id) : []);
  const history = user ? db.prepare(`SELECT c.venue_id,b.starts FROM bookings b JOIN courts c ON c.id=b.court_id
    WHERE b.user_id=? AND b.status='confirmed' ORDER BY b.created DESC LIMIT 20`).all(user.id) : [];
  const lastHour = history[0] ? minute(slotTime(history[0].starts)) : 19 * 60;
  const results = [];
  for (const venue of listVenues(db)) {
    if (venueId && venue.id !== venueId) continue;
    if ((!venue.verified && !demo) || (area && !textKey(`${venue.area} ${venue.name} ${venue.address}`).includes(textKey(area)))) continue;
    if (maxPrice != null && Math.round(venue.price * duration / 60) > maxPrice) continue;
    const km = origin && distanceKm(origin, venue);
    for (const court of availability(db, getVenue(db, venue.id, demo), date, duration)) {
      for (const slot of court.slots) {
        if (slot.status !== 'available' || (after && slot.time < after) || (before && slot.end > before)) continue;
        const preferred = history.some((booking) => booking.venue_id === venue.id);
        const score = Number(saved.has(venue.id)) * 24 + Number(preferred) * 20 - (km ?? 0) * 3 -
          Math.abs(minute(slot.time) - lastHour) / 24 - slot.amount / 50000;
        results.push({ venueId: venue.id, venueName: venue.name, area: venue.area, courtId: court.id,
          courtName: court.name, date, time: slot.time, end: slot.end, duration, amount: slot.amount,
          reason: saved.has(venue.id) ? 'Sân bạn đã lưu' : preferred ? 'Sân bạn từng đặt' :
            km != null ? `Cách ${km.toFixed(1)} km đường chim bay` : 'Còn giờ trống phù hợp', score });
      }
    }
  }
  const selected = new Set();
  return results.sort((a, b) => b.score - a.score).filter((result) => {
    const key = `${result.venueId}:${result.time}`;
    if (selected.has(key)) return false;
    selected.add(key);
    return true;
  }).slice(0, 3).map(({ score, ...result }) => result);
}
