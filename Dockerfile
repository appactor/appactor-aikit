FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production \
	&& rm -rf /root/.bun/install/cache

COPY tsconfig.json ./
COPY src ./src

RUN addgroup -S appactor && adduser -S appactor -G appactor

USER appactor

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["bun", "run", "src/index.ts"]
