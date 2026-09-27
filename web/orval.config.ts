import { defineConfig } from 'orval'

// Typed TanStack Query hooks generated from the FastAPI spec.
// Regenerate after any API change: bun run gen:api (exports the spec, then runs Orval).
export default defineConfig({
  tcfl: {
    input: { target: './openapi.json' },
    output: {
      mode: 'tags-split',
      target: 'src/api/generated',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: { path: 'src/api/fetcher.ts', name: 'apiFetch' },
        fetch: { includeHttpResponseReturnType: false },
        query: { signal: true },
      },
    },
  },
})
