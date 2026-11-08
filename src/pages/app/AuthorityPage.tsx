import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Lock, Minus } from 'lucide-react'
import { ApiError, authorityApi, projectsApi } from '@/lib/api'
import type { AuthorityMemberOut, ProjectRole } from '@/lib/types'
import { useCurrentProject } from '@/providers/AppProviders'
import '@/styles/pages-data.css'
import {
  Button,
  Card,
  EmptyState,
  Modal,
  ModalContent,
  PageHeader,
  RoleChip,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TRow,
} from '@/components/app/ui'

/* ------------------------------------------------------------------ utils */

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.detail || err.error
  return 'Something went wrong. Please try again.'
}

const PROJECT_ROLES: ProjectRole[] = ['head', 'lead', 'member', 'successor']

const ROLE_OPTIONS = PROJECT_ROLES.map((role) => ({
  value: role,
  label: role.charAt(0).toUpperCase() + role.slice(1),
}))

const ROLE_REASON: Record<string, string> = {
  manage_members: 'Only a project head or lead can manage members.',
}

function Yes() {
  return <Check size={15} className="pd-yes mx-auto" aria-label="Allowed" />
}

function No() {
  return (
    <span className="pd-no mx-auto block" aria-label="Not allowed">
      <Minus size={14} />
    </span>
  )
}

/* ------------------------------------------------------------------ page */

export function AuthorityPage() {
  const { project, projectId } = useCurrentProject()
  const qc = useQueryClient()
  const [roleChange, setRoleChange] = useState<{
    member: AuthorityMemberOut
    role: ProjectRole
  } | null>(null)

  const overviewQuery = useQuery({
    queryKey: ['authority', projectId],
    queryFn: () => authorityApi.overview(projectId as string),
    enabled: !!projectId,
  })

  const meQuery = useQuery({
    queryKey: ['authorityMe', projectId],
    queryFn: () => authorityApi.me(projectId as string),
    enabled: !!projectId,
  })

  const me = meQuery.data
  const can = me?.can ?? {}
  const canManage = !!can.manage_members

  const memberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) =>
      projectsApi.updateMember(projectId as string, userId, { role }),
    onSuccess: () => {
      toast.success('Project role updated.')
      setRoleChange(null)
      void qc.invalidateQueries({ queryKey: ['authority', projectId] })
      void qc.invalidateQueries({ queryKey: ['authorityMe', projectId] })
      void qc.invalidateQueries({ queryKey: ['projectMembers', projectId] })
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const requestRoleChange = (member: AuthorityMemberOut, role: ProjectRole) => {
    if (role === member.project_role) return
    if (member.project_role === 'head' && role !== 'head') {
      setRoleChange({ member, role })
      return
    }
    memberMutation.mutate({ userId: member.user_id, role })
  }

  const overview = overviewQuery.data

  let body: ReactNode

  if (!projectId) {
    body = (
      <EmptyState
        title="No project selected."
        description="Choose or create a project above to inspect its authority map."
      />
    )
  } else if (overviewQuery.isPending) {
    body = (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Loading authority…
      </div>
    )
  } else if (overviewQuery.isError || !overview) {
    body = (
      <EmptyState
        title="Authority could not be loaded."
        description={
          overviewQuery.error instanceof ApiError
            ? overviewQuery.error.detail || overviewQuery.error.error
            : 'The authority map is unavailable right now.'
        }
        action={
          <Button variant="outline" onClick={() => void overviewQuery.refetch()}>
            Try again
          </Button>
        }
      />
    )
  } else {
    const capabilityLabels = new Map(overview.capabilities.map((c) => [c.key, c.label]))

    body = (
      <div className="flex flex-col gap-8">
        {/* your access */}
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="label-mono text-forest">Your access</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">project role</span>
                <RoleChip role={me?.project_role ?? null} />
                <span className="text-sm text-muted">workspace role</span>
                <RoleChip role={me?.workspace_role ?? null} />
                {me?.is_workspace_owner ? (
                  <span className="pd-badge" data-tone="ember">
                    workspace owner
                  </span>
                ) : null}
              </div>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              {Object.values(can).filter(Boolean).length} / {Object.keys(can).length} capabilities
            </span>
          </div>

          {me?.limitations?.length ? (
            <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
              {me.limitations.map((limitation) => (
                <li key={limitation} className="pd-limit">
                  {limitation}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        {/* capability matrix */}
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
            <h2 className="font-display text-2xl tracking-tight text-ink">Capability matrix</h2>
            <span className="label-mono text-muted">
              {overview.capabilities.length} capabilities · audit{' '}
              {overview.audit_enabled ? 'on' : 'off'}
            </span>
          </div>

          <Card className="mt-4 overflow-hidden">
            <Table>
              <THead>
                <TRow>
                  <TH className="min-w-[280px]">Capability</TH>
                  {PROJECT_ROLES.map((role) => (
                    <TH key={role} className="pd-cell text-center">
                      {role}
                    </TH>
                  ))}
                  <TH className="pd-cell text-center">Workspace owner</TH>
                </TRow>
              </THead>
              <TBody>
                {overview.capabilities.map((cap) => (
                  <TRow key={cap.key}>
                    <TD>
                      <p className="font-medium text-ink">{cap.label}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">
                        {cap.description}
                      </p>
                    </TD>
                    {PROJECT_ROLES.map((role) => (
                      <TD key={role} className="pd-cell">
                        {cap.roles.includes(role) ? <Yes /> : <No />}
                      </TD>
                    ))}
                    <TD className="pd-cell">
                      {cap.workspace_owner_allowed ? <Yes /> : <No />}
                    </TD>
                  </TRow>
                ))}
              </TBody>
            </Table>
          </Card>
        </section>

        {/* members */}
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
            <h2 className="font-display text-2xl tracking-tight text-ink">Members</h2>
            <span className="label-mono text-muted">{overview.members.length} people</span>
          </div>

          <Card className="mt-4 overflow-hidden">
            <Table>
              <THead>
                <TRow>
                  <TH>Name</TH>
                  <TH>Workspace role</TH>
                  <TH>Project role</TH>
                  <TH>Responsibility</TH>
                  <TH className="text-right">Doc grants</TH>
                </TRow>
              </THead>
              <TBody>
                {overview.members.map((member) => {
                  const isOwner = member.is_workspace_owner
                  const select = (
                    <Select
                      ariaLabel={`Project role for ${member.name || member.email}`}
                      value={member.project_role ?? 'member'}
                      onChange={(role) => requestRoleChange(member, role as ProjectRole)}
                      options={ROLE_OPTIONS}
                      disabled={!canManage || isOwner || memberMutation.isPending}
                    />
                  )
                  return (
                    <TRow key={member.user_id}>
                      <TD>
                        <p className="font-medium text-ink">{member.name || '—'}</p>
                        <p className="font-mono text-[11px] text-muted">{member.email}</p>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RoleChip role={member.ws_role ?? null} />
                          {isOwner ? (
                            <span className="pd-badge" data-tone="ember">
                              owner
                            </span>
                          ) : null}
                        </div>
                      </TD>
                      <TD>
                        {canManage && !isOwner ? (
                          select
                        ) : isOwner ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">{select}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              The workspace owner is a project head on every project.
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">{select}</span>
                            </TooltipTrigger>
                            <TooltipContent>{ROLE_REASON.manage_members}</TooltipContent>
                          </Tooltip>
                        )}
                      </TD>
                      <TD className="text-muted">{member.responsibility || '—'}</TD>
                      <TD className="text-right font-mono text-[13px] text-muted">
                        {member.document_grants}
                      </TD>
                    </TRow>
                  )
                })}
              </TBody>
            </Table>
          </Card>
        </section>

        {/* roles */}
        <section>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-2xl tracking-tight text-ink">Project roles</h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {overview.roles.map((role) => (
              <Card key={role.role} className="flex flex-col p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg tracking-tight text-ink">{role.label}</h3>
                  <RoleChip role={role.role} />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{role.summary}</p>

                <p className="label-mono mt-4 text-forest">Can</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {role.capabilities.map((key) => (
                    <li key={key} className="pd-cap-item">
                      <Check size={13} className="mt-0.5 shrink-0 text-forest" aria-hidden />
                      <span>{capabilityLabels.get(key) ?? key}</span>
                    </li>
                  ))}
                </ul>

                {role.limitations.length ? (
                  <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-3.5">
                    {role.limitations.map((limitation) => (
                      <li key={limitation} className="pd-limit">
                        {limitation}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            ))}
          </div>
        </section>

        {/* scopes */}
        <section>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-2xl tracking-tight text-ink">Access scopes</h2>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {overview.scopes.map((scope) => (
              <Card key={scope.scope} className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg tracking-tight text-ink">{scope.label}</h3>
                  {scope.scope === 'restricted' ? (
                    <span className="pd-badge" data-tone="ember">
                      <Lock size={10} aria-hidden />
                      restricted
                    </span>
                  ) : (
                    <span className="pd-badge" data-tone="forest">
                      default
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{scope.description}</p>
                <p className="label-mono mt-4 text-muted">Visible to</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {scope.visible_to.map((who) => (
                    <li key={who} className="pd-cap-item">
                      <Check size={13} className="mt-0.5 shrink-0 text-forest" aria-hidden />
                      <span>{who}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline={project?.name ?? 'Project'}
        title="Authority"
        description="Who can do what, and what each scope exposes."
        actions={
          meQuery.isFetching ? <Spinner size={13} className="text-muted" /> : null
        }
      />

      {body}

      <Modal
        open={roleChange !== null}
        onOpenChange={(o) => {
          if (!o) setRoleChange(null)
        }}
      >
        <ModalContent
          title="Demote the project head?"
          description={
            roleChange
              ? `${roleChange.member.name || roleChange.member.email} will become ${roleChange.role}. Only one head should remain on a project — this changes what they can approve, share and manage.`
              : ''
          }
        >
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setRoleChange(null)}>
              Cancel
            </Button>
            <Button
              loading={memberMutation.isPending}
              onClick={() =>
                roleChange &&
                memberMutation.mutate({
                  userId: roleChange.member.user_id,
                  role: roleChange.role,
                })
              }
            >
              Change role
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}
