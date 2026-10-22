'use client';

import clsx from 'clsx';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AssistantRequest, ChatMessage } from '@soccalytics/contracts';
import { isOfflineError, streamAssistantChat } from '../lib/api';
import { useRole } from '../lib/role';
import { Icon } from './icons';
import { Spinner } from './ui';

interface ToolActivity {
  name: string;
  status: 'started' | 'finished';
}

interface UiMessage extends ChatMessage {
  tools?: ToolActivity[];
  error?: string;
  streaming?: boolean;
}

/** Friendly labels for the agent's narrow, typed tools. */
export function toolLabel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('benchmark')) return 'Benchmarking against peers';
  if (n.includes('similar')) return 'Finding similar players';
  if (n.includes('scout') || n.includes('search')) return 'Searching the player database';
  if (n.includes('trend')) return 'Checking form trend';
  if (n.includes('event') || n.includes('shot')) return 'Scanning match events';
  if (n.includes('report')) return 'Reading the match report';
  if (n.includes('team')) return 'Looking up team stats';
  if (n.includes('match')) return 'Reviewing match data';
  if (n.includes('player')) return 'Looking up player stats';
  return `Running ${name.replace(/[_-]/g, ' ')}`;
}

function routeContext(pathname: string): AssistantRequest['context'] {
  const m = pathname.match(/^\/matches\/([^/]+)/);
  if (m) return { matchId: decodeURIComponent(m[1]) };
  const p = pathname.match(/^\/players\/([^/]+)/);
  if (p) return { playerId: decodeURIComponent(p[1]) };
  return {};
}

function suggestions(ctx: AssistantRequest['context'], role: string): string[] {
  if (ctx.matchId)
    return ['Why did we lose the xG battle?', 'Who was our best progressive passer?', 'Where did our press break down?'];
  if (ctx.playerId)
    return ['How does this player compare to position peers?', 'What should their next training block focus on?', 'Is their form improving?'];
  if (role === 'scout') return ['Find a ball-playing centre-back under 21', 'Which wingers create the most xT?'];
  return ['Who are the top performers this month?', 'Which team presses the hardest?', 'Summarise our last match'];
}

/** Tiny formatter: paragraphs, "- " bullets and **bold**. Text only, no HTML injection. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const inline = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={`${key}-${i}`}>{part}</Fragment>
      ),
    );
  const flush = () => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-0.5">
          {items.map((li, i) => (
            <li key={i}>{inline(li, `li-${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  text.split('\n').forEach((line, i) => {
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p-${i}`}>{inline(line, `p-${i}`)}</p>);
  });
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

export function AssistantDrawer() {
  const pathname = usePathname();
  const { role } = useRole();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ctx = routeContext(pathname);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateLast = (fn: (m: UiMessage) => UiMessage) =>
    setMessages((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history: ChatMessage[] = [...messages, { role: 'user' as const, content }]
      .filter((m) => m.content.trim().length > 0)
      .map(({ role: r, content: c }) => ({ role: r, content: c }));
    setMessages((prev) => [...prev, { role: 'user', content }, { role: 'assistant', content: '', tools: [], streaming: true }]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAssistantChat(
        { messages: history, context: ctx },
        (e) => {
          if (e.type === 'text') updateLast((m) => ({ ...m, content: m.content + e.delta }));
          else if (e.type === 'tool')
            updateLast((m) => {
              const tools = [...(m.tools ?? [])];
              const idx = tools.findIndex((t) => t.name === e.name && t.status === 'started');
              if (e.status === 'finished' && idx >= 0) tools[idx] = { name: e.name, status: 'finished' };
              else tools.push({ name: e.name, status: e.status });
              return { ...m, tools };
            });
          else if (e.type === 'error') updateLast((m) => ({ ...m, error: e.message }));
        },
        controller.signal,
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        updateLast((m) => ({
          ...m,
          error: isOfflineError(err)
            ? 'API offline — run `pnpm nx serve api` and try again.'
            : err instanceof Error
              ? err.message
              : 'The assistant failed to respond.',
        }));
      }
    } finally {
      updateLast((m) => ({ ...m, streaming: false }));
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const ctxLabel = ctx.matchId ? 'this match' : ctx.playerId ? 'this player' : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="assistant-drawer"
        className={clsx(
          'fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-lg shadow-black/30 transition-transform hover:scale-[1.03]',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <Icon.sparkle size={18} />
        Ask the analyst
      </button>

      <div
        id="assistant-drawer"
        role="dialog"
        aria-modal="false"
        aria-label="Ask the analyst"
        hidden={!open}
        className="fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col border-t border-border-strong bg-surface shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(640px,80dvh)] sm:w-[420px] sm:rounded-2xl sm:border"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon.sparkle size={18} />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Ask the analyst</div>
              <div className="text-[11px] text-muted">
                Grounded in your data{ctxLabel ? ` · looking at ${ctxLabel}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
                onClick={() => {
                  abortRef.current?.abort();
                  setMessages([]);
                }}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-md text-text-2 hover:bg-surface-2"
            >
              <Icon.close size={16} />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-2">
                Ask about matches, players or tactics. The analyst reads your stats through typed tools — it never makes
                numbers up.
              </p>
              <div className="flex flex-col gap-2">
                {suggestions(ctx, role).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-sm text-text-2 hover:border-border-strong hover:text-text"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-accent-ink">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-2">
                {!!m.tools?.length && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.tools.map((t, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-text-2"
                      >
                        {t.status === 'started' ? (
                          <Spinner className="h-3 w-3 text-accent" />
                        ) : (
                          <Icon.check size={12} className="text-good-text" />
                        )}
                        {toolLabel(t.name)}
                        {t.status === 'started' ? '…' : ''}
                      </span>
                    ))}
                  </div>
                )}
                {(m.content || m.streaming) && !m.error && (
                  <div className="max-w-[95%] rounded-2xl rounded-bl-sm bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed">
                    {m.content ? (
                      <RichText text={m.content} />
                    ) : (
                      <span className="inline-flex items-center gap-2 text-muted">
                        <Spinner className="h-3.5 w-3.5" /> Thinking…
                      </span>
                    )}
                  </div>
                )}
                {m.error && (
                  <div role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-text">
                    {m.error}
                  </div>
                )}
              </div>
            ),
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-border p-3">
          <label htmlFor="assistant-input" className="sr-only">
            Message the analyst
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="assistant-input"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={ctxLabel ? `Ask about ${ctxLabel}…` : 'Ask anything about your squad…'}
              className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-sm placeholder:text-muted"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="grid h-10 w-10 place-items-center rounded-lg border border-border-strong text-text-2 hover:bg-surface-2"
                aria-label="Stop generating"
              >
                <span className="h-3 w-3 rounded-sm bg-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-ink disabled:opacity-40"
                aria-label="Send"
              >
                <Icon.send size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
