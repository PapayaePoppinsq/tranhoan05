export async function onRequest({ request, env }) {
  if (!env.BACKEND_ORIGIN) return Response.json({ error: 'Backend chưa được cấu hình.' }, { status: 503 });
  const url = new URL(request.url);
  const destination = new URL(url.pathname + url.search, env.BACKEND_ORIGIN);
  if (destination.protocol !== 'https:') return Response.json({ error: 'Địa chỉ backend không hợp lệ.' }, { status: 500 });
  return fetch(new Request(destination, request), { redirect: 'manual' });
}
