import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, LogOut, RefreshCw, Trash2 } from 'lucide-react'
import { ApiError, demoApi, metaApi } from '@/lib/api'
import { useSession } from '@/providers/AppProviders'
import '@/styles/pages-data.css'
import {
  Button,
  Card,
  Modal,
  ModalContent,
  PageHeader,
  RoleChip,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TRow,
} from '@/components/app/ui'

/* ------------------------------------------------------------------ utils */

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.detail || err.error
  return 'Something went wrong. Please try again.'
}

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied.`)
  } catch {
    toast.error('Clipboard is unavailable — copy the value manually.')
  }
}

function HealthRow({
  label,
  value,
  state,
}: {
  label: string
  value: string
  state: 'ok' | 'bad' | 'idle'
}) {
  return (
    <div className="pd-health-row">
      <span className="pd-health-k">
        <span className="pd-status-dot" data-state={state} aria-hidden />
        {label}
      </span>
      <span className="pd-health-v">{value}</span>
    </div>
  )
}

function boolState(v: boolean): 'ok' | 'bad' {
  return v ? 'ok' : 'bad'
}

/* ------------------------------------------------------------------ page */

export function SettingsPage() {
  const { user, workspaces, logout } = useSession()
  const qc = useQueryClient()
  const [resetOpen, setResetOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const demoQuery = useQuery({
    queryKey: ['demoStatus'],
    queryFn: demoApi.status,
    retry: false,
  })

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: metaApi.health,
    retry: 1,
    refetchInterval: 30_000,
  })

  const afterDataChange = async (): Promise<void> => {
    await qc.invalidateQueries()
  }

  const seedMutation = useMutation({
    mutationFn: demoApi.seed,
    onSuccess: async () => {
      toast.success('Demo data loaded into your workspace.')
      await afterDataChange()
      setResetOpen(false)
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const resetMutation = useMutation({
    mutationFn: () => demoApi.reset(demoQuery.data?.workspace_id ?? undefined),
    onSuccess: async () => {
      toast.success('Demo data reset.')
      await afterDataChange()
      setResetOpen(false)
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const logoutMutation = useMutation({
    mutationFn: logout,
    onError: (err) => toast.error(errMsg(err)),
  })

  const health = healthQuery.data
  const demo = demoQuery.data
  const counts = demo ? Object.entries(demo.counts) : []

  let demoBody: ReactNode
  if (demoQuery.isPending) {
    demoBody = (
      <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
        <Spinner size={15} /> Checking demo state…
      </div>
    )
  } else if (demoQuery.isError) {
    demoBody = (
      <div className="px-5 py-6">
        <div className="pd-banner" role="status">
          Demo status is unavailable on this build — seeding may still work.
        </div>
      </div>
    )
  } else if (!demo?.seeded) {
    demoBody = (
      <div className="px-5 py-6">
        <p className="text-sm leading-relaxed text-muted">
          Nothing seeded yet. Load a realistic pilot dataset — documents, knowledge, handovers
          and sample logins — into your current workspace, or clear it and start from scratch.
        </p>
      </div>
    )
  } else {
    demoBody = (
      <div className="flex flex-col gap-4 px-5 py-5">
        {counts.length ? (
          <div className="flex flex-wrap gap-1.5">
            {counts.map(([key, value]) => (
              <span key={key} className="pd-badge" data-tone="ink">
                {key} {value}
              </span>
            ))}
          </div>
        ) : null}

        {demo.logins.length ? (
          <div className="overflow-hidden rounded-sm border border-line">
            <Table>
              <THead>
                <TRow>
                  <TH>Login</TH>
                  <TH>Role</TH>
                  <TH>Password</TH>
                  <TH className="text-right">Copy</TH>
                </TRow>
              </THead>
              <TBody>
                {demo.logins.map((login) => (
                  <TRow key={login.email}>
                    <TD>
                      <p className="font-medium text-ink">{login.name || '—'}</p>
                      <p className="font-mono text-[11px] text-muted">{login.email}</p>
                    </TD>
                    <TD>
                      <RoleChip role={login.project_role} />
                    </TD>
                    <TD className="font-mono text-[13px] text-muted">{login.password}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Copy email for ${login.email}`}
                          onClick={async () => {
                            await copyText(login.email, 'Email')
                            setCopiedId(`e:${login.email}`)
                            window.setTimeout(() => setCopiedId(null), 1500)
                          }}
                        >
                          {copiedId === `e:${login.email}` ? (
                            <Check size={13} aria-hidden />
                          ) : (
                            <Copy size={13} aria-hidden />
                          )}
                          Email
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Copy password for ${login.email}`}
                          onClick={async () => {
                            await copyText(login.password, 'Password')
                            setCopiedId(`p:${login.email}`)
                            window.setTimeout(() => setCopiedId(null), 1500)
                          }}
                        >
                          {copiedId === `p:${login.email}` ? (
                            <Check size={13} aria-hidden />
                          ) : (
                            <Copy size={13} aria-hidden />
                          )}
                          Password
                        </Button>
                      </div>
                    </TD>
                  </TRow>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline="Account"
        title="Settings"
        description="Your profile, workspace memberships, demo data and platform health."
        actions={
          <Button
            variant="outline"
            loading={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            <LogOut size={14} aria-hidden />
            Sign out
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-lg tracking-tight text-ink">Profile</h2>
          </div>
          <Table>
            <TBody>
              <TRow>
                <TH className="w-40 align-top">Name</TH>
                <TD>{user?.name ?? '—'}</TD>
              </TRow>
              <TRow>
                <TH className="align-top">Email</TH>
                <TD>
                  <span className="font-mono text-[13px]">{user?.email ?? '—'}</span>
                </TD>
              </TRow>
              <TRow>
                <TH className="align-top">Title</TH>
                <TD className="text-muted">{user?.title || '—'}</TD>
              </TRow>
              <TRow>
                <TH className="align-top">User ID</TH>
                <TD className="font-mono text-[11px] text-muted">{user?.id ?? '—'}</TD>
              </TRow>
            </TBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-lg tracking-tight text-ink">Workspaces</h2>
          </div>
          {workspaces.length ? (
            <Table>
              <THead>
                <TRow>
                  <TH>Workspace</TH>
                  <TH>Your role</TH>
                </TRow>
              </THead>
              <TBody>
                {workspaces.map((ws) => (
                  <TRow key={ws.id}>
                    <TD>{ws.name}</TD>
                    <TD>
                      <RoleChip role={ws.role} />
                    </TD>
                  </TRow>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">No workspace memberships.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display text-lg tracking-tight text-ink">Demo data</h2>
              <p className="mt-0.5 text-xs text-muted">
                Seed or clear the sample workspace used for walkthroughs.
              </p>
            </div>
            <span className="pd-badge" data-tone={demo?.seeded ? 'forest' : 'ink'}>
              <span
                className="pd-status-dot"
                data-state={demoQuery.isError ? 'idle' : demo?.seeded ? 'ok' : 'idle'}
                aria-hidden
              />
              {demoQuery.isError
                ? 'status unavailable'
                : demo?.seeded
                  ? 'seeded'
                  : 'not seeded'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
            <Button
              size="sm"
              loading={seedMutation.isPending}
              onClick={() => seedMutation.mutate()}
            >
              <RefreshCw size={13} aria-hidden />
              Load demo data
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={resetMutation.isPending}
              onClick={() => setResetOpen(true)}
            >
              <Trash2 size={13} aria-hidden />
              Reset demo data
            </Button>
          </div>

          {demoBody}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display text-lg tracking-tight text-ink">System health</h2>
              <p className="mt-0.5 text-xs text-muted">
                Live checks from the API — polled every 30s.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={healthQuery.isFetching}
              onClick={() => void healthQuery.refetch()}
            >
              {healthQuery.isFetching ? (
                <Spinner size={13} />
              ) : (
                <RefreshCw size={13} aria-hidden />
              )}
              Refresh
            </Button>
          </div>

          <div className="px-5 py-4">
            {healthQuery.isPending ? (
              <div className="flex items-center gap-3 text-sm text-muted">
                <Spinner size={15} /> Contacting API…
              </div>
            ) : healthQuery.isError || !health ? (
              <div className="pd-banner" role="status">
                The health endpoint is unreachable — the API may be restarting.
              </div>
            ) : (
              <div>
                <HealthRow
                  label="API status"
                  value={health.status}
                  state={health.status === 'ok' ? 'ok' : 'bad'}
                />
                <HealthRow
                  label="Database"
                  value={health.database}
                  state={health.database === 'ok' ? 'ok' : 'bad'}
                />
                <HealthRow
                  label="pgvector"
                  value={String(health.pgvector)}
                  state={boolState(health.pgvector)}
                />
                <HealthRow
                  label="Configured"
                  value={String(health.ai_configured)}
                  state={boolState(health.ai_configured)}
                />
                <HealthRow
                  label="Demo mode"
                  value={String(health.demo_mode)}
                  state="idle"
                />
                <HealthRow label="Embed dim" value={String(health.embed_dim)} state="idle" />
                <HealthRow label="Version" value={health.version} state="idle" />
              </div>
            )}
          </div>
        </Card>
      </div>

      <Modal open={resetOpen} onOpenChange={setResetOpen}>
        <ModalContent
          title="Reset demo data?"
          description="This clears the seeded sample workspace (documents, knowledge, handovers and logins). Your own projects are untouched."
        >
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={resetMutation.isPending}
              onClick={() => resetMutation.mutate(undefined)}
            >
              Reset demo data
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}
