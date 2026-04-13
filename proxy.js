const express = require('express')
const session = require('express-session')
const rateLimit = require('express-rate-limit')
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware')
const { exec, spawn } = require('child_process')
const http = require('http')
const path = require('path')
const crypto = require('crypto')

// ─── Config ───────────────────────────────────────────────────────────────────

const USER = process.env.AUTH_USER || 'admin'
const PASSWORD = process.env.AUTH_PASSWORD
const SESSION_SECRET = process.env.SESSION_SECRET
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || String(8 * 60 * 60 * 1000), 10)
const PUBLIC_PORT = parseInt(process.env.PORT || '3000', 10)

if (!PASSWORD) {
  console.error('ERROR: AUTH_PASSWORD environment variable is required')
  process.exit(1)
}
if (!SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET not set — set a dedicated secret for production')
}

// ─── Database parsing ─────────────────────────────────────────────────────────

function detectProvider(url) {
  if (/^postgres(ql)?:\/\//.test(url)) return 'postgresql'
  if (url.startsWith('mysql://')) return 'mysql'
  if (url.startsWith('sqlserver://')) return 'sqlserver'
  if (/^mongodb(\+srv)?:\/\//.test(url)) return 'mongodb'
  if (url.startsWith('file:')) return 'sqlite'
  return process.env.DATABASE_PROVIDER || 'postgresql'
}

function extractDbName(url) {
  if (url.startsWith('sqlserver://')) {
    const match = url.match(/[;?]database=([^;&#]+)/i)
    return match ? match[1] : 'Database'
  }
  if (url.startsWith('file:')) {
    const filepath = url.slice(5).trim()
    const filename = filepath.split('/').pop() || filepath
    return filename.replace(/\.[^.]+$/, '') || 'Database'
  }
  const withoutQuery = url.split(/[?#]/)[0]
  const segment = withoutQuery.split('/').filter(Boolean).pop()
  return segment || 'Database'
}

function parseDatabases() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    console.error('ERROR: DATABASE_URL environment variable is required.')
    process.exit(1)
  }
  const entries = raw.split('|').map((s) => s.trim()).filter(Boolean)
  if (entries.length === 0) {
    console.error('ERROR: DATABASE_URL is empty.')
    process.exit(1)
  }
  return entries.map((entry, i) => {
    // Support "Label::url" format
    const sep = entry.indexOf('::')
    const label = sep !== -1 ? entry.slice(0, sep).trim() : null
    const url = sep !== -1 ? entry.slice(sep + 2).trim() : entry
    const provider = detectProvider(url)
    return {
      name: label || extractDbName(url),
      url,
      provider,
      port: PUBLIC_PORT + 10001 + i,
      index: i + 1,
    }
  })
}

const databases = parseDatabases()
console.log(`Configured databases: ${databases.map((db) => `${db.name} (${db.provider})`).join(', ')}`)

// ─── Studio management ────────────────────────────────────────────────────────

let shuttingDown = false
const studioProcesses = new Map()

function launchStudio(db) {
  if (shuttingDown) return
  const proc = spawn(
    'npx',
    [
      'prisma', 'studio',
      `--schema=/app/prisma/db_${db.index}/schema.prisma`,
      `--port=${db.port}`,
      '--browser=none',
    ],
    { env: { ...process.env, DATABASE_URL: db.url }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  proc.stdout.on('data', (d) => process.stdout.write(`[${db.name}] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[${db.name}] ${d}`))
  studioProcesses.set(db.index, proc)
  proc.on('exit', (code, signal) => {
    if (shuttingDown || signal === 'SIGTERM' || signal === 'SIGKILL') return
    console.warn(`Studio "${db.name}" exited (code ${code}). Restarting in 3s...`)
    setTimeout(() => launchStudio(db), 3000)
  })
}

databases.forEach((db) => launchStudio(db))

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express()
app.set('trust proxy', 1)
app.use(express.urlencoded({ extended: false }))

app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

const sessionMiddleware = session({
  secret: SESSION_SECRET || PASSWORD,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIE === 'true',
    maxAge: SESSION_MAX_AGE,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSelectedIdx(req) {
  const idx = req.session?.selectedDb ?? 0
  return Math.max(0, Math.min(idx, databases.length - 1))
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function requireAuth(req, res, next) {
  if (!req.session.authenticated) return res.redirect('/auth/login')
  next()
}

function csrfProtect(req, res, next) {
  const token = req.body._csrf || req.headers['x-csrf-token']
  if (!token || token !== req.session.csrfToken) return res.status(403).send('Forbidden')
  next()
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => { res.resume(); resolve(true) })
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
    req.end()
  })
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/healthz', async (_req, res) => {
  const checks = await Promise.all(
    databases.map(async (db) => ({
      name: db.name,
      provider: db.provider,
      healthy: await checkPort(db.port),
    }))
  )
  const allHealthy = checks.every((c) => c.healthy)
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    databases: checks,
  })
})

app.use('/public', express.static(path.join(__dirname, 'public')))

app.get('/auth/login', (req, res) => {
  if (req.session.authenticated) return res.redirect(databases.length > 1 ? '/select' : '/')
  res.sendFile(path.join(__dirname, 'login.html'))
})

app.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body
  if (username === USER && password === PASSWORD) {
    req.session.authenticated = true
    req.session.selectedDb = 0
    req.session.csrfToken = crypto.randomBytes(24).toString('hex')
    return res.redirect(databases.length > 1 ? '/select' : '/')
  }
  res.redirect('/auth/login?error=1')
})

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'))
})

app.post('/auth/switch-db', requireAuth, csrfProtect, (req, res) => {
  const idx = parseInt(req.body.db, 10)
  if (!Number.isNaN(idx) && idx >= 0 && idx < databases.length) {
    req.session.selectedDb = idx
  }
  res.redirect('/')
})

app.post('/auth/refresh', requireAuth, csrfProtect, (req, res) => {
  const idx = Math.min(req.session.selectedDb ?? 0, databases.length - 1)
  const db = databases[idx]
  exec(
    `npx prisma db pull --schema="/app/prisma/db_${db.index}/schema.prisma"`,
    { cwd: '/app', env: { ...process.env, DATABASE_URL: db.url } },
    (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message })
      res.json({ ok: true, output: stdout })
    }
  )
})

app.get('/select', requireAuth, (req, res) => {
  res.send(buildSelectPage(req))
})

app.use(requireAuth)

// ─── UI components ────────────────────────────────────────────────────────────

const PRISMA_LOGO_SM = `<svg width="16" height="16" viewBox="0 0 64 64" fill="none"><path d="M18 22.3488C18 19.3948 20.3948 17 23.3488 17H58.6512C61.6052 17 64 19.3948 64 22.3488V57.6512C64 60.6052 61.6052 63 58.6512 63H23.3488C20.3948 63 18 60.6052 18 57.6512V22.3488Z" fill="#9F6BF4"/><path d="M0 6.34884C0 3.39476 2.39476 1 5.34884 1H40.6512C43.6052 1 46 3.39476 46 6.34884V41.6512C46 44.6052 43.6052 47 40.6512 47H5.34884C2.39476 47 0 44.6052 0 41.6512V6.34884Z" fill="#C9D3DB"/><path d="M46 17V41.7059C46 44.6297 43.5892 47 40.6154 47H18V22.2941C18 19.3703 20.4108 17 23.3846 17H46Z" fill="#8044E2"/></svg>`

const PRISMA_LOGO_LG = `<svg width="32" height="32" viewBox="0 0 64 64" fill="none"><path d="M18 22.3488C18 19.3948 20.3948 17 23.3488 17H58.6512C61.6052 17 64 19.3948 64 22.3488V57.6512C64 60.6052 61.6052 63 58.6512 63H23.3488C20.3948 63 18 60.6052 18 57.6512V22.3488Z" fill="#9F6BF4"/><path d="M0 6.34884C0 3.39476 2.39476 1 5.34884 1H40.6512C43.6052 1 46 3.39476 46 6.34884V41.6512C46 44.6052 43.6052 47 40.6512 47H5.34884C2.39476 47 0 44.6052 0 41.6512V6.34884Z" fill="#C9D3DB"/><path d="M46 17V41.7059C46 44.6297 43.5892 47 40.6154 47H18V22.2941C18 19.3703 20.4108 17 23.3846 17H46Z" fill="#8044E2"/></svg>`

function buildSelectPage(req) {
  const csrf = escapeHtml(req.session.csrfToken || '')
  const cards = databases.map((db, i) => `
    <div class="card" data-db="${escapeHtml(db.name)}">
      <div class="card-top">
        <div class="card-name">${escapeHtml(db.name)}</div>
        <span class="badge p-${escapeHtml(db.provider)}">${escapeHtml(db.provider)}</span>
      </div>
      <div class="status">
        <div class="dot"></div>
        <span class="status-text">Checking…</span>
      </div>
      <form method="POST" action="/auth/switch-db">
        <input type="hidden" name="db" value="${i}" />
        <input type="hidden" name="_csrf" value="${csrf}" />
        <button type="submit" class="open-btn">Open</button>
      </form>
    </div>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Prisma Studio — Select a database</title>
  <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#09090b;color:#e2e2e6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px}
    .brand{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:22px;font-weight:700;color:#f4f4f5}
    .subtitle{color:#71717a;font-size:14px;margin-bottom:48px;text-align:center}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;width:100%;max-width:840px}
    .card{background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:14px;transition:border-color .15s,box-shadow .15s}
    .card:hover{border-color:#7c3aed;box-shadow:0 0 0 1px #7c3aed22}
    .card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
    .card-name{font-size:15px;font-weight:600;color:#f4f4f5;word-break:break-word;line-height:1.4}
    .badge{font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;white-space:nowrap;text-transform:uppercase;letter-spacing:.05em;flex-shrink:0;margin-top:2px}
    .p-postgresql{background:#1e3a5f;color:#60a5fa}
    .p-mysql{background:#1a3a2a;color:#4ade80}
    .p-sqlserver{background:#3b1a1a;color:#f87171}
    .p-mongodb{background:#1a3a1a;color:#86efac}
    .p-sqlite{background:#2d2a1a;color:#fde68a}
    .status{display:flex;align-items:center;gap:7px;font-size:12px;color:#71717a}
    .dot{width:7px;height:7px;border-radius:50%;background:#3f3f46;flex-shrink:0;transition:background .3s}
    .dot.ok{background:#22c55e}
    .dot.error{background:#ef4444}
    .open-btn{width:100%;padding:9px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s;margin-top:2px}
    .open-btn:hover{background:#6d28d9}
    .sign-out{position:fixed;top:20px;right:20px;font-size:12px;color:#52525b;text-decoration:none;transition:color .15s}
    .sign-out:hover{color:#a1a1aa}
    .db-count{color:#52525b;font-size:12px;margin-top:-36px;margin-bottom:48px}
  </style>
</head>
<body>
  <div class="brand">${PRISMA_LOGO_LG} Prisma Studio</div>
  <p class="subtitle">Select a database to explore</p>
  ${databases.length > 1 ? `<p class="db-count">${databases.length} databases configured</p>` : ''}
  <div class="grid">${cards}</div>
  <a href="/auth/logout" class="sign-out">Sign out</a>
  <script>
    async function refreshStatus() {
      try {
        const d = await fetch('/healthz').then(r => r.json())
        d.databases.forEach(({ name, healthy }) => {
          const card = document.querySelector('[data-db="' + name.replace(/"/g, '\\"') + '"]')
          if (!card) return
          card.querySelector('.dot').className = 'dot ' + (healthy ? 'ok' : 'error')
          card.querySelector('.status-text').textContent = healthy ? 'Online' : 'Offline'
        })
      } catch (_) {}
    }
    refreshStatus()
    setInterval(refreshStatus, 8000)
  </script>
</body>
</html>`
}

function buildLogoutBar(selectedIdx, csrfToken) {
  const csrf = escapeHtml(csrfToken || '')
  let dbSection
  if (databases.length === 1) {
    dbSection = `<span style="padding:3px 10px;background:#27272a;color:#a1a1aa;border-radius:6px;font-size:12px;">${escapeHtml(databases[0].name)}</span>`
  } else {
    const options = databases
      .map((db, i) => `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escapeHtml(db.name)}</option>`)
      .join('')
    dbSection = `
      <form method="POST" action="/auth/switch-db" style="display:inline;margin:0;">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <select name="db" onchange="this.form.submit()" style="padding:3px 8px;background:#27272a;color:#e2e2e6;border:1px solid #3f3f46;border-radius:6px;font-size:12px;cursor:pointer;outline:none;">${options}</select>
      </form>
      <a href="/select" style="padding:4px 10px;background:#27272a;color:#a1a1aa;text-decoration:none;border-radius:6px;font-size:12px;">All DBs</a>`
  }

  return `
<div id="__proxy_bar" style="z-index:99999;display:flex;align-items:center;justify-content:space-between;padding:6px 16px;background:#18181b;border-bottom:1px solid #27272a;font-family:-apple-system,sans-serif;font-size:13px;color:#71717a;gap:12px;">
  <span style="display:flex;align-items:center;gap:8px;">${PRISMA_LOGO_SM}Prisma Studio</span>
  <div style="display:flex;align-items:center;gap:8px;">${dbSection}</div>
  <div style="display:flex;gap:8px;">
    <button onclick="fetch('/auth/refresh',{method:'POST',headers:{'X-CSRF-Token':'${csrf}'}}).then(r=>r.json()).then(d=>{if(d.ok)location.reload();else alert(d.error)})" style="padding:4px 12px;background:#27272a;color:#e2e2e6;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;">Refresh schema</button>
    <a href="/auth/logout" style="padding:4px 12px;background:#27272a;color:#e2e2e6;text-decoration:none;border-radius:6px;font-size:12px;font-weight:500;">Sign out</a>
  </div>
</div>
<style>#root{height:calc(100vh - 37px)}#__proxy_bar button:hover,#__proxy_bar a:hover{background:#3f3f46!important}</style>
`
}

function buildErrorPage(db) {
  const switchLinks = databases.length > 1
    ? `<p style="margin-top:16px;font-size:13px;color:#71717a;">
        <a href="/select" style="color:#7c3aed;text-decoration:none;">Switch to another database</a>
       </p>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Studio Offline</title>
  <style>
    body{background:#09090b;color:#e2e2e6;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{text-align:center;padding:40px}
    .dot{width:12px;height:12px;border-radius:50%;background:#ef4444;display:inline-block;margin-bottom:24px}
    h1{font-size:20px;font-weight:600;margin-bottom:8px}
    p{color:#71717a;font-size:14px}
    .badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;background:#27272a;color:#a1a1aa;margin-top:8px}
    button{margin-top:24px;padding:8px 20px;background:#27272a;color:#e2e2e6;border:none;border-radius:8px;font-size:13px;cursor:pointer}
    button:hover{background:#3f3f46}
  </style>
</head>
<body>
  <div class="box">
    <div class="dot"></div>
    <h1>Studio is offline</h1>
    <p>The Prisma Studio instance for <strong>${escapeHtml(db.name)}</strong> is not responding.</p>
    <div class="badge">${escapeHtml(db.provider)}</div>
    ${switchLinks}
    <br/>
    <button onclick="location.reload()">Retry</button>
  </div>
</body>
</html>`
}

// ─── Proxy ────────────────────────────────────────────────────────────────────

const proxy = createProxyMiddleware({
  changeOrigin: true,
  selfHandleResponse: true,
  router: (req) => `http://localhost:${databases[getSelectedIdx(req)].port}`,
  on: {
    error: (_err, req, res) => {
      res.status(502).send(buildErrorPage(databases[getSelectedIdx(req)]))
    },
    proxyRes: responseInterceptor(async (buffer, proxyRes, req) => {
      const type = proxyRes.headers['content-type'] || ''
      if (type.includes('text/html')) {
        const bar = buildLogoutBar(getSelectedIdx(req), req.session?.csrfToken)
        const html = buffer.toString('utf8')
        return html.includes('</body>')
          ? html.replace('</body>', `${bar}</body>`)
          : html + bar
      }
      return buffer
    }),
  },
})

app.use('/', proxy)

// ─── Start ────────────────────────────────────────────────────────────────────

function waitForPort(port, retries = 30, delay = 1000) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const req = http.get(`http://localhost:${port}`, (res) => { res.resume(); resolve() })
      req.on('error', () => {
        if (remaining <= 0) return reject(new Error(`Studio on port ${port} did not start in time`))
        setTimeout(() => attempt(remaining - 1), delay)
      })
      req.end()
    }
    attempt(retries)
  })
}

console.log('Waiting for Prisma Studio instances to be ready...')
Promise.all(databases.map((db) => waitForPort(db.port)))
  .then(() => {
    const server = app.listen(PUBLIC_PORT, () => {
      console.log(`Auth proxy listening on port ${PUBLIC_PORT}`)
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

    function gracefulShutdown() {
      if (shuttingDown) return
      shuttingDown = true
      console.log('Shutting down...')
      studioProcesses.forEach((proc) => proc.kill('SIGTERM'))
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(1), 10000)
    }
    process.on('SIGTERM', gracefulShutdown)
    process.on('SIGINT', gracefulShutdown)
  })
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
