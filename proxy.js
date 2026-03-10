const express = require('express')
const { createProxyMiddleware } = require('http-proxy-middleware')

const USER = process.env.AUTH_USER || 'admin'
const PASSWORD = process.env.AUTH_PASSWORD

if (!PASSWORD) {
  console.error('ERROR: AUTH_PASSWORD environment variable is required')
  process.exit(1)
}

const app = express()

app.use((req, res, next) => {
  const auth = req.headers.authorization

  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Prisma Studio"')
    return res.status(401).send('Unauthorized')
  }

  const decoded = Buffer.from(auth.slice(6), 'base64').toString()
  const colon = decoded.indexOf(':')
  const user = decoded.slice(0, colon)
  const pass = decoded.slice(colon + 1)

  if (user !== USER || pass !== PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Prisma Studio"')
    return res.status(401).send('Unauthorized')
  }

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

server.on('upgrade', proxy.upgrade)
