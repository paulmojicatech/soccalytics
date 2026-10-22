'use client';

import type { MatchStatus } from '@soccalytics/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/icons';
import { MatchListItem } from '../../components/match';
import { EmptyState, LinkButton, LoadingBlock, PageHeader, QueryState, Tabs, inputClass } from '../../components/ui';
import { q } from '../../lib/queries';

type StatusFilter = 'all' | MatchStatus;

export function MatchesView() {
  const query = useQuery({
    ...q.matches(),
    refetchInterval: (qq) => (qq.state.data?.some((m) => m.status === 'processing') ? 5000 : false),
  });
  const [status, setStatus] = useState<StatusFilter>('all');
  const [text, setText] = useState('');

  return (
    <>
      <PageHeader
        eyebrow="Matches"
        title="Match centre"
        subtitle="Every analysed fixture with xG, tactics and AI reports."
        actions={
          <LinkButton href="/analyse" variant="primary">
            <Icon.analyse size={16} /> Analyse a match
          </LinkButton>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-72">
          <label htmlFor="match-search" className="sr-only">
            Search by team or competition
          </label>
          <input
            id="match-search"
            type="search"
            placeholder="Search team or competition…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={inputClass}
          />
        </div>
        <Tabs
          label="Filter by status"
          value={status}
          onChange={setStatus}
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'analysed', label: 'Analysed' },
            { id: 'processing', label: 'Processing' },
            { id: 'failed', label: 'Failed' },
          ]}
        />
      </div>
      <QueryState query={query} loading={<LoadingBlock rows={6} label="Loading matches" />}>
        {(matches) => {
          const needle = text.trim().toLowerCase();
          const list = matches
            .filter((m) => status === 'all' || m.status === status)
            .filter(
              (m) =>
                !needle ||
                [m.homeTeam.name, m.awayTeam.name, m.homeTeam.shortName, m.awayTeam.shortName, m.competition]
                  .join(' ')
                  .toLowerCase()
                  .includes(needle),
            )
            .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));
          if (!matches.length)
            return (
              <div className="card">
                <EmptyState
                  title="No matches yet"
                  body="Upload match footage or simulate a fixture to get started."
                  action={
                    <LinkButton href="/analyse" variant="primary" size="sm">
                      Analyse a match
                    </LinkButton>
                  }
                />
              </div>
            );
          if (!list.length)
            return (
              <div className="card">
                <EmptyState title="No matches match your filters" />
              </div>
            );
          return (
            <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {list.map((m) => (
                <MatchListItem key={m.id} m={m} />
              ))}
            </ul>
          );
        }}
      </QueryState>
    </>
  );
}
