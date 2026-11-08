import type { ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, activityApi, authorityApi } from '@/lib/api'
import type { ActivityOut } from '@/lib/types'
import { useCurrentProject } from '@/providers/AppProviders'
import '@/styles/pages-data.css'
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/app/ui'

/* ------------------------------------------------------------------ utils */

const ACTION_LABELS: Record<string, string> = {
  'auth.signup': 'Account created',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'workspace.create': 'Workspace created',
  'workspace.member.add': 'Workspace member added',
  'workspace.member.role': 'Workspace role changed',
  'project.create': 'Project created',
  'project.update': 'Project updated',
  'project.member.add': 'Project member added',
  'project.member.update': 'Project role changed',
  'document.upload': 'Document uploaded',
  'document.delete': 'Document deleted',
  'document.scope': 'Access scope changed',
  'document.grant': 'Restricted access granted',
  'document.revoke': 'Restricted access revoked',
  'document.process': 'Document processed',
  'knowledge.review': 'Knowledge reviewed',
  'handover.create': 'Handover started',
  'handover.generate': 'Handover draft generated',
  'handover.submit': 'Handover submitted',
  'handover.approve': 'Handover approved',
  'handover.request_changes': 'Changes requested',
  'handover.share': 'Handover shared',
  'handover.archive': 'Handover archived',
  'handover.finding.review': 'Handover finding reviewed',
  'assistant.message': 'Assistant asked',
  'demo.seed': 'Demo data loaded',
  'demo.reset': 'Demo data reset',
}

function actionLabel(action: string): string {
  const known = ACTION_LABELS[action]
  if (known) return known
  return action
    .replace(/^[a-z]+\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-CA')
}

function initialOf(name: string | null | undefined, actorType: string): string {
  if (!name) return actorType === 'system' ? 'S' : '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.length === 1
    ? parts[0].slice(0, 1).toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function FeedItem({ event }: { event: ActivityOut }) {
  const isSystem = !event.actor_id || event.actor_type === 'system'
  const metaEntries = Object.entries(event.meta ?? {})
  const hasMeta = metaEntries.length > 0

  return (
    <li className="pd-feed-item">
      <span className="pd-feed-dot" data-system={isSystem ? 'true' : 'false'} aria-hidden>
        {initialOf(event.actor_name, event.actor_type)}
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`text-sm font-medium ${isSystem ? 'text-muted' : 'text-ink'}`}>
          {event.actor_name || (isSystem ? 'System' : 'Removed user')}
        </span>
        <span className="pd-badge" data-tone="forest">
          {actionLabel(event.action)}
        </span>
        <time
          className="font-mono text-[11px] text-muted"
          dateTime={event.created_at ?? undefined}
        >
          {timeAgo(event.created_at)}
        </time>
      </div>

      {event.summary ? <p className="pd-feed-summary mt-1.5">{event.summary}</p> : null}

      {hasMeta ? (
        <details className="pd-meta-details mt-2">
          <summary>Details</summary>
          <pre className="pd-json mt-2">{JSON.stringify(event.meta, null, 2)}</pre>
        </details>
      ) : null}
    </li>
  )
}

/* ------------------------------------------------------------------ page */

export function ActivityPage() {
  const { project, projectId } = useCurrentProject()

  // Same capability flag the authority map exposes — cached across pages.
  const meQuery = useQuery({
    queryKey: ['authorityMe', projectId],
    queryFn: () => authorityApi.me(projectId as string),
    enabled: !!projectId,
  })
  const canView = meQuery.data ? !!meQuery.data.can.view_activity : true

  const feedQuery = useInfiniteQuery({
    queryKey: ['activity', projectId],
    queryFn: ({ pageParam }) =>
      activityApi.list({
        project_id: projectId as string,
        limit: 50,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, page) => n + page.length, 0)
      return lastPage.length === 50 ? loaded : undefined
    },
    enabled: !!projectId,
  })

  const events = (feedQuery.data?.pages ?? []).flat()

  let body: ReactNode

  if (!projectId) {
    body = (
      <EmptyState
        title="No project selected."
        description="Choose or create a project above to read its activity trail."
      />
    )
  } else if (feedQuery.isPending) {
    body = (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Loading activity…
      </div>
    )
  } else if (feedQuery.isError) {
    body = (
      <EmptyState
        title="Activity could not be loaded."
        description={
          feedQuery.error instanceof ApiError
            ? feedQuery.error.detail || feedQuery.error.error
            : 'The activity feed is unavailable right now.'
        }
        action={
          <Button variant="outline" onClick={() => void feedQuery.refetch()}>
            Try again
          </Button>
        }
      />
    )
  } else if (events.length === 0) {
    body = (
      <EmptyState
        title="Nothing recorded yet."
        description="Uploads, reviews, role changes and handover actions will appear here as they happen."
      />
    )
  } else {
    body = (
      <Card className="p-5">
        <ul className="pd-feed">
          {events.map((event) => (
            <FeedItem key={event.id} event={event} />
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="label-mono text-muted">{events.length} events loaded</span>
          <Button
            variant="outline"
            size="sm"
            loading={feedQuery.isFetchingNextPage}
            disabled={!feedQuery.hasNextPage}
            onClick={() => void feedQuery.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline={project?.name ?? 'Project'}
        title="Activity"
        description="An audit trail of what changed, who changed it and when — scoped to this project."
        actions={
          canView ? null : (
            <span className="pd-badge" data-tone="ember">
              members normally see heads + leads only
            </span>
          )
        }
      />
      {body}
    </div>
  )
}
