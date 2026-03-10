const express = require('express')
const session = require('express-session')
const rateLimit = require('express-rate-limit')
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware')
const { exec } = require('child_process')
const http = require('http')
const path = require('path')

const USER = process.env.AUTH_USER || 'admin'
const PASSWORD = process.env.AUTH_PASSWORD
const SESSION_SECRET = process.env.SESSION_SECRET

if (!PASSWORD) {
  console.error('ERROR: AUTH_PASSWORD environment variable is required')
  process.exit(1)
}

if (!SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET not set — set a dedicated secret for production')
}

const app = express()
app.set('trust proxy', 1)
app.use(express.urlencoded({ extended: false }))

const sessionMiddleware = session({
  secret: SESSION_SECRET || PASSWORD,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIE === 'true',
  },
})

app.use(sessionMiddleware)

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
})

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }))

app.get('/auth/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/')
  res.sendFile(path.join(__dirname, 'login.html'))
})

app.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body
  if (username === USER && password === PASSWORD) {
    req.session.authenticated = true
    return res.redirect('/')
  }
  res.redirect('/auth/login?error=1')
})

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'))
})

app.post('/auth/refresh', (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' })
  exec('npx prisma db pull', { cwd: '/app' }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message })
    res.json({ ok: true, output: stdout })
  })
})

app.use((req, res, next) => {
  if (!req.session.authenticated) return res.redirect('/auth/login')
  next()
})

const LOGOUT_BAR = `
<div id="__proxy_bar" style="position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;align-items:center;justify-content:space-between;padding:6px 16px;background:#18181b;border-bottom:1px solid #27272a;font-family:-apple-system,sans-serif;font-size:13px;color:#71717a;gap:12px;">
  <span style="display:flex;align-items:center;gap:8px;">
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="6" fill="#5b21b6"/><path d="M10 8h8a6 6 0 0 1 0 12H10V8z" fill="white" opacity="0.9"/><path d="M10 20h5l5 4H10v-4z" fill="white" opacity="0.5"/></svg>
    Prisma Studio
  </span>
  <div style="display:flex;gap:8px;">
    <button onclick="fetch('/auth/refresh',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok)location.reload();else alert(d.error)})" style="padding:4px 12px;background:#27272a;color:#e2e2e6;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;">Refresh schema</button>
    <a href="/auth/logout" style="padding:4px 12px;background:#27272a;color:#e2e2e6;text-decoration:none;border-radius:6px;font-size:12px;font-weight:500;">Sign out</a>
  </div>
</div>
<style>body { padding-top: 37px !important; } #__proxy_bar button:hover, #__proxy_bar a:hover { background: #3f3f46 !important; }</style>
`

const proxy = createProxyMiddleware({
  target: 'http://localhost:5555',
  changeOrigin: true,
  selfHandleResponse: true,
  on: {
    proxyRes: responseInterceptor(async (buffer, proxyRes) => {
      const type = proxyRes.headers['content-type'] || ''
      if (type.includes('text/html')) {
        const html = buffer.toString('utf8')
        return html.includes('</body>')
          ? html.replace('</body>', `${LOGOUT_BAR}</body>`)
          : html + LOGOUT_BAR
      }
      return buffer
    }),
  },
})

app.use('/', proxy)

function waitForStudio(retries = 30, delay = 1000) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const req = http.get('http://localhost:5555', (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (remaining <= 0) return reject(new Error('Prisma Studio did not start in time'))
        setTimeout(() => attempt(remaining - 1), delay)
      })
      req.end()
    }
    attempt(retries)
  })
}

console.log('Waiting for Prisma Studio to be ready...')
waitForStudio()
  .then(() => {
    const port = parseInt(process.env.PORT || '3000', 10)
    const server = app.listen(port, () => {
      console.log(`Auth proxy listening on port ${port}`)
    })

    server.on('upgrade', (req, socket, head) => {
      sessionMiddleware(req, {}, () => {
        if (!req.session?.authenticated) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }
        proxy.upgrade(req, socket, head)
      })
    })
  })
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
