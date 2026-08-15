import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

const migrations = await readD1Migrations('./migrations')

export default defineWorkersConfig({
  test: {
    include: ['tests/worker/**/*.test.js'],
    setupFiles: ['./tests/worker/setup.js'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            COOKIE_SECRET: 'test-cookie-secret',
            PREVIEW_BARISTA_KEY: 'test-preview-key',
          },
        },
      },
    },
  },
})
