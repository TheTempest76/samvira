/** Minimal guard for operator endpoints. Prototype-grade: a shared PIN sent as a header. */
export function adminAllowed(req: Request) {
  const pin = process.env.ADMIN_PIN;
  if (!pin) return true;
  return req.headers.get('x-admin-pin') === pin;
}
export const forbidden = () => Response.json({ error: 'admin PIN required' }, { status: 401 });
