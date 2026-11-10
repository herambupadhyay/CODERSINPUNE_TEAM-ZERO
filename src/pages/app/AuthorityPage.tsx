import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Check,
  Lock,
  Pencil,
  ShieldCheck,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react'
import { ApiError, authorityApi, documentsApi, projectsApi } from '@/lib/api'
import type { AuthorityDocumentAccess, AuthorityMemberOut, ProjectRole } from '@/lib/types'
import { useCurrentProject, useSession } from '@/providers/AppProviders'
import '@/styles/pages-data.css'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  ModalContent,
  PageHeader,
  RoleChip,
  Select,
  Spinner,
  StatusBadge,
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

const ROLE_REASON = {
  manage:
    'Only the project head can change roles, responsibilities or document access.',
}

function Yes() {
  return (
    <span className="pd-yes mx-auto inline-flex items-center justify-center w-5 h-5 rounded-sm border border-forest bg-forest/10" aria-label="Allowed">
      <Check size={11} strokeWidth={2} />
    </span>
  )
}

function No() {
  return (
    <span className="pd-no mx-auto inline-flex items-center justify-center w-5 h-5 rounded-sm border border-line bg-transparent" aria-label="Not allowed">
      <span className="w-1 h-1 rounded-sm bg-transparent" />
    </span>
  )
}

/* ------------------------------------------------------- document access */

function AccessRow({
  doc,
  members,
  busy,
  onAdd,
  onRevoke,
}: {
  doc: AuthorityDocumentAccess
  members: AuthorityMemberOut[]
  busy: boolean
  onAdd: (userId: string) => void
  onRevoke: (userId: string) => void
}) {
  const [selected, setSelected] = useState('')
  const grantedIds = new Set(doc.grants.map((grant) => grant.user_id))
  const options = members
    .filter(
      (member) =>
        !member.is_workspace_owner &&
        member.project_role !== 'head' &&
        !grantedIds.has(member.user_id),
    )
    .map((member) => ({
      value: member.user_id,
      label: `${member.name || member.email} · ${member.project_role ?? 'member'}`,
    }))

  return (
    <div className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Lock size={13} className="shrink-0 text-ember" aria-hidden />
          <p className="truncate text-sm font-medium text-ink">{doc.name}</p>
          <StatusBadge status={doc.status} />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {doc.grants.length} granted
        </span>
      </div>

      {doc.grants.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {doc.grants.map((grant) => (
            <li
              key={grant.user_id}
              className="inline-flex items-center gap-1.5 rounded-[3px] border border-line bg-paper px-2 py-1"
            >
              <span className="text-xs text-ink">{grant.name || grant.email}</span>
              <button
                type="button"
                aria-label={`Revoke access for ${grant.name || grant.email}`}
                disabled={busy}
                onClick={() => onRevoke(grant.user_id)}
                className="text-muted transition-colors duration-150 hover:text-ember disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">
          No explicit grants — only the head and workspace owner can read it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          ariaLabel={`Member to grant access to ${doc.name}`}
          value={selected || null}
          onChange={setSelected}
          options={options}
          placeholder={options.length ? 'Choose a member…' : 'Everyone already has access'}
          className="max-w-[280px]"
          disabled={!options.length || busy}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || busy}
          onClick={() => {
            if (!selected) return
            onAdd(selected)
            setSelected('')
          }}
        >
          <UserPlus size={13} aria-hidden />
          Grant access
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export function AuthorityPage() {
  const { project, projectId } = useCurrentProject()
  const { user } = useSession()
  const qc = useQueryClient()
  const [roleChange, setRoleChange] = useState<{
    member: AuthorityMemberOut
    role: ProjectRole
  } | null>(null)
  const [responsibilityEdit, setResponsibilityEdit] = useState<{
    member: AuthorityMemberOut
    value: string
  } | null>(null)
  const [removeMember, setRemoveMember] = useState<AuthorityMemberOut | null>(null)

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
  const canEditAuthority = !!can.manage_authority

  const accessQuery = useQuery({
    queryKey: ['authorityAccess', projectId],
    queryFn: () => authorityApi.access(projectId as string),
    enabled: !!projectId && canEditAuthority,
  })

  const memberMutation = useMutation({
    mutationFn: ({
      userId,
      role,
      responsibility,
      status,
    }: {
      userId: string
      role?: ProjectRole
      responsibility?: string | null
      status?: 'active' | 'deactivated'
    }) =>
      projectsApi.updateMember(projectId as string, userId, {
        ...(role ? { role } : {}),
        ...(responsibility !== undefined ? { responsibility } : {}),
        ...(status ? { status } : {}),
      }),
    onSuccess: () => {
      toast.success('Authority updated.')
      setRoleChange(null)
      setResponsibilityEdit(null)
      setRemoveMember(null)
      void qc.invalidateQueries({ queryKey: ['authority', projectId] })
      void qc.invalidateQueries({ queryKey: ['authorityMe', projectId] })
      void qc.invalidateQueries({ queryKey: ['authorityAccess', projectId] })
      void qc.invalidateQueries({ queryKey: ['projectMembers', projectId] })
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const capMutation = useMutation({
    mutationFn: ({ key, role, enabled }: { key: string; role: ProjectRole; enabled: boolean }) =>
      authorityApi.updateCapability(projectId as string, { key, role, enabled }),
    onSuccess: () => {
      toast.success('Capability updated.')
      void qc.invalidateQueries({ queryKey: ['authority', projectId] })
      void qc.invalidateQueries({ queryKey: ['authorityMe', projectId] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const grantMutation = useMutation({
    mutationFn: ({ docId, userId }: { docId: string; userId: string }) =>
      documentsApi.addGrant(projectId as string, docId, userId),
    onSuccess: () => {
      toast.success('Access granted.')
      void qc.invalidateQueries({ queryKey: ['authorityAccess', projectId] })
      void qc.invalidateQueries({ queryKey: ['authority', projectId] })
      void qc.invalidateQueries({ queryKey: ['documents', projectId] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const revokeMutation = useMutation({
    mutationFn: ({ docId, userId }: { docId: string; userId: string }) =>
      documentsApi.removeGrant(projectId as string, docId, userId),
    onSuccess: () => {
      toast.success('Access revoked.')
      void qc.invalidateQueries({ queryKey: ['authorityAccess', projectId] })
      void qc.invalidateQueries({ queryKey: ['authority', projectId] })
      void qc.invalidateQueries({ queryKey: ['documents', projectId] })
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

  const toggleCapability = (key: string, role: ProjectRole) => {
    if (!canEditAuthority) return
    const cap = overview?.capabilities.find((c) => c.key === key)
    const currentlyEnabled = cap?.roles.includes(role) ?? false
    capMutation.mutate({ key, role, enabled: !currentlyEnabled })
  }

  const overview = overviewQuery.data
  const head = overview?.members.find((member) => member.project_role === 'head')

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
    const accessDocs = accessQuery.data?.documents ?? []

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

        {/* edit banner */}
        {canEditAuthority ? (
          <div className="flex items-start gap-3 rounded-[4px] border border-forest/30 bg-forest/5 px-4 py-3">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-forest" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">
                You are the project head — authority is yours to edit.
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Change roles, reassign responsibilities, and grant or revoke access to
                restricted documents. Every change is written to the audit trail.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-[4px] border border-line bg-cream px-4 py-3">
            <Lock size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">Authority is read-only for you.</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Only the project head
                {head ? ` (${head.name || head.email})` : ''} can change roles,
                responsibilities or document access.
              </p>
            </div>
          </div>
        )}

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
                        <button
                          type="button"
                          onClick={() => toggleCapability(cap.key, role)}
                          disabled={!canEditAuthority}
                          className={
                            !canEditAuthority
                              ? 'flex items-center justify-center w-full h-full rounded-[3px] opacity-50 cursor-not-allowed transition-colors duration-150'
                              : cap.roles.includes(role)
                                ? 'flex items-center justify-center w-full h-full rounded-[3px] bg-forest/10 hover:bg-forest/20 transition-colors duration-150'
                                : 'flex items-center justify-center w-full h-full rounded-[3px] bg-transparent hover:bg-cream transition-colors duration-150'
                          }
                          title={
                            canEditAuthority
                              ? `Toggle ${cap.label} for ${role}`
                              : 'Only the project head can edit authority capabilities.'
                          }
                        >
                          {cap.roles.includes(role) ? <Yes /> : <No />}
                        </button>
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
            <span className="label-mono text-muted">
              {overview.members.length} people
              {canEditAuthority ? ' · editable' : ' · read-only'}
            </span>
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
                  {canEditAuthority ? <TH className="text-right">Actions</TH> : null}
                </TRow>
              </THead>
              <TBody>
                {overview.members.map((member) => {
                  const isOwner = member.is_workspace_owner
                  const isSelf = member.user_id === user?.id
                  const select = (
                    <Select
                      ariaLabel={`Project role for ${member.name || member.email}`}
                      value={member.project_role ?? 'member'}
                      onChange={(role) => requestRoleChange(member, role as ProjectRole)}
                      options={ROLE_OPTIONS}
                      disabled={!canEditAuthority || isOwner || memberMutation.isPending}
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
                        {canEditAuthority && !isOwner ? (
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
                            <TooltipContent>{ROLE_REASON.manage}</TooltipContent>
                          </Tooltip>
                        )}
                      </TD>
                      <TD className="text-muted">{member.responsibility || '—'}</TD>
                      <TD className="text-right font-mono text-[13px] text-muted">
                        {member.document_grants}
                      </TD>
                      {canEditAuthority ? (
                        <TD>
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Edit responsibility for ${member.name || member.email}`}
                                  disabled={isOwner || memberMutation.isPending}
                                  onClick={() =>
                                    setResponsibilityEdit({
                                      member,
                                      value: member.responsibility ?? '',
                                    })
                                  }
                                >
                                  <Pencil size={13} aria-hidden />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit responsibility</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Remove ${member.name || member.email} from project`}
                                  disabled={isOwner || isSelf || memberMutation.isPending}
                                  onClick={() => setRemoveMember(member)}
                                >
                                  <UserMinus size={13} aria-hidden />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isOwner
                                  ? 'The workspace owner cannot be removed.'
                                  : isSelf
                                    ? 'You cannot remove yourself.'
                                    : 'Remove from project'}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TD>
                      ) : null}
                    </TRow>
                  )
                })}
              </TBody>
            </Table>
          </Card>
        </section>

        {/* document access (head only) */}
        {canEditAuthority ? (
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 className="font-display text-2xl tracking-tight text-ink">
                Document access
              </h2>
              <span className="label-mono text-muted">
                {accessDocs.length} restricted document{accessDocs.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Restricted documents stay invisible to everyone without an explicit grant.
              Grant access to a specific person, or revoke it to lock a lead out.
            </p>

            <Card className="mt-4 overflow-hidden">
              {accessQuery.isPending ? (
                <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted">
                  <Spinner size={14} /> Loading document access…
                </div>
              ) : accessQuery.isError ? (
                <div className="px-4 py-6 text-sm text-ember">
                  {accessQuery.error instanceof ApiError
                    ? accessQuery.error.detail || accessQuery.error.error
                    : 'Document access could not be loaded.'}
                </div>
              ) : accessDocs.length ? (
                accessDocs.map((doc) => (
                  <AccessRow
                    key={doc.document_id}
                    doc={doc}
                    members={overview.members}
                    busy={grantMutation.isPending || revokeMutation.isPending}
                    onAdd={(userId) =>
                      grantMutation.mutate({ docId: doc.document_id, userId })
                    }
                    onRevoke={(userId) =>
                      revokeMutation.mutate({ docId: doc.document_id, userId })
                    }
                  />
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">
                  No restricted documents in this project yet. Move a document to the
                  restricted scope from the Documents page to manage it here.
                </div>
              )}
            </Card>
          </section>
        ) : null}

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
        description="Who can do what, and what each scope exposes. Only the head can edit it."
        actions={
          meQuery.isFetching ? <Spinner size={13} className="text-muted" /> : null
        }
      />

      {body}

      {/* demote-head confirmation */}
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

      {/* responsibility editor */}
      <Modal
        open={responsibilityEdit !== null}
        onOpenChange={(o) => {
          if (!o) setResponsibilityEdit(null)
        }}
      >
        <ModalContent
          title="Edit responsibility"
          description={
            responsibilityEdit
              ? `What is ${responsibilityEdit.member.name || responsibilityEdit.member.email} responsible for on this project?`
              : ''
          }
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!responsibilityEdit) return
              memberMutation.mutate({
                userId: responsibilityEdit.member.user_id,
                responsibility: responsibilityEdit.value.trim() || null,
              })
            }}
          >
            <Field label="Responsibility" htmlFor="authority-responsibility">
              <Input
                id="authority-responsibility"
                value={responsibilityEdit?.value ?? ''}
                maxLength={140}
                placeholder="e.g. Ledger service owner"
                onChange={(event) =>
                  setResponsibilityEdit((current) =>
                    current ? { ...current, value: event.target.value } : current,
                  )
                }
              />
            </Field>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setResponsibilityEdit(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={memberMutation.isPending}>
                Save
              </Button>
            </div>
          </form>
        </ModalContent>
      </Modal>

      {/* remove member confirmation */}
      <Modal
        open={removeMember !== null}
        onOpenChange={(o) => {
          if (!o) setRemoveMember(null)
        }}
      >
        <ModalContent
          title="Remove from project?"
          description={
            removeMember
              ? `${removeMember.name || removeMember.email} will lose access to this project's documents, knowledge and handovers. They stay in the workspace.`
              : ''
          }
        >
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoveMember(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={memberMutation.isPending}
              onClick={() =>
                removeMember &&
                memberMutation.mutate({
                  userId: removeMember.user_id,
                  status: 'deactivated',
                })
              }
            >
              Remove member
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}
