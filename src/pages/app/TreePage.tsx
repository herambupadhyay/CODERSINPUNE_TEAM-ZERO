import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Lock,
  Network,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { authorityApi, codeApi, documentsApi, handoverApi, knowledgeApi } from '@/lib/api'
import type {
  CodeTreeFile,
  DocumentOut,
  HandoverOut,
  KnowledgeItemOut,
  ProjectRole,
} from '@/lib/types'
import { useCurrentProject } from '@/providers/AppProviders'
import { renderBlocks } from '@/lib/markdownLite'
import {
  Button,
  PageHeader,
  RoleChip,
  Spinner,
  StatusBadge,
} from '@/components/app/ui'
import '@/styles/pages-data.css'
import '@/styles/pages-tree.css'

/* ------------------------------------------------------------------ utils */

type Selection =
  | { kind: 'document'; id: string; name: string; path: 'documents' | 'restricted' }
  | { kind: 'knowledge'; id: string; name: string; path: 'knowledge' }
  | { kind: 'handover'; id: string; name: string; path: 'handovers' }
  | { kind: 'code'; id: string; name: string; path: 'code' }
  | { kind: 'locked'; name: string; path: 'restricted' }

const KNOWLEDGE_GROUPS: Array<{ type: string; label: string }> = [
  { type: 'decision', label: 'Decisions' },
  { type: 'task', label: 'Tasks' },
  { type: 'risk', label: 'Risks' },
  { type: 'dependency', label: 'Dependencies' },
  { type: 'person', label: 'People' },
  { type: 'gap', label: 'Gaps' },
  { type: 'question', label: 'Questions' },
  { type: 'contact', label: 'Contacts' },
]

const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  markdown: 'MD',
  csv: 'CSV',
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusTone(status: string): 'ok' | 'warn' | 'muted' {
  if (['completed', 'verified', 'approved', 'shared', 'supported'].includes(status)) return 'ok'
  if (['processing', 'needs_review', 'changes_requested', 'failed', 'missing', 'conflicting', 'inferred', 'rejected'].includes(status)) return 'warn'
  return 'muted'
}

function roleLabel(role?: ProjectRole | null): string {
  if (!role) return 'no role'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

/* ------------------------------------------------------------ code tree */

type CodeNode = {
  name: string
  path: string
  folders: CodeNode[]
  files: CodeTreeFile[]
}

function buildCodeTree(files: CodeTreeFile[]): CodeNode {
  const root: CodeNode = { name: 'code', path: '', folders: [], files: [] }
  const folders = new Map<string, CodeNode>([['', root]])
  for (const file of files) {
    const parts = file.path.split('/')
    let current = root
    let currentPath = ''
    for (const part of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      let folder = folders.get(currentPath)
      if (!folder) {
        folder = { name: part, path: currentPath, folders: [], files: [] }
        folders.set(currentPath, folder)
        current.folders.push(folder)
      }
      current = folder
    }
    current.files.push(file)
  }
  const sort = (node: CodeNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name))
    node.files.sort((a, b) => a.path.localeCompare(b.path))
    node.folders.forEach(sort)
  }
  sort(root)
  return root
}

function countCodeFiles(node: CodeNode): number {
  return node.files.length + node.folders.reduce((sum, folder) => sum + countCodeFiles(folder), 0)
}

function filterCodeTree(node: CodeNode, query: string): CodeNode | null {
  const folders = node.folders
    .map((folder) => filterCodeTree(folder, query))
    .filter((folder): folder is CodeNode => folder !== null)
  const files = node.files.filter(
    (file) => !query || file.path.toLowerCase().includes(query),
  )
  if (!node.path) return { ...node, folders, files }
  if (!folders.length && !files.length) return null
  return { ...node, folders, files }
}

function CodeFileView({ projectId, path }: { projectId: string; path: string }) {
  const fileQuery = useQuery({
    queryKey: ['treeCodeFile', projectId, path],
    queryFn: () => codeApi.file(projectId, path),
  })

  if (fileQuery.isPending) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Opening file…
      </div>
    )
  }
  if (fileQuery.isError || !fileQuery.data) {
    return <p className="text-sm text-ember">This file could not be opened.</p>
  }

  const file = fileQuery.data
  const allLines = file.content.split('\n')
  const visibleLines = allLines.slice(0, 2500)

  return (
    <div>
      <div className="pt-file-title">
        <FileCode2 size={18} className="text-muted" aria-hidden />
        <h2>{file.name}</h2>
        <StatusBadge status={file.language} />
      </div>

      <dl className="pt-meta">
        <div>
          <dt>Path</dt>
          <dd className="break-all font-mono text-[11px]">{file.path}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(file.size)}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>{allLines.length}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>Read-only demo snapshot</dd>
        </div>
      </dl>

      <p className="pt-section-label">Source</p>
      <div className="pt-code">
        {visibleLines.map((text, index) => (
          <div className="pt-line" key={index}>
            <span className="pt-ln">{index + 1}</span>
            <span className="pt-line-text">{text || ' '}</span>
          </div>
        ))}
      </div>
      {visibleLines.length < allLines.length ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          Showing first {visibleLines.length} of {allLines.length} lines
        </p>
      ) : null}
      {file.truncated ? (
        <p className="mt-1 text-xs text-ember">File truncated at 256 KB.</p>
      ) : null}
    </div>
  )
}

function CodeFolderBranch({
  node,
  depth,
  isOpen,
  toggle,
  selection,
  onSelect,
}: {
  node: CodeNode
  depth: number
  isOpen: (path: string) => boolean
  toggle: (path: string) => void
  selection: Selection | null
  onSelect: (file: CodeTreeFile) => void
}) {
  return (
    <>
      {node.folders.map((folder) => {
        const open = isOpen(folder.path)
        return (
          <div key={folder.path}>
            <button
              type="button"
              className="pt-folder"
              style={{ paddingLeft: `${0.7 + depth * 0.85}rem` }}
              onClick={() => toggle(folder.path)}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {open ? <FolderOpen size={13} aria-hidden /> : <Folder size={13} aria-hidden />}
              <span className="pt-item-name">{folder.name}</span>
              <span className="pt-folder-count">{countCodeFiles(folder)}</span>
            </button>
            {open ? (
              <CodeFolderBranch
                node={folder}
                depth={depth + 1}
                isOpen={isOpen}
                toggle={toggle}
                selection={selection}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        )
      })}
      {node.files.map((file) => (
        <button
          key={file.path}
          type="button"
          className="pt-item"
          style={{ paddingLeft: `${1.35 + depth * 0.85}rem` }}
          data-active={selection?.kind === 'code' && selection.id === file.path}
          title={file.path}
          onClick={() => onSelect(file)}
        >
          <FileCode2 size={12} className="shrink-0 text-muted" aria-hidden />
          <span className="pt-item-name">{file.path.split('/').pop() ?? file.path}</span>
        </button>
      ))}
    </>
  )
}

/* ------------------------------------------------------- editor content */

function DocumentView({ projectId, docId }: { projectId: string; docId: string }) {
  const detailQuery = useQuery({
    queryKey: ['treeDocument', projectId, docId],
    queryFn: () => documentsApi.get(projectId, docId),
  })
  const chunksQuery = useQuery({
    queryKey: ['treeDocumentChunks', projectId, docId],
    queryFn: () => documentsApi.chunks(projectId, docId, 24),
  })

  if (detailQuery.isPending) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Opening file…
      </div>
    )
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <p className="text-sm text-ember">This document could not be opened.</p>
  }

  const doc: DocumentOut = detailQuery.data
  const chunkItems = chunksQuery.data?.items ?? []
  const chunkViews = chunkItems.map((chunk, chunkIndex) => {
    const start =
      chunkItems
        .slice(0, chunkIndex)
        .reduce((sum, previous) => sum + previous.text.split('\n').length, 0) + 1
    return {
      chunk,
      lines: chunk.text
        .split('\n')
        .map((text, lineIndex) => ({ no: start + lineIndex, text })),
    }
  })

  return (
    <div>
      <div className="pt-file-title">
        <FileText size={18} className="text-muted" aria-hidden />
        <h2>{doc.original_name}</h2>
        <StatusBadge status={doc.status} />
        {doc.access_scope === 'restricted' ? (
          <span className="pd-badge" data-tone="ember">
            <Lock size={10} aria-hidden />
            restricted
          </span>
        ) : null}
      </div>

      <dl className="pt-meta">
        <div>
          <dt>Type</dt>
          <dd>{KIND_LABEL[doc.kind] ?? doc.kind.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(doc.size_bytes)}</dd>
        </div>
        <div>
          <dt>Chunks</dt>
          <dd>{doc.chunk_count}</dd>
        </div>
        <div>
          <dt>Extracted items</dt>
          <dd>{doc.extracted_count}</dd>
        </div>
        <div>
          <dt>Uploaded by</dt>
          <dd>{doc.uploaded_by_name || '—'}</dd>
        </div>
        <div>
          <dt>Uploaded</dt>
          <dd>{formatDate(doc.created_at)}</dd>
        </div>
        <div>
          <dt>Processed</dt>
          <dd>{formatDate(doc.processed_at)}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{doc.access_scope === 'restricted' ? 'Restricted' : 'Project'}</dd>
        </div>
      </dl>

      <p className="pt-section-label">
        Content preview · {chunksQuery.data?.total ?? doc.chunk_count} chunks
      </p>

      {chunksQuery.isPending ? (
        <div className="mt-3 flex items-center gap-3 text-sm text-muted">
          <Spinner size={14} /> Loading content…
        </div>
      ) : chunksQuery.data?.items.length ? (
        chunkViews.map(({ chunk, lines }) => (
          <div key={chunk.id} className="pt-chunk">
            <div className="pt-chunk-head">
              <span>chunk {chunk.seq + 1}</span>
              {chunk.section ? <span>· {chunk.section}</span> : null}
              {chunk.page_number ? <span>· page {chunk.page_number}</span> : null}
            </div>
            <div className="pt-code">
              {lines.map((line) => (
                <div className="pt-line" key={`${chunk.id}-${line.no}`}>
                  <span className="pt-ln">{line.no}</span>
                  <span className="pt-line-text">{line.text || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="mt-2 text-sm text-muted">No parsed content yet.</p>
      )}

      <div className="mt-6">
        <Link
          to="/app/documents"
          className="inline-flex items-center gap-1.5 text-sm text-forest underline-offset-4 hover:underline"
        >
          Open in Documents <ExternalLink size={13} aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function KnowledgeView({ projectId, itemId }: { projectId: string; itemId: string }) {
  const itemQuery = useQuery({
    queryKey: ['treeKnowledgeItem', projectId, itemId],
    queryFn: () => knowledgeApi.get(projectId, itemId),
  })

  if (itemQuery.isPending) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Opening item…
      </div>
    )
  }
  if (itemQuery.isError || !itemQuery.data) {
    return <p className="text-sm text-ember">This knowledge item could not be opened.</p>
  }

  const item: KnowledgeItemOut = itemQuery.data
  const attributes = Object.entries(item.attributes ?? {})

  return (
    <div>
      <div className="pt-file-title">
        <Network size={18} className="text-muted" aria-hidden />
        <h2>{item.title}</h2>
        <StatusBadge status={item.type} />
        <StatusBadge status={item.review_state} />
        <StatusBadge status={item.evidence_status} />
      </div>

      <dl className="pt-meta">
        <div>
          <dt>Source</dt>
          <dd>{item.source_document_name || '—'}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{item.access_scope === 'restricted' ? 'Restricted' : 'Project'}</dd>
        </div>
        <div>
          <dt>Reviewed by</dt>
          <dd>{item.reviewed_by || '—'}</dd>
        </div>
        <div>
          <dt>Reviewed at</dt>
          <dd>{formatDate(item.reviewed_at)}</dd>
        </div>
      </dl>

      <p className="pt-section-label">Description</p>
      <div className="pt-prose">{renderBlocks(item.description || '')}</div>

      {item.corrected_text ? (
        <>
          <p className="pt-section-label">Correction</p>
          <div className="pt-prose">{renderBlocks(item.corrected_text)}</div>
        </>
      ) : null}

      {attributes.length ? (
        <>
          <p className="pt-section-label">Attributes</p>
          <div className="pt-attributes">
            {attributes.map(([key, value]) => (
              <span key={key} className="pt-attribute">
                <strong>{key}</strong> {String(value)}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {item.evidence?.length ? (
        <>
          <p className="pt-section-label">Evidence</p>
          <div className="pt-evidence">
            {item.evidence.map((ref, index) => (
              <blockquote key={`${ref.chunk_id ?? index}`}>
                {ref.quote || 'No quote recorded.'}
                <cite>
                  {ref.document_name || 'source'}
                  {ref.section ? ` · ${ref.section}` : ''}
                  {ref.page_number ? ` · page ${ref.page_number}` : ''}
                </cite>
              </blockquote>
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-6">
        <Link
          to="/app/knowledge"
          className="inline-flex items-center gap-1.5 text-sm text-forest underline-offset-4 hover:underline"
        >
          Open in Knowledge <ExternalLink size={13} aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function HandoverView({ projectId, handoverId }: { projectId: string; handoverId: string }) {
  const handoverQuery = useQuery({
    queryKey: ['treeHandover', projectId, handoverId],
    queryFn: () => handoverApi.get(projectId, handoverId),
  })

  if (handoverQuery.isPending) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={15} /> Opening handover…
      </div>
    )
  }
  if (handoverQuery.isError || !handoverQuery.data) {
    return <p className="text-sm text-ember">This handover could not be opened.</p>
  }

  const handover = handoverQuery.data

  return (
    <div>
      <div className="pt-file-title">
        <ArrowRightLeft size={18} className="text-muted" aria-hidden />
        <h2>{handover.title}</h2>
        <StatusBadge status={handover.status} />
      </div>

      <dl className="pt-meta">
        <div>
          <dt>Departing</dt>
          <dd>{handover.departing_name || '—'}</dd>
        </div>
        <div>
          <dt>Successor</dt>
          <dd>{handover.successor_name || '—'}</dd>
        </div>
        <div>
          <dt>Role transferred</dt>
          <dd>{handover.role_transferred || '—'}</dd>
        </div>
        <div>
          <dt>Sections</dt>
          <dd>{handover.section_count}</dd>
        </div>
        <div>
          <dt>Findings</dt>
          <dd>{handover.finding_count}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>v{handover.version}</dd>
        </div>
      </dl>

      {handover.summary ? (
        <>
          <p className="pt-section-label">Summary</p>
          <div className="pt-prose">{renderBlocks(handover.summary)}</div>
        </>
      ) : null}

      {handover.sections.map((section) => (
        <div key={section.id}>
          <p className="pt-section-label">
            {section.position + 1}. {section.title}
          </p>
          <div className="pt-prose">{renderBlocks(section.body || '')}</div>
        </div>
      ))}

      <div className="mt-6">
        <Link
          to="/app/handover"
          className="inline-flex items-center gap-1.5 text-sm text-forest underline-offset-4 hover:underline"
        >
          Open in Handover <ExternalLink size={13} aria-hidden />
        </Link>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export function TreePage() {
  const { project, projectId } = useCurrentProject()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({
    documents: true,
    restricted: true,
    knowledge: true,
    handovers: true,
  })

  const docsQuery = useQuery({
    queryKey: ['treeDocuments', projectId],
    queryFn: () => documentsApi.list(projectId as string),
    enabled: !!projectId,
  })
  const knowledgeQuery = useQuery({
    queryKey: ['treeKnowledge', projectId],
    queryFn: () => knowledgeApi.list(projectId as string, { limit: 200 }),
    enabled: !!projectId,
  })
  const handoversQuery = useQuery({
    queryKey: ['treeHandovers', projectId],
    queryFn: () => handoverApi.list(projectId as string),
    enabled: !!projectId,
  })
  const meQuery = useQuery({
    queryKey: ['authorityMe', projectId],
    queryFn: () => authorityApi.me(projectId as string),
    enabled: !!projectId,
  })
  const codeQuery = useQuery({
    queryKey: ['treeCode', projectId],
    queryFn: () => codeApi.tree(projectId as string),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  })

  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data])
  const knowledgeItems = useMemo(
    () => knowledgeQuery.data?.items ?? [],
    [knowledgeQuery.data],
  )
  const handovers = useMemo(() => handoversQuery.data ?? [], [handoversQuery.data])
  const codeFiles = useMemo(() => codeQuery.data?.files ?? [], [codeQuery.data])

  const q = query.trim().toLowerCase()

  const codeTree = useMemo(() => buildCodeTree(codeFiles), [codeFiles])
  const filteredCodeTree = useMemo<CodeNode>(() => {
    if (!q) return codeTree
    return filterCodeTree(codeTree, q) ?? { name: 'code', path: '', folders: [], files: [] }
  }, [codeTree, q])

  const projectDocs = docs.filter(
    (doc) => doc.access_scope === 'project' && (!q || doc.original_name.toLowerCase().includes(q)),
  )
  const restrictedDocs = docs.filter(
    (doc) => doc.access_scope === 'restricted' && (!q || doc.original_name.toLowerCase().includes(q)),
  )

  const groupedKnowledge = KNOWLEDGE_GROUPS.map((group) => ({
    ...group,
    items: knowledgeItems
      .filter((item) => item.type === group.type)
      .filter((item) => !q || item.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title)),
  }))

  const filteredHandovers = handovers.filter(
    (handover) => !q || handover.title.toLowerCase().includes(q),
  )

  const totalDocs = project?.counts.documents ?? docs.length
  const lockedDocs = Math.max(0, totalDocs - docs.length)
  const totalKnowledge = project?.counts.knowledge ?? knowledgeItems.length
  const lockedKnowledge = Math.max(0, totalKnowledge - knowledgeItems.length)

  const role = (meQuery.data?.project_role ?? project?.my_role ?? null) as ProjectRole | null

  const toggle = (key: string) =>
    setOpen((current) => ({ ...current, [key]: !current[key] }))

  const folderOpen = (key: string) => !!open[key]

  const isActive = (kind: Selection['kind'], id?: string) => {
    if (!selection || selection.kind !== kind) return false
    if (selection.kind === 'locked') return selection.name === id
    return selection.id === id
  }

  const roleHint =
    role === 'head'
      ? 'Heads can open every file, including restricted material.'
      : role === 'lead'
        ? 'Leads open project files; restricted files need an explicit grant.'
        : role === 'successor'
          ? 'Successors open project files and shared handovers; restricted files need a grant.'
          : 'Members open project files; restricted files need an explicit grant.'

  let editor: ReactNode
  if (!selection) {
    editor = (
      <div className="pt-editor-empty">
        <Network size={22} aria-hidden />
        <p>Select a file from the explorer</p>
        <p>
          The tree mirrors the project base — folders, documents, knowledge and
          handovers. What you can open follows your role.
        </p>
        <p>
          <kbd>{roleLabel(role)}</kbd> access · {roleHint}
        </p>
      </div>
    )
  } else if (selection.kind === 'locked') {
    editor = (
      <div className="pt-locked-panel">
        <Lock size={18} className="text-ember" aria-hidden />
        <h3>Access restricted</h3>
        <p>
          {selection.name} is outside your authority on this project. Restricted
          documents are hidden from {roleLabel(role).toLowerCase()} accounts unless
          the project head grants access explicitly.
        </p>
        <p>
          Ask the head to grant access from the Authority page — or sign in as the
          head to see the full tree.
        </p>
      </div>
    )
  } else if (selection.kind === 'document') {
    editor = <DocumentView projectId={projectId as string} docId={selection.id} />
  } else if (selection.kind === 'knowledge') {
    editor = <KnowledgeView projectId={projectId as string} itemId={selection.id} />
  } else if (selection.kind === 'handover') {
    editor = <HandoverView projectId={projectId as string} handoverId={selection.id} />
  } else {
    editor = <CodeFileView projectId={projectId as string} path={selection.id} />
  }

  const breadcrumbPath = selection
    ? `${project?.name ?? 'Project'} / ${selection.path} / ${selection.name}`
    : `${project?.name ?? 'Project'} / project tree`

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline={project?.name ?? 'Project'}
        title="Project tree"
        description="The whole project base in one explorer — opening files follows your authority."
        actions={
          <div className="flex items-center gap-2">
            <RoleChip role={role} />
            {meQuery.isFetching ? <Spinner size={13} className="text-muted" /> : null}
          </div>
        }
      />

      <div className="pt-shell">
        <aside className="pt-sidebar">
          <div className="pt-sidebar-head">
            <div className="pt-sidebar-title">
              <span>Explorer</span>
              <span>
                {docs.length + knowledgeItems.length + handovers.length + codeFiles.length} items
              </span>
            </div>
            <label className="pt-search">
              <Search size={12} aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter files…"
                aria-label="Filter project tree"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => setQuery('')}
                  className="text-muted hover:text-ink"
                >
                  <X size={12} />
                </button>
              ) : null}
            </label>
          </div>

          <div className="pt-tree">
            {/* documents */}
            <button type="button" className="pt-folder" onClick={() => toggle('documents')}>
              {folderOpen('documents') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {folderOpen('documents') ? (
                <FolderOpen size={13} aria-hidden />
              ) : (
                <Folder size={13} aria-hidden />
              )}
              Documents
              <span className="pt-folder-count">{projectDocs.length}</span>
            </button>
            {folderOpen('documents') ? (
              projectDocs.length ? (
                projectDocs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className="pt-item"
                    data-active={isActive('document', doc.id)}
                    onClick={() =>
                      setSelection({
                        kind: 'document',
                        id: doc.id,
                        name: doc.original_name,
                        path: 'documents',
                      })
                    }
                  >
                    <FileText size={13} className="shrink-0 text-muted" aria-hidden />
                    <span className="pt-item-name">{doc.original_name}</span>
                    <span className="pt-dot" data-tone={statusTone(doc.status)} />
                  </button>
                ))
              ) : (
                <p className="pt-empty-tree">No documents match.</p>
              )
            ) : null}

            {/* restricted */}
            <button type="button" className="pt-folder" onClick={() => toggle('restricted')}>
              {folderOpen('restricted') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Lock size={13} aria-hidden />
              Restricted
              <span className="pt-folder-count">{restrictedDocs.length + lockedDocs}</span>
            </button>
            {folderOpen('restricted') ? (
              <>
                {restrictedDocs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className="pt-item"
                    data-active={isActive('document', doc.id)}
                    onClick={() =>
                      setSelection({
                        kind: 'document',
                        id: doc.id,
                        name: doc.original_name,
                        path: 'restricted',
                      })
                    }
                  >
                    <Lock size={13} className="shrink-0 text-ember" aria-hidden />
                    <span className="pt-item-name">{doc.original_name}</span>
                    <span className="pt-dot" data-tone={statusTone(doc.status)} />
                  </button>
                ))}
                {lockedDocs > 0 ? (
                  <button
                    type="button"
                    className="pt-item"
                    data-locked="true"
                    data-active={selection?.kind === 'locked'}
                    onClick={() =>
                      setSelection({
                        kind: 'locked',
                        name: `${lockedDocs} restricted document${lockedDocs === 1 ? '' : 's'}`,
                        path: 'restricted',
                      })
                    }
                  >
                    <Lock size={13} className="shrink-0" aria-hidden />
                    <span className="pt-item-name">
                      {lockedDocs} locked document{lockedDocs === 1 ? '' : 's'}
                    </span>
                  </button>
                ) : null}
                {!restrictedDocs.length && !lockedDocs ? (
                  <p className="pt-empty-tree">No restricted documents.</p>
                ) : null}
              </>
            ) : null}

            {/* knowledge */}
            <button type="button" className="pt-folder" onClick={() => toggle('knowledge')}>
              {folderOpen('knowledge') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {folderOpen('knowledge') ? (
                <FolderOpen size={13} aria-hidden />
              ) : (
                <Folder size={13} aria-hidden />
              )}
              Knowledge
              <span className="pt-folder-count">{knowledgeItems.length}</span>
            </button>
            {folderOpen('knowledge') ? (
              <>
                {groupedKnowledge.map((group) => {
                  const key = `k:${group.type}`
                  return (
                    <div key={group.type}>
                      <button
                        type="button"
                        className="pt-folder"
                        data-depth="1"
                        onClick={() => toggle(key)}
                      >
                        {folderOpen(key) ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                        <Folder size={12} aria-hidden />
                        {group.label}
                        <span className="pt-folder-count">{group.items.length}</span>
                      </button>
                      {folderOpen(key) && group.items.length
                        ? group.items.map((item: KnowledgeItemOut) => (
                            <button
                              key={item.id}
                              type="button"
                              className="pt-item"
                              data-depth="1"
                              data-active={isActive('knowledge', item.id)}
                              onClick={() =>
                                setSelection({
                                  kind: 'knowledge',
                                  id: item.id,
                                  name: item.title,
                                  path: 'knowledge',
                                })
                              }
                            >
                              <Network size={12} className="shrink-0 text-muted" aria-hidden />
                              <span className="pt-item-name">{item.title}</span>
                              <span
                                className="pt-dot"
                                data-tone={statusTone(item.review_state)}
                              />
                            </button>
                          ))
                        : null}
                    </div>
                  )
                })}
                {lockedKnowledge > 0 ? (
                  <p className="pt-empty-tree">
                    {lockedKnowledge} knowledge item{lockedKnowledge === 1 ? '' : 's'} hidden by
                    access scope.
                  </p>
                ) : null}
                {!knowledgeItems.length ? (
                  <p className="pt-empty-tree">No knowledge extracted yet.</p>
                ) : null}
              </>
            ) : null}

            {/* handovers */}
            <button type="button" className="pt-folder" onClick={() => toggle('handovers')}>
              {folderOpen('handovers') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {folderOpen('handovers') ? (
                <FolderOpen size={13} aria-hidden />
              ) : (
                <Folder size={13} aria-hidden />
              )}
              Handovers
              <span className="pt-folder-count">{filteredHandovers.length}</span>
            </button>
            {folderOpen('handovers') ? (
              filteredHandovers.length ? (
                filteredHandovers.map((handover: HandoverOut) => (
                  <button
                    key={handover.id}
                    type="button"
                    className="pt-item"
                    data-active={isActive('handover', handover.id)}
                    onClick={() =>
                      setSelection({
                        kind: 'handover',
                        id: handover.id,
                        name: handover.title,
                        path: 'handovers',
                      })
                    }
                  >
                    <ArrowRightLeft size={13} className="shrink-0 text-muted" aria-hidden />
                    <span className="pt-item-name">{handover.title}</span>
                    <span className="pt-dot" data-tone={statusTone(handover.status)} />
                  </button>
                ))
              ) : (
                <p className="pt-empty-tree">No handovers match.</p>
              )
            ) : null}

            {/* code */}
            <button type="button" className="pt-folder" onClick={() => toggle('code')}>
              {folderOpen('code') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Code2 size={13} aria-hidden />
              Code
              <span className="pt-folder-count">{codeFiles.length}</span>
            </button>
            {folderOpen('code') || q ? (
              codeQuery.isError ? (
                <p className="pt-empty-tree">Code snapshot unavailable.</p>
              ) : codeQuery.isPending ? (
                <p className="pt-empty-tree">Loading code…</p>
              ) : countCodeFiles(filteredCodeTree) ? (
                <CodeFolderBranch
                  node={filteredCodeTree}
                  depth={0}
                  isOpen={(path) => (q ? true : folderOpen(`c:${path}`))}
                  toggle={(path) => toggle(`c:${path}`)}
                  selection={selection}
                  onSelect={(file) =>
                    setSelection({
                      kind: 'code',
                      id: file.path,
                      name: file.path.split('/').pop() ?? file.path,
                      path: 'code',
                    })
                  }
                />
              ) : (
                <p className="pt-empty-tree">No code files match.</p>
              )
            ) : null}
          </div>

          <div className="flex items-start gap-2 border-t border-line px-3 py-2.5">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-forest" aria-hidden />
            <p className="font-mono text-[10px] leading-relaxed text-muted">{roleHint}</p>
          </div>
        </aside>

        <div className="pt-editor">
          <div className="pt-tabbar">
            {selection ? (
              <div className="pt-tab">
                {selection.kind === 'document' ? (
                  <FileText size={12} aria-hidden />
                ) : selection.kind === 'knowledge' ? (
                  <Network size={12} aria-hidden />
                ) : selection.kind === 'handover' ? (
                  <ArrowRightLeft size={12} aria-hidden />
                ) : selection.kind === 'code' ? (
                  <FileCode2 size={12} aria-hidden />
                ) : (
                  <Lock size={12} aria-hidden />
                )}
                <span>{selection.name}</span>
                <button
                  type="button"
                  aria-label="Close file"
                  onClick={() => setSelection(null)}
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="pt-tab">
                <Folder size={12} aria-hidden />
                <span>Explorer</span>
              </div>
            )}
          </div>

          <div className="pt-breadcrumb">
            <span>{breadcrumbPath}</span>
          </div>

          <div className="pt-content">{editor}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          {project?.counts.documents ?? docs.length} documents ·{' '}
          {project?.counts.knowledge ?? knowledgeItems.length} knowledge ·{' '}
          {handovers.length} handovers · {codeFiles.length} code files
        </p>
        <div className="flex items-center gap-2">
          <Link to="/app/authority">
            <Button size="sm" variant="outline">
              <ShieldCheck size={13} aria-hidden />
              Authority
            </Button>
          </Link>
          <Link to="/app/documents">
            <Button size="sm" variant="outline">
              <FileText size={13} aria-hidden />
              Documents
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
