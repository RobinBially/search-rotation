import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Hono, Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
export interface SecurityOptions {
    token: string;
    origin: string;
    additionalOrigins?: string[];
    dashboardEnabled?: boolean;
}
const COOKIE = 'sr_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const publicFiles = new Set(['/app.js', '/i18n.js', '/style.css']);
function equal(a: string, b: string): boolean {
    const left = Buffer.from(a), right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
export function mountSecurity(app: Hono, options: SecurityOptions) {
    const origins = [...new Set([options.origin, ...(options.additionalOrigins ?? [])].map(o => new URL(o).origin))];
    const allowedHosts = origins.map(o => new URL(o).host);
    const tickets = new Map<string, number>();
    const sessions = new Map<string, number>();
    const failures: number[] = [];
    const prune = (map: Map<string, number>) => { for (const [key, expiry] of map)
        if (expiry <= Date.now())
            map.delete(key); };
    const session = (c: Context) => {
        prune(sessions);
        if (sessions.size >= 100)
            sessions.delete(sessions.keys().next().value!);
        const id = randomBytes(32).toString('base64url');
        sessions.set(id, Date.now() + SESSION_MS);
        setCookie(c, COOKIE, id, { httpOnly: true, sameSite: 'Strict', secure: new URL(options.origin).protocol === 'https:', path: '/', maxAge: SESSION_MS / 1000 });
        return c.redirect('/', 303);
    };
    app.use('*', async (c, next) => {
        c.header('Referrer-Policy', 'no-referrer');
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('X-Frame-Options', 'DENY');
        c.header('Cache-Control', 'no-store');
        const url = new URL(c.req.url);
        const host = c.req.header('host') ?? url.host;
        if (!allowedHosts.includes(host) || !allowedHosts.includes(url.host))
            return c.text('Host nicht erlaubt', 403);
        const origin = c.req.header('origin');
        if (origin && !origins.includes(origin))
            return c.text('Origin nicht erlaubt', 403);
        if (c.req.header('sec-fetch-site') === 'cross-site')
            return c.text('Cross-site request nicht erlaubt', 403);
        await next();
    });
    app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ error: 'Request zu groß (max. 64 KiB)' }, 413) }));
    app.use('*', async (c, next) => {
        const pathname = c.req.path;
        if (options.dashboardEnabled === false && pathname !== '/mcp')
            return c.notFound();
        if (pathname === '/login' || publicFiles.has(pathname))
            return next();
        if (options.token) {
            const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
            prune(sessions);
            // MCP remains bearer-only; browser sessions authorize dashboard APIs.
            const validSession = pathname !== '/mcp' && sessions.has(getCookie(c, COOKIE) ?? '');
            if (!equal(bearer, options.token) && !validSession) {
                if (pathname === '/')
                    return c.redirect('/login', 303);
                return c.json({ error: 'Anmeldung erforderlich', login: '/login' }, 401);
            }
        }
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && (pathname.startsWith('/api/') || pathname === '/mcp')) {
            const type = c.req.header('content-type')?.split(';')[0].trim().toLowerCase();
            // DELETE without a body does not need a media type.
            if (c.req.method !== 'DELETE' && type !== 'application/json')
                return c.json({ error: 'application/json erforderlich' }, 415);
        }
        await next();
    });
    app.get('/login', c => {
        if (!options.token)
            return c.redirect('/', 303);
        const ticket = c.req.query('ticket');
        if (ticket) {
            prune(tickets);
            if (!tickets.delete(ticket))
                return c.text('Anmeldelink abgelaufen oder bereits verwendet', 401);
            return session(c);
        }
        return c.html('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>search-rotation Anmeldung</title><body><main><h1>search-rotation</h1><p>Mit dem konfigurierten Server-Token anmelden.</p><form method="post" action="/login"><label>Token <input type="password" name="token" required autocomplete="current-password" maxlength="4096"></label> <button>Anmelden</button></form></main></body></html>');
    });
    app.post('/login', async (c) => {
        if (!options.token)
            return c.redirect('/', 303);
        if (!c.req.header('origin') || !origins.includes(c.req.header('origin')!))
            return c.text('Origin erforderlich', 403);
        if (c.req.header('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded')
            return c.text('Formular erwartet', 415);
        while (failures.length && failures[0] < Date.now() - 60000)
            failures.shift();
        if (failures.length >= 10)
            return c.text('Zu viele Anmeldeversuche. In einer Minute erneut versuchen.', 429);
        const body = await c.req.parseBody();
        if (typeof body.token !== 'string' || !equal(body.token, options.token)) {
            failures.push(Date.now());
            return c.text('Token falsch', 401);
        }
        return session(c);
    });
    return {
        allowedHosts, allowedOrigins: origins,
        browserUrl: () => {
            if (!options.token)
                return options.origin + '/';
            prune(tickets);
            if (tickets.size >= 20)
                tickets.delete(tickets.keys().next().value!);
            const ticket = randomBytes(32).toString('base64url');
            tickets.set(ticket, Date.now() + 60000);
            return options.origin + '/login?ticket=' + ticket;
        },
    };
}
