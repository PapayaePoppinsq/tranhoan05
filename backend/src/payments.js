import { PayOS } from '@payos/node';
import { bookingSelect, HttpError, now, recordPayment, showBooking } from './domain.js';

export function createPayments(db, config) {
  // Keep webhook verification available while new bookings stay closed during setup.
  const client = config.payos && Object.values(config.payos).every(Boolean) ? new PayOS(config.payos) : null;
  const inProgress = new Map();

  async function createLink(row) {
    const callback = new URL(`/thanh-toan/${row.id}`, config.origin).href;
    let link;
    try {
      link = await client.paymentRequests.create({ orderCode: row.code, amount: row.amount,
        description: `SV${String(row.code).slice(-12)}`, returnUrl: callback, cancelUrl: callback, expiredAt: row.hold_until },
      { timeout: 6000, maxRetries: 0 });
    } catch {
      try {
        const existing = await client.paymentRequests.get(row.code, { timeout: 5000, maxRetries: 0 });
        if (!existing?.id || existing.orderCode !== row.code || existing.amount !== row.amount) throw new Error();
        link = { paymentLinkId: existing.id, checkoutUrl: `https://pay.payos.vn/web/${encodeURIComponent(existing.id)}` };
      } catch { throw new HttpError(502, 'Chưa tạo được liên kết thanh toán. Hãy thử lại.'); }
    }
    const url = new URL(link.checkoutUrl);
    if (!link.paymentLinkId || url.protocol !== 'https:' || url.hostname !== 'pay.payos.vn') {
      throw new HttpError(502, 'Liên kết thanh toán không hợp lệ.');
    }
    db.prepare('UPDATE bookings SET link_id=?, checkout=? WHERE id=?').run(link.paymentLinkId, url.href, row.id);
  }

  return {
    async start(row) {
      if (row.status !== 'pending' || row.hold_until <= now()) {
        throw new HttpError(409, 'Đơn này không còn chờ thanh toán.');
      }
      if (row.provider === 'payos' && !row.checkout) {
        if (!client) throw new HttpError(503, 'payOS chưa được cấu hình.');
        if (!inProgress.has(row.id)) inProgress.set(row.id, createLink(row).finally(() => inProgress.delete(row.id)));
        await inProgress.get(row.id);
      }
      return showBooking(db.prepare(`${bookingSelect} WHERE b.id=?`).get(row.id));
    },
    webhook: async (body) => {
      if (!client) throw new HttpError(404, 'Webhook chưa được bật.');
      let data;
      try { data = await client.webhooks.verify(body); }
      catch { throw new HttpError(400, 'Chữ ký webhook không hợp lệ.'); }
      if (data.code !== '00' || !data.reference || !Number.isSafeInteger(data.amount) || data.amount <= 0) return;
      // payOS sends a signed sample during webhook setup. Unknown order codes do not affect bookings.
      const row = db.prepare("SELECT * FROM bookings WHERE code=? AND provider='payos'").get(data.orderCode);
      if (!row) return;
      if (!row.link_id) throw new HttpError(503, 'Yêu cầu thanh toán đang được lưu.');
      if (data.paymentLinkId !== row.link_id || (data.currency && data.currency !== 'VND')) return;
      recordPayment(db, { bookingId: row.id, eventId: `payos:${row.link_id}:${data.reference}`,
        amount: data.amount, addAmount: true });
    },
  };
}
