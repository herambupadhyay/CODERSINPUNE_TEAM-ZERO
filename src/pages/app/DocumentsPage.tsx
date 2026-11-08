import { useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronLeft,
  FileCode,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  Lock,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { ApiError, authorityApi, documentsApi, processingApi, projectsApi } from '@/lib/api'
import type {
  AccessScope,
  DocumentKind,
  DocumentOut,
  DocumentStatus,
  JobOut,
} from '@/lib/types'
import { useCurrentProject, useSession } from '@/providers/AppProviders'
import '@/styles/pages-data.css'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  IconButton,
  Modal,
  ModalContent,
  PageHeader,
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

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-CA')
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_TONE: Record<DocumentStatus, string> = {
  uploaded: 'ink',
  queued: 'forest-soft',
  processing: 'forest-soft',
  completed: 'forest',
  failed: 'ember',
  needs_review: 'ember',
}

const STATUS_LABEL: Record<DocumentStatus, string> = {
  uploaded: 'uploaded',
  queued: 'queued',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
  needs_review: 'needs review',
}

const KIND_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv'
const MAX_BYTES = 20 * 1024 * 1024

function kindIcon(kind: DocumentKind) {
  switch (kind) {
    case 'csv':
      return FileSpreadsheet
    case 'markdown':
      return FileCode
    case 'txt':
      return FileIcon
    default:
      return FileText
  }
}

function kindIconEl(kind: DocumentKind, size: number, className?: string): ReactNode {
  const Icon = kindIcon(kind)
  return <Icon size={size} className={className} aria-hidden />
}

function DocStatusBadge({ status }: { status: DocumentStatus }) {
  const pulsing = status === 'queued' || status === 'processing'
  return (
    <span className="pd-status" data-tone={STATUS_TONE[status]}>
      {pulsing ? (
        <span
          aria-hidden
          className="pd-dot pd-pulse"
          style={{ backgroundColor: 'currentColor' }}
        />
      ) : null}
      {STATUS_LABEL[status]}
    </span>
  )
}

function ScopeChip({ scope }: { scope: AccessScope }) {
  if (scope === 'restricted') {
    return (
      <Chip className="border-ember/40 bg-ember/8 text-ember">
        <Lock size={11} aria-hidden />
        restricted
      </Chip>
    )
  }
  return <Chip>project</Chip>
}

function reasonFor(cap: string): string {
  switch (cap) {
    case 'upload_documents':
      return 'Only project heads, leads and members can upload documents.'
    case 'set_access_scope':
      return 'Only a project head or lead can do this.'
    case 'grant_restricted_access':
      return 'Only a project head or lead can do this.'
    default:
      return 'You do not have permission to do this.'
  }
}

/* ------------------------------------------------------------ upload modal */

function UploadModal({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [scope, setScope] = useState<AccessScope>('project')
  const [error, setError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new ApiError(400, 'Choose a file first.')
      return documentsApi.upload(projectId, file, scope)
    },
    onSuccess: (res) => {
      const message = res.warnings.length
        ? res.warnings.join(' ')
        : `"${res.document.original_name}" uploaded — queued for processing.`
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['documents', projectId] })
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['jobs', projectId] })
      setFile(null)
      setError(null)
      setScope('project')
      if (inputRef.current) inputRef.current.value = ''
      onOpenChange(false)
    },
    onError: (err) => setError(errMsg(err)),
  })

  const pickFile = (next: File | null) => {
    setError(null)
    if (next && next.size > MAX_BYTES) {
      setFile(null)
      setError(`"${next.name}" is ${fmtSize(next.size)} — the limit is 20 MB.`)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setFile(next)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
    >
      <ModalContent
        title="Upload document"
        description="Add a source file to this project. Processing extracts chunks and knowledge items."
      >
        <div className="flex flex-col gap-5">
          <Field label="File" htmlFor="pd-upload-file" hint="PDF, DOCX, TXT, MD, CSV — up to 20 MB.">
            <input
              ref={inputRef}
              id="pd-upload-file"
              type="file"
              accept={KIND_ACCEPT}
              disabled={upload.isPending}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="block w-full cursor-pointer rounded-[3px] border border-line bg-paper text-sm text-ink file:mr-3 file:cursor-pointer file:rounded-[3px] file:border file:border-line file:bg-cream file:px-3 file:py-2 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.14em] file:text-muted transition-colors duration-150 hover:border-ink/25 file:hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </Field>

          {file ? (
            <div className="flex items-center justify-between gap-3 rounded-[3px] border border-line bg-cream px-3.5 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <FileText size={15} className="shrink-0 text-forest" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{file.name}</span>
                  <span className="font-mono text-[11px] text-muted">{fmtSize(file.size)}</span>
                </span>
              </span>
              <IconButton
                aria-label="Remove selected file"
                size="sm"
                onClick={() => {
                  setFile(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
              >
                <X size={14} />
              </IconButton>
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="label-mono mb-1.5 text-muted">Visibility</legend>
            <label className="pd-scope" data-checked={scope === 'project' ? 'true' : 'false'}>
              <input
                type="radio"
                name="pd-scope"
                checked={scope === 'project'}
                onChange={() => setScope('project')}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#315b45]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Project members</span>
                <span className="block text-xs leading-relaxed text-muted">
                  Everyone actively assigned to this project can read it.
                </span>
              </span>
            </label>
            <label className="pd-scope" data-checked={scope === 'restricted' ? 'true' : 'false'}>
              <input
                type="radio"
                name="pd-scope"
                checked={scope === 'restricted'}
                onChange={() => setScope('restricted')}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#315b45]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Restricted</span>
                <span className="block text-xs leading-relaxed text-muted">
                  Hidden from general membership — access is granted person by person.
                </span>
              </span>
            </label>
          </fieldset>

          {upload.isPending ? (
            <div className="flex flex-col gap-2">
              <p className="label-mono text-forest">Uploading…</p>
              <div className="pd-indeterminate" role="progressbar" aria-label="Uploading" />
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-[3px] border border-ember/40 bg-ember/8 px-3.5 py-2.5 text-sm text-ember"
            >
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => upload.mutate()}
              loading={upload.isPending}
              disabled={!file}
            >
              <Upload size={14} aria-hidden />
              Upload
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

/* ------------------------------------------------------------ detail modal */

function DetailModal({
  projectId,
  docId,
  onClose,
  canManage,
  canUpload,
  canGrant,
  currentUserId,
}: {
  projectId: string
  docId: string
  onClose: () => void
  canManage: boolean
  canUpload: boolean
  canGrant: boolean
  currentUserId: string | null
}) {
  const qc = useQueryClient()
  const [showAll, setShowAll] = useState(false)
  const [confirmScope, setConfirmScope] = useState<AccessScope | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [grantUserId, setGrantUserId] = useState<string>('')

  const docQuery = useQuery({
    queryKey: ['document', projectId, docId],
    queryFn: () => documentsApi.get(projectId, docId),
    enabled: !!docId,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'queued' || status === 'processing' ? 2000 : false
    },
  })

  const jobQuery = useQuery({
    queryKey: ['documentJob', projectId, docId],
    queryFn: () => documentsApi.job(projectId, docId),
    enabled: !!docId,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'queued' || status === 'running' ? 1500 : false
    },
  })

  const previewQuery = useQuery({
    queryKey: ['chunksPreview', projectId, docId],
    queryFn: () => documentsApi.chunks(projectId, docId, 5, 0),
    enabled: !!docId && !showAll,
  })

  const chunksQuery = useInfiniteQuery({
    queryKey: ['chunks', projectId, docId],
    queryFn: ({ pageParam }) => documentsApi.chunks(projectId, docId, 50, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
    enabled: !!docId && showAll,
  })

  const doc = docQuery.data
  const isRestricted = doc?.access_scope === 'restricted'
  const manageGrants = isRestricted && canGrant

  const grantsQuery = useQuery({
    queryKey: ['documentGrants', projectId, docId],
    queryFn: () => documentsApi.grants(projectId, docId),
    enabled: !!docId && manageGrants,
  })

  const membersQuery = useQuery({
    queryKey: ['projectMembers', projectId],
    queryFn: () => projectsApi.members(projectId),
    enabled: manageGrants,
  })

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['document', projectId, docId] })
    void qc.invalidateQueries({ queryKey: ['documents', projectId] })
    void qc.invalidateQueries({ queryKey: ['project', projectId] })
    void qc.invalidateQueries({ queryKey: ['documentGrants', projectId, docId] })
  }

  const scopeMutation = useMutation({
    mutationFn: (next: AccessScope) => documentsApi.updateScope(projectId, docId, next),
    onSuccess: (updated) => {
      toast.success(
        updated.access_scope === 'restricted'
          ? 'Document moved to restricted scope.'
          : 'Document is now visible to project members.',
      )
      invalidateAll()
      setConfirmScope(null)
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => documentsApi.remove(projectId, docId),
    onSuccess: () => {
      toast.success('Document deleted.')
      void qc.invalidateQueries({ queryKey: ['documents', projectId] })
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
      onClose()
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const retryMutation = useMutation({
    mutationFn: () => {
      const job = jobQuery.data
      return job
        ? processingApi.retry(projectId, job.id)
        : documentsApi.reprocess(projectId, docId)
    },
    onSuccess: () => {
      toast.success('Reprocessing queued.')
      invalidateAll()
      void qc.invalidateQueries({ queryKey: ['jobs', projectId] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const grantMutation = useMutation({
    mutationFn: (userId: string) => documentsApi.addGrant(projectId, docId, userId),
    onSuccess: () => {
      toast.success('Access granted.')
      setGrantUserId('')
      void qc.invalidateQueries({ queryKey: ['documentGrants', projectId, docId] })
      void qc.invalidateQueries({ queryKey: ['document', projectId, docId] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => documentsApi.removeGrant(projectId, docId, userId),
    onSuccess: () => {
      toast.success('Access revoked.')
      void qc.invalidateQueries({ queryKey: ['documentGrants', projectId, docId] })
      void qc.invalidateQueries({ queryKey: ['document', projectId, docId] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  if (docQuery.isPending) {
    return (
      <Modal open onOpenChange={(o) => !o && onClose()}>
        <ModalContent title="Document">
          <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted">
            <Spinner size={16} /> Loading document…
          </div>
        </ModalContent>
      </Modal>
    )
  }

  if (docQuery.isError || !doc) {
    return (
      <Modal open onOpenChange={(o) => !o && onClose()}>
        <ModalContent title="Document">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted">
              {docQuery.error instanceof ApiError
                ? docQuery.error.detail || docQuery.error.error
                : 'This document could not be loaded.'}
            </p>
            <Button variant="outline" onClick={() => void docQuery.refetch()}>
              Try again
            </Button>
          </div>
        </ModalContent>
      </Modal>
    )
  }

  const job = jobQuery.data
  const jobActive = job?.status === 'queued' || job?.status === 'running'
  const canDelete = canManage || (doc.uploaded_by !== null && doc.uploaded_by === currentUserId)
  const grants = grantsQuery.data ?? []
  const grantedIds = new Set(grants.map((g) => g.user_id))
  const grantCandidates = (membersQuery.data ?? []).filter((m) => !grantedIds.has(m.user_id))

  if (showAll) {
    const pages = chunksQuery.data?.pages ?? []
    const chunks = pages.flatMap((p) => p.items)
    const total = pages[0]?.total ?? chunks.length
    return (
      <Modal open onOpenChange={(o) => !o && onClose()}>
        <ModalContent
          className="pd-modal-wide"
          title={`${doc.original_name} — chunks`}
          description={`${total} chunk${total === 1 ? '' : 's'} extracted from this document.`}
        >
          <div className="flex flex-col gap-4">
            <Button variant="quiet" size="sm" className="self-start" onClick={() => setShowAll(false)}>
              <ChevronLeft size={14} aria-hidden />
              Back to details
            </Button>

            {chunksQuery.isPending ? (
              <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted">
                <Spinner size={16} /> Loading chunks…
              </div>
            ) : chunks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                No chunks yet — processing has not produced any.
              </p>
            ) : (
              <div className="max-h-[45vh] overflow-y-auto pr-1">
                {chunks.map((chunk) => (
                  <div key={chunk.id} className="pd-chunk">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-medium text-forest">
                        #{String(chunk.seq).padStart(3, '0')}
                      </span>
                      {chunk.section ? (
                        <span className="label-mono text-muted">{chunk.section}</span>
                      ) : null}
                      {chunk.page_number ? (
                        <span className="font-mono text-[11px] text-muted">
                          p. {chunk.page_number}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink">{chunk.text}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="label-mono text-muted">
                {chunks.length} / {total} loaded
              </span>
              <Button
                variant="outline"
                size="sm"
                loading={chunksQuery.isFetchingNextPage}
                disabled={!chunksQuery.hasNextPage}
                onClick={() => void chunksQuery.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    )
  }

  return (
    <>
      <Modal open onOpenChange={(o) => !o && onClose()}>
        <ModalContent
          className="pd-modal-wide"
          title={doc.original_name}
          description={`Uploaded ${fmtDate(doc.created_at)}${
            doc.uploaded_by_name ? ` by ${doc.uploaded_by_name}` : ''
          }`}
        >
          <div className="flex flex-col gap-6">
            {/* metadata */}
            <div className="pd-meta-grid">
              <div>
                <p className="pd-meta-k">Kind</p>
                <p className="pd-meta-v flex items-center gap-2">
                  {kindIconEl(doc.kind, 13, 'text-forest')}
                  {doc.kind}
                </p>
              </div>
              <div>
                <p className="pd-meta-k">Size</p>
                <p className="pd-meta-v font-mono">{fmtSize(doc.size_bytes)}</p>
              </div>
              <div>
                <p className="pd-meta-k">Characters</p>
                <p className="pd-meta-v font-mono">
                  {doc.char_count !== null && doc.char_count !== undefined
                    ? doc.char_count.toLocaleString()
                    : '—'}
                </p>
              </div>
              <div>
                <p className="pd-meta-k">Status</p>
                <p className="pd-meta-v">
                  <DocStatusBadge status={doc.status} />
                </p>
              </div>
              <div>
                <p className="pd-meta-k">Scope</p>
                <p className="pd-meta-v">
                  <ScopeChip scope={doc.access_scope} />
                </p>
              </div>
              <div>
                <p className="pd-meta-k">Uploaded by</p>
                <p className="pd-meta-v">{doc.uploaded_by_name ?? '—'}</p>
              </div>
              <div>
                <p className="pd-meta-k">Processed</p>
                <p className="pd-meta-v font-mono">{fmtDate(doc.processed_at)}</p>
              </div>
              <div>
                <p className="pd-meta-k">Storage id</p>
                <p className="pd-meta-v font-mono text-[11px] text-muted">{doc.id}</p>
              </div>
            </div>

            {/* job panel */}
            {jobActive ? (
              <div className="rounded-[3px] border border-line bg-cream px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="label-mono text-forest">Processing</p>
                  <span className="font-mono text-[11px] text-muted">
                    {job?.stage ?? 'queued'}
                    {job && job.attempts > 1 ? ` · attempt ${job.attempts}` : ''}
                  </span>
                </div>
                <div className="pd-indeterminate mt-3" role="progressbar" aria-label="Processing" />
              </div>
            ) : null}

            {doc.status === 'failed' || job?.status === 'failed' ? (
              <div className="rounded-[3px] border border-ember/40 bg-ember/8 px-4 py-3.5">
                <p className="label-mono text-ember">Processing failed</p>
                <p className="mt-1.5 text-sm text-ember">
                  {job?.error_message || doc.error_message || 'Something went wrong while processing.'}
                </p>
                {canUpload ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    loading={retryMutation.isPending}
                    onClick={() => retryMutation.mutate()}
                  >
                    <RefreshCw size={13} aria-hidden />
                    Retry processing
                  </Button>
                ) : null}
              </div>
            ) : null}

            {/* restricted grants */}
            {isRestricted && !canGrant ? (
              <div className="flex items-start gap-2.5 rounded-[3px] border border-line bg-cream px-4 py-3">
                <Lock size={14} className="mt-0.5 shrink-0 text-ember" aria-hidden />
                <p className="text-sm leading-relaxed text-muted">
                  Restricted — project heads and leads manage who can open this document.
                </p>
              </div>
            ) : null}

            {manageGrants ? (
              <section className="rounded-[3px] border border-line bg-paper px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="label-mono text-ink">Granted access</p>
                  <span className="font-mono text-[11px] text-muted">{grants.length}</span>
                </div>

                {grantsQuery.isPending ? (
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                    <Spinner size={14} /> Loading grants…
                  </div>
                ) : grants.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    Nobody has been granted yet — only the workspace owner and project head can
                    open it.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {grants.map((grant) => (
                      <li
                        key={grant.user_id}
                        className="flex items-center justify-between gap-3 rounded-[3px] border border-line bg-cream px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">{grant.name}</span>
                          <span className="block truncate font-mono text-[11px] text-muted">
                            {grant.email}
                          </span>
                        </span>
                        <IconButton
                          aria-label={`Revoke access for ${grant.name}`}
                          size="sm"
                          disabled={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(grant.user_id)}
                        >
                          <X size={14} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 flex items-end gap-2">
                  <Field label="Grant to" className="flex-1">
                    <Select
                      ariaLabel="Grant access to project member"
                      value={grantUserId || null}
                      onChange={setGrantUserId}
                      placeholder={
                        membersQuery.isPending
                          ? 'Loading members…'
                          : grantCandidates.length
                            ? 'Choose a member'
                            : 'All members already granted'
                      }
                      options={grantCandidates.map((m) => ({
                        value: m.user_id,
                        label: m.name ? `${m.name} — ${m.email}` : m.email,
                      }))}
                      disabled={!grantCandidates.length || membersQuery.isPending}
                    />
                  </Field>
                  <Button
                    size="md"
                    disabled={!grantUserId}
                    loading={grantMutation.isPending}
                    onClick={() => grantMutation.mutate(grantUserId)}
                  >
                    Grant
                  </Button>
                </div>
              </section>
            ) : null}

            {/* chunks preview */}
            <section>
              <div className="flex items-center justify-between gap-3">
                <p className="label-mono text-muted">Chunks</p>
                <span className="font-mono text-[11px] text-muted">
                  {doc.chunk_count} total · {doc.extracted_count} extracted
                </span>
              </div>

              {previewQuery.isPending ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <Spinner size={14} /> Loading preview…
                </div>
              ) : (previewQuery.data?.items.length ?? 0) === 0 ? (
                <p className="mt-3 text-sm text-muted">No chunks extracted yet.</p>
              ) : (
                <div className="mt-2">
                  {previewQuery.data?.items.map((chunk) => (
                    <div key={chunk.id} className="pd-chunk">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-medium text-forest">
                          #{String(chunk.seq).padStart(3, '0')}
                        </span>
                        {chunk.section ? (
                          <span className="label-mono text-muted">{chunk.section}</span>
                        ) : null}
                        {chunk.page_number ? (
                          <span className="font-mono text-[11px] text-muted">
                            p. {chunk.page_number}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink">
                        {chunk.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {doc.chunk_count > 5 ? (
                <Button
                  variant="quiet"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowAll(true)}
                >
                  View all {doc.chunk_count} chunks
                </Button>
              ) : null}
            </section>

            {/* actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {doc.access_scope === 'project' && canManage ? (
                  <Button variant="outline" size="sm" onClick={() => setConfirmScope('restricted')}>
                    <Lock size={13} aria-hidden />
                    Make restricted
                  </Button>
                ) : null}
                {doc.access_scope === 'restricted' && canManage ? (
                  <Button variant="outline" size="sm" onClick={() => setConfirmScope('project')}>
                    Open to project
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={13} aria-hidden />
                    Delete
                  </Button>
                ) : null}
              </div>
              <span className="label-mono text-muted">{doc.status}</span>
            </div>
          </div>
        </ModalContent>
      </Modal>

      {/* scope change confirm */}
      <Modal
        open={confirmScope !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmScope(null)
        }}
      >
        <ModalContent
          title={confirmScope === 'restricted' ? 'Move to restricted?' : 'Open to project?'}
          description={
            confirmScope === 'restricted'
              ? 'This document will disappear from general membership. Only the workspace owner, project head and people you grant explicitly will be able to open it.'
              : 'Every active project member will be able to read this document. Existing grants stay in place but stop being needed.'
          }
        >
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmScope(null)}>
              Cancel
            </Button>
            <Button
              loading={scopeMutation.isPending}
              onClick={() => confirmScope && scopeMutation.mutate(confirmScope)}
            >
              {confirmScope === 'restricted' ? 'Make restricted' : 'Open to project'}
            </Button>
          </div>
        </ModalContent>
      </Modal>

      {/* delete confirm */}
      <Modal
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(false)
        }}
      >
        <ModalContent
          title="Delete this document?"
          description={`"${doc.original_name}" and its ${doc.chunk_count} chunks will be removed. Knowledge items extracted from it stay in the project. This cannot be undone.`}
        >
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              <Trash2 size={14} aria-hidden />
              Delete document
            </Button>
          </div>
        </ModalContent>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------- page */

export function DocumentsPage() {
  const { project, projectId } = useCurrentProject()
  const { user } = useSession()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const meQuery = useQuery({
    queryKey: ['authorityMe', projectId],
    queryFn: () => authorityApi.me(projectId as string),
    enabled: !!projectId,
  })
  const can = meQuery.data?.can ?? {}
  const canUpload = !!can.upload_documents

  const docsQuery = useQuery({
    queryKey: ['documents', projectId],
    queryFn: () => documentsApi.list(projectId as string),
    enabled: !!projectId,
    refetchInterval: (q) => {
      const active = (q.state.data ?? []).some(
        (d) => d.status === 'queued' || d.status === 'processing',
      )
      return active ? 3000 : false
    },
  })

  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => processingApi.jobs(projectId as string),
    enabled: !!projectId,
    refetchInterval: (q) => {
      const active = (q.state.data ?? []).some(
        (j) => j.status === 'queued' || j.status === 'running',
      )
      return active ? 2500 : false
    },
  })

  const docs = docsQuery.data ?? []
  const nameById = new Map(docs.map((d) => [d.id, d.original_name]))
  const activeJobs = (jobsQuery.data ?? [])
    .filter((j: JobOut) => j.status === 'queued' || j.status === 'running')
    .slice(0, 3)

  const uploadButton = (
    <Button onClick={() => setUploadOpen(true)} disabled={!canUpload}>
      <Upload size={14} aria-hidden />
      Upload
    </Button>
  )

  const headerActions = canUpload ? (
    uploadButton
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{uploadButton}</span>
      </TooltipTrigger>
      <TooltipContent>{reasonFor('upload_documents')}</TooltipContent>
    </Tooltip>
  )

  let body: ReactNode

  if (!projectId) {
    body = (
      <EmptyState
        title="No project selected."
        description="Choose or create a project in the workspace switcher above to manage its documents."
      />
    )
  } else if (docsQuery.isPending) {
    body = (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Loading documents…
      </div>
    )
  } else if (docsQuery.isError) {
    body = (
      <EmptyState
        title="Documents could not be loaded."
        description={
          docsQuery.error instanceof ApiError
            ? docsQuery.error.detail || docsQuery.error.error
            : 'The document list is unavailable right now.'
        }
        action={
          <Button variant="outline" onClick={() => void docsQuery.refetch()}>
            Try again
          </Button>
        }
      />
    )
  } else if (docs.length === 0) {
    body = (
      <EmptyState
        icon={<FileText size={22} />}
        title="No documents yet"
        description="Upload PDF, DOCX, TXT, MD or CSV files up to 20 MB — processing turns them into chunks and knowledge items."
        action={
          canUpload ? (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload size={14} aria-hidden />
              Upload document
            </Button>
          ) : (
            <p className="text-xs text-muted">{reasonFor('upload_documents')}</p>
          )
        }
      />
    )
  } else {
    body = (
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TRow>
              <TH>Name</TH>
              <TH>Status</TH>
              <TH>Scope</TH>
              <TH className="text-right">Pages</TH>
              <TH className="text-right">Chunks</TH>
              <TH className="text-right">Extracted</TH>
              <TH>Uploaded by</TH>
              <TH>Date</TH>
            </TRow>
          </THead>
          <TBody>
            {docs.map((doc: DocumentOut) => {
              return (
                <TRow
                  key={doc.id}
                  className="pd-row"
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${doc.original_name}`}
                  onClick={() => setDetailId(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setDetailId(doc.id)
                    }
                  }}
                >
                  <TD>
                    <span className="flex items-center gap-2.5">
                      {kindIconEl(doc.kind, 15, 'shrink-0 text-forest')}
                      <span className="max-w-[240px] truncate font-medium text-ink">
                        {doc.original_name}
                      </span>
                    </span>
                  </TD>
                  <TD>
                    <DocStatusBadge status={doc.status} />
                  </TD>
                  <TD>
                    <ScopeChip scope={doc.access_scope} />
                  </TD>
                  <TD className="text-right font-mono text-[13px] text-muted">
                    {doc.page_count ?? '—'}
                  </TD>
                  <TD className="text-right font-mono text-[13px] text-muted">{doc.chunk_count}</TD>
                  <TD className="text-right font-mono text-[13px] text-forest">
                    {doc.extracted_count}
                  </TD>
                  <TD className="text-muted">{doc.uploaded_by_name ?? '—'}</TD>
                  <TD className="font-mono text-[12px] text-muted">{fmtDate(doc.created_at)}</TD>
                </TRow>
              )
            })}
          </TBody>
        </Table>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline={project?.name ?? 'Project'}
        title="Documents"
        description="Source files, their processing status and the chunks they produced."
        actions={
          <div className="flex items-center gap-3">
            {docsQuery.isFetching && !docsQuery.isPending ? (
              <Spinner size={13} className="text-muted" />
            ) : null}
            {headerActions}
          </div>
        }
      />

      {activeJobs.length ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-line bg-cream px-4 py-3">
          <span className="label-mono flex items-center gap-2 text-forest">
            <span className="pd-dot pd-pulse" style={{ backgroundColor: 'currentColor' }} />
            Processing
          </span>
          {activeJobs.map((job) => (
            <Chip key={job.id}>
              {nameById.get(job.document_id) ?? 'document'} · {job.stage} · {job.status}
            </Chip>
          ))}
        </div>
      ) : null}

      {body}

      {projectId ? (
        <UploadModal
          projectId={projectId}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
        />
      ) : null}

      {projectId && detailId ? (
        <DetailModal
          projectId={projectId}
          docId={detailId}
          onClose={() => setDetailId(null)}
          canManage={!!can.set_access_scope}
          canUpload={canUpload}
          canGrant={!!can.grant_restricted_access}
          currentUserId={user?.id ?? null}
        />
      ) : null}
    </div>
  )
}
