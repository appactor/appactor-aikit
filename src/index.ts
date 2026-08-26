import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig()
const app = createApp(config)

Bun.serve({
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
