/**
 * Typed client for apps/api. Every response is parsed with the contract zod
 * schema from @soccalytics/contracts, so contract drift is caught at the edge.
 * Works on the server (RSC prefetch) and in the browser.
 */
import { z } from 'zod';
import {
  ApiError,
  AssistantStreamEvent,
  CreateUploadResponse,
  JobCreatedResponse,
  JobStreamEvent,
  MatchDetail,
  MatchEvent,
  MatchSummary,
  Overview,
  PlayerBenchmark,
  PlayerDetail,
  PlayerListItem,
  PlayerTrend,
  ProcessingJob,
  ScoutSearchResponse,
  SimilarPlayer,
  StoredMatchReport,
  StoredPlayerEvaluation,
  Team,
  routes,
  type AssistantRequest,
  type BenchmarkCohort,
  type CreateUploadRequest,
  type EventType,
  type Position,
  type SimulateMatchRequest,
} from '@soccalytics/contracts';

const DEFAULT_API_URL = 'http://localhost:4000';

/** Browser uses NEXT_PUBLIC_API_URL; the server may use an internal API_URL. */
export function apiBaseUrl(): string {
  const isServer = typeof window === 'undefined';
  const url = (isServer ? process.env['API_URL'] : undefined) ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  return url.replace(/\/$/, '');
}

export class ApiRequestError extends Error {
  readonly status: number;
  /** True when the API could not be reached at all (not running, CORS, DNS…). */
  readonly offline: boolean;
  readonly body: ApiError | null;

  constructor(message: string, opts: { status: number; offline?: boolean; body?: ApiError | null }) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = opts.status;
    this.offline = opts.offline ?? false;
    this.body = opts.body ?? null;
  }
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiRequestError && err.offline;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status === 404;
}

/**
 * Parse with the contract schema. A mismatch is logged loudly but does not
 * take the page down during a live demo; the raw payload is returned instead.
 */
function parseWith<S extends z.ZodType>(schema: S, data: unknown, label: string): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  console.warn(`[api] ${label}: response does not match contract`, z.prettifyError(result.error));
  return data as z.output<S>;
}

type Query = Record<string, string | number | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(apiBaseUrl() + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function toApiError(res: Response): Promise<ApiRequestError> {
  let body: ApiError | null = null;
  try {
    const parsed = ApiError.safeParse(await res.json());
    if (parsed.success) body = parsed.data;
  } catch {
    // non-JSON error body
  }
  return new ApiRequestError(body?.message ?? `${res.status} ${res.statusText}`, { status: res.status, body });
}

interface RequestOpts {
  method?: 'GET' | 'POST';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

async function rawRequest(path: string, opts: RequestOpts = {}): Promise<Response> {
  const isServer = typeof window === 'undefined';
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      // Never let an unreachable API hang server rendering.
      signal: opts.signal ?? (isServer ? AbortSignal.timeout(4000) : undefined),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError' && !isServer) throw err;
    throw new ApiRequestError('The analytics API is unreachable.', { status: 0, offline: true });
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function request<S extends z.ZodType>(schema: S, path: string, opts: RequestOpts = {}): Promise<z.output<S>> {
  const res = await rawRequest(path, opts);
  return parseWith(schema, await res.json(), `${opts.method ?? 'GET'} ${path}`);
}

/** Like `request`, but a 404 resolves to null (resource not generated yet). */
async function requestOptional<S extends z.ZodType>(
  schema: S,
  path: string,
  opts: RequestOpts = {},
): Promise<z.output<S> | null> {
  try {
    return await request(schema, path, opts);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// ── Read endpoints ──────────────────────────────────────────────────────────

export interface PlayerFilters {
  position?: Position | '';
  teamId?: string;
  q?: string;
}

export const api = {
  overview: () => request(Overview, routes.overview),
  teams: () => request(z.array(Team), routes.teams),

  players: (f: PlayerFilters = {}) =>
    request(z.array(PlayerListItem), routes.players, { query: { position: f.position, teamId: f.teamId, q: f.q } }),
  player: (id: string) => request(PlayerDetail, routes.player(id)),
  playerBenchmark: (id: string, cohort: BenchmarkCohort) =>
    request(PlayerBenchmark, routes.playerBenchmark(id), { query: { cohort } }),
  playerTrend: (id: string) => request(PlayerTrend, routes.playerTrend(id)),
  playerSimilar: (id: string) => request(z.array(SimilarPlayer), routes.playerSimilar(id)),
  playerEvaluation: (id: string) => requestOptional(StoredPlayerEvaluation, routes.playerEvaluation(id)),
  generatePlayerEvaluation: (id: string) =>
    request(StoredPlayerEvaluation, routes.playerEvaluation(id), { method: 'POST' }),

  matches: () => request(z.array(MatchSummary), routes.matches),
  match: (id: string) => request(MatchDetail, routes.match(id)),
  matchEvents: (id: string, f: { types?: EventType[]; playerId?: string } = {}) =>
    request(z.array(MatchEvent), routes.matchEvents(id), {
      query: { types: f.types?.join(','), playerId: f.playerId },
    }),
  matchReport: (id: string, teamId: string) =>
    requestOptional(StoredMatchReport, routes.matchReport(id), { query: { teamId } }),
  generateMatchReport: (id: string, teamId: string) =>
    request(StoredMatchReport, routes.matchReport(id), { method: 'POST', body: { teamId } }),

  job: (id: string) => request(ProcessingJob, routes.job(id)),

  // ── Write endpoints ──
  createUpload: (body: CreateUploadRequest) =>
    request(CreateUploadResponse, routes.uploads, { method: 'POST', body }),
  startProcessing: (matchId: string, videoKey: string) =>
    request(JobCreatedResponse, routes.matchProcess(matchId), { method: 'POST', body: { videoKey } }),
  simulate: (body: SimulateMatchRequest) => request(JobCreatedResponse, routes.simulate, { method: 'POST', body }),
  scoutSearch: (query: string, limit = 15) =>
    request(ScoutSearchResponse, routes.scoutSearch, { method: 'POST', body: { query, limit } }),
};

// ── Upload with progress (XHR, since fetch has no upload progress) ──────────

export function uploadFile(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new ApiRequestError(`Upload failed (${xhr.status})`, { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new ApiRequestError('Upload failed: storage unreachable.', { status: 0, offline: true }));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

// ── Server-sent events ──────────────────────────────────────────────────────

/**
 * Subscribe to a job's SSE stream. Returns an unsubscribe function.
 * `onEnd` fires on the server's `event: end`; `onError` when the stream drops.
 */
export function subscribeToJob(
  jobId: string,
  handlers: { onEvent: (e: JobStreamEvent) => void; onEnd: () => void; onError: () => void },
): () => void {
  const source = new EventSource(apiBaseUrl() + routes.jobStream(jobId));
  let closed = false;
  const close = () => {
    closed = true;
    source.close();
  };
  source.onmessage = (msg) => {
    try {
      handlers.onEvent(parseWith(JobStreamEvent, JSON.parse(msg.data), 'job stream'));
    } catch {
      // ignore malformed frames (e.g. keep-alives)
    }
  };
  source.addEventListener('end', () => {
    close();
    handlers.onEnd();
  });
  source.onerror = () => {
    if (closed) return;
    close();
    handlers.onError();
  };
  return close;
}

/** Split an SSE byte stream into `data:` payloads (multi-line data joined). */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) yield { event, data: data.join('\n') };
      else if (event !== 'message') yield { event, data: '' };
    }
  }
}

/** POST /v1/assistant/chat and stream AssistantStreamEvents. */
export async function streamAssistantChat(
  req: AssistantRequest,
  onEvent: (e: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiBaseUrl() + routes.assistantChat, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError('The analytics API is unreachable.', { status: 0, offline: true });
  }
  if (!res.ok || !res.body) throw await toApiError(res);
  for await (const frame of readSse(res.body)) {
    if (frame.event === 'end') break;
    if (!frame.data) continue;
    try {
      const parsed = AssistantStreamEvent.safeParse(JSON.parse(frame.data));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      // ignore non-JSON frames
    }
  }
}
