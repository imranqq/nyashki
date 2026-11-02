#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sitePort = 5173
const roomPort = 3001
const tunnelUrlTimeoutMs = 60000
const registrationWarnAfterMs = 45000
const dnsCheckIntervalMs = 10000
const dnsCheckAttempts = 20
const roomFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.nyashki-room')
const roomCode = resolveRoomCode()
const children = new Set()
let shuttingDown = false

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeRoomCode(value) {
  return typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : ''
}

// The room code is kept between runs, so friends land in the same room and its history survives restarts.
function resolveRoomCode() {
  const fromArgument = process.argv.slice(2).find((argument) => argument.startsWith('--room='))
  const requested = normalizeRoomCode(fromArgument?.slice('--room='.length)) || normalizeRoomCode(process.env.NYASHKI_ROOM)
  if (requested) return requested
  try {
    const saved = normalizeRoomCode(readFileSync(roomFile, 'utf8'))
    if (saved) return saved
  } catch {
    // No saved code yet, so one is created below.
  }
  const created = `vecher-${randomBytes(3).toString('hex').slice(0, 4)}`
  try {
    writeFileSync(roomFile, `${created}\n`, 'utf8')
  } catch {
    // A read-only checkout still gets a working code for this run.
  }
  return created
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const settle = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(700)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true
    await sleep(400)
  }
  return false
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) killTree(child)
  setTimeout(() => process.exit(code), 400)
}

function startSite() {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run dev'] : ['run', 'dev']
  const child = spawn(command, args, { stdio: 'inherit', env: process.env })
  children.add(child)
  child.on('exit', (code) => {
    children.delete(child)
    if (!shuttingDown) {
      console.error(`\nСайт остановился (код ${code ?? '—'}). Останавливаю туннель.`)
      shutdown(code ?? 1)
    }
  })
  return child
}

function startTunnel() {
  const child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${sitePort}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  const state = { log: '' }

  const url = new Promise((resolve, reject) => {
    const pattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
    const timer = setTimeout(() => reject(new Error(`туннель не выдал адрес за ${tunnelUrlTimeoutMs / 1000} секунд`)), tunnelUrlTimeoutMs)
    const scan = (chunk) => {
      state.log = (state.log + chunk.toString()).slice(-8000)
      const match = state.log.match(pattern)
      if (!match) return
      clearTimeout(timer)
      resolve(match[0])
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`туннель завершился (код ${code ?? '—'})`))
    })
  })

  return { child, url, state }
}

async function linkResponds(link) {
  try {
    const response = await fetch(link, { signal: AbortSignal.timeout(8000) })
    return response.ok
  } catch {
    return false
  }
}

// Cloudflare publishes a new quick tunnel hostname in DNS with a delay of a few minutes.
function watchLink(link) {
  let attempt = 0
  const timer = setInterval(async () => {
    attempt += 1
    if (await linkResponds(link)) {
      clearInterval(timer)
      console.log('\nСсылка открывается — можно отправлять друзьям.')
      return
    }
    if (attempt >= dnsCheckAttempts) {
      clearInterval(timer)
      console.log('\nСсылка пока не открывается. Перезапустите npm run share, если так и не заработала.')
    }
  }, dnsCheckIntervalMs)
  return timer
}

function describeError(error) {
  if (error?.code === 'ENOENT') return 'cloudflared не найден. Установите его: winget install Cloudflare.cloudflared'
  return error?.message ?? String(error)
}

async function main() {
  console.log('')
  console.log('nyashki share')
  console.log('----------------------------------------')

  const siteIsRunning = await isPortOpen(sitePort)
  if (siteIsRunning) {
    console.log(`Сайт уже работает на http://localhost:${sitePort}, использую его.`)
    if (!(await isPortOpen(roomPort))) {
      console.log('Внимание: сервер комнаты на :3001 не отвечает, поэтому чат и голос не заработают.')
    }
  } else {
    console.log('Запускаю сайт: npm run dev')
    startSite()
    if (!(await waitForPort(sitePort, 45000))) throw new Error(`сайт не поднялся на порту ${sitePort}`)
    console.log('Сайт поднялся.')
  }

  console.log('Открываю туннель Cloudflare...')
  const tunnel = startTunnel()
  const publicUrl = await tunnel.url
  tunnel.child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\nТуннель закрылся (код ${code ?? '—'}). Останавливаю сайт.`)
      shutdown(1)
    }
  })

  const link = `${publicUrl}/?room=${roomCode}`

  console.log('')
  console.log('Ссылка для друзей:')
  console.log(`  ${link}`)
  console.log('')
  console.log(`Код комнаты: ${roomCode} (сохраняется в .nyashki-room, поэтому не меняется между запусками)`)
  console.log('Откройте ссылку на компьютере, дальше «Пригласить» скопирует её.')
  console.log('Другая комната: npm run share -- --room=ваш-код')
  console.log(`Если друг открыл только адрес туннеля, пусть нажмёт «Пригласить» и введёт код ${roomCode} в поле «Войти по коду».`)
  console.log('')
  console.log('Cloudflare публикует новый адрес в DNS не сразу — обычно это занимает 1–3 минуты.')
  console.log('Ниже сообщу, когда ссылка начнёт открываться. Остановить: Ctrl+C.')
  console.log('')

  setTimeout(() => {
    if (!/Registered tunnel connection/i.test(tunnel.state.log)) {
      console.log('Внимание: Cloudflare ещё не подтвердил соединение с туннелем. Проверьте сеть или перезапустите команду.')
    }
  }, registrationWarnAfterMs)

  watchLink(link)
}

process.on('SIGINT', () => {
  console.log('\nОстанавливаю туннель.')
  shutdown(0)
})
process.on('SIGTERM', () => shutdown(0))

main().catch((error) => {
  console.error(`\nНе получилось: ${describeError(error)}`)
  shutdown(1)
})
