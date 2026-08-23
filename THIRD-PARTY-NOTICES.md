# Third-party notices

NeurAI Platform is proprietary software (see [LICENSE](LICENSE)) built on
open-source components, each under its own license. The load-bearing ones:

| Component | Used in | License |
|---|---|---|
| Next.js, React | web/ | MIT |
| next-intl | web/ | MIT |
| Tailwind CSS | web/ | MIT |
| Vazirmatn (font) | web/ | SIL Open Font License 1.1 |
| Fastify | core/ | MIT |
| postgres.js (`postgres`) | core/, db/ | Unlicense |
| pino | core/ | MIT |
| zod | core/ | MIT |
| pgmq (Postgres extension) | database | PostgreSQL License |
| sherpa-onnx | ml/ | Apache-2.0 |
| Silero VAD (model) | ml/ | MIT |
| onnxruntime | ml/ | MIT |
| Vitest | all packages (dev) | MIT |
| TypeScript | all packages (dev) | Apache-2.0 |

Full transitive inventories live in each package's lockfile
(`pnpm-lock.yaml`); run `pnpm licenses list` in a package for the complete
current set.

Hosted services (Supabase, Vercel, Cloudflare, Soniox, OpenRouter) are used
under their own commercial terms and are not distributed with this software.
