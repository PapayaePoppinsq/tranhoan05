import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';
import { readDirectoryDetails } from './directory.js';

const ddl = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer'
  CHECK(role IN ('customer','owner','admin'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_data (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY, owner_id INTEGER REFERENCES users(id), name TEXT NOT NULL, area TEXT NOT NULL,
  address TEXT NOT NULL, lat REAL, lng REAL, open TEXT NOT NULL, close TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 1000), image TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  source TEXT, map_url TEXT, verification_note TEXT, image_sample INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS courts (
  id INTEGER PRIMARY KEY, venue_id INTEGER NOT NULL REFERENCES venues(id), name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, is_demo INTEGER NOT NULL DEFAULT 0, UNIQUE(venue_id, name)
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id INTEGER NOT NULL REFERENCES venues(id), PRIMARY KEY(user_id, venue_id)
);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, type TEXT NOT NULL, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), court_id INTEGER NOT NULL REFERENCES courts(id),
  starts INTEGER NOT NULL, ends INTEGER NOT NULL CHECK(ends > starts), amount INTEGER NOT NULL,
  hold_until INTEGER NOT NULL, code INTEGER NOT NULL UNIQUE, created INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','expired','review')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','review')),
  provider TEXT NOT NULL CHECK(provider IN ('demo','payos')), link_id TEXT, checkout TEXT, qr_payload TEXT
);
CREATE INDEX IF NOT EXISTS upcoming_court ON bookings(court_id, starts, ends, status);
CREATE INDEX IF NOT EXISTS user_bookings ON bookings(user_id, created);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), amount INTEGER NOT NULL,
  received INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

const conflictTrigger = (action) => `
CREATE TRIGGER IF NOT EXISTS no_overlap_${action} BEFORE ${action} ON bookings
WHEN (NEW.status = 'confirmed' OR (NEW.status = 'pending' AND NEW.hold_until > unixepoch())) AND EXISTS (
  SELECT 1 FROM bookings b WHERE b.id != NEW.id AND b.court_id = NEW.court_id
  AND b.starts < NEW.ends AND b.ends > NEW.starts
  AND (b.status = 'confirmed' OR (b.status = 'pending' AND b.hold_until > unixepoch()))
)
BEGIN SELECT RAISE(ABORT, 'slot_conflict'); END;
`;

export const schemaSql = ddl + conflictTrigger('insert') + conflictTrigger('update');

export function upgradeSchema(db) {
  transaction(db, () => {
    const columns = new Set(db.prepare('PRAGMA table_info(venues)').all().map(({ name }) => name));
    for (const [name, type] of Object.entries({ directory_id: 'INTEGER', category: 'TEXT', rating: 'REAL',
      rating_count: 'INTEGER', contact_phone: 'TEXT', source_hours: 'TEXT', photo_source: 'TEXT',
      directory_details: 'TEXT' })) {
      if (!columns.has(name)) db.exec(`ALTER TABLE venues ADD COLUMN ${name} ${type}`);
    }
    if (!db.prepare('PRAGMA table_info(courts)').all().some(({ name }) => name === 'is_demo')) {
      db.exec('ALTER TABLE courts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
    }
    if (!db.prepare('PRAGMA table_info(bookings)').all().some(({ name }) => name === 'qr_payload')) {
      db.exec('ALTER TABLE bookings ADD COLUMN qr_payload TEXT');
    }
  });
}

export function createDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;');
  db.exec(schemaSql);
  upgradeSchema(db);
  return db;
}

export function transaction(db, work) {
  if (db.transactionSync) return db.transactionSync(work);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const demoHourlyPrice = 100_000;
// Keep the existing import marker because the 25 venue records are unchanged by the CSV rename.
const catalogVersion = 'pickleball_thai_nguyen.csv:2026-11-22';
const asNumber = (value) => value?.trim() ? Number(value.replace(',', '.')) : null;

function readDirectory() {
  const source = readFileSync(new URL('../data/thai-nguyen.csv', import.meta.url), 'utf8');
  const rows = parse(source, { columns: true, bom: true, trim: true, skip_empty_lines: true });
  const ids = new Set();
  return rows.map((row) => {
    const id = Number(row.id);
    const range = row.thoi_gian_hoat_dong?.match(/^((?:[01]\d|2[0-3]):[03]0)\s*-\s*((?:[01]\d|2[0-3]):[03]0|24:00)/);
    const [open, close] = range ? range.slice(1) : /24\/24/.test(row.thoi_gian_hoat_dong) ? ['00:00','24:00'] : [];
    const lat = asNumber(row.vi_do), lng = asNumber(row.kinh_do), rating = asNumber(row.so_sao);
    const count = asNumber(row.so_luot_danh_gia);
    if (!Number.isInteger(id) || id <= 0 || ids.has(id) || !row.ten_san || !row.dia_chi || !open || close <= open ||
        !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
        (rating != null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) ||
        (count != null && (!Number.isInteger(count) || count < 0))) {
      throw new Error(`Dòng dữ liệu sân không hợp lệ: ${row.id}`);
    }
    ids.add(id);
    const area = row.dia_chi.match(/(?:Phường|Xã)\s+([^,]+)/i)?.[1]?.trim() || 'Thái Nguyên';
    const mapUrl = new URL(row.link_google_maps);
    if (mapUrl.protocol !== 'https:' || mapUrl.hostname !== 'www.google.com' || !mapUrl.pathname.startsWith('/maps/')) {
      throw new Error(`Liên kết bản đồ không hợp lệ ở sân ${id}`);
    }
    return { id, name: row.ten_san, area, address: row.dia_chi, lat, lng, open, close, mapUrl: mapUrl.href,
      category: row.the_loai || null, rating, count, phone: row.so_dien_thoai || null, hours: row.thoi_gian_hoat_dong,
      directory_details:readDirectoryDetails(row, open, close) };
  });
}

export function syncDirectory(db) {
  const rows = readDirectory();
  seedLocalDirectory(db, rows);
  syncDirectoryDetails(db, rows);
}

function seedLocalDirectory(db, rows) {
  const importedVersion = db.prepare("SELECT value FROM app_data WHERE key='directory_catalog'");
  if (importedVersion.get()?.value === catalogVersion) return;
  if (!rows.length) throw new Error('Danh bạ trống.');
  transaction(db, () => {
    if (importedVersion.get()?.value === catalogVersion) return;
    const { lastVenue } = db.prepare('SELECT coalesce(max(id),0) AS lastVenue FROM venues').get();
    const { lastCourt } = db.prepare('SELECT coalesce(max(id),0) AS lastCourt FROM courts').get();
    // Giữ định danh và tên của sân từng có đơn để lịch sử vẫn trỏ đúng địa điểm.
    db.exec(`UPDATE venues SET active=0;
      DELETE FROM favorites WHERE venue_id IN (
        SELECT id FROM venues WHERE NOT EXISTS (
          SELECT 1 FROM courts JOIN bookings ON bookings.court_id=courts.id WHERE courts.venue_id=venues.id
        )
      );
      DELETE FROM courts WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE bookings.court_id=courts.id);
      DELETE FROM venues WHERE NOT EXISTS (SELECT 1 FROM courts WHERE courts.venue_id=venues.id);`);
    const insertVenue = db.prepare(`INSERT INTO venues
      (id,name,area,address,lat,lng,open,close,price,image,map_url,image_sample,
       directory_id,category,rating,rating_count,contact_phone,source_hours)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertCourt = db.prepare('INSERT INTO courts(id,venue_id,name,is_demo) VALUES (?,?,?,1)');
    for (const row of rows) {
      const venueId = lastVenue + row.id;
      insertVenue.run(venueId, row.name, row.area, row.address, row.lat, row.lng, row.open, row.close,
        demoHourlyPrice, '', row.mapUrl, 0, row.id, row.category, row.rating, row.count, row.phone, row.hours);
      insertCourt.run(lastCourt + row.id, venueId, 'Sân thử');
    }
    db.prepare("INSERT OR REPLACE INTO app_data(key,value) VALUES ('directory_catalog',?)").run(catalogVersion);
  });
}

export function syncDirectoryDetails(db, rows) {
  const details = rows.map((row) => [row.directory_id ?? row.id, JSON.stringify(row.directory_details)]);
  const version = createHash('sha256').update(JSON.stringify(details)).digest('hex');
  const importedVersion = db.prepare("SELECT value FROM app_data WHERE key='directory_details'");
  if (importedVersion.get()?.value === version) return;
  transaction(db, () => {
    if (importedVersion.get()?.value === version) return;
    // Apply CSV metadata in place so IDs and operational records stay attached to the same venue.
    const update = db.prepare('UPDATE venues SET directory_details=? WHERE directory_id=? AND active=1');
    for (const [directoryId, value] of details) update.run(value, directoryId);
    db.prepare("INSERT OR REPLACE INTO app_data(key,value) VALUES ('directory_details',?)").run(version);
  });
}

export function syncDirectoryPhotos(db, suppliedPhotos, suppliedCatalog) {
  const manifest = suppliedPhotos ? JSON.stringify(suppliedPhotos) :
    readFileSync(new URL('../data/catalog-photos.json', import.meta.url), 'utf8');
  const version = createHash('sha256').update(manifest).digest('hex');
  const importedVersion = db.prepare("SELECT value FROM app_data WHERE key='directory_photos'");
  if (importedVersion.get()?.value === version) return;

  const photos = JSON.parse(manifest);
  const catalog = new Map((suppliedCatalog || readDirectory()).map((row) => [row.id, row]));
  const seen = new Set(), covers = new Set();
  for (const row of photos) {
    const venue = catalog.get(row.id);
    if (!venue || seen.has(row.id) || row.name !== venue.name || row.address !== venue.address) {
      throw new Error(`Dữ liệu ảnh không khớp sân ${row.id}`);
    }
    seen.add(row.id);
    if (row.cover && (!row.cover.startsWith(`/images/san-thuc-te/${row.id}-`) ||
        !/^\/images\/san-thuc-te\/\d+-[a-f0-9]{12}\.(jpg|png|webp)$/.test(row.cover) ||
        !row.source || new URL(row.source).protocol !== 'https:' || covers.has(row.cover))) {
      throw new Error(`Ảnh sân ${row.id} không hợp lệ hoặc bị trùng.`);
    }
    if (row.cover) covers.add(row.cover);
  }
  if (seen.size !== catalog.size) throw new Error('Danh sách ảnh chưa đủ các sân trong danh bạ.');

  transaction(db, () => {
    if (importedVersion.get()?.value === version) return;
    const update = db.prepare(`UPDATE venues SET image=?,image_sample=0,photo_source=?
      WHERE directory_id=? AND active=1 AND image NOT LIKE '/api/media/%' AND name=? AND address=?`);
    for (const row of photos) update.run(row.cover || '',row.cover ? row.source : null,row.id,row.name,row.address);
    db.prepare("INSERT OR REPLACE INTO app_data(key,value) VALUES ('directory_photos',?)").run(version);
  });
}
