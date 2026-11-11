import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { ApiError, authorityApi, handoverApi, projectsApi } from '@/lib/api'
import type {
  FindingOut,
  HandoverActionPayload,
  HandoverOut,
  ImpactAnalysis,
  ProjectMemberOut,
} from '@/lib/types'
import { renderBlocks } from '@/lib/markdownLite'
import { useCurrentProject } from '@/providers/AppProviders'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  ModalContent,
  PageHeader,
  Progress,
  RoleChip,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/app/ui'
import '@/styles/pages-handover.css'

/* ------------------------------------------------------------------ utils */

const HANDOVER_CATEGORIES = [
  'responsibilities',
  'decisions',
  'tasks',
  'risks',
  'contacts',
  'systems',
  'documents',
  'next_steps',
] as const

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.detail || err.error
  return 'Something went wrong. Please try again.'
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function relTime(iso?: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return fmtDate(iso)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function numAt(rec: Record<string, unknown>, key: string): number | null {
  const v = rec[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

type Tile = { label: string; value: number }

function tilesFromAnalysis(a: ImpactAnalysis): Tile[] {
  return [
    { label: 'Open tasks', value: a.open_tasks },
    { label: 'Decisions', value: a.decisions },
    { label: 'Systems owned', value: a.owned_systems },
    { label: 'Documents', value: a.documents_uploaded },
    { label: 'Gaps', value: a.gaps },
    { label: 'Unresolved', value: a.unresolved_items },
  ]
}

function tilesFromRecord(impact: Record<string, unknown>): Tile[] {
  const pairs: Array<[string, number | null]> = [
    ['Open tasks', numAt(impact, 'open_tasks')],
    ['Decisions', numAt(impact, 'decisions')],
    ['Systems owned', numAt(impact, 'owned_systems')],
    ['Documents', numAt(impact, 'documents_uploaded')],
    ['Gaps', numAt(impact, 'gaps')],
    ['Unresolved', numAt(impact, 'unresolved_items')],
  ]
  return pairs
    .filter((p): p is [string, number] => p[1] !== null)
    .map(([label, value]) => ({ label, value }))
}

const APPROVAL_LABELS: Record<string, string> = {
  submitted: 'submitted for review',
  approve: 'approved',
  approved: 'approved',
  request_changes: 'changes requested',
  changes_requested: 'changes requested',
  shared: 'shared with successor',
  archive: 'archived',
  archived: 'archived',
  created: 'created',
}

function approvalLabel(action: string): string {
  return APPROVAL_LABELS[action] ?? action.replace(/_/g, ' ')
}

const EVIDENCE_CLS: Record<string, string | undefined> = {
  inferred: 'border-line bg-cream text-muted',
  conflicting: 'border-ember bg-ember text-paper',
}

/* -------------------------------------------------------------- root page */

export function HandoverPage() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('h')

  const openHandover = useCallback(
    (id: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('h', id)
        return next
      })
    },
    [setParams],
  )

  const closeHandover = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('h')
      return next
    })
  }, [setParams])

  if (selectedId) return <HandoverDetail id={selectedId} onBack={closeHandover} />
  return <HandoverList onOpen={openHandover} />
}

/* ------------------------------------------------------------ list view */

function HandoverList({ onOpen }: { onOpen: (id: string) => void }) {
  const { projectId, project } = useCurrentProject()
  const [creating, setCreating] = useState(false)

  const listQuery = useQuery({
    queryKey: ['handovers', projectId],
    queryFn: () => handoverApi.list(projectId as string),
    enabled: !!projectId,
  })
  const authorityQuery = useQuery({
    queryKey: ['authority-me', projectId],
    queryFn: () => authorityApi.me(projectId as string),
    enabled: !!projectId,
    staleTime: 60_000,
  })
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectsApi.members(projectId as string),
    enabled: !!projectId,
    staleTime: 60_000,
  })

  const canInitiate = authorityQuery.data?.can['initiate_handover'] ?? false
  const members = membersQuery.data ?? []
  const memberRoles = new Map(members.map((m) => [m.user_id, m.role]))

  const newButton = (
    <Button
      onClick={() => setCreating(true)}
      disabled={!canInitiate}
      loading={authorityQuery.isPending && !!projectId}
    >
      <Plus size={15} aria-hidden />
      New handover
    </Button>
  )

  const header = (
    <PageHeader
      overline={project?.name ?? 'Project'}
      title="Handovers"
      description="Departure packets reconstructed from authorised evidence — drafted, reviewed, approved, then shared."
      actions={
        authorityQuery.isPending && projectId ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <Spinner size={14} /> Checking permissions…
          </span>
        ) : canInitiate ? (
          newButton
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">{newButton}</span>
            </TooltipTrigger>
            <TooltipContent>Only heads and leads can start a handover.</TooltipContent>
          </Tooltip>
        )
      }
    />
  )

  if (!projectId) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          icon={<FileText size={22} aria-hidden />}
          title="No project selected"
          description="Pick a project in the top bar to see its handovers."
        />
      </div>
    )
  }

  if (listQuery.isPending && projectId) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="ph-skel-card pp-skeleton" aria-hidden />
          ))}
        </div>
        <NewHandoverModal
          open={creating}
          onOpenChange={setCreating}
          members={members}
          membersLoading={membersQuery.isPending}
          onCreated={onOpen}
        />
      </div>
    )
  }

  const handovers = listQuery.data ?? []
  const loadFailed = listQuery.isError && !listQuery.data

  return (
    <div className="flex flex-col gap-6">
      {header}

      {loadFailed ? (
        <EmptyState
          title="Couldn't load handovers"
          description={errMsg(listQuery.error)}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={() => void listQuery.refetch()}>
                Try again
              </Button>
              <Button onClick={() => setCreating(true)} disabled={!canInitiate}>
                <Plus size={15} aria-hidden />
                New handover
              </Button>
            </div>
          }
        />
      ) : handovers.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} aria-hidden />}
          title="No handovers yet"
          description="Reconstruct what the team knows before knowledge walks out the door."
          action={
            <Button onClick={() => setCreating(true)} disabled={!canInitiate}>
              <Plus size={15} aria-hidden />
              New handover
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {handovers.map((h) => (
            <HandoverCard
              key={h.id}
              handover={h}
              departingRole={memberRoles.get(h.departing_user_id) ?? null}
              successorRole={h.successor_user_id ? (memberRoles.get(h.successor_user_id) ?? null) : null}
              onOpen={() => onOpen(h.id)}
            />
          ))}
        </div>
      )}

      <NewHandoverModal
        open={creating}
        onOpenChange={setCreating}
        members={members}
        membersLoading={membersQuery.isPending}
        onCreated={onOpen}
      />
    </div>
  )
}

function HandoverCard({
  handover: h,
  departingRole,
  successorRole,
  onOpen,
}: {
  handover: HandoverOut
  departingRole: string | null
  successorRole: string | null
  onOpen: () => void
}) {
  return (
    <button type="button" className="ph-hcard" onClick={onOpen}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-[17px] leading-snug text-ink">{h.title}</h3>
        <StatusBadge
          status={h.status}
          className={h.status === 'shared' ? 'shrink-0 border-forest bg-forest text-paper' : 'shrink-0'}
        />
      </div>

      <p className="text-[13px] text-muted">{h.role_transferred}</p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink">
        <span className="truncate">{h.departing_name ?? 'Unknown'}</span>
        <ArrowRight size={13} className="shrink-0 text-forest" aria-hidden />
        <span className={h.successor_name ? 'truncate' : 'text-muted'}>
          {h.successor_name ?? 'No successor yet'}
        </span>
        {departingRole ? <RoleChip role={departingRole} /> : null}
        {successorRole ? <RoleChip role={successorRole} /> : null}
      </div>

      <div className="ph-hcard-meta">
        <span>v{h.version}</span>
        <span>{h.section_count} sections</span>
        <span>{h.finding_count} findings</span>
        <span className="ml-auto">{relTime(h.updated_at ?? h.created_at)}</span>
      </div>
    </button>
  )
}

/* --------------------------------------------------- new handover modal */

function NewHandoverModal({
  open,
  onOpenChange,
  members,
  membersLoading,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: ProjectMemberOut[]
  membersLoading: boolean
  onCreated: (id: string) => void
}) {
  const { projectId } = useCurrentProject()
  const [title, setTitle] = useState('')
  const [departingId, setDepartingId] = useState<string | null>(null)
  const [successorId, setSuccessorId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [categories, setCategories] = useState<string[]>([...HANDOVER_CATEGORIES])
  const [errors, setErrors] = useState<{ title?: string; departing?: string; role?: string }>({})

  const impactQuery = useQuery({
    queryKey: ['handover-impact', projectId, departingId],
    queryFn: () => handoverApi.impact(projectId as string, departingId as string),
    enabled: open && !!projectId && !!departingId,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      handoverApi.create(projectId as string, {
        departing_user_id: departingId as string,
        successor_user_id: successorId,
        role_transferred: role.trim(),
        title: title.trim(),
        categories,
      }),
    onSuccess: (created) => {
      toast.success('Handover created.')
      reset()
      onOpenChange(false)
      onCreated(created.id)
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  function reset() {
    setTitle('')
    setDepartingId(null)
    setSuccessorId(null)
    setRole('')
    setCategories([...HANDOVER_CATEGORIES])
    setErrors({})
  }

  function toggleCategory(cat: string) {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]))
  }

  function submit() {
    const next: typeof errors = {}
    if (!title.trim()) next.title = 'Give this handover a title.'
    if (!departingId) next.departing = 'Pick the person leaving.'
    if (!role.trim()) next.role = 'Name the role being transferred.'
    setErrors(next)
    if (Object.keys(next).length) return
    createMutation.mutate()
  }

  const memberOptions = members.map((m) => ({
    value: m.user_id,
    label: `${m.name} · ${m.role}`,
  }))
  const impact = impactQuery.data

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <ModalContent
        title="New handover"
        description="Pick who's leaving, what's moving, and which slices of knowledge to reconstruct."
      >
        <div className="flex flex-col gap-4">
          <Field label="Title" htmlFor="ph-title" error={errors.title}>
            <Input
              id="ph-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Backend ownership transfer — Daniel → Priya"
              invalid={!!errors.title}
            />
          </Field>

          <Field
            label="Departing member"
            htmlFor="ph-departing"
            error={errors.departing}
            hint="Pick the person leaving."
          >
            <Select
              ariaLabel="Departing member"
              value={departingId}
              onChange={(v) => {
                setDepartingId(v)
                setErrors((e) => ({ ...e, departing: undefined }))
              }}
              options={memberOptions}
              placeholder={membersLoading ? 'Loading members…' : 'Select a member'}
              disabled={membersLoading || !memberOptions.length}
              className="ph-select-full"
            />
          </Field>

          {departingId ? (
            <div className="rounded-[3px] border border-line bg-cream px-3.5 py-3">
              <p className="label-mono mb-2 text-muted">Departure impact preview</p>
              {impactQuery.isPending ? (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Spinner size={13} /> Reading open work…
                </p>
              ) : impactQuery.isError ? (
                <p className="text-[13px] text-muted">Impact preview unavailable right now.</p>
              ) : impact ? (
                <div className="ph-tiles">
                  {tilesFromAnalysis(impact).slice(0, 5).map((t) => (
                    <div key={t.label} className="ph-tile">
                      <b>{t.value}</b>
                      <span>{t.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <Field label="Successor (optional)" htmlFor="ph-successor" hint="Who's picking this up?">
            <Select
              ariaLabel="Successor"
              value={successorId}
              onChange={setSuccessorId}
              options={memberOptions}
              placeholder="Leave unassigned for now"
              disabled={membersLoading || !memberOptions.length}
              className="ph-select-full"
            />
          </Field>

          <Field label="Role transferred" htmlFor="ph-role" error={errors.role}>
            <Input
              id="ph-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Backend ownership"
              invalid={!!errors.role}
            />
          </Field>

          <fieldset>
            <legend className="label-mono mb-1.5 text-muted">Categories to reconstruct</legend>
            <div className="ph-cat-grid">
              {HANDOVER_CATEGORIES.map((cat) => {
                const on = categories.includes(cat)
                return (
                  <label key={cat} className="ph-cat" data-on={on ? 'true' : 'false'}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleCategory(cat)}
                    />
                    <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className="mt-1 flex items-center justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={createMutation.isPending}>
              Create handover
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

/* ----------------------------------------------------------- detail view */

type DialogKind = 'submit' | 'approve' | 'changes' | 'share' | 'archive' | 'regenerate' | 'delete'

function HandoverDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { projectId } = useCurrentProject()
  const qc = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['handover', projectId, id],
    queryFn: () => handoverApi.get(projectId as string, id),
    enabled: !!projectId,
    retry: false,
  })

  const h = detailQuery.data
  const can = h?.can ?? {}

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['handover', projectId, id] })
    void qc.invalidateQueries({ queryKey: ['handovers', projectId] })
  }, [qc, projectId, id])

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectsApi.members(projectId as string),
    enabled: !!projectId && !!h?.can['share'],
    staleTime: 60_000,
  })

  const departingId = h?.departing_user_id
  const impactQuery = useQuery({
    queryKey: ['handover-impact', projectId, departingId],
    queryFn: () => handoverApi.impact(projectId as string, departingId as string),
    enabled: !!projectId && !!departingId,
  })

  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [recipient, setRecipient] = useState<string | null>(null)
  const [genPct, setGenPct] = useState(0)

  const generateMutation = useMutation({
    mutationFn: () => handoverApi.generate(projectId as string, id),
    onMutate: () => setGenPct(0),
    onSuccess: () => {
      toast.success('Report reconstructed from authorised evidence.')
      invalidate()
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const actionMutation = useMutation({
    mutationFn: (payload: HandoverActionPayload) => handoverApi.action(projectId as string, id, payload),
    onSuccess: (_data, payload) => {
      const toastBy: Record<string, string> = {
        submit: 'Submitted for review.',
        approve: 'Handover approved.',
        request_changes: 'Changes requested.',
        share: 'Shared with the successor.',
        archive: 'Handover archived.',
      }
      toast.success(toastBy[payload.action] ?? 'Done.')
      setDialog(null)
      setNote('')
      setNoteError('')
      invalidate()
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => handoverApi.delete(projectId as string, id),
    onSuccess: () => {
      toast.success('Handover deleted.')
      setDialog(null)
      invalidate()
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const exportMutation = useMutation({
    mutationFn: async () => {
      const blob = await handoverApi.markdown(projectId as string, id)
      if (!blob.size) throw new ApiError(0, 'The export came back empty. Please try again.')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `handover-${id}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      return blob.size
    },
    onSuccess: () => toast.success('Export downloaded.'),
    onError: (err) => toast.error(errMsg(err)),
  })

  useEffect(() => {
    if (!generateMutation.isPending) return
    const timer = window.setInterval(() => {
      setGenPct((p) => (p < 92 ? p + Math.max(1, Math.round((92 - p) / 8)) : p))
    }, 420)
    return () => window.clearInterval(timer)
  }, [generateMutation.isPending])

  function openDialog(kind: DialogKind) {
    setNote('')
    setNoteError('')
    if (kind === 'share') {
      setRecipient(h?.successor_user_id ?? null)
    }
    setDialog(kind)
  }

  function confirmDialog() {
    if (!dialog) return
    if (dialog === 'regenerate') {
      setDialog(null)
      generateMutation.mutate()
      return
    }
    if (dialog === 'delete') {
      setDialog(null)
      deleteMutation.mutate()
      return
    }
    if (dialog === 'changes' && !note.trim()) {
      setNoteError('Add a note so the author knows what to change.')
      return
    }
    if (dialog === 'share' && !recipient) {
      setNoteError('Choose who receives this handover.')
      return
    }
    const payload: HandoverActionPayload =
      dialog === 'submit'
        ? { action: 'submit' }
        : dialog === 'approve'
          ? { action: 'approve', note: note.trim() || null }
          : dialog === 'changes'
            ? { action: 'request_changes', note: note.trim() }
            : dialog === 'share'
              ? { action: 'share', note: note.trim() || null, recipient_user_id: recipient }
              : { action: 'archive', note: note.trim() || null }
    actionMutation.mutate(payload)
  }

  if (!projectId) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          title="No project selected"
          description="Pick a project in the top bar to open a handover."
          action={
            <Button variant="outline" onClick={onBack}>
              All handovers
            </Button>
          }
        />
      </div>
    )
  }

  if (detailQuery.isPending) return <DetailSkeleton onBack={onBack} />

  if (detailQuery.isError) {
    const notFound = detailQuery.error instanceof ApiError && detailQuery.error.status === 404
    return (
      <div className="flex flex-col gap-6">
        <button type="button" className="ph-back" onClick={onBack}>
          <ArrowLeft size={13} aria-hidden /> All handovers
        </button>
        <EmptyState
          icon={<FileText size={22} aria-hidden />}
          title={notFound ? "That handover isn't available to you." : 'Could not open this handover'}
          description={notFound ? undefined : errMsg(detailQuery.error)}
          action={
            <Button variant="outline" onClick={onBack}>
              Back to handovers
            </Button>
          }
        />
      </div>
    )
  }

  if (!h) return null

  const sections = [...h.sections].sort((a, b) => a.position - b.position)
  const findings = [...h.findings].sort((a, b) => a.position - b.position)
  const findingsBySection = new Map<string, FindingOut[]>()
  for (const f of findings) {
    const list = findingsBySection.get(f.section_key) ?? []
    list.push(f)
    findingsBySection.set(f.section_key, list)
  }
  const orphanFindings = findings.filter((f) => !sections.some((s) => s.key === f.section_key))

  const lifecycleOn =
    !!can['generate'] ||
    !!can['submit'] ||
    !!can['approve'] ||
    !!can['request_changes'] ||
    !!can['share'] ||
    !!can['archive']
  const showSuccessorBanner =
    !lifecycleOn && (h.status === 'shared' || h.status === 'approved')

  const impact = impactQuery.data
  const tiles = impact
    ? tilesFromAnalysis(impact)
    : tilesFromRecord(recordOf(h.impact))

  return (
    <div className="flex flex-col gap-6">
      <button type="button" className="ph-back" onClick={onBack}>
        <ArrowLeft size={13} aria-hidden /> All handovers
      </button>

      {/* header */}
      <header className="flex flex-col gap-3 border-b border-line pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge
            status={h.status}
            className={h.status === 'shared' ? 'border-forest bg-forest text-paper' : undefined}
          />
          <span className="font-mono text-xs tracking-widest text-muted">v{h.version}</span>
        </div>
        <h1 className="font-display text-[28px] leading-tight tracking-tight text-ink">{h.title}</h1>
        <div className="ph-meta-row">
          <span className="ph-route">
            <span>{h.departing_name ?? 'Unknown'}</span>
            <ArrowRight size={13} className="ph-arrow" aria-hidden />
            <span className={h.successor_name ? '' : 'text-muted'}>
              {h.successor_name ?? 'No successor yet'}
            </span>
          </span>
          <span>{h.role_transferred}</span>
          <span>Created {fmtDate(h.created_at)}</span>
          <span>Updated {fmtDate(h.updated_at)}</span>
          {h.approved_at ? <span>Approved {fmtDate(h.approved_at)}</span> : null}
          {h.shared_at ? <span>Shared {fmtDate(h.shared_at)}</span> : null}
        </div>
      </header>

      {/* action bar */}
      <div className="flex flex-col gap-4">
        <div className="ph-actionbar">
          {can['generate'] ? (
            <Button
              variant={h.section_count > 0 ? 'outline' : 'primary'}
              loading={generateMutation.isPending}
              onClick={() => {
                if (h.section_count > 0) openDialog('regenerate')
                else generateMutation.mutate()
              }}
            >
              {!generateMutation.isPending && <RefreshCw size={14} aria-hidden />}
              {h.section_count > 0 ? 'Regenerate' : 'Generate report'}
            </Button>
          ) : null}

          {can['submit'] ? (
            <Button variant="outline" onClick={() => openDialog('submit')}>
              Submit for review
            </Button>
          ) : null}

          {can['approve'] ? (
            <Button onClick={() => openDialog('approve')}>Approve</Button>
          ) : null}

          {can['request_changes'] ? (
            <Button variant="outline" onClick={() => openDialog('changes')}>
              Request changes
            </Button>
          ) : null}

          {can['share'] ? (
            <Button variant="outline" onClick={() => openDialog('share')}>
              Share with successor
            </Button>
          ) : null}

          {can['archive'] ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="danger" onClick={() => openDialog('archive')}>
                  <Archive size={14} aria-hidden />
                  Archive
                </Button>
              </TooltipTrigger>
              <TooltipContent>Files it away — it stays exportable.</TooltipContent>
            </Tooltip>
          ) : null}

          {can['delete'] ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="danger" onClick={() => openDialog('delete')}>
                  <Trash2 size={14} aria-hidden />
                  Delete
                </Button>
              </TooltipTrigger>
              <TooltipContent>Permanently removes this handover.</TooltipContent>
            </Tooltip>
          ) : null}

          {can['export'] ? (
            <Button
              variant="outline"
              loading={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              {!exportMutation.isPending && <Download size={14} aria-hidden />}
              Export .md
            </Button>
          ) : null}
        </div>

        {generateMutation.isPending ? (
          <div className="ph-gen" role="status">
            <p className="ph-gen-status">
              <Spinner size={13} /> Reconstructing from authorised evidence…
            </p>
            <Progress value={genPct} label="Reconstruction" />
            <p className="text-[13px] text-muted">
              Reading the documents this person can access — this can take up to half a minute.
            </p>
          </div>
        ) : null}

        {showSuccessorBanner ? (
          <div className="ph-banner">
            You're viewing this handover as the successor. It's yours to read — review actions stay
            with the heads.
          </div>
        ) : null}
      </div>

      {/* impact strip */}
      {tiles.length > 0 ? (
        <section className="rounded-[4px] border border-line bg-paper px-5 py-4">
          <p className="label-mono mb-3 text-forest">Departure impact</p>
          <div className="ph-tiles">
            {tiles.map((t) => (
              <div key={t.label} className="ph-tile">
                <b>{t.value}</b>
                <span>{t.label}</span>
              </div>
            ))}
          </div>
          {impact && impact.items.length > 0 ? (
            <details className="ph-details">
              <summary>
                <ChevronDown size={13} className="ph-caret" aria-hidden />
                {impact.items.length} tracked items
              </summary>
              <div className="mt-2">
                {impact.items.map((item, i) => (
                  <div key={`${item.label}-${i}`} className="ph-impact-item">
                    <span className="ph-impact-label">{item.label}</span>
                    <span className="ph-impact-meta">
                      {item.type}
                      {item.status ? ` · ${item.status}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* body: sections + rail */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {sections.length === 0 && findings.length === 0 ? (
            <EmptyState
              icon={<FileText size={22} aria-hidden />}
              title="No sections yet"
              description={
                can['generate']
                  ? 'Generate the report to reconstruct this handover from authorised evidence.'
                  : 'Sections appear once the report has been generated.'
              }
              action={
                can['generate'] ? (
                  <Button
                    loading={generateMutation.isPending}
                    onClick={() => {
                      if (h.section_count > 0) openDialog('regenerate')
                      else generateMutation.mutate()
                    }}
                  >
                    {!generateMutation.isPending && <RefreshCw size={14} aria-hidden />}
                    Generate report
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {sections.map((s, i) => (
                <article key={s.id} className="ph-section">
                  <p className="ph-section-overline">
                    Section {pad2(i + 1)} · {s.key.replace(/_/g, ' ')}
                  </p>
                  <h2 className="ph-section-title">{s.title}</h2>
                  {renderBlocks(s.body)}
                  {(findingsBySection.get(s.key) ?? []).map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      canReview={!!can['review_findings']}
                      onChanged={invalidate}
                    />
                  ))}
                </article>
              ))}

              {orphanFindings.length > 0 ? (
                <article className="ph-section mt-4">
                  <p className="ph-section-overline">Findings</p>
                  <h2 className="ph-section-title">Raised across the report</h2>
                  {orphanFindings.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      canReview={!!can['review_findings']}
                      onChanged={invalidate}
                    />
                  ))}
                </article>
              ) : null}
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-24">
          <div className="ph-rail-card">
            <p className="label-mono text-muted">History</p>
            {h.approvals.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted">No actions yet.</p>
            ) : (
              <div className="ph-timeline">
                {[...h.approvals]
                  .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
                  .map((a) => (
                    <div key={a.id} className="ph-tl-item">
                      <p className="ph-tl-action">{approvalLabel(a.action)}</p>
                      <p className="ph-tl-meta">
                        {a.actor_name ?? 'System'} · {relTime(a.created_at)}
                      </p>
                      {a.note ? <p className="ph-tl-note">{a.note}</p> : null}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="ph-rail-card">
            <p className="label-mono text-muted">Report</p>
            <dl className="mt-3 flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Sections</dt>
                <dd className="font-mono text-ink">{h.section_count}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Findings</dt>
                <dd className="font-mono text-ink">{h.finding_count}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Version</dt>
                <dd className="font-mono text-ink">v{h.version}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      {/* action dialogs */}
      <Dialogs
        kind={dialog}
        note={note}
        noteError={noteError}
        recipient={recipient}
        members={membersQuery.data ?? []}
        membersLoading={membersQuery.isPending}
        hasSections={h.section_count > 0}
        pending={actionMutation.isPending || generateMutation.isPending}
        onNote={(v) => {
          setNote(v)
          if (noteError) setNoteError('')
        }}
        onRecipient={(v) => {
          setRecipient(v)
          if (noteError) setNoteError('')
        }}
        onClose={() => setDialog(null)}
        onConfirm={confirmDialog}
      />
    </div>
  )
}

/* ------------------------------------------------------------- dialogs */

function Dialogs({
  kind,
  note,
  noteError,
  recipient,
  members,
  membersLoading,
  hasSections,
  pending,
  onNote,
  onRecipient,
  onClose,
  onConfirm,
}: {
  kind: DialogKind | null
  note: string
  noteError: string
  recipient: string | null
  members: ProjectMemberOut[]
  membersLoading: boolean
  hasSections: boolean
  pending: boolean
  onNote: (v: string) => void
  onRecipient: (v: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const meta: Record<DialogKind, { title: string; description: string; confirm: string }> = {
    regenerate: {
      title: 'Regenerate this report?',
      description: hasSections
        ? 'This replaces the current sections and findings with a fresh reconstruction from authorised evidence. Review work done on existing findings will be lost.'
        : 'Reconstruct this handover from authorised evidence.',
      confirm: 'Regenerate',
    },
    submit: {
      title: 'Submit for review?',
      description: 'Send this handover to the reviewer. Findings can still be edited until it is approved.',
      confirm: 'Submit for review',
    },
    approve: {
      title: 'Approve this handover?',
      description: 'Approving marks the reconstruction as final — it can then be shared with the successor.',
      confirm: 'Approve',
    },
    changes: {
      title: 'Request changes',
      description: 'Tell the author what needs another pass. A note is required.',
      confirm: 'Request changes',
    },
    share: {
      title: 'Share with successor',
      description: 'The recipient gets read access to this approved handover.',
      confirm: 'Share',
    },
    archive: {
      title: 'Archive this handover?',
      description: 'It drops out of the active list. You can still find it, read it and export it.',
      confirm: 'Archive',
    },
    delete: {
      title: 'Delete this handover?',
      description: 'This permanently removes the handover and all its sections, findings and approvals. It cannot be undone.',
      confirm: 'Delete',
    },
  }

  if (!kind) return null
  const m = meta[kind]

  return (
    <Modal open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <ModalContent title={m.title} description={m.description}>
        <div className="flex flex-col gap-4">
          {kind === 'approve' || kind === 'archive' || kind === 'share' || kind === 'delete' ? (
            <Field label="Note (optional)" htmlFor="ph-note">
              <Textarea
                id="ph-note"
                value={note}
                onChange={(e) => onNote(e.target.value)}
                placeholder={kind === 'archive' ? 'Why is this being filed away?' : 'Anything the record should note…'}
                className="min-h-[72px]"
              />
            </Field>
          ) : null}

          {kind === 'changes' ? (
            <Field label="What needs changing?" htmlFor="ph-note" error={noteError}>
              <Textarea
                id="ph-note"
                value={note}
                onChange={(e) => onNote(e.target.value)}
                placeholder="The systems section is missing the payments on-call rota…"
                invalid={!!noteError}
              />
            </Field>
          ) : null}

          {kind === 'share' ? (
            <Field label="Recipient" error={noteError} hint="Pre-selected to the handover's successor.">
              <Select
                ariaLabel="Recipient"
                value={recipient}
                onChange={onRecipient}
                options={members.map((mem) => ({ value: mem.user_id, label: `${mem.name} · ${mem.role}` }))}
                placeholder={membersLoading ? 'Loading members…' : 'Select a member'}
                disabled={membersLoading || !members.length}
                className="ph-select-full"
              />
            </Field>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={kind === 'archive' || kind === 'delete' ? 'danger' : 'primary'}
              loading={pending}
              onClick={onConfirm}
            >
              {m.confirm}
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

/* ------------------------------------------------------------- findings */

function FindingCard({
  finding: f,
  canReview,
  onChanged,
}: {
  finding: FindingOut
  canReview: boolean
  onChanged: () => void
}) {
  const { projectId } = useCurrentProject()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [note, setNote] = useState('')
  const [content, setContent] = useState('')
  const [editError, setEditError] = useState('')

  const reviewMutation = useMutation({
    mutationFn: (payload: { action: 'accept' | 'reject' | 'edit'; content?: string; note?: string }) =>
      handoverApi.reviewFinding(projectId as string, f.handover_id, f.id, payload),
    onSuccess: (_d, payload) => {
      toast.success(
        payload.action === 'accept'
          ? 'Finding accepted.'
          : payload.action === 'reject'
            ? 'Finding rejected.'
            : 'Finding updated.',
      )
      setRejectOpen(false)
      setEditOpen(false)
      setNote('')
      setEditError('')
      onChanged()
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  function startEdit() {
    setContent(f.content)
    setEditError('')
    setEditOpen(true)
  }

  function saveEdit() {
    const next = content.trim()
    if (!next) {
      setEditError('The finding cannot be empty.')
      return
    }
    if (next === f.content.trim()) {
      setEditError('Make a change before saving.')
      return
    }
    reviewMutation.mutate({ action: 'edit', content: next })
  }

  return (
    <div className="ph-finding">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-medium text-ink">{f.label}</span>
        <StatusBadge status={f.evidence_status} className={EVIDENCE_CLS[f.evidence_status]} />
        {f.review_state !== 'pending' ? (
          <span className="ph-review-chip" data-state={f.review_state}>
            {f.review_state === 'accepted' ? <Check size={11} aria-hidden /> : null}
            {f.review_state === 'rejected' ? <X size={11} aria-hidden /> : null}
            {f.review_state === 'edited' ? <Pencil size={11} aria-hidden /> : null}
            {f.review_state}
          </span>
        ) : null}
      </div>

      <div className="mt-2">{renderBlocks(f.content)}</div>

      {f.reviewer_note ? <p className="ph-reviewer-note">Reviewer note: {f.reviewer_note}</p> : null}

      {f.evidence.length > 0 ? (
        <div className="mt-3">
          <p className="label-mono mb-1.5 text-muted">Evidence</p>
          {f.evidence.map((ev, i) => {
            const open = expanded === i
            const quote = ev.quote ?? ''
            return (
              <div key={`${ev.chunk_id ?? 'ev'}-${i}`} className="ph-ev">
                <button
                  type="button"
                  className="ph-ev-toggle"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : i)}
                >
                  <span className="ph-ev-quote" data-clamped={!open && quote.length > 140 ? 'true' : 'false'}>
                    “{quote}”
                  </span>
                </button>
                <div className="ph-ev-foot">
                  <span>{ev.document_name ?? 'Document'}</span>
                  {ev.page_number != null ? <span>p. {ev.page_number}</span> : null}
                  {ev.section ? <span>{ev.section}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {canReview ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button
            size="sm"
            variant="outline"
            loading={reviewMutation.isPending && reviewMutation.variables?.action === 'accept'}
            onClick={() => reviewMutation.mutate({ action: 'accept' })}
          >
            <Check size={13} aria-hidden />
            Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setNote(''); setRejectOpen(true) }}>
            <X size={13} aria-hidden />
            Reject
          </Button>
          <Button size="sm" variant="ghost" onClick={startEdit}>
            <Pencil size={13} aria-hidden />
            Edit
          </Button>
        </div>
      ) : null}

      <Modal open={rejectOpen} onOpenChange={setRejectOpen}>
        <ModalContent title="Reject this finding" description="A note helps the author fix it next pass.">
          <div className="flex flex-col gap-4">
            <Field label="Note (optional)" htmlFor="ph-reject-note">
              <Textarea
                id="ph-reject-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-[72px]"
                placeholder="This contradicts the on-call rota in the runbook…"
              />
            </Field>
            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={reviewMutation.isPending && reviewMutation.variables?.action === 'reject'}
                onClick={() =>
                  reviewMutation.mutate({ action: 'reject', note: note.trim() || undefined })
                }
              >
                Reject finding
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>

      <Modal open={editOpen} onOpenChange={setEditOpen}>
        <ModalContent title="Edit finding" description="Rewrite the finding — your version is recorded as the edit.">
          <div className="flex flex-col gap-4">
            <Field label="Finding" htmlFor="ph-edit-content" error={editError}>
              <Textarea
                id="ph-edit-content"
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  if (editError) setEditError('')
                }}
                invalid={!!editError}
                className="min-h-[140px]"
              />
            </Field>
            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={reviewMutation.isPending && reviewMutation.variables?.action === 'edit'}
                onClick={saveEdit}
              >
                Save change
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------- skeleton */

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading handover">
      <button type="button" className="ph-back" onClick={onBack}>
        <ArrowLeft size={13} aria-hidden /> All handovers
      </button>
      <div className="flex flex-col gap-3 border-b border-line pb-6">
        <div className="h-5 w-28 pp-skeleton" aria-hidden />
        <div className="h-8 w-2/3 pp-skeleton" aria-hidden />
        <div className="h-4 w-1/2 pp-skeleton" aria-hidden />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 pp-skeleton" aria-hidden />
        ))}
      </div>
      <div className="h-56 pp-skeleton" aria-hidden />
      <div className="h-56 pp-skeleton" aria-hidden />
      <span className="sr-only">Loading handover…</span>
    </div>
  )
}
