import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, ChevronDown, Pencil, X } from 'lucide-react'
import { ApiError, authorityApi, graphApi, knowledgeApi } from '@/lib/api'
import type {
  EvidenceStatus,
  GraphNode,
  GraphOut,
  KnowledgeType,
  RelationshipType,
  ReviewState,
} from '@/lib/types'
import { useCurrentProject } from '@/providers/AppProviders'
import '@/styles/pages-data.css'
import {
  Button,
  CenteredSpinner,
  EmptyState,
  PageHeader,
  Spinner,
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

const TYPE_DOT: Record<KnowledgeType, string> = {
  decision: '#315b45',
  task: '#20231f',
  risk: '#d96b32',
  dependency: '#244534',
  person: '#315b45',
  gap: '#d96b32',
  question: '#777a73',
  contact: '#777a73',
}

const TYPES = Object.keys(TYPE_LABEL) as KnowledgeType[]

const RELATIONSHIPS: RelationshipType[] = [
  'owns',
  'assigned_to',
  'depends_on',
  'blocks',
  'decided_by',
  'supports',
  'supersedes',
  'mentioned_in',
  'resolved_by',
  'related_to',
]

const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  supported: 'supported',
  inferred: 'inferred',
  conflicting: 'conflicting',
  missing: 'missing',
}

function evidenceDotStyle(status: EvidenceStatus): CSSProperties {
  switch (status) {
    case 'supported':
      return { backgroundColor: 'var(--color-forest)' }
    case 'conflicting':
      return { backgroundColor: 'var(--color-ember)' }
    case 'missing':
      return {
        backgroundColor: 'transparent',
        boxShadow: 'inset 0 0 0 2px var(--color-ember)',
      }
    default:
      return { backgroundColor: 'var(--color-muted)' }
  }
}

function ReviewGlyph({ state, size = 11 }: { state: ReviewState; size?: number }) {
  if (state === 'verified') return <Check size={size} className="text-forest" aria-label="Verified" />
  if (state === 'rejected') return <X size={size} className="text-ember" aria-label="Rejected" />
  if (state === 'corrected') {
    return <Pencil size={size} className="text-forest-soft" aria-label="Corrected" />
  }
  return (
    <span
      aria-label="Pending review"
      title="Pending review"
      className="pd-dot pd-pulse"
      style={{ backgroundColor: 'var(--color-muted)' }}
    />
  )
}

/* ------------------------------------------------------------ custom node */

type KnowledgeNodeData = { graph: GraphNode }
type KnowledgeFlowNode = Node<KnowledgeNodeData, 'knowledge'>

function KnowledgeNodeCard({ data, selected }: NodeProps<KnowledgeFlowNode>) {
  const g = data.graph
  return (
    <div
      className="pd-node"
      data-selected={selected ? 'true' : 'false'}
      data-sample={g.is_sample ? 'true' : 'false'}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flex items-start justify-between gap-2">
        <span className={`pd-node-type ${TYPE_TONE[g.type]}`}>{g.type}</span>
        <span
          className="pd-evidence-dot"
          style={evidenceDotStyle(g.evidence_status)}
          title={`Evidence: ${EVIDENCE_LABEL[g.evidence_status]}`}
          aria-label={`Evidence: ${EVIDENCE_LABEL[g.evidence_status]}`}
        />
      </div>
      <p className="pd-node-title mt-1">{g.title}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ReviewGlyph state={g.review_state} />
        {g.is_sample ? <span className="pd-sample-tag">sample</span> : null}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

const nodeTypes: NodeTypes = { knowledge: KnowledgeNodeCard }

/* ------------------------------------------------------------- layout */

function buildNodes(
  graph: GraphOut,
  active: Set<KnowledgeType>,
  selectedId: string | null,
): { nodes: KnowledgeFlowNode[]; visibleIds: Set<string> } {
  const visible = graph.nodes.filter((n) => active.has(n.type))
  const groups = Array.from(new Set(visible.map((n) => n.group))).sort((a, b) => a - b)
  const columnOf = new Map<number, number>(groups.map((g, i) => [g, i]))
  const columns: GraphNode[][] = groups.map(() => [])
  for (const node of visible) {
    columns[columnOf.get(node.group) ?? 0].push(node)
  }
  const typeIndex = new Map(TYPES.map((t, i) => [t, i]))
  const nodes: KnowledgeFlowNode[] = []
  columns.forEach((column, colIndex) => {
    column.sort((a, b) => {
      const ta = typeIndex.get(a.type) ?? 99
      const tb = typeIndex.get(b.type) ?? 99
      return ta - tb || a.id.localeCompare(b.id)
    })
    column.forEach((node, rowIndex) => {
      nodes.push({
        id: node.id,
        type: 'knowledge',
        position: { x: colIndex * 260, y: rowIndex * 110 },
        data: { graph: node },
        selected: node.id === selectedId,
        draggable: false,
      })
    })
  })
  return { nodes, visibleIds: new Set(nodes.map((n) => n.id)) }
}

function buildEdges(graph: GraphOut, visibleIds: Set<string>): Edge[] {
  return graph.edges
    .filter((e) => visibleIds.has(e.src_item_id) && visibleIds.has(e.dst_item_id))
    .map((e) => ({
      id: e.id,
      source: e.src_item_id,
      target: e.dst_item_id,
      label: e.label || e.rel_type,
      labelStyle: {
        fill: 'var(--color-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.06em',
      },
      labelBgStyle: { fill: 'var(--color-paper)' },
      labelBgPadding: [4, 2] as [number, number],
      labelShowBg: true,
      style: { stroke: 'var(--color-line)' },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: 'var(--color-forest-soft)',
      },
    }))
}

/* ------------------------------------------------------------ side panel */

function SidePanel({
  projectId,
  nodeId,
  canReview,
  onClose,
}: {
  projectId: string
  nodeId: string
  canReview: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const itemQuery = useQuery({
    queryKey: ['knowledgeItem', projectId, nodeId],
    queryFn: () => knowledgeApi.get(projectId, nodeId),
    enabled: !!nodeId,
  })

  const reviewMutation = useMutation({
    mutationFn: (action: 'verify' | 'reject') =>
      knowledgeApi.review(projectId, nodeId, { action }),
    onSuccess: (_data, action) => {
      toast.success(action === 'verify' ? 'Finding verified.' : 'Finding rejected.')
      void qc.invalidateQueries({ queryKey: ['knowledgeItem', projectId, nodeId] })
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
      void qc.invalidateQueries({ queryKey: ['graph', projectId] })
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const item = itemQuery.data

  return (
    <aside className="pd-side" aria-label="Knowledge item detail">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          {item ? (
            <p className={`pd-type-overline ${TYPE_TONE[item.type]}`}>{TYPE_LABEL[item.type]}</p>
          ) : (
            <p className="pd-type-overline text-muted">Loading…</p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close detail panel"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] text-muted transition-colors duration-150 hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
        >
          <X size={15} />
        </button>
      </div>

      {itemQuery.isPending ? (
        <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted">
          <Spinner size={15} /> Loading item…
        </div>
      ) : itemQuery.isError || !item ? (
        <div className="px-4 py-6">
          <p className="text-sm text-muted">
            {itemQuery.error instanceof ApiError
              ? itemQuery.error.detail || itemQuery.error.error
              : 'This item could not be loaded.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void itemQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          <h2 className="font-display text-lg leading-snug text-ink">{item.title}</h2>

          <div className="flex flex-wrap gap-1.5">
            <span
              className="pd-badge"
              data-tone={
                item.evidence_status === 'supported'
                  ? 'forest'
                  : item.evidence_status === 'conflicting'
                    ? 'ember-solid'
                    : item.evidence_status === 'missing'
                      ? 'outline-ember'
                      : undefined
              }
            >
              {EVIDENCE_LABEL[item.evidence_status]}
            </span>
            <span
              className="pd-badge"
              data-tone={
                item.review_state === 'verified'
                  ? 'forest'
                  : item.review_state === 'rejected'
                    ? 'ember'
                    : item.review_state === 'corrected'
                      ? 'forest-soft'
                      : undefined
              }
            >
              {item.review_state}
            </span>
            {item.is_sample ? <span className="pd-sample-tag">sample</span> : null}
          </div>

          <div>
            <p className="label-mono mb-1.5 text-muted">Description</p>
            <p className="text-sm leading-relaxed text-ink">
              {item.corrected_text ?? item.description}
            </p>
            {item.corrected_text ? (
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Original extraction: {item.description}
              </p>
            ) : null}
          </div>

          {item.reasoning ? (
            <div>
              <p className="label-mono mb-1.5 text-forest-deep">Reasoning</p>
              <div className="pd-reasoning">{item.reasoning}</div>
            </div>
          ) : null}

          {Object.keys(item.attributes ?? {}).length ? (
            <div>
              <p className="label-mono mb-1.5 text-muted">Attributes</p>
              <div className="pd-attr-grid">
                {Object.entries(item.attributes)
                  .filter(([, v]) => v !== null && v !== undefined && v !== '')
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <span className="pd-attr-k">{k}</span>
                      <span className="pd-attr-v">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}

          {item.evidence.length ? (
            <div>
              <p className="label-mono mb-1.5 text-muted">Evidence</p>
              <div className="flex flex-col gap-2">
                {item.evidence.map((ref, i) => (
                  <div key={`${item.id}-ev-${i}`}>
                    <p className="pd-quote">{ref.quote ?? '—'}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      {ref.document_name ?? 'source document'}
                      {ref.page_number ? ` · p. ${ref.page_number}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="border-t border-line pt-3">
            <p className="font-mono text-[11px] text-muted">
              {item.source_document_name ?? 'source unknown'}
            </p>
          </div>

          {canReview ? (
            <div className="flex flex-wrap gap-2">
              {item.review_state !== 'verified' ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={reviewMutation.isPending && reviewMutation.variables === 'verify'}
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate('verify')}
                >
                  <Check size={13} aria-hidden />
                  Verify
                </Button>
              ) : null}
              {item.review_state !== 'rejected' ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={reviewMutation.isPending && reviewMutation.variables === 'reject'}
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate('reject')}
                >
                  <X size={13} aria-hidden />
                  Reject
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted">
              Only a project head or lead can review findings — you can still read every detail
              here.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}

/* ---------------------------------------------------------------- legend */

function Legend() {
  const [open, setOpen] = useState(true)
  return (
    <div className="pd-legend">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="label-mono text-muted">Legend</span>
        <button
          type="button"
          aria-label={open ? 'Hide legend' : 'Show legend'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
        >
          <ChevronDown
            size={14}
            className={`transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
          />
        </button>
      </div>
      {open ? (
        <div className="pd-legend-body">
          <div className="flex flex-col gap-1.5">
            <span className="label-mono text-ink">Types</span>
            {TYPES.map((t) => (
              <span key={t} className="pd-legend-row">
                <span
                  aria-hidden
                  className="pd-dot"
                  style={{ backgroundColor: TYPE_DOT[t] }}
                />
                {TYPE_LABEL[t]}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
            <span className="label-mono text-ink">Evidence</span>
            {(['supported', 'inferred', 'conflicting', 'missing'] as EvidenceStatus[]).map((e) => (
              <span key={e} className="pd-legend-row">
                <span
                  aria-hidden
                  className="pd-evidence-dot"
                  style={evidenceDotStyle(e)}
                />
                {EVIDENCE_LABEL[e]}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
            <span className="label-mono text-ink">Relationships</span>
            {RELATIONSHIPS.map((r) => (
              <span key={r} className="pd-legend-row">
                {r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export function GraphPage() {
  const { project, projectId } = useCurrentProject()
  const [active, setActive] = useState<Set<KnowledgeType>>(() => new Set(TYPES))
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const graphQuery = useQuery({
    queryKey: ['graph', projectId],
    queryFn: () => graphApi.get(projectId as string),
    enabled: !!projectId,
  })

  const meQuery = useQuery({
    queryKey: ['authorityMe', projectId],
    queryFn: () => authorityApi.me(projectId as string),
    enabled: !!projectId,
  })
  const canReview = !!meQuery.data?.can.review_findings

  const graph = graphQuery.data
  const { nodes, visibleIds } = useMemo(
    () =>
      graph
        ? buildNodes(graph, active, selectedId)
        : { nodes: [] as KnowledgeFlowNode[], visibleIds: new Set<string>() },
    [graph, active, selectedId],
  )
  const edges = useMemo(
    () => (graph ? buildEdges(graph, visibleIds) : []),
    [graph, visibleIds],
  )

  const toggleType = (type: KnowledgeType) => {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
    setSelectedId(null)
  }

  const headerActions = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
        {graph
          ? `${nodes.length} nodes · ${edges.length} edges · scope-filtered`
          : 'scope-filtered'}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className="pd-facet"
            aria-pressed={active.has(t)}
            onClick={() => toggleType(t)}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  )

  let body: ReactNode

  if (!projectId) {
    body = (
      <EmptyState
        title="No project selected."
        description="Choose or create a project above to see its knowledge graph."
      />
    )
  } else if (graphQuery.isPending) {
    body = (
      <div className="pd-graph-wrap">
        <div className="flex h-full items-center justify-center rounded-[4px] border border-line bg-paper">
          <CenteredSpinner label="Loading graph" />
        </div>
      </div>
    )
  } else if (graphQuery.isError) {
    body = (
      <EmptyState
        title="The knowledge graph could not be loaded."
        description={
          graphQuery.error instanceof ApiError
            ? graphQuery.error.detail || graphQuery.error.error
            : 'The graph service is unavailable right now.'
        }
        action={
          <Button variant="outline" onClick={() => void graphQuery.refetch()}>
            Try again
          </Button>
        }
      />
    )
  } else if (!graph || graph.nodes.length === 0) {
    body = (
      <EmptyState
        title="The knowledge graph will build as documents are processed."
        description="Once processing extracts knowledge items and relationships, they will appear here as a connected map."
      />
    )
  } else if (nodes.length === 0) {
    body = (
      <EmptyState
        title="No types selected."
        description="Turn a type back on in the filter row above to bring nodes into view."
        action={
          <Button variant="outline" onClick={() => setActive(new Set(TYPES))}>
            Show all types
          </Button>
        }
      />
    )
  } else {
    body = (
      <div className="pd-graph-wrap">
        <div className="pd-graph" data-testid="pd-graph" aria-label="Knowledge graph canvas">
          {graph.truncated ? (
            <div className="pd-banner absolute left-1/2 top-3 z-[13] max-w-[70%] -translate-x-1/2" role="status">
              Showing the first {graph.nodes.length} nodes — refine filters for more.
            </div>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.15}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: false }}
          >
            <Background color="var(--color-line)" gap={26} size={1} />
            <Controls showInteractive={false} position="top-left" />
            <MiniMap
              pannable
              zoomable
              bgColor="var(--color-cream)"
              maskColor="rgb(250 248 244 / 0.8)"
              nodeColor={(n) => {
                const g = (n.data as KnowledgeNodeData | undefined)?.graph
                return g ? TYPE_DOT[g.type] : 'var(--color-line)'
              }}
              nodeStrokeColor="var(--color-paper)"
              nodeBorderRadius={6}
              position="bottom-right"
              ariaLabel="Graph minimap"
            />
          </ReactFlow>

          <Legend />

          {selectedId && projectId ? (
            <SidePanel
              projectId={projectId}
              nodeId={selectedId}
              canReview={canReview}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline={project?.name ?? 'Project'}
        title="Knowledge graph"
        description="How people, systems, decisions and tasks depend on each other — scope-filtered to what you can read."
        actions={headerActions}
      />
      {body}
    </div>
  )
}
