import { schemaSql, upgradeSchema } from '../../backend/src/db.js';
import catalog from '../../frontend/public/catalog.json' with { type: 'json' };

export function databaseFor(ctx) {
  const sql = ctx.storage.sql;
  return {
    exec(query) { sql.exec(query); },
    transactionSync(work) { return ctx.storage.transactionSync(work); },
    prepare(query) {
      return {
        get(...values) { return sql.exec(query, ...values).toArray()[0]; },
        all(...values) { return sql.exec(query, ...values).toArray(); },
        run(...values) {
          const cursor = sql.exec(query, ...values);
          return { changes: cursor.rowsWritten,
            lastInsertRowid: sql.exec('SELECT last_insert_rowid() AS id').one().id };
        },
      };
    },
  };
}

export function initializeDatabase(db) {
  db.exec(schemaSql);
  upgradeSchema(db);
  if (db.prepare('SELECT id FROM venues LIMIT 1').get()) return;
  db.transactionSync(() => {
    const venue = db.prepare(`INSERT INTO venues
      (id,name,area,address,lat,lng,open,close,price,image,map_url,image_sample,
       directory_id,category,rating,rating_count,contact_phone,photo_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const court = db.prepare('INSERT INTO courts(id,venue_id,name,is_demo) VALUES (?,?,?,1)');
    for (const row of catalog) {
      venue.run(row.id,row.name,row.area,row.address,row.lat,row.lng,row.open,row.close,row.price,
        row.image,row.map_url,row.image_sample,row.directory_id,row.category,row.rating,row.rating_count,
        row.contact_phone,row.photo_source);
      court.run(row.id,row.id,'Sân thử');
    }
  });
}
