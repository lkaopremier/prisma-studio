const express = require('express')
const session = require('express-session')
const { createProxyMiddleware } = require('http-proxy-middleware')
const path = require('path')

const USER = process.env.AUTH_USER || 'admin'
const PASSWORD = process.env.AUTH_PASSWORD

if (!PASSWORD) {
  console.error('ERROR: AUTH_PASSWORD environment variable is required')
  process.exit(1)
}

const app = express()

app.use(express.urlencoded({ extended: false }))

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || PASSWORD,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
})

app.use(sessionMiddleware)

app.get('/auth/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/')
  res.sendFile(path.join(__dirname, 'login.html'))
})

app.post('/auth/login', (req, res) => {
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

app.use((req, res, next) => {
  if (!req.session.authenticated) return res.redirect('/auth/login')
  next()
})

const proxy = createProxyMiddleware({
  target: 'http://localhost:5555',
  changeOrigin: true,
  ws: true,
})

app.use('/', proxy)

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
