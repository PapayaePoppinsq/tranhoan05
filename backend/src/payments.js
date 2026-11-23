import { PayOS } from '@payos/node';
import { bookingSelect, HttpError, now, recordPayment, showBooking } from './domain.js';

function payosFailure(error) {
  return {
    type: typeof error?.name === 'string' && /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'Error',
    status: Number.isInteger(error?.status) ? error.status : null,
    code: typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(error.code) ? error.code : null,
  };
}

export function createPayments(db, config, providedClient) {
  // Keep webhook verification available while new bookings stay closed during setup.
  const credentials = Object.fromEntries(Object.entries(config.payos || {})
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
  const client = providedClient ?? (config.payos && Object.values(credentials).every(Boolean)
    ? new PayOS(credentials) : null);
  const inProgress = new Map();

  async function createLink(row) {
    const callback = new URL(`/thanh-toan/${row.id}`, config.origin).href;
    let link;
    try {
      link = await client.paymentRequests.create({ orderCode: row.code, amount: row.amount,
        description: String(row.code).slice(-9), returnUrl: callback, cancelUrl: callback, expiredAt: row.hold_until },
      { timeout: 10000, maxRetries: 0 });
    } catch (createError) {
      console.warn('payOS create link failed', payosFailure(createError));
      try {
        const existing = await client.paymentRequests.get(row.code, { timeout: 8000, maxRetries: 0 });
        if (!existing?.id || existing.orderCode !== row.code || existing.amount !== row.amount) throw new Error();
        link = { paymentLinkId: existing.id, checkoutUrl: `https://pay.payos.vn/web/${encodeURIComponent(existing.id)}` };
      } catch (lookupError) {
        console.warn('payOS lookup link failed', payosFailure(lookupError));
        if (createError?.name === 'InvalidSignatureError' || lookupError?.name === 'InvalidSignatureError') {
          throw new HttpError(502, 'Không xác minh được phản hồi payOS. Quản trị viên cần kiểm tra Checksum Key.');
        }
        if ([401,403].includes(createError?.status) || [401,403].includes(lookupError?.status)) {
          throw new HttpError(502, 'Kênh payOS chưa xác thực được. Quản trị viên cần kiểm tra Client ID và API Key.');
        }
        if (createError?.status === 400) {
          throw new HttpError(502, 'payOS từ chối thông tin đơn thanh toán. Quản trị viên cần kiểm tra cấu hình kênh.');
        }
        throw new HttpError(502, 'Chưa kết nối được payOS. Hãy thử lại sau ít phút.');
      }
    }
    const url = new URL(link.checkoutUrl);
    if (!link.paymentLinkId || url.protocol !== 'https:' || url.hostname !== 'pay.payos.vn') {
      throw new HttpError(502, 'Liên kết thanh toán không hợp lệ.');
    }
    const qrPayload = typeof link.qrCode === 'string' && /^000201[\x20-\x7e]{14,1994}$/.test(link.qrCode)
      ? link.qrCode : null;
    db.prepare('UPDATE bookings SET link_id=?, checkout=?, qr_payload=? WHERE id=?')
      .run(link.paymentLinkId, url.href, qrPayload, row.id);
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
