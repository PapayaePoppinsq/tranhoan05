import express from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabase, syncDirectory, syncDirectoryPhotos, transaction } from './db.js';
import { HttpError, availability, bookingSelect, dateAt, getVenue, listVenues, minute, now, quoteBooking,
  recordPayment, reserve, showBooking, suggest, textKey, validDate } from './domain.js';
import { daySchema, timeSchema, originSchema, filterSchema, chatContextSchema, interpret, naturalReply, mapDistances, mapRoute } from './integrations.js';
import { logIn, logOut, matchPassword, passwordHash, phoneKey, requireUser, seedAdmin, sessionUser, userView } from './auth.js';
import { createPayments } from './payments.js';
import { localHosts, protectRequests, securityHeaders } from './http-security.js';

const path = (name) => fileURLToPath(new URL(name, import.meta.url));
export function configuration() {
  if (existsSync(path('../.env'))) process.loadEnvFile(path('../.env'));
  const env = process.env;
  if (env.DEMO_MODE !== undefined && !['true', 'false'].includes(env.DEMO_MODE)) {
    throw new Error('DEMO_MODE must be true or false.');
  }
  if (env.PAYOS_WEBHOOK_READY !== undefined && !['true', 'false'].includes(env.PAYOS_WEBHOOK_READY)) {
    throw new Error('PAYOS_WEBHOOK_READY must be true or false.');
  }
  const demo = env.DEMO_MODE === 'true' || (env.DEMO_MODE === undefined && process.argv.includes('--demo'));
  const payos = { clientId: env.PAYOS_CLIENT_ID, apiKey: env.PAYOS_API_KEY, checksumKey: env.PAYOS_CHECKSUM_KEY };
  const port = Number(env.PORT || 4311);
  const publicUrl = new URL(env.PUBLIC_ORIGIN || (demo ? 'http://localhost:5173' : `http://localhost:${port}`));
  const local = localHosts.includes(publicUrl.hostname);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password ||
      publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash ||
      (demo && (!local || env.NODE_ENV === 'production')) ||
      ((!local || env.NODE_ENV === 'production' || (!demo && Object.values(payos).every(Boolean))) && publicUrl.protocol !== 'https:')) {
    throw new Error('Use a valid PUBLIC_ORIGIN. Demo is local only, and public or payOS setups need HTTPS.');
  }
  const origin = publicUrl.origin;
  return { port, origin, demo, payos, secure: origin.startsWith('https:'),
    database: env.DB_PATH || path(demo ? '../var/demo.sqlite' : '../var/live.sqlite'),
    paymentMode: demo ? 'demo' : Object.values(payos).every(Boolean) && env.PAYOS_WEBHOOK_READY === 'true' ? 'payos' : 'off',
    adminPassword: env.ADMIN_PASSWORD, geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, orsKey: env.ORS_API_KEY };
}

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const durationSchema = z.coerce.number().int().min(30).max(180).multipleOf(30);
const phoneSchema = z.string().trim().max(30).transform(phoneKey).pipe(z.string().regex(/^0[0-9]{9}$/));
const emailSchema = z.email().max(120).transform((email) => email.toLowerCase());
const quoteSchema = z.object({ courtId: idSchema, date: daySchema, time: timeSchema, duration: durationSchema });
const userSchema = z.object({ name: z.string().trim().min(2).max(100), phone: phoneSchema, email: emailSchema });
const venueSchema = z.object({ name: z.string().trim().min(2).max(120), area: z.string().trim().min(2).max(100),
  address: z.string().trim().min(4).max(250), lat: originSchema.shape.lat.nullable(), lng: originSchema.shape.lng.nullable(),
  open: timeSchema, close: z.union([timeSchema,z.literal('24:00')]), price: z.number().int().min(1000).max(5000000),
  image: z.string().regex(/^\/api\/media\/[a-f0-9-]{36}$/).optional(),
  featured: z.boolean().optional(), verified: z.boolean().optional(), active: z.boolean().optional(),
  ownerPhone: z.union([phoneSchema, z.literal('')]).optional(),
}).refine((v) => minute(v.open) % 30 === 0 && minute(v.close) % 30 === 0 && minute(v.open) + 30 <= minute(v.close)
  && (v.lat == null) === (v.lng == null), 'Giờ mở và đóng dùng bước 30 phút. Cần nhập đủ cặp tọa độ.');

function editableVenue(db, user, id) {
  const row = db.prepare('SELECT * FROM venues WHERE id=?').get(id);
  if (!row || (user.role !== 'admin' && row.owner_id !== user.id)) throw new HttpError(404, 'Không tìm thấy sân bạn quản lý.');
  return row;
}

function ownerOf(db, phone) {
  if (!phone) return null;
  const user = db.prepare('SELECT id,role FROM users WHERE phone=?').get(phone);
  if (!user || user.role === 'admin') throw new HttpError(400, 'Cần số điện thoại của tài khoản chủ sân đã đăng ký.');
  db.prepare("UPDATE users SET role='owner' WHERE id=?").run(user.id);
  return user.id;
}

function uploadImage(db, value) {
  const data = z.string().max(2_800_000).parse(value);
  const match = data.match(/^data:image\/(jpeg|png|webp);base64,([a-z\d+/]+=*)$/i);
  if (!match) throw new HttpError(400, 'Ảnh phải là JPG, PNG hoặc WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  const type = match[1].toLowerCase();
  const valid = type === 'jpeg' ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff' : type === 'png' ?
    bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' :
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid || bytes.length > 2_000_000) throw new HttpError(400, 'Ảnh không hợp lệ hoặc vượt quá 2 MB.');
  const id = randomUUID();
  db.prepare('INSERT INTO media(id,type,bytes) VALUES (?,?,?)').run(id, `image/${type}`, bytes);
  return `/api/media/${id}`;
}

export async function createApp(config, database) {
  const db = database || createDatabase(config.database);
  if (!database) {
    syncDirectory(db);
    syncDirectoryPhotos(db);
  }
  await seedAdmin(db, config);
  const payments = createPayments(db, config);
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders(config));
  const router = express.Router();
  const protect = protectRequests(config);
  const json = (size) => express.json({ limit: size, inflate: false });
  const limit = (n, ms) => rateLimit({ limit: n, windowMs: ms, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.get('CF-Connecting-IP') || req.ip || '127.0.0.1'),
    message: { error: 'Quá nhiều yêu cầu. Hãy thử lại sau.' } });
  const authLimit = limit(18, 600000);
  const searchLimit = limit(35, 60000);
  const chatLimit = limit(12, 60000);
  const uploadLimit = limit(12, 60000);
  function loadUser(req, _res, next) {
    req.user = sessionUser(db, req);
    next();
  }
  function requireManager(req, _res, next) {
    if (!['admin', 'owner'].includes(req.user?.role)) return next(new HttpError(403, 'Tài khoản chưa có quyền quản trị.'));
    next();
  }
  app.use('/api', router);
  router.post('/payments/payos/webhook', json('48kb'), async (req, res) => {
    await payments.webhook(req.body);
    res.json({ ok: true });
  });
  router.get('/media/:id', (req, res) => {
    const row = db.prepare('SELECT type,bytes FROM media WHERE id=?').get(req.params.id);
    if (!row) throw new HttpError(404, 'Không tìm thấy ảnh.');
    res.type(row.type).set('Cache-Control', 'public, max-age=31536000, immutable').send(Buffer.from(row.bytes));
  });
  router.use(protect, json('24kb'), loadUser);

  router.get('/health', (_req, res) => res.json({ ok: true }));
  router.get('/config', (_req, res) => res.json({ demo: config.demo, payment: config.paymentMode,
    chat: config.ai || config.geminiKey && config.geminiModel ? 'ai' : 'demo' }));
  router.get('/auth/me', (req, res) => res.json(userView(req.user)));
  router.post('/auth/register', authLimit, async (req, res) => {
    const { name, phone, email, password } = userSchema.extend({ password: z.string().min(8).max(128) }).parse(req.body);
    if (phone === '0900000000' || email === 'admin@sanvot.local') throw new HttpError(409, 'Số điện thoại hoặc email dành cho quản trị.');
    const encoded = await passwordHash(password);
    try {
      const { lastInsertRowid } = db.prepare('INSERT INTO users(name,name_key,phone,email,password) VALUES (?,?,?,?,?)')
        .run(name, textKey(name), phone, email, encoded);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(lastInsertRowid);
      logIn(db, res, user, req.user, config.secure);
      res.status(201).json(userView(user));
    } catch (error) {
      if (error.message.includes('UNIQUE')) throw new HttpError(409, 'Số điện thoại hoặc email đã được sử dụng.');
      throw error;
    }
  });
  router.post('/auth/login', authLimit, async (req, res) => {
    const { login, password } = z.object({ login:z.string().trim().min(1).max(100), password:z.string().min(1).max(128) }).parse(req.body);
    const phone = phoneKey(login);
    const users = /^0[0-9]{9}$/.test(phone) ? db.prepare('SELECT * FROM users WHERE phone=?').all(phone) :
      db.prepare('SELECT * FROM users WHERE name_key=? LIMIT 2').all(textKey(login));
    const user = users.length === 1 ? users[0] : null;
    if (!await matchPassword(password, user?.password)) throw new HttpError(401, 'Thông tin đăng nhập chưa đúng. Hãy dùng số điện thoại nếu đăng nhập bằng họ tên không thành công.');
    logIn(db, res, user, req.user, config.secure);
    res.json(userView(user));
  });
  router.post('/auth/logout', (req, res) => {
    logOut(db, res, req.user, config.secure);
    res.json({ ok: true });
  });
  router.put('/auth/profile', requireUser, (req, res) => {
    const { name, email } = userSchema.pick({ name: true, email: true }).parse(req.body);
    if (email === 'admin@sanvot.local' && req.user.role !== 'admin') throw new HttpError(409, 'Email dành cho quản trị.');
    try { db.prepare('UPDATE users SET name=?,name_key=?,email=? WHERE id=?').run(name, textKey(name), email, req.user.id); }
    catch (error) { if (error.message.includes('UNIQUE')) throw new HttpError(409, 'Email đã được sử dụng.'); throw error; }
    res.json(userView({ ...req.user, name, email }));
  });

  router.get('/venues', (req, res) => {
    const query = z.object({ date: daySchema.optional(), after: timeSchema.optional(), available: z.literal('1').optional() }).parse(req.query);
    const venues = listVenues(db);
    if (query.available && query.date) {
      return res.json(venues.filter((venue) => (config.demo || venue.verified) &&
        availability(db, getVenue(db, venue.id, config.demo), query.date, 60).some((court) => court.slots.some((slot) =>
          slot.status === 'available' && (!query.after || slot.time >= query.after)))));
    }
    res.json(venues);
  });
  router.get('/venues/:id', (req, res) => res.json(getVenue(db, idSchema.parse(req.params.id), config.demo)));
  router.get('/venues/:id/availability', (req, res) => {
    const venue = getVenue(db, idSchema.parse(req.params.id), config.demo);
    const { date, duration } = z.object({ date: daySchema, duration: durationSchema.default(60) }).parse(req.query);
    res.json((venue.verified || config.demo) ? availability(db, venue, date, duration) : []);
  });
  router.get('/favorites', requireUser, (req, res) => res.json(db.prepare('SELECT venue_id FROM favorites WHERE user_id=?')
    .all(req.user.id).map(({ venue_id }) => venue_id)));
  router.put('/favorites/:id', requireUser, (req, res) => {
    const venueId = idSchema.parse(req.params.id);
    const { saved } = z.object({ saved: z.boolean() }).parse(req.body);
    if (saved) {
      getVenue(db, venueId);
      db.prepare('INSERT INTO favorites(user_id,venue_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(req.user.id, venueId);
    } else db.prepare('DELETE FROM favorites WHERE user_id=? AND venue_id=?').run(req.user.id, venueId);
    res.json({ saved });
  });

  router.post('/distances', searchLimit, async (req, res) => {
    const origin = originSchema.parse(req.body);
    res.json(await mapDistances(config, origin, listVenues(db)));
  });
  router.post('/venues/:id/route', searchLimit, async (req, res) => {
    const origin = originSchema.parse(req.body);
    const venue = getVenue(db, idSchema.parse(req.params.id));
    res.json(await mapRoute(config, origin, venue));
  });
  router.post('/quick', searchLimit, (req, res) => {
    const filters = filterSchema.extend({ origin: originSchema.optional(), venueId: idSchema.optional() }).parse(req.body);
    let results = suggest(db, { ...filters, date: filters.date ?? dateAt() }, req.user, config.demo);
    if (!filters.date && !results.length) results = suggest(db, { ...filters, date: dateAt(1) }, req.user, config.demo);
    res.json({ results });
  });
  router.post('/chat', chatLimit, async (req, res) => {
    const { message, context, origin, history = [] } = z.object({ message: z.string().trim().min(1).max(500),
      context: chatContextSchema.optional(), origin: originSchema.optional(), history:z.array(z.object({
        role:z.enum(['user','assistant']), content:z.string().trim().min(1).max(500),
      })).max(4).optional() }).parse(req.body);
    const venues = listVenues(db);
    const areas = [...new Set(venues.map((v) => v.area))];
    const words = textKey(message);
    const howQuestion = /\b(lam sao|cach nao|cach dung|huong dan|su dung|tinh nang)\b/.test(words);
    const greeting = /^(?:chao|hello|hi\b|cam on\b|thanks\b|ok\b|oke\b)/.test(words) &&
      !/\b(tim san|dat san|choi san|gia san)\b/.test(words) || /\b(khoe khong|hom nay the nao)\b/.test(words);
    const plan = await interpret(config, message, areas, { context, history, venues });
    const { criteria, mode } = plan;
    const nameKey = (value) => textKey(value).replace(/[^a-z0-9]+/g, ' ').trim();
    const namesIn = (text) => venues.filter(({ name }) => {
      const query = ` ${nameKey(text)} `;
      const exactName = nameKey(name);
      const shortName = nameKey(name.replace(/\([^)]*\)/g, ''))
        .replace(/\b(?:san|pickleball|club|clb)\b/g, ' ').replace(/\s+/g, ' ').trim();
      return query.includes(` ${exactName} `) || (shortName.length >= 3 && query.includes(` ${shortName} `));
    });
    const directoryQuestion = /\b(co nhung san nao|co san nao|nhung san nao|danh sach san)\b/.test(words);
    const venueQuestion = /\b(bao nhieu san|gia|mat san|mai che|trong nha|ngoai troi|gio mo|mo cua|phu phi)\b/.test(words);
    const bookingRequest = /\b(tim san|dat san|choi san|con gio|con trong|gio trong)\b/.test(words);
    const intent = plan.intent ?? (greeting ? 'social' : howQuestion ? 'help' : bookingRequest ? 'booking' :
      directoryQuestion || venueQuestion ? 'info' : 'booking');
    const onTask = intent === 'booking' || intent === 'info';
    let namedVenues = onTask ? namesIn(message).slice(0, 4) : [];
    if (onTask && !namedVenues.length && plan.venueIds === undefined) {
      const referringBack = /\b(san do|san ay|cho do|dia diem do|san nay)\b/.test(words);
      if (!criteria.area && (!bookingRequest || referringBack)) {
        namedVenues = venues.filter(({id}) => context?.venueIds?.includes(id));
      }
      if (!namedVenues.length && referringBack) {
        for (const turn of [...history].reverse()) {
          if (turn.role === 'user' && (namedVenues = namesIn(turn.content).slice(0, 4)).length) break;
        }
      }
    }
    if (onTask && !namedVenues.length && plan.venueIds?.length) {
      namedVenues = venues.filter(({id}) => plan.venueIds.includes(id));
    }

    const { venueIds:previousVenueIds, ...previousFilters } = context ?? {};
    const combined = intent === 'booking' ? { ...previousFilters } : { ...criteria };
    if (intent === 'booking') {
      for (const key of plan.clear ?? []) delete combined[key];
      Object.assign(combined, criteria);
      if (namedVenues.length && !criteria.area) delete combined.area;
    }
    const matchingVenues = namedVenues.length ? namedVenues : combined.area ? venues.filter((venue) =>
      textKey(`${venue.area} ${venue.name} ${venue.address}`).includes(textKey(combined.area))) : venues;
    const changedAfter = intent === 'booking' && previousFilters.after && combined.after !== previousFilters.after ?
      combined.after : undefined;
    let reply, results = [], searchStatus;
    if (intent === 'social') reply = /\b(cam on|thanks)\b/.test(words) ?
      'Không có gì! Khi cần tìm sân hoặc hỏi thông tin một địa điểm, bạn cứ nhắn mình nhé.' :
      'Chào bạn! Bạn có thể hỏi mình về sân ở Thái Nguyên hoặc nhờ tìm sân theo ngày, giờ và khu vực.';
    else if (intent === 'help') reply = /\b(gan nha|gan toi|gan minh|gan day)\b/.test(words) ?
      'Bấm Chọn vị trí trong khung chat hoặc nhập khu vực; sau đó cho mình ngày, giờ và ngân sách để tìm sân phù hợp.' :
      'Bạn có thể nói ngày, giờ, khu vực và ngân sách; mình sẽ lọc sân phù hợp. Bạn cũng có thể hỏi giá, giờ mở cửa hoặc số sân nhỏ của một địa điểm.';
    else if (intent === 'info') {
      reply = directoryQuestion ? matchingVenues.length ?
        `Danh bạ ghi ${matchingVenues.length} cụm sân${combined.area ? ` ở ${combined.area}` : ''}, ${matchingVenues.length > 4 ? 'ví dụ' : 'gồm'} ${matchingVenues.slice(0, 4).map((venue) => venue.name).join(', ')}. Thông tin chưa được chủ sân xác minh.` :
        `Danh bạ chưa ghi nhận cụm sân${combined.area ? ` ở ${combined.area}` : ''}.` : 'Bạn muốn hỏi thông tin về sân nào?';
      const venue = namedVenues.length === 1 ? namedVenues[0] : null;
      if (venue?.directory_details && venueQuestion) {
        const { courtCount, courtType, surface, prices } = venue.directory_details;
        reply = `${venue.name} có ${courtCount} sân nhỏ, loại sân ${courtType.toLowerCase()}, mặt sân ${surface}. Giá thấp điểm tham khảo ${prices.offPeak.toLocaleString('vi-VN')} ₫/giờ. Xem trang chi tiết để tra bảng giá và phụ phí theo khung giờ.`;
      }
    }
    else if (config.paymentMode === 'off') {
      searchStatus = 'paymentOff';
      reply = changedAfter ? `Mình đổi sang từ ${changedAfter} nhé. Web vẫn chưa mở giữ chỗ.` :
        'Đặt sân trực tuyến chưa mở vì thanh toán chưa được cấu hình. Bạn vẫn có thể xem thông tin sân và liên hệ chủ sân.';
    }
    else if (!combined.date) {
      searchStatus = 'missingDate';
      reply = 'Bạn muốn chơi hôm nay hay ngày nào?';
    }
    else if (!validDate(combined.date)) {
      searchStatus = 'invalidDate';
      delete combined.date;
      reply = 'Chọn ngày hợp lệ từ hôm nay đến 30 ngày tới.';
    }
    else if (combined.near && !combined.area && !origin && !namedVenues.length) {
      searchStatus = 'missingOrigin';
      reply = 'Bạn muốn tìm gần khu vực nào? Bạn cũng có thể dùng vị trí hiện tại.';
    }
    else if (combined.after && combined.before && combined.after >= combined.before) {
      searchStatus = 'invalidWindow';
      reply = 'Giờ bắt đầu cần sớm hơn giờ kết thúc. Bạn muốn tìm khung nào?';
    }
    else {
      results = suggest(db, { ...combined, origin, venueIds:namedVenues.map(({id}) => id) }, req.user, config.demo);
      searchStatus = results.length ? 'results' : 'noMatch';
      reply = results.length ? `Mình tìm được ${results.length} khung giờ phù hợp, mặc định ${combined.duration ?? 60} phút. Chọn một khung để xem lại đơn.` :
        !config.demo && venues.every((venue) => !venue.verified || !venue.court_count) ?
          'Hiện chưa có sân nào được xác minh và mở nhận đặt. Bạn có thể xem thông tin các cụm sân ở trang tìm sân.' :
          'Chưa có sân phù hợp với các điều kiện này. Thử chọn giờ, khu vực hoặc mức giá khác.';
    }
    const facts = { venueCount:venues.length, matchingVenueCount:matchingVenues.length, searchStatus, changedAfter,
      bookableVenueCount:config.paymentMode === 'off' ? 0 : config.demo ? venues.length :
        venues.filter((venue) => venue.verified && venue.court_count).length,
      originProvided:Boolean(origin), paymentReady:config.paymentMode !== 'off',
      venueSamples:(onTask ? matchingVenues.slice(0, 4) : []).map((venue) => ({ name:venue.name, area:venue.area,
        address:venue.address, contactPhone:venue.contact_phone || undefined,
        directoryHours:`${venue.open}-${venue.close}`, verifiedForBooking:Boolean(venue.verified && venue.court_count),
        directoryReference:venue.directory_details && {
          courtCount:venue.directory_details.courtCount, courtType:venue.directory_details.courtType,
          surface:venue.directory_details.surface, prices:venue.directory_details.prices,
          ...(namedVenues.some((named) => named.id === venue.id) ? {
            weekdayRates:venue.directory_details.weekdayRates, weekendRates:venue.directory_details.weekendRates,
            courts:venue.directory_details.courts } : {}),
        } })),
      results:results.map(({ venueName, area, date, time, end, amount, reason }) =>
        ({ venueName, area, date, time, end, amount, reason })) };
    const response = config.ai ? await naturalReply(config, { message, history, criteria:combined,
      facts, fallback:reply, intent }) : { reply, mode };
    const nextContext = intent === 'booking' ? combined : { ...previousFilters };
    const venueIds = namedVenues.map(({id}) => id);
    if (venueIds.length) nextContext.venueIds = venueIds;
    else if (!onTask && previousVenueIds?.length) nextContext.venueIds = previousVenueIds;
    res.json({ reply:response.reply, results, criteria: nextContext, mode:response.mode });
  });

  router.post('/quote', (req, res) => res.json(quoteBooking(db, quoteSchema.parse(req.body), config.demo)));
  router.post('/bookings', requireUser, (req, res) => {
    const data = quoteSchema.extend({ amount: z.number().int().positive() }).parse(req.body);
    res.status(201).json(reserve(db, req.user.id, data, config));
  });
  router.get('/bookings', requireUser, (req, res) => res.json(db.prepare(`${bookingSelect} WHERE user_id=? ORDER BY created DESC`)
    .all(req.user.id).map(showBooking)));
  function ownBooking(req) {
    const row = db.prepare(`${bookingSelect} WHERE b.id=? AND b.user_id=?`).get(req.params.id, req.user.id);
    if (!row) throw new HttpError(404, 'Không tìm thấy đơn đặt.');
    return row;
  }
  router.get('/bookings/:id', requireUser, (req, res) => res.json(showBooking(ownBooking(req))));
  router.post('/bookings/:id/payment', requireUser, async (req, res) => res.json(await payments.start(ownBooking(req))));
  router.post('/bookings/:id/demo-payment', requireUser, (req, res) => {
    const row = ownBooking(req);
    if (!config.demo || row.provider !== 'demo') throw new HttpError(404, 'Thanh toán thử chưa bật.');
    if (row.status === 'confirmed') return res.json(showBooking(row));
    if (row.status !== 'pending' || row.hold_until <= now()) throw new HttpError(409, 'Giữ chỗ đã hết hạn.');
    recordPayment(db,{ bookingId: row.id, eventId: `demo:${row.id}`, amount: row.amount });
    res.json(showBooking(ownBooking(req)));
  });

  const manage = express.Router();
  router.use('/manage', requireUser, requireManager, manage);
  manage.get('/venues', (req, res) => {
    const query = 'SELECT v.*, u.phone AS owner_phone FROM venues v LEFT JOIN users u ON u.id=v.owner_id';
    const venues = req.user.role === 'admin' ? db.prepare(`${query} ORDER BY v.id`).all() :
      db.prepare(`${query} WHERE v.owner_id=? ORDER BY v.id`).all(req.user.id);
    res.json(venues.map((venue) => ({...venue, courts: db.prepare('SELECT id,name,active,is_demo FROM courts WHERE venue_id=? ORDER BY id').all(venue.id)})));
  });
  manage.post('/venues', (req, res) => {
    const v = venueSchema.parse(req.body);
    const id = transaction(db, () => {
      const admin = req.user.role === 'admin';
      const owner = admin ? ownerOf(db, v.ownerPhone) : req.user.id;
      const { lastInsertRowid } = db.prepare(`INSERT INTO venues(name,area,address,lat,lng,open,close,price,image,featured,verified,owner_id,image_sample)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.name,v.area,v.address,v.lat,v.lng,v.open,v.close,v.price,v.image ?? '',
        Number(admin && !!v.featured), Number(admin && !!v.verified),owner,0);
      db.prepare("INSERT INTO courts(venue_id,name) VALUES (?,'Sân 1')").run(lastInsertRowid);
      return lastInsertRowid;
    });
    res.status(201).json({ id });
  });
  manage.put('/venues/:id', (req, res) => {
    const row = editableVenue(db, req.user, idSchema.parse(req.params.id));
    const v = venueSchema.parse(req.body);
    transaction(db, () => {
      const admin = req.user.role === 'admin';
      const owner = admin && v.ownerPhone !== undefined ? ownerOf(db, v.ownerPhone) : row.owner_id;
      const photo = v.image || row.image;
      db.prepare(`UPDATE venues SET name=?,area=?,address=?,lat=?,lng=?,open=?,close=?,price=?,image=?,featured=?,
        verified=?,active=?,owner_id=?,image_sample=?,source_hours=?,photo_source=? WHERE id=?`).run(v.name,v.area,v.address,v.lat,v.lng,v.open,v.close,v.price,photo,
        admin ? Number(v.featured ?? row.featured) : row.featured, admin ? Number(v.verified ?? row.verified) : row.verified,
        Number(v.active ?? row.active),owner,v.image ? 0 : row.image_sample,
        v.open === row.open && v.close === row.close ? row.source_hours : null,v.image ? null : row.photo_source,row.id);
    });
    res.json({ id: row.id });
  });
  manage.post('/venues/:id/courts', (req, res) => {
    const venue = editableVenue(db, req.user, idSchema.parse(req.params.id));
    const { name } = z.object({ name:z.string().trim().min(1).max(50) }).parse(req.body);
    try {
      const { lastInsertRowid } = db.prepare('INSERT INTO courts(venue_id,name) VALUES (?,?)').run(venue.id,name);
      res.status(201).json({ id: lastInsertRowid });
    } catch (error) { if (error.message.includes('UNIQUE')) throw new HttpError(409, 'Tên sân nhỏ đã tồn tại.'); throw error; }
  });
  manage.put('/venues/:id/courts/:courtId', (req, res) => {
    const venue = editableVenue(db, req.user, idSchema.parse(req.params.id));
    const id = idSchema.parse(req.params.courtId);
    const { active } = z.object({ active:z.boolean() }).parse(req.body);
    if (!db.prepare('UPDATE courts SET active=? WHERE id=? AND venue_id=?').run(Number(active), id, venue.id).changes) {
      throw new HttpError(404, 'Không tìm thấy sân nhỏ.');
    }
    res.json({ id, active });
  });
  manage.get('/bookings', (req, res) => {
    const rows = req.user.role === 'admin' ? db.prepare(`${bookingSelect} ORDER BY b.created DESC LIMIT 200`).all() :
      db.prepare(`${bookingSelect} WHERE v.owner_id=? ORDER BY b.created DESC LIMIT 200`).all(req.user.id);
    res.json(rows.map((row) => showBooking({ ...row, checkout: null, qr_payload: null })));
  });
  // Use a dedicated router before the small JSON parser for image uploads.
  app.post('/upload-court-photo', protect, loadUser, requireManager, uploadLimit, json('3mb'), (req, res) => {
    res.status(201).json({ image: uploadImage(db, req.body?.image) });
  });
  router.use((_req,_res,next) => next(new HttpError(404,'Không tìm thấy API.')));
  const dist = database ? null : path('../../frontend/dist');
  if (dist && existsSync(`${dist}/index.html`)) {
    app.use(express.static(dist));
    app.get('/{*route}', (req, res, next) => {
      if (!req.accepts('html') || /\.[^/]+$/.test(req.path)) return next(new HttpError(404, 'Không tìm thấy tệp.'));
      res.sendFile(`${dist}/index.html`);
    });
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: `Dữ liệu chưa hợp lệ (${error.issues[0]?.path.join('.') || 'kiểm tra thông tin'}).` });
    const status = Number(error.status) || 500;
    if (status >= 500 && !(error instanceof HttpError)) console.error(error);
    res.status(status).json({ error: error instanceof HttpError ? error.message : status === 413 ? 'Tệp hoặc yêu cầu quá lớn.' :
      status === 400 ? 'Yêu cầu không hợp lệ.' : 'Máy chủ chưa xử lý được yêu cầu.' });
  });
  return { app, db };
}

if (import.meta.url && process.argv[1]?.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const config = configuration();
  const { app } = await createApp(config);
  app.listen(config.port, '127.0.0.1', () => console.log(`Sân Vợt API: http://localhost:${config.port}`));
}
