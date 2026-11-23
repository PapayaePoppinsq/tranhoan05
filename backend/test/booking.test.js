import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { PayOS } from '@payos/node';
import { createApp } from '../src/index.js';
import { dateAt, now, recordPayment } from '../src/domain.js';
import { createDatabase, demoHourlyPrice, syncDirectory, syncDirectoryDetails, syncDirectoryPhotos } from '../src/db.js';
import { passwordHash, seedAdmin } from '../src/auth.js';

let server, db, base;
const adminPassword = 'test-admin-password-123';
before(async () => {
  const made = await createApp({ demo:true, paymentMode:'demo', adminPassword, database:':memory:', origin:'http://localhost:5173', port:4311 });
  db = made.db;
  server = made.app.listen(0,'127.0.0.1');
  await once(server,'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db?.close();
});

async function request(path, { body, cookie, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const response = await fetch(base + path, { method, headers:{
    ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...(cookie ? {Cookie:cookie} : {}),
  }, body:body === undefined ? undefined : JSON.stringify(body) });
  return { status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
}

const signUp = (n, name = `Khách ${n}`) => request('/auth/register', { body:{ name, phone:`09100000${n}`, email:`user${n}@example.com`, password:'valid-password-1' } });

test('imports 25 venue records with operating hours, ratings and supplied images', async () => {
  const { body:venues } = await request('/venues');
  assert.equal(venues.length, 25);
  assert.equal(venues.filter((venue) => venue.image).length,16);
  assert.equal(venues[0].name,'Sân Vin Pickleball Thanh Niên 2');
  assert.equal(venues[0].lat,21.5794);
  assert.equal(venues[0].rating,5);
  assert.equal(venues[0].rating_count,4);
  assert.equal(venues[0].area,'Tân Thịnh');
  assert.equal(venues[0].court_count,0);
  assert.equal(venues.reduce((count, venue) => count + venue.directory_details.courtCount, 0), 107);
  assert.equal(venues[1].image,'');
  assert.match(venues[6].image,/\/san-thuc-te\/7-/);
  assert.match(venues[7].photo_source,/bvdktuthainguyen.gov.vn/);
  assert.equal(venues[18].image,'');
  assert.equal(venues[24].image,'');
  assert.ok(venues.every((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng) && v.map_url.startsWith('https://')));
  assert.deepEqual(venues.slice(4,6).map(({open,close}) => [open,close]), [['05:00','23:00'],['00:00','24:00']]);
  const allDay = (await request(`/venues/6/availability?date=${dateAt(1)}&duration=60`)).body[0];
  assert.equal(allDay.slots.at(-1).end,'24:00');
  const { body:detail } = await request('/venues/4');
  assert.deepEqual(detail.directory_details.weekendRates.at(-1), { start:'16:00', end:'22:00', hourly:150000 });
  assert.match(detail.directory_details.courts[0].label, /\+10000 VND\/h/);
  assert.equal(detail.court_count, 0);
});

test('directory questions list real venues without inventing a playing date', async () => {
  const { body } = await request('/chat', { body:{ message:'Ở Quyết Thắng có những sân nào?' } });
  assert.equal(body.mode, 'demo');
  assert.equal(body.criteria.date, undefined);
  assert.match(body.reply, /CLB Pickleball Quyết Thắng/);
  const named = await request('/chat', { body:{ message:'Sân Quang Minh có bao nhiêu sân nhỏ và giá bao nhiêu?' } });
  assert.match(named.body.reply, /Quang Minh có 5 sân nhỏ/);
  assert.match(named.body.reply, /90\.000/);
});

test('directory details backfill existing venues without changing their booking settings or favorites', () => {
  const existing = createDatabase(':memory:');
  try {
    existing.exec(`INSERT INTO users(id,name,name_key,phone,email,password) VALUES (1,'Local','local','0900000001','local@example.com','fixture');
      INSERT INTO venues(id,directory_id,name,area,address,open,close,price,image,verified) VALUES
        (54,1,'Sân đã xác minh','A','B','07:00','21:00',125000,'/api/media/mine',1);
      INSERT INTO courts(id,venue_id,name) VALUES (92,54,'Sân chính');
      INSERT INTO favorites(user_id,venue_id) VALUES (1,54);`);
    const csv = [{ id:1, directory_details:{ courtCount:6 } }];
    syncDirectoryDetails(existing, csv);
    syncDirectoryDetails(existing, csv);
    const { id, verified, price, image, open, directory_details } = existing.prepare('SELECT * FROM venues').get();
    assert.deepEqual({ id, verified, price, image, open, directory_details:JSON.parse(directory_details) },
      { id:54, verified:1, price:125000, image:'/api/media/mine', open:'07:00', directory_details:{ courtCount:6 } });
    assert.equal(existing.prepare('SELECT venue_id FROM favorites').get().venue_id, 54);
    assert.equal(existing.prepare('SELECT venue_id FROM courts WHERE id=92').get().venue_id, 54);
  } finally { existing.close(); }
});

test('replaces old directory without reusing booking identifiers or re-importing on restart', () => {
  const existing = createDatabase(':memory:');
  try {
    existing.exec(`INSERT INTO users(id,name,name_key,phone,email,password) VALUES (1,'Local','local','0900000001','local@example.com','fixture');
      INSERT INTO venues(id,name,area,address,open,close,price,image) VALUES
        (1,'Sân từng đặt','A','A','06:00','22:00',100000,''),(2,'Sân thử cũ','A','B','06:00','22:00',100000,'');
      INSERT INTO courts(id,venue_id,name) VALUES(1,1,'Sân 1'),(2,2,'Sân 1');
      INSERT INTO bookings(id,user_id,court_id,starts,ends,amount,hold_until,code,provider,status)
        VALUES('legacy',1,1,100,200,100000,100,1,'demo','confirmed');`);
    syncDirectory(existing);
    assert.equal(existing.prepare('SELECT count(*) AS count FROM venues WHERE active=1').get().count,25);
    assert.equal(existing.prepare('SELECT name FROM venues WHERE id=2').get(),undefined);
    assert.equal(existing.prepare('SELECT v.name FROM bookings b JOIN courts c ON c.id=b.court_id JOIN venues v ON v.id=c.venue_id').get().name,'Sân từng đặt');
    const row = existing.prepare('SELECT id FROM venues WHERE directory_id=1').get();
    assert.ok(row.id > 2);
    existing.prepare('UPDATE venues SET featured=1 WHERE id=?').run(row.id);
    syncDirectory(existing);
    assert.equal(existing.prepare('SELECT featured FROM venues WHERE id=?').get(row.id).featured,1);
    existing.prepare("UPDATE venues SET image='/api/media/user-upload' WHERE directory_id=3").run();
    syncDirectoryPhotos(existing);
    assert.match(existing.prepare('SELECT image FROM venues WHERE id=?').get(row.id).image,/\/san-thuc-te\/1-/);
    assert.equal(existing.prepare('SELECT image FROM venues WHERE directory_id=3').get().image,'/api/media/user-upload');
    assert.equal(existing.prepare('SELECT court_id FROM bookings WHERE id=?').get('legacy').court_id,1);
  } finally { existing.close(); }
});

test('quotes and reserves once across competing accounts, then confirms demo and updates availability', async () => {
  const [one,two] = await Promise.all([signUp(11),signUp(12)]);
  assert.equal(one.status,201);
  assert.equal(two.status,201);
  const venue = (await request('/venues/1')).body;
  const choice = { courtId:venue.courts[0].id, date:dateAt(1), time:'19:00', duration:60 };
  const quote = (await request('/quote', {body:choice})).body;
  assert.equal(quote.amount,demoHourlyPrice);
  assert.equal((await request('/bookings',{cookie:one.cookie,body:{...choice,amount:1}})).status,409);
  const competing = await Promise.all([one,two].map((user) => request('/bookings',{cookie:user.cookie,body:{...choice,amount:quote.amount}})));
  assert.deepEqual(competing.map(({status}) => status).sort(),[201,409]);
  const i = competing.findIndex((row) => row.status === 201);
  const order = competing[i].body, winner = [one,two][i], loser = [two,one][i];
  assert.equal((await request(`/bookings/${order.id}`,{cookie:loser.cookie})).status,404);
  assert.equal((await request('/bookings',{cookie:winner.cookie,body:{...choice,amount:quote.amount}})).body.id,order.id);
  assert.equal((await request('/quote',{body:{...choice,time:'19:30'}})).status,409);
  // The database also protects writers which bypass the quote operation.
  assert.throws(() => db.prepare(`INSERT INTO bookings(id,user_id,court_id,starts,ends,amount,hold_until,code,provider)
    SELECT 'duplicate',user_id,court_id,starts+1800,ends+1800,amount,hold_until,100,'demo' FROM bookings WHERE id=?`).run(order.id), /slot_conflict/);
  const paid = await request(`/bookings/${order.id}/demo-payment`,{cookie:winner.cookie,body:{}});
  assert.equal(paid.body.status,'confirmed');
  assert.equal((await request(`/bookings/${order.id}/demo-payment`,{cookie:winner.cookie,body:{}})).body.status,'confirmed');
  const availability = (await request(`/venues/1/availability?date=${choice.date}&duration=60`)).body;
  assert.equal(availability[0].slots.find(({time}) => time === '19:00').status,'booked');
  assert.equal((await request('/bookings',{cookie:winner.cookie})).body[0].paymentStatus,'paid');
});

test('late payment needs review and cannot take a replacement reservation', async () => {
  const [one,two] = await Promise.all([signUp(13),signUp(14)]);
  const choice = { courtId:1, date:dateAt(2), time:'20:00', duration:60, amount:demoHourlyPrice };
  const expired = (await request('/bookings',{cookie:one.cookie,body:choice})).body;
  db.prepare('UPDATE bookings SET hold_until=? WHERE id=?').run(now()-1,expired.id);
  const replacement = (await request('/bookings',{cookie:two.cookie,body:choice})).body;
  recordPayment(db,{bookingId:expired.id,eventId:'verified-late-1',amount:choice.amount});
  recordPayment(db,{bookingId:expired.id,eventId:'verified-late-1',amount:choice.amount});
  assert.equal((await request(`/bookings/${expired.id}`,{cookie:one.cookie})).body.status,'review');
  assert.equal((await request(`/bookings/${replacement.id}`,{cookie:two.cookie})).body.status,'pending');
  assert.equal(db.prepare('SELECT count(*) AS n FROM payment_events WHERE booking_id=?').get(expired.id).n,1);
});

test('permissions, saved venues, and both assisted booking paths', async () => {
  const customer = await signUp(15,'Khách Tìm Sân');
  assert.equal((await request('/manage/venues',{cookie:customer.cookie})).status,403);
  const login = await request('/auth/login',{body:{login:'Khách Tìm Sân',password:'valid-password-1'}});
  assert.equal(login.body.phone,'0910000015');
  assert.equal((await request('/favorites/1',{method:'PUT',cookie:login.cookie,body:{saved:true}})).status,200);
  assert.deepEqual((await request('/favorites',{cookie:login.cookie})).body,[1]);
  const quick = (await request('/quick',{cookie:login.cookie,body:{date:dateAt(3),after:'19:00',maxPrice:180000}})).body;
  assert.equal(quick.results[0].venueId,1);
  const forVenue = (await request('/quick',{cookie:login.cookie,body:{venueId:2,date:dateAt(3),duration:90}})).body;
  assert.equal(forVenue.results[0].venueId,2);
  assert.equal(forVenue.results[0].duration,90);
  const message = 'Tìm sân gần nhà tối mai, sau 7 giờ, giá dưới 200 nghìn';
  const incomplete = (await request('/chat',{body:{message}})).body;
  assert.equal(incomplete.results.length,0);
  assert.match(incomplete.reply,/vị trí/);
  const chat = (await request('/chat',{body:{message,origin:{lat:21.59,lng:105.82}}})).body;
  assert.equal(chat.mode,'demo');
  assert.equal(chat.criteria.after,'19:00');
  assert.equal(chat.criteria.maxPrice,199999);
  assert.ok(chat.results.length);
  for (const result of [quick.results[0],chat.results[0]]) {
    assert.equal((await request('/quote',{body:result})).body.amount,result.amount);
  }
  assert.equal((await request('/distances',{body:{lat:21.59,lng:105.82}})).body[0].type,'straight');
});

test('admin adds a verified venue, assigns a registered owner, and can add and close a court', async () => {
  const owner = await signUp(16);
  const other = await signUp(17);
  const admin = await request('/auth/login',{body:{login:'0900000000',password:adminPassword}});
  assert.equal(admin.body.role,'admin');
  const created = await request('/manage/venues',{cookie:admin.cookie,body:{name:'Cụm thử quản trị',area:'Thái Nguyên',
    address:'Địa chỉ kiểm tra',lat:21.6,lng:105.8,open:'07:00',close:'22:00',price:160000,ownerPhone:owner.body.phone,verified:true}});
  assert.equal(created.status,201);
  const id = created.body.id;
  assert.equal((await request('/manage/venues',{cookie:owner.cookie})).body[0].id,id);
  assert.equal((await request(`/manage/venues/${id}/courts`,{cookie:other.cookie,body:{name:'Sân Hải'}})).status,403);
  const court = (await request(`/manage/venues/${id}/courts`,{cookie:owner.cookie,body:{name:'Sân Hải'}})).body;
  assert.equal((await request(`/venues/${id}`)).body.courts.length,2);
  const closed = await request(`/manage/venues/${id}/courts/${court.id}`,{method:'PUT',cookie:owner.cookie,body:{active:false}});
  assert.equal(closed.body.active,false);
  assert.equal((await request(`/venues/${id}`)).body.courts.length,1);
});

test('disables a legacy demo administrator and retires existing sessions before setting a private password', async () => {
  const legacy = createDatabase(':memory:');
  try {
    legacy.prepare(`INSERT INTO users(id,name,name_key,phone,email,password,role)
      VALUES (1,'Quản trị','quan tri','0900000000','admin@sanvot.local',?,'admin')`).run(await passwordHash('SanVotDemo2026'));
    legacy.prepare('INSERT INTO sessions(id,user_id,expires) VALUES (?,1,?)').run('fixture', now() + 600);
    await seedAdmin(legacy, { demo:true });
    assert.equal(legacy.prepare('SELECT password FROM users WHERE id=1').get().password, '!');
    assert.equal(legacy.prepare('SELECT count(*) AS count FROM sessions').get().count, 0);
    await seedAdmin(legacy, { demo:true, adminPassword });
    assert.match(legacy.prepare('SELECT password FROM users WHERE id=1').get().password, /^[a-f0-9]+:[a-f0-9]+$/);
  } finally { legacy.close(); }
});

test('limits pending holds per account and lets the holder retry an existing order', async () => {
  const user = await signUp(18);
  const booking = { courtId: 1, date: dateAt(5), duration: 60, amount: demoHourlyPrice };
  for (const time of ['18:00', '19:00', '20:00']) {
    assert.equal((await request('/bookings', { cookie: user.cookie, body: { ...booking, time } })).status, 201);
  }
  assert.equal((await request('/bookings', { cookie: user.cookie, body: { ...booking, time: '21:00' } })).status, 429);
  assert.equal((await request('/bookings', { cookie: user.cookie, body: { ...booking, time: '18:00' } })).status, 201);
});

test('payOS webhook confirms only a signed matching payment and handles replays', async () => {
  const payos = {clientId:'fixture', apiKey:'fixture', checksumKey:'checksum-fixture-webhook'};
  const service = await createApp({demo:false,paymentMode:'payos',payos,database:':memory:',origin:'http://localhost:5173'});
  const live = service.app.listen(0,'127.0.0.1');
  await once(live,'listening');
  const endpoint = `http://127.0.0.1:${live.address().port}/api`;
  const post = (path, body, cookie) => fetch(endpoint + path,{ method:'POST', headers:{'Content-Type':'application/json',
    ...(cookie ? {Cookie:cookie} : {})},body:JSON.stringify(body) });
  try {
    const registration = await post('/auth/register',{name:'Khách thử webhook',phone:'0910001234',email:'pay-test@example.com',password:'valid-password-2'});
    const cookie = registration.headers.get('set-cookie').split(';')[0];
    const selection = {courtId:1,date:dateAt(4),time:'19:00',duration:60,amount:demoHourlyPrice};
    assert.equal((await post('/bookings',selection,cookie)).status,404);
    service.db.prepare('UPDATE venues SET verified=1 WHERE id=1').run();
    assert.equal((await post('/bookings',selection,cookie)).status,404);
    const { lastInsertRowid: courtId } = service.db.prepare("INSERT INTO courts(venue_id,name) VALUES (1,'Sân thật')").run();
    const order = await (await post('/bookings',{...selection,courtId},cookie)).json();
    const link = 'fixture-link-for-test';
    service.db.prepare('UPDATE bookings SET link_id=? WHERE id=?').run(link,order.id);
    const sdk = new PayOS(payos);
    const event = {orderCode:order.code, amount:selection.amount, description:'Sân Vợt thử',accountNumber:'1234',reference:'txn-local-1',
      transactionDateTime:'2026-11-22 01:00:00',currency:'VND',paymentLinkId:link,code:'00',desc:'success'};
    const send = async (data, signature) => post('/payments/payos/webhook',{code:'00',desc:'success',success:true,data,
      signature:signature ?? await sdk.crypto.createSignatureFromObj(data,payos.checksumKey)});
    assert.equal((await send(event,'invalid')).status,400);
    assert.equal((await send({...event,paymentLinkId:'wrong-link'})).status,200);
    assert.equal(service.db.prepare('SELECT status FROM bookings WHERE id=?').get(order.id).status,'pending');
    assert.equal((await send(event)).status,200);
    assert.equal((await send(event)).status,200);
    assert.equal(service.db.prepare('SELECT status FROM bookings WHERE id=?').get(order.id).status,'confirmed');
    assert.equal(service.db.prepare('SELECT count(*) AS total FROM payment_events').get().total,1);
    assert.equal((await send({...event, reference:'txn-local-2'})).status,200);
    assert.deepEqual({...service.db.prepare('SELECT status,payment_status FROM bookings WHERE id=?').get(order.id)},
      {status:'confirmed', payment_status:'review'});
  } finally {
    await new Promise((resolve) => live.close(resolve));
    service.db.close();
  }
});
