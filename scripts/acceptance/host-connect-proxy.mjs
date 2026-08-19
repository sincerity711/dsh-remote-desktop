#!/usr/bin/env node
import http from 'node:http'
import net from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const ollamaOrigin = new URL(process.env.DSH_RD_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434')

const server = http.createServer((clientReq, clientRes) => {
  let target
  try {
    target = clientReq.url.startsWith('/v1/') ? new URL(clientReq.url, ollamaOrigin) : new URL(clientReq.url)
  } catch {
    clientRes.writeHead(400)
    clientRes.end('absolute URL or /v1/ Ollama path required')
    return
  }
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest
  const headers = clientReq.url.startsWith('/v1/') ? { ...clientReq.headers, host: ollamaOrigin.host } : clientReq.headers
  const upstream = request(target, { method: clientReq.method, headers }, upstreamRes => {
    clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
    upstreamRes.on('error', () => clientRes.destroy())
    clientRes.on('error', () => upstreamRes.destroy())
    upstreamRes.pipe(clientRes)
  })
  upstream.on('error', error => {
    if (clientRes.destroyed) return
    if (!clientRes.headersSent) {
      clientRes.writeHead(502)
      clientRes.end(String(error.message || error))
    } else {
      clientRes.destroy(error)
    }
  })
  clientReq.on('error', () => upstream.destroy())
  clientReq.pipe(upstream)
})

server.on('connect', (req, clientSocket, head) => {
  const [host, portText = '443'] = String(req.url).split(':')
  const upstream = net.connect(Number(portText), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})

server.listen(0, '0.0.0.0', () => {
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('no proxy port')
  console.log(JSON.stringify({ port: address.port }))
})
