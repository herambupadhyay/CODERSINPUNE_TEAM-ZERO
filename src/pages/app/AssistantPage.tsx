import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ApiError, assistantApi } from '@/lib/api'
import type { ConversationOut, EvidenceRef, MessageOut } from '@/lib/types'
import { renderBlocks } from '@/lib/markdownLite'
import { useCurrentProject } from '@/providers/AppProviders'
import {
  Button,
  EmptyState,
  IconButton,
  Modal,
  ModalContent,
  Select,
  Spinner,
} from '@/components/app/ui'
import '@/styles/pages-handover.css'

/* ------------------------------------------------------------------ utils */

const SUGGESTIONS = [
  'What does Daniel own before he leaves?',
  'What decisions are documented?',
  "What's unresolved before the handover?",
] as const

const NO_SOURCES = 'No authorised sources matched this question.'

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.detail || err.error
  return 'Something went wrong. Please try again.'
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
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function metaNum(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function metaStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key]
  return typeof v === 'string' && v.trim() ? v : null
}

function metaBool(meta: Record<string, unknown>, key: string): boolean {
  return meta[key] === true || meta[key] === 'true'
}

function localUserMessage(text: string, conversationId: string): MessageOut {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    conversation_id: conversationId,
    role: 'user',
    content: text,
    meta: {},
    created_at: new Date().toISOString(),
    citations: [],
  }
}

/* ------------------------------------------------------------ root page */

export function AssistantPage() {
  const { projectId } = useCurrentProject()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [convId, setConvId] = useState<string | null>(null)
  const [staged, setStaged] = useState<MessageOut[]>([])
  const [draft, setDraft] = useState('')
  const [askError, setAskError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConversationOut | null>(null)
  const [cite, setCite] = useState<EvidenceRef | null>(null)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  /* --- mutations declared before queries that observe their pending state --- */

  const ask = useMutation({
    mutationFn: (message: string) =>
      assistantApi.ask(projectId as string, {
        conversation_id: convId ?? undefined,
        message,
      }),
    onSuccess: (res, message) => {
      setAskError(null)
      if (projectId) {
        const userSeed = localUserMessage(message, res.conversation_id)
        qc.setQueryData<MessageOut[]>(
          ['assistant', 'messages', projectId, res.conversation_id],
          (old) => (old ? [...old, userSeed, res.message] : [userSeed, res.message]),
        )
        void qc.invalidateQueries({ queryKey: ['assistant', 'conversations', projectId] })
      }
      // the exchange now lives in the query cache — drop the optimistic copy
      setStaged([])
      if (convId !== res.conversation_id) setConvId(res.conversation_id)
    },
    onError: (err) => setAskError(errMsg(err)),
  })

  const messagesQuery = useQuery({
    queryKey: ['assistant', 'messages', projectId, convId],
    queryFn: () => assistantApi.messages(projectId as string, convId as string),
    enabled: !!projectId && !!convId && !ask.isPending,
  })

  const conversationsQuery = useQuery({
    queryKey: ['assistant', 'conversations', projectId],
    queryFn: () => assistantApi.conversations(projectId as string),
    enabled: !!projectId,
  })

  // Server messages plus whatever is still in flight locally.
  const thread = [...(messagesQuery.data ?? []), ...staged]

  const newChat = useMutation({
    mutationFn: () => assistantApi.createConversation(projectId as string, 'New conversation'),
    onSuccess: (conv) => {
      selectConversation(conv.id)
      void qc.invalidateQueries({ queryKey: ['assistant', 'conversations', projectId] })
      window.setTimeout(() => taRef.current?.focus(), 30)
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const deleteConversation = useMutation({
    mutationFn: (cid: string) => assistantApi.deleteConversation(projectId as string, cid),
    onSuccess: (_ok, cid) => {
      toast.success('Conversation deleted.')
      setDeleteTarget(null)
      void qc.invalidateQueries({ queryKey: ['assistant', 'conversations', projectId] })
      if (cid === convId) {
        const rest = (conversationsQuery.data ?? []).filter((c) => c.id !== cid)
        selectConversation(rest[0]?.id ?? null)
      }
    },
    onError: (err) => {
      toast.error(errMsg(err))
      setDeleteTarget(null)
    },
  })

  function selectConversation(cid: string | null) {
    setConvId(cid)
    setAskError(null)
    setStaged([])
  }

  function send(raw: string, opts?: { skipOptimistic?: boolean }) {
    const text = raw.trim()
    if (!text || ask.isPending || !projectId) return
    setAskError(null)
    if (!opts?.skipOptimistic) {
      setStaged((prev) => [...prev, localUserMessage(text, convId ?? '')])
    }
    setDraft('')
    ask.mutate(text)
  }

  function retry() {
    const lastUser = [...thread].reverse().find((m) => m.role === 'user')
    setAskError(null)
    if (lastUser) send(lastUser.content, { skipOptimistic: true })
  }

  // autosize the composer (rows 1 → 6)
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 152)}px`
  }, [draft])

  // keep the newest message in view
  const threadTail = thread.length > 0 ? `${thread.length}:${thread[thread.length - 1].id}` : ''
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [threadTail, ask.isPending])

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(draft)
    }
  }

  const conversations = conversationsQuery.data ?? []
  const hasActivity = thread.length > 0 || ask.isPending
  const showWelcome = !convId && !hasActivity
  const showEmptyThread = !!convId && !hasActivity && messagesQuery.isSuccess

  const conversationSelectOptions = [
    { value: '__none__', label: 'Ask a question' },
    ...conversations.map((c) => ({ value: c.id, label: c.title })),
  ]

  if (!projectId) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          title="No project selected"
          description="Pick a project in the top bar to ask the assistant anything."
        />
      </div>
    )
  }

  return (
    <div className="ph-assistant">
      {/* ------------------------------------------------ conversations rail */}
      <aside className="ph-rail" aria-label="Conversations">
        <div className="ph-rail-head">
          <span className="label-mono text-muted">Chats</span>
          <Button
            size="sm"
            variant="ghost"
            loading={newChat.isPending}
            onClick={() => newChat.mutate()}
          >
            <Plus size={14} aria-hidden />
            New chat
          </Button>
        </div>
        <div className="ph-rail-list">
          {conversationsQuery.isPending ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[13px] text-muted">
              <Spinner size={13} /> Loading…
            </p>
          ) : conversationsQuery.isError ? (
            <div className="px-2 py-3">
              <p className="text-[13px] text-muted">Couldn't load conversations.</p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 px-0"
                onClick={() => void conversationsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-muted">
              No conversations yet — ask your first question.
            </p>
          ) : (
            conversations.map((c) => (
              <div key={c.id} className="ph-conv-wrap">
                <button
                  type="button"
                  className="ph-conv"
                  data-active={convId === c.id ? 'true' : 'false'}
                  aria-current={convId === c.id ? 'page' : undefined}
                  onClick={() => selectConversation(c.id)}
                >
                  <span className="ph-conv-title">{c.title}</span>
                  <span className="ph-conv-meta">
                    {relTime(c.updated_at ?? c.created_at)}
                    {c.message_count > 0 ? ` · ${c.message_count} msg` : ''}
                  </span>
                </button>
                <IconButton
                  aria-label={`Delete conversation ${c.title}`}
                  size="sm"
                  className="ph-conv-del"
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 size={13} aria-hidden />
                </IconButton>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* -------------------------------------------------------- chat column */}
      <section className="ph-chat" aria-label="Assistant">
        <div className="ph-mobile-bar">
          <Button
            size="sm"
            variant="ghost"
            loading={newChat.isPending}
            onClick={() => newChat.mutate()}
          >
            <Plus size={14} aria-hidden />
            New chat
          </Button>
          <div className="min-w-0 flex-1">
            <Select
              ariaLabel="Conversation"
              value={convId ?? '__none__'}
              onChange={(v) => selectConversation(v === '__none__' ? null : v)}
              options={conversationSelectOptions}
              className="ph-select-full"
            />
          </div>
        </div>

        <div className="ph-thread" ref={threadRef}>
          <div className="ph-thread-inner">
            {showWelcome ? (
              <Welcome
                sub="Answers cite only documents you're authorised to see."
                disabled={ask.isPending}
                onPick={send}
              />
            ) : null}

            {showEmptyThread ? (
              <Welcome disabled={ask.isPending} onPick={send} />
            ) : null}

            {messagesQuery.isError && !hasActivity ? (
              <ErrorCard
                text={errMsg(messagesQuery.error)}
                onRetry={() => void messagesQuery.refetch()}
              />
            ) : null}

            {thread.map((m) =>
              m.error ? (
                <ErrorCard key={m.id} text={m.error} onRetry={retry} />
              ) : m.role === 'user' ? (
                <div key={m.id} className="ph-msg-user">
                  {m.content}
                </div>
              ) : (
                <AssistantMessage key={m.id} message={m} onCite={setCite} onRetry={retry} />
              ),
            )}

            {ask.isPending ? (
              <div className="ph-pending" role="status">
                <Spinner size={14} />
                <span>Consulting authorised evidence</span>
                <span className="ph-dots" aria-hidden>
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </div>
            ) : null}

            {askError && !ask.isPending ? <ErrorCard text={askError} onRetry={retry} /> : null}
          </div>
        </div>

        <div className="ph-composer">
          <div className="ph-composer-inner">
            <textarea
              ref={taRef}
              className="ph-input"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask what the sources actually know…"
              aria-label="Message the assistant"
            />
            <span className="ph-enter-hint" aria-hidden>
              ENTER ↵
            </span>
            <button
              type="button"
              className="ph-send"
              aria-label="Send message"
              disabled={!draft.trim() || ask.isPending}
              onClick={() => send(draft)}
            >
              <ArrowUp size={16} aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- modals */}
      <Modal open={!!deleteTarget} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
        <ModalContent
          title="Delete this conversation?"
          description="The thread and its citations go away for everyone in the project."
        >
          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteConversation.isPending}
              onClick={() => {
                if (deleteTarget) deleteConversation.mutate(deleteTarget.id)
              }}
            >
              Delete
            </Button>
          </div>
        </ModalContent>
      </Modal>

      <Modal open={!!cite} onOpenChange={(open) => (!open ? setCite(null) : undefined)}>
        <ModalContent title="Source quote" description="The exact passage this answer leaned on.">
          {cite ? (
            <div className="flex flex-col gap-4">
              <div className="ph-quote-card">
                <p>“{cite.quote}”</p>
              </div>
              <div className="ph-quote-meta">
                <span>{cite.document_name ?? 'Document'}</span>
                {cite.page_number != null ? <span>Page {cite.page_number}</span> : null}
                {cite.section ? <span>{cite.section}</span> : null}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
                <Button variant="ghost" onClick={() => setCite(null)}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCite(null)
                    navigate('/app/documents')
                  }}
                >
                  View in Documents
                </Button>
              </div>
            </div>
          ) : null}
        </ModalContent>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------- pieces */

function Welcome({
  sub,
  disabled,
  onPick,
}: {
  sub?: string
  disabled: boolean
  onPick: (text: string) => void
}) {
  return (
    <div className="ph-welcome">
      <h2 className="ph-welcome-title">Ask what the sources actually know.</h2>
      {sub ? <p className="ph-welcome-sub">{sub}</p> : null}
      <div className="ph-suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="ph-suggest"
            disabled={disabled}
            onClick={() => onPick(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function AssistantMessage({
  message: m,
  onCite,
  onRetry,
}: {
  message: MessageOut
  onCite: (c: EvidenceRef) => void
  onRetry: () => void
}) {
  const meta = m.meta ?? {}
  const retrieved = metaNum(meta, 'retrieved_count')
  const model = metaStr(meta, 'model')
  const demo = metaBool(meta, 'demo_mode')
  const uncertainty =
    metaStr(meta, 'uncertainty') ?? (meta['uncertainty'] ? NO_SOURCES : null)
  const citations = m.citations ?? []

  if (m.error) return <ErrorCard text={m.error} onRetry={onRetry} />

  return (
    <div className="ph-msg-ai">
      <div className="ph-msg-meta">
        <span>Assistant</span>
        {retrieved !== null ? (
          <span>
            {retrieved} source{retrieved === 1 ? '' : 's'} consulted
          </span>
        ) : null}
        {model ? <span>{model}</span> : null}
        {demo ? <span className="ph-demo-chip">Sample mode</span> : null}
      </div>

      {renderBlocks(m.content)}

      {uncertainty ? <p className="ph-uncertainty">{uncertainty}</p> : null}

      {citations.length > 0 ? (
        <div className="ph-cites">
          {citations.map((c, i) => (
            <button
              key={`${c.chunk_id ?? 'c'}-${i}`}
              type="button"
              className="ph-cite-chip"
              onClick={() => onCite(c)}
            >
              <span className="ph-cite-num">[{i + 1}]</span>
              <span className="ph-cite-name">{c.document_name ?? 'Source'}</span>
              {c.page_number != null ? <span>p.{c.page_number}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ErrorCard({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="ph-error-card" role="alert">
      <p className="ph-error-title">The assistant couldn't answer</p>
      <p className="ph-error-text">{text}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
        <RotateCcw size={13} aria-hidden />
        Retry
      </Button>
    </div>
  )
}
