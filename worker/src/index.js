import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { DurableObject } from 'cloudflare:workers';
import { createApp } from '../../backend/src/index.js';
import { databaseFor, initializeDatabase } from './storage.js';

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
        paymentMode:Object.values(payos).every(Boolean) ? 'payos' : 'off',
        adminPassword:env.ADMIN_PASSWORD, geminiKey:env.GEMINI_API_KEY,
        geminiModel:env.GEMINI_MODEL, orsKey:env.ORS_API_KEY };
      const { app } = await createApp(config, db);
      this.handler = httpServerHandler(createServer(app));
    });
  }

  async fetch(request) {
    await this.ready;
    return this.handler.fetch(request);
  }
}

export default {
  fetch(request, env) {
    const id = env.BOOKING_DB.idFromName('main');
    return env.BOOKING_DB.get(id).fetch(request);
  },
};
