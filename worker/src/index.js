import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { httpServerHandler } from 'cloudflare:node';
import { DurableObject } from 'cloudflare:workers';
import { createApp } from '../../backend/src/index.js';
import { passwordHash } from '../../backend/src/auth.js';
import { transaction } from '../../backend/src/db.js';
import { textKey } from '../../backend/src/domain.js';
import { databaseFor, initializeDatabase } from './storage.js';

async function reconcileAdmin(db, password) {
  if (!password) return;
  if (password.length < 12 || password.length > 128) throw new Error('ADMIN_PASSWORD phải dài 12–128 ký tự.');
  const digest = createHash('sha256').update(password).digest('hex');
  if (db.prepare("SELECT value FROM app_data WHERE key='admin_secret_hash'").get()?.value === digest) return;
  const encoded = await passwordHash(password);
  transaction(db, () => {
    const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get();
    if (admin) {
      db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, admin.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(admin.id);
    } else {
      db.prepare("INSERT INTO users(name,name_key,phone,email,password,role) VALUES (?,?,?,?,?,'admin')")
        .run('Quản trị Sân Vợt',textKey('Quản trị Sân Vợt'),'0900000000','admin@sanvot.local',encoded);
    }
    db.prepare("INSERT OR REPLACE INTO app_data(key,value) VALUES ('admin_secret_hash',?)").run(digest);
  });
}

export class BookingDatabase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const db = databaseFor(ctx);
      initializeDatabase(db);
      const origin = new URL(env.PUBLIC_ORIGIN).origin;
      if (!origin.startsWith('https://')) throw new Error('PUBLIC_ORIGIN phải dùng HTTPS.');
      const payos = { clientId:env.PAYOS_CLIENT_ID, apiKey:env.PAYOS_API_KEY,
        checksumKey:env.PAYOS_CHECKSUM_KEY };
      const config = { origin, secure:true, demo:false, port:4311, payos,
        paymentMode:Object.values(payos).every(Boolean) && env.PAYOS_WEBHOOK_READY === 'true' ? 'payos' : 'off',
        adminPassword:env.ADMIN_PASSWORD?.trim(), geminiKey:env.GEMINI_API_KEY,
        geminiModel:env.GEMINI_MODEL, ai:env.AI, orsKey:env.ORS_API_KEY };
      this.db = db;
      this.config = config;
      const { app } = await createApp(config, db);
      await reconcileAdmin(db, config.adminPassword);
      this.handler = httpServerHandler(createServer(app));
    });
  }

  async fetch(request) {
    await this.ready;
    await reconcileAdmin(this.db, this.env.ADMIN_PASSWORD?.trim());
    return this.handler.fetch(request);
  }
}

export default {
  fetch(request, env) {
    const id = env.BOOKING_DB.idFromName('main');
    return env.BOOKING_DB.get(id).fetch(request);
  },
};
