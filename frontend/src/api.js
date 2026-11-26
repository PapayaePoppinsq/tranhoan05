import { useEffect, useState } from 'react';

export async function api(path, { body, signal, method = body === undefined ? 'GET' : 'POST' } = {}) {
  let response;
  try {
    response = await fetch(path.startsWith('/upload-') ? path : `/api${path}`, {
      method, signal, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Không kết nối được máy chủ. Hãy thử lại.');
  }
  let data;
  try { data = await response.json(); }
  catch (error) {
    if (signal?.aborted) throw error;
    if (response.ok) throw new Error(response.headers.get('content-type')?.includes('text/html')
      ? 'Trang web chưa kết nối API. Cần triển khai backend để đăng nhập và đặt sân.'
      : 'Máy chủ trả về dữ liệu không hợp lệ. Hãy thử lại.');
  }
  if (!response.ok) {
    const error = new Error(data?.error || 'Máy chủ chưa xử lý được yêu cầu.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function useApi(path, revision = 0) {
  const key = `${path}:${revision}`;
  const [state, setState] = useState({ key: null, value: null, error: '', loading: false });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api(path, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setState({ key, value, error: '', loading: false });
    },
      (error) => { if (!controller.signal.aborted) setState({ key, value: null, error: error.message, status:error.status, loading: false }); });
    return () => controller.abort();
  }, [path, key]);
  return path && state.key === key ? state : { value: null, error: '', loading: Boolean(path) };
}

export function useCatalog(enabled) {
  const [state, setState] = useState({ value: null, error: '', loading: true });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/catalog.json', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Không tải được danh bạ sân.');
      const value = await response.json();
      if (!Array.isArray(value)) throw new Error('Danh bạ sân không hợp lệ.');
      if (!controller.signal.aborted) setState({ value, error: '', loading: false });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ value: null, error: error.message, loading: false });
    });
    return () => controller.abort();
  }, [enabled]);
  return enabled ? state : { value: null, error: '', loading: false };
}

export const today = (offset = 0) => new Date(Date.now() + (7 + offset * 24) * 3600000).toISOString().slice(0, 10);
export function isBookingDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today() || value > today(30)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const dollars = Intl.NumberFormat('vi-VN', { style:'currency', currency:'VND' });
export const money = (value) => dollars.format(value);
export const longDate = (date) => date ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', dateStyle:'full' })
  .format(new Date(`${date}T12:00:00Z`)) : '';
export const sameText = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ','d');
export const bookingStatus = { pending:'Chờ thanh toán', confirmed:'Đã đặt', expired:'Hết hạn giữ chỗ', review:'Cần đối soát' };

export function reviewUrl(result) {
  const query = new URLSearchParams({ courtId: result.courtId, date: result.date, time: result.time, duration: result.duration });
  if (result.venueId) query.set('venue', result.venueId);
  return `/xem-lai?${query}`;
}

export function detailsUrl(venueId, date, after) {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (after) params.set('time', after);
  return `/san/${venueId}${params.size ? `?${params}` : ''}`;
}
