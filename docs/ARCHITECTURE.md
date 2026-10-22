# Soccalytics architecture

AI-powered soccer analytics: video in → tracking → events → metrics → AI insight.

```
                ┌──────────────┐     presigned PUT      ┌───────────────┐
  browser ────▶ │  apps/web    │ ─────────────────────▶ │ S3 (seaweedfs)│
  (Next.js)     │  :3000       │                         └──────▲────────┘
                └──────┬───────┘                                │ video / tracking.json.gz
                       │ REST + SSE                             │
                ┌──────▼───────┐   BullMQ    ┌──────────────────┴─┐
                │  apps/api    │ ──────────▶ │ apps/vision-worker │  YOLO + ByteTrack + homography
                │  Fastify     │  vision q   │ (Python)           │
                │  :4000       │             └─────────┬──────────┘
                └──┬───────┬───┘                       │ analytics q {task:'events'}
                   │       │ BullMQ analytics q  ┌─────▼──────────┐
                   │       └───────────────────▶ │  apps/worker   │  events → metrics → report
                   │                             │  (Node)        │  (or simulate)
                   │                             └──┬──────────┬──┘
             ┌─────▼─────────────────────────────────▼──┐   ┌───▼─────────┐
             │ Postgres 17 + pgvector  (libs/db)        │   │ Claude API  │
             └──────────────────────────────────────────┘   │ (libs/ai)   │
                    Redis: queues + job pub/sub             └─────────────┘
```

## Monorepo layout

| Project | Kind | Responsibility |
|---|---|---|
| `libs/contracts` | lib | Zod schemas + types for every boundary (REST DTOs, queue payloads, LLM output schemas). No runtime deps beyond zod. |
| `libs/analytics` | lib | Pure, deterministic analytics engine (xG, xT, progressive actions, PPDA, passing networks, physical load, ratings, benchmarking, similarity, trends, event inference from tracking). No I/O. |
| `libs/simulator` | lib | Seeded synthetic league + match generator producing tracking and events, so the whole pipeline runs without GPUs or footage. |
| `libs/db` | lib | Drizzle schema, migrations, client, repositories, seed. |
| `libs/ai` | lib | Claude gateway: structured outputs, prompt registry/versioning, prompt caching, grounding verification, usage telemetry, offline fallback, assistant agent with tools, evals. |
| `apps/api` | Fastify | REST + SSE, OpenAPI docs at `/docs`, enqueues jobs. |
| `apps/worker` | Node | BullMQ consumer for the analytics queue. |
| `apps/vision-worker` | Python | BullMQ consumer for the vision queue (CV pipeline). |
| `apps/web` | Next.js | Dashboards for coaches, players, scouts. |

Dependency rule (enforced by `@nx/enforce-module-boundaries` tags):
`contracts` ← `analytics`, `simulator` ← `db`, `ai` ← `api`, `worker`. Apps never import other apps. `web` imports only `contracts`.

## Conventions

- ESM everywhere (`"type": "module"`, `moduleResolution: nodenext`): relative imports use `.js` suffix.
- Workspace libs resolve to `src/` via the `@soccalytics/source` export condition in dev (no build step needed for `tsx`/Next).
- Coordinates: metres on a 105×68 pitch. Events normalised so the acting team attacks towards x=105.
- All numbers surfaced to users and to the LLM use `PlayerMetricKey` names.

## libs/analytics public API

```ts
xgForShot(shot: { start: Point; bodyPart: BodyPart; playPattern: PlayPattern }): number
priorXtGrid(): XtGrid                       // smooth prior, 16×12 cells
fitXtGrid(events: MatchEvent[], opts?): XtGrid   // Karun Singh value iteration
xtAt(grid: XtGrid, p: Point): number
isProgressive(e: Pick<MatchEvent,'type'|'start'|'end'|'success'>): boolean
enrichEvents(events: MatchEventInput[], grid?: XtGrid): MatchEvent[]   // xg, xt, progressive
inferEventsFromTracking(doc: TrackingDocument): MatchEventInput[]      // CV path: no manual tagging
computePhysical(doc: TrackingDocument): Map<playerId, PhysicalMetrics>
computeMatchStats(input: {
  match: Match; lineups: Lineup[]; events: MatchEvent[]; tracking: TrackingDocument | null
}): { players: PlayerMatchStats[]; teams: TeamMatchStats[] }
aggregateProfile(playerId, position, stats: PlayerMatchStats[]): PlayerProfile
benchmarkPlayer(profile, cohort: PlayerProfile[], cohortName): PlayerBenchmark
playerTrend(playerId, points: TrendPoint[], horizon?): PlayerTrend
profileVector(profile): number[]           // standardised, fixed key order (VECTOR_KEYS)
VECTOR_DIM: number
cosineSimilarity(a, b): number
rankScoutCandidates(filter: ScoutFilter, candidates: ScoutCandidate[]): ScoutResult[]
```

## libs/simulator public API

```ts
generateLeague(seed: number): { teams: Team[]; players: (Player & { attributes: LatentAttributes })[] }
simulateMatch(input: {
  matchId; seed; home: { team; players }; away: { team; players }; fps?: number
}): { tracking: TrackingDocument; events: MatchEventInput[]; lineups: Lineup[]; homeScore; awayScore; durationSec }
```

Players carry hidden latent attributes (passing, finishing, pace, work rate, …) that drive behaviour, so analytics can rediscover real differences between players.

## Processing pipeline

1. `POST /v1/uploads` creates a match + returns a presigned S3 PUT URL.
2. `POST /v1/matches/:id/process` creates a `processing_jobs` row and enqueues `vision` (video) — or `POST /v1/simulations` enqueues `analytics {task:'simulate'}`.
3. Vision worker: decode → detect (YOLO) → track (ByteTrack) → team assignment (jersey colour k-means) → homography to pitch metres → write `tracking/{matchId}.json.gz` → enqueue `analytics {task:'events'}`.
4. Worker `events`: `inferEventsFromTracking` → `enrichEvents` → persist.
5. Worker `metrics`: `computeMatchStats` → persist player/team stats, refresh profile embeddings (pgvector).
6. Worker `report`: build grounded context → Claude structured output → grounding check → persist with provenance.
7. Each stage publishes `JobStreamEvent` on Redis `soccalytics:job:{id}`; API relays as SSE.

## AI design principles (libs/ai)

- **Compute first, narrate second.** The LLM never computes metrics; it explains numbers produced by the deterministic engine.
- **Structured outputs** via Zod schemas from `contracts` — no regex parsing of prose.
- **Grounding verification**: every claim carries `{subject, metric, value}` evidence, checked against the context; violations are recorded in `AiArtifactMeta.grounding` and surfaced in the UI.
- **Prompt registry** with versioned prompts; version stored on every artefact.
- **Prompt caching**: stable system prompt + metric glossary first, volatile match context last.
- **Telemetry**: tokens, cache reads, latency per call → `llm_calls` table + OTel spans.
- **Graceful degradation**: without `ANTHROPIC_API_KEY`, deterministic templated reports keep the product demoable.
- **Evals** (`nx run ai:eval`): golden contexts with schema, grounding and content assertions.
- **Agent with narrow tools**: the analyst assistant can only read through typed tool handlers backed by repositories.
