import { createApp, leaveRotation } from './app'
import { loadConfig } from './config'

const config = loadConfig()
const app = await createApp(config)

const server = Bun.serve({
	port: config.PORT,
	fetch: app.fetch,
})

console.info(
	JSON.stringify({
		level: 'info',
		message: 'AppActor MCP listening',
		port: config.PORT,
	}),
)

let shuttingDown = false

const shutdown = async (signal: string) => {
	if (shuttingDown) return
	shuttingDown = true

	console.info(
		JSON.stringify({
			level: 'info',
			message: `${signal} received, leaving rotation...`,
			service: 'appactor-mcp',
			unrouteDelayMs: config.SHUTDOWN_UNROUTE_DELAY_MS,
		}),
	)

	leaveRotation()
	await Bun.sleep(config.SHUTDOWN_UNROUTE_DELAY_MS)

	server.stop()
	console.info(
		JSON.stringify({
			level: 'info',
			message: 'AppActor MCP stopped gracefully',
		}),
	)
	process.exit(0)
}

process.on('SIGTERM', () => {
	void shutdown('SIGTERM')
})

process.on('SIGINT', () => {
	void shutdown('SIGINT')
})
