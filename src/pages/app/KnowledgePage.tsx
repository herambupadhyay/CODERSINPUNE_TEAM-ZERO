import { useEffect, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Check,
  ChevronDown,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { ApiError, authorityApi, knowledgeApi } from '@/lib/api'
import type {
  AccessScope,
  EvidenceStatus,
  KnowledgeItemCreate,
  KnowledgeItemOut,
  KnowledgeReviewPayload,
  KnowledgeType,
  ReviewState,
} from '@/lib/types'
import { useCurrentProject } from '@/providers/AppProviders'
import '@/styles/pages-data.css'
import {
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  ModalContent,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/app/ui'

/* ------------------------------------------------------------------ utils */

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.detail || err.error
  return 'Something went wrong. Please try again.'
}

const TYPE_LABEL: Record<KnowledgeType, string> = {
  decision: 'Decision',
  task: 'Task',
  risk: 'Risk',
  dependency: 'Dependency',
  person: 'Person',
  gap: 'Gap',
  question: 'Question',
  contact: 'Contact',
}

const TYPE_TONE: Record<KnowledgeType, string> = {
  decision: 'text-forest',
  task: 'text-ink',
  risk: 'text-ember',
  dependency: 'text-forest-deep',
  person: 'text-forest',
  gap: 'text-ember',
  question: 'text-muted',
  contact: 'text-muted',
}

const TYPES = Object.keys(TYPE_LABEL) as KnowledgeType[]

const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  supported: 'supported',
  inferred: 'inferred',
  conflicting: 'conflicting',
  missing: 'missing',
}

const EVIDENCE_TONE: Record<EvidenceStatus, string> = {
  supported: 'forest',
  inferred: '',
  conflicting: 'ember-solid',
  missing: 'outline-ember',
}

const EVIDENCES = Object.keys(EVIDENCE_LABEL) as EvidenceStatus[]

const REVIEW_OPTIONS = [
  { value: '', label: 'All review states' },
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'corrected', label: 'Corrected' },
]

function evidenceTone(evidence: EvidenceStatus): Record<string, string> {
  return EVIDENCE_TONE[evidence] ? { 'data-tone': EVIDENCE_TONE[evidence] } : {}
}

function ReviewBadge({ state }: { state: ReviewState }) {
  if (state === 'verified') {
    return (
      <span className="pd-badge" data-tone="forest">
        <Check size={10} aria-hidden />
        verified
      </span>
    )
  }
  if (state === 'rejected') {
    return (
      <span className="pd-badge" data-tone="ember">
        <X size={10} aria-hidden />
        rejected
      </span>
    )
  }
  if (state === 'corrected') {
    return (
      <span className="pd-badge" data-tone="forest-soft">
        <Pencil size={10} aria-hidden />
        corrected
      </span>
    )
  }
  return (
    <span className="pd-badge">
      <span
        aria-hidden
        className="pd-dot pd-pulse"
        style={{ backgroundColor: 'currentColor' }}
      />
      pending
    </span>
  )
}

function EvidenceList({ item }: { item: KnowledgeItemOut }) {
  if (!item.evidence.length) {
    return <p className="text-sm text-muted">No evidence references recorded.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {item.evidence.map((ref, i) => (
        <details key={`${item.id}-ev-${i}`} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[3px] border border-line bg-paper px-3 py-2 transition-colors duration-150 hover:border-ink/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest">
            <ChevronDown
              size={13}
              className="shrink-0 text-muted transition-transform duration-150 group-open:rotate-180"
              aria-hidden
            />
            <span className="min-w-0 truncate font-mono text-[11px] text-muted">
              {ref.document_name ?? 'source document'}
              {ref.page_number ? ` · p. ${ref.page_number}` : ''}
              {ref.section ? ` · ${ref.section}` : ''}
            </span>
          </summary>
          <div className="mt-1.5">
            <p className="pd-quote">{ref.quote ?? '—'}</p>
          </div>
        </details>
      ))}
    </div>
  )
}

function AttributesGrid({ item }: { item: KnowledgeItemOut }) {
  const entries = Object.entries(item.attributes ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  )
  if (!entries.length) return null
  return (
    <div className="pd-attr-grid">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <span className="pd-attr-k">{key}</span>
          <span className="pd-attr-v">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------- modals */

function CorrectModal({
  item,
  onClose,
  onDone,
  pending,
}: {
  item: KnowledgeItemOut
  onClose: () => void
  onDone: (payload: KnowledgeReviewPayload) => void
  pending: boolean
}) {
  const [text, setText] = useState(item.corrected_text ?? item.description)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!text.trim()) {
      setError('Provide the corrected text.')
      return
    }
    onDone({
      action: 'correct',
      corrected_text: text.trim(),
      note: note.trim() || null,
    })
    setError(null)
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent
        title="Correct this finding"
        description="Replace the extracted text with the verified wording."
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="label-mono mb-1.5 text-muted">Corrected text</p>
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setError(null)
              }}
              invalid={!!error}
              aria-label="Corrected text"
              className="min-h-[120px]"
            />
            <p className="mt-1.5 text-xs text-muted">
              Pre-filled with {item.corrected_text ? 'your previous correction' : 'the current extraction'}.
            </p>
          </div>
          <div>
            <p className="label-mono mb-1.5 text-muted">Note (optional)</p>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this needed correcting"
              aria-label="Correction note"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-ember">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button loading={pending} onClick={submit}>
              <Pencil size={14} aria-hidden />
              Save correction
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

function CommentModal({
  onClose,
  onDone,
  pending,
}: {
  onClose: () => void
  onDone: (payload: KnowledgeReviewPayload) => void
  pending: boolean
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!note.trim()) {
      setError('Write a comment before sending.')
      return
    }
    onDone({ action: 'comment', note: note.trim() })
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent
        title="Comment on this finding"
        description="Comments are recorded in the review history for everyone with access."
      >
        <div className="flex flex-col gap-4">
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setError(null)
            }}
            invalid={!!error}
            placeholder="What should the reviewer know?"
            aria-label="Comment"
            className="min-h-[110px]"
          />
          {error ? (
            <p role="alert" className="text-sm text-ember">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button loading={pending} onClick={submit}>
              <MessageSquare size={14} aria-hidden />
              Post comment
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

function CreateModal({
  onClose,
  onDone,
  pending,
}: {
  onClose: () => void
  onDone: (payload: KnowledgeItemCreate) => void
  pending: boolean
}) {
  const [type, setType] = useState<KnowledgeType>('decision')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [evidenceStatus, setEvidenceStatus] = useState<EvidenceStatus>('supported')
  const [accessScope, setAccessScope] = useState<AccessScope>('project')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!title.trim()) {
      setError('Provide a title.')
      return
    }
    onDone({
      type,
      title: title.trim(),
      description: description.trim() || '',
      reasoning: reasoning.trim() || null,
      evidence_status: evidenceStatus,
      access_scope: accessScope,
    })
    setError(null)
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent title="Create knowledge item" description="Add a decision, task, risk, dependency, person, gap, question or contact manually.">
        <div className="flex flex-col gap-4">
          <div>
            <p className="label-mono mb-1.5 text-muted">Type</p>
            <Select
              value={type}
              onChange={(v) => setType(v as KnowledgeType)}
              options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
              className="min-w-[240px]"
            />
          </div>
          <div>
            <p className="label-mono mb-1.5 text-muted">Title</p>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              invalid={!!error}
              placeholder="e.g. Sarah owns retry-worker"
              aria-label="Title"
            />
          </div>
          <div>
            <p className="label-mono mb-1.5 text-muted">Description</p>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was decided, owned, or identified…"
              aria-label="Description"
              className="min-h-[100px]"
            />
          </div>
          <div>
            <p className="label-mono mb-1.5 text-muted">Reasoning (optional)</p>
            <Textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              placeholder="Why this matters or how it was established"
              aria-label="Reasoning"
              className="min-h-[80px]"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <p className="label-mono mb-1.5 text-muted">Evidence status</p>
              <Select
                value={evidenceStatus}
                onChange={(v) => setEvidenceStatus(v as EvidenceStatus)}
                options={EVIDENCES.map((e) => ({ value: e, label: EVIDENCE_LABEL[e] }))}
                className="min-w-[180px]"
              />
            </div>
            <div>
              <p className="label-mono mb-1.5 text-muted">Scope</p>
              <Select
                value={accessScope}
                onChange={(v) => setAccessScope(v as AccessScope)}
                options={[
                  { value: 'project', label: 'Project (all members)' },
                  { value: 'restricted', label: 'Restricted (granted only)' },
                ]}
                className="min-w-[180px]"
              />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-ember">{error}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button loading={pending} onClick={submit}>
              <Plus size={14} aria-hidden />
              Create item
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

/* ------------------------------------------------------------------ page */

function ActionButton({
  label,
  tone = 'quiet',
  disabled,
  loading,
  onClick,
  children,
}: {
  label: string
  tone?: 'quiet' | 'forest' | 'ember'
  disabled?: boolean
  loading?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const cls =
    tone === 'forest'
      ? 'text-forest hover:bg-forest/10 hover:text-forest-deep'
      : tone === 'ember'
        ? 'text-ember hover:bg-ember/10'
        : 'text-muted hover:text-ink hover:bg-cream'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled || loading}
          onClick={onClick}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[3px] px-2.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-1 focus-visible:ring-offset-paper ${cls}`}
        >
          {loading ? <Spinner size={12} /> : children}
          <span className="hidden sm:inline">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function KnowledgePage() {
  const { project, projectId } = useCurrentProject()
  const qc = useQueryClient()

  const [typeF, setTypeF] = useState<KnowledgeType | null>(null)
  const [evF, setEvF] = useState<EvidenceStatus | null>(null)
  const [reviewF, setReviewF] = useState<ReviewState | ''>('')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [correctId, setCorrectId] = useState<string | null>(null)
  const [commentId, setCommentId] = useState<string | null>(null)
  const [createId, setCreateId] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDq(q.trim()), 350)
    return () => clearTimeout(timer)
  }, [q])

  const meQuery = useQuery({
    queryKey: ['authorityMe', projectId],
    queryFn: () => authorityApi.me(projectId as string),
    enabled: !!projectId,
  })
  const can = meQuery.data?.can ?? {}
  const canReview = !!can.review_findings
  const canCorrect = !!can.correct_knowledge

  const listQuery = useInfiniteQuery({
    queryKey: [
      'knowledge',
      projectId,
      { type: typeF, evidence: evF, review: reviewF, q: dq },
    ],
    queryFn: ({ pageParam }) =>
      knowledgeApi.list(projectId as string, {
        type: typeF ?? undefined,
        evidence_status: evF ?? undefined,
        review_state: reviewF || undefined,
        q: dq || undefined,
        limit: 50,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    enabled: !!projectId,
  })

  const pages = listQuery.data?.pages ?? []
  const items = pages.flatMap((p) => p.items)
  const total = pages[0]?.total ?? 0
  const countsByType = pages[0]?.counts_by_type ?? {}
  const countsByEvidence = pages[0]?.counts_by_evidence ?? {}

  const reviewMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: KnowledgeReviewPayload }) =>
      knowledgeApi.review(projectId as string, id, payload),
    onSuccess: (_data, vars) => {
      const labels: Record<string, string> = {
        verify: 'Finding verified.',
        reject: 'Finding rejected.',
        correct: 'Correction saved.',
        comment: 'Comment added.',
        restore: 'Finding reopened for review.',
      }
      toast.success(labels[vars.payload.action] ?? 'Saved.')
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['graph', projectId] })
      setCorrectId(null)
      setCommentId(null)
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const createMutation = useMutation({
    mutationFn: (payload: KnowledgeItemCreate) =>
      knowledgeApi.create(projectId as string, payload),
    onSuccess: (_data) => {
      toast.success('Knowledge item created.')
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
      void qc.invalidateQueries({ queryKey: ['graph', projectId] })
      setCreateId(null)
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const busyId = reviewMutation.isPending ? reviewMutation.variables?.id : null
  const correctItem = items.find((i) => i.id === correctId) ?? null
  const commentItem = items.find((i) => i.id === commentId) ?? null

  const act = (id: string, payload: KnowledgeReviewPayload) =>
    reviewMutation.mutate({ id, payload })

  let body: ReactNode

  if (!projectId) {
    body = (
      <EmptyState
        title="No project selected."
        description="Choose or create a project above to see its knowledge items."
      />
    )
  } else if (listQuery.isPending) {
    body = (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Loading knowledge…
      </div>
    )
  } else if (listQuery.isError) {
    body = (
      <EmptyState
        title="Knowledge could not be loaded."
        description={
          listQuery.error instanceof ApiError
            ? listQuery.error.detail || listQuery.error.error
            : 'The list is unavailable right now.'
        }
        action={
          <Button variant="outline" onClick={() => void listQuery.refetch()}>
            Try again
          </Button>
        }
      />
    )
  } else if (items.length === 0) {
    const filtering = typeF || evF || reviewF || dq
    body = reviewF === 'pending' && !typeF && !evF && !dq ? (
      <EmptyState
        icon={<Check size={22} />}
        title="Nothing pending review."
        description="Every item matching this view has already been reviewed. Switch the filter to see the rest."
        action={
          <Button variant="outline" onClick={() => setReviewF('')}>
            Show all review states
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={filtering ? 'No items match these filters.' : 'No knowledge extracted yet.'}
        description={
          filtering
            ? 'Loosen a facet or clear the search to see more.'
            : 'Upload documents and let processing extract decisions, tasks, risks and gaps — they will land here for review.'
        }
        action={
          filtering ? (
            <Button
              variant="outline"
              onClick={() => {
                setTypeF(null)
                setEvF(null)
                setReviewF('')
                setQ('')
                setDq('')
              }}
            >
              Clear filters
            </Button>
          ) : undefined
        }
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const open = openId === item.id
          const busy = busyId === item.id
          return (
            <article key={item.id} className="pd-k-card" data-open={open ? 'true' : 'false'}>
              <button
                type="button"
                className="pd-k-head px-4 py-3.5"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`pd-type-overline ${TYPE_TONE[item.type]}`}>
                        {TYPE_LABEL[item.type]}
                      </span>
                      {item.is_sample ? <span className="pd-sample-tag">sample</span> : null}
                    </div>
                    <p className="pd-k-title mt-1">{item.title}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="pd-badge" {...evidenceTone(item.evidence_status)}>
                      {EVIDENCE_LABEL[item.evidence_status]}
                    </span>
                    <ReviewBadge state={item.review_state} />
                    <ChevronDown
                      size={15}
                      className={`text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </div>
                </div>
              </button>

              {open ? (
                <div className="flex flex-col gap-5 border-t border-line px-4 py-4">
                  {item.corrected_text ? (
                    <div className="rounded-[3px] border border-forest/35 bg-forest/6 px-4 py-3.5">
                      <p className="label-mono text-forest">Corrected by reviewer</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-ink">
                        {item.corrected_text}
                      </p>
                      <p className="mt-3 border-t border-forest/20 pt-2.5 text-xs leading-relaxed text-muted">
                        <span className="label-mono">Original extraction: </span>
                        {item.description}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="label-mono mb-1.5 text-muted">Description</p>
                      <p className="text-sm leading-relaxed text-ink">{item.description}</p>
                    </div>
                  )}

                  {item.reasoning ? (
                    <div>
                      <p className="label-mono mb-1.5 text-forest-deep">Reasoning</p>
                      <div className="pd-reasoning">{item.reasoning}</div>
                    </div>
                  ) : null}

                  <AttributesGrid item={item} />

                  <div>
                    <p className="label-mono mb-2 text-muted">Evidence</p>
                    <EvidenceList item={item} />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                    <span className="font-mono text-[11px] text-muted">
                      {item.source_document_name ?? 'source unknown'}
                    </span>
                    <span className="font-mono text-[11px] text-muted">
                      {item.access_scope === 'restricted' ? 'restricted scope' : 'project scope'}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1 border-t border-line px-3 py-2">
                {canReview ? (
                  <>
                    {item.review_state !== 'verified' ? (
                      <ActionButton
                        label="Verify"
                        tone="forest"
                        disabled={busy}
                        loading={busy && reviewMutation.variables?.payload.action === 'verify'}
                        onClick={() => act(item.id, { action: 'verify' })}
                      >
                        <Check size={13} aria-hidden />
                      </ActionButton>
                    ) : null}
                    {item.review_state !== 'rejected' ? (
                      <ActionButton
                        label="Reject"
                        tone="ember"
                        disabled={busy}
                        loading={busy && reviewMutation.variables?.payload.action === 'reject'}
                        onClick={() => act(item.id, { action: 'reject' })}
                      >
                        <X size={13} aria-hidden />
                      </ActionButton>
                    ) : null}
                    {canCorrect ? (
                      <ActionButton
                        label="Correct"
                        disabled={busy}
                        onClick={() => setCorrectId(item.id)}
                      >
                        <Pencil size={13} aria-hidden />
                      </ActionButton>
                    ) : null}
                    {item.review_state === 'rejected' || item.review_state === 'corrected' ? (
                      <ActionButton
                        label="Restore"
                        disabled={busy}
                        loading={busy && reviewMutation.variables?.payload.action === 'restore'}
                        onClick={() => act(item.id, { action: 'restore' })}
                      >
                        <RotateCcw size={13} aria-hidden />
                      </ActionButton>
                    ) : null}
                  </>
                ) : null}
                <ActionButton
                  label="Comment"
                  disabled={busy}
                  onClick={() => setCommentId(item.id)}
                >
                  <MessageSquare size={13} aria-hidden />
                </ActionButton>
                {!canReview ? (
                  <span className="ml-auto pr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    read + comment
                  </span>
                ) : null}
              </div>
            </article>
          )
        })}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="label-mono text-muted">
            {items.length} of {total} items
          </span>
          <Button
            variant="outline"
            size="sm"
            loading={listQuery.isFetchingNextPage}
            disabled={!listQuery.hasNextPage}
            onClick={() => void listQuery.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline={project?.name ?? 'Project'}
        title="Knowledge"
        description="Decisions, tasks, risks and gaps extracted from your documents — with the evidence behind each one."
        actions={
          <>
            {canReview && (
              <Button variant="primary" onClick={() => setCreateId('create')}>
                <Plus size={14} aria-hidden />
                Create item
              </Button>
            )}
            {pages[0] && pages[0].pending_review > 0 ? (
              <span className="pd-badge" data-tone="ember">
                {pages[0].pending_review} pending review
              </span>
            ) : null}
          </>
        }
      />

      {/* facets */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-mono mr-1 text-muted">Type</span>
          {TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="pd-facet"
              aria-pressed={typeF === type}
              onClick={() => setTypeF(typeF === type ? null : type)}
            >
              {TYPE_LABEL[type]}
              <span className="pd-facet-n">{countsByType[type] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-mono mr-1 text-muted">Evidence</span>
          {EVIDENCES.map((ev) => (
            <button
              key={ev}
              type="button"
              className="pd-facet"
              data-tone={ev === 'conflicting' || ev === 'missing' ? 'ember' : undefined}
              aria-pressed={evF === ev}
              onClick={() => setEvF(evF === ev ? null : ev)}
            >
              {EVIDENCE_LABEL[ev]}
              <span className="pd-facet-n">{countsByEvidence[ev] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="label-mono text-muted">Review</span>
            <Select
              ariaLabel="Review state"
              value={reviewF}
              onChange={(v) => setReviewF(v as ReviewState | '')}
              options={REVIEW_OPTIONS}
              className="min-w-[180px]"
            />
          </label>
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search knowledge</span>
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles and descriptions…"
              className="pl-9"
            />
          </label>
        </div>
      </Card>

      {body}

      {projectId && correctItem ? (
        <CorrectModal
          item={correctItem}
          pending={reviewMutation.isPending}
          onClose={() => setCorrectId(null)}
          onDone={(payload) => act(correctItem.id, payload)}
        />
      ) : null}

      {projectId && commentItem ? (
        <CommentModal
          pending={reviewMutation.isPending}
          onClose={() => setCommentId(null)}
          onDone={(payload) => act(commentItem.id, payload)}
        />
      ) : null}

      {projectId && createId === 'create' ? (
        <CreateModal
          pending={createMutation.isPending}
          onClose={() => setCreateId(null)}
          onDone={(payload) => createMutation.mutate(payload)}
        />
      ) : null}
    </div>
  )
}
