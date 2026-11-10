import type {
  ActivityOut,
  ApiErrorBody,
  AskOut,
  AuthorityAccess,
  AuthorityMe,
  AuthorityOverview,
  ChunkOut,
  CodeFileOut,
  CodeTreeOut,
  ConversationOut,
  DemoAccounts,
  DemoStatus,
  DocumentGrantOut,
  DocumentOut,
  EvidenceOut,
  FindingReviewPayload,
  GraphOut,
  HandoverActionPayload,
  HandoverCreatePayload,
  HandoverDetailOut,
  HandoverOut,
  HandoverUpdatePayload,
  HealthOut,
  InvitationOut,
  ImpactAnalysis,
  JobOut,
  KnowledgeItemOut,
  KnowledgeListOut,
  KnowledgeQuery,
  KnowledgeReviewPayload,
  LoginPayload,
  MessageOut,
  OkOut,
  Page,
  ProjectCreatePayload,
  ProjectMemberAddPayload,
  ProjectMemberOut,
  ProjectMemberUpdatePayload,
  ProjectOut,
  ProjectUpdatePayload,
  SearchOut,
  SessionOut,
  SignupPayload,
  UploadResult,
  WorkspaceMemberOut,
  WorkspaceOut,
} from './types'

const BASE = '/api'

const STATUS_FALLBACK: Record<number, string> = {
  400: 'Something went wrong with that request.',
  401: 'Please sign in again.',
  403: "You don't have permission to do that.",
  404: 'Not found.',
  409: 'That conflicts with something that already exists.',
  422: 'Please check the highlighted fields and try again.',
  500: 'Something went wrong on our side. Please try again.',
}

export class ApiError extends Error {
  status: number
  error: string
  detail?: string

  constructor(status: number, error: string, detail?: string) {
    super(detail || error)
    this.name = 'ApiError'
    this.status = status
    this.error = error
    this.detail = detail
  }
}

type UnauthorizedHandler = () => void

let onUnauthorized: UnauthorizedHandler | null = null

/** Registered by AuthProvider â€” fired on any 401 response. */
export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

export type ApiInit = RequestInit & { json?: unknown; form?: FormData }

async function toApiError(res: Response): Promise<ApiError> {
  let error = STATUS_FALLBACK[res.status] || `Request failed (${res.status}).`
  let detail: string | undefined
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>
    if (body && typeof body.error === 'string' && body.error.trim()) error = body.error
    if (body && typeof body.detail === 'string' && body.detail.trim()) detail = body.detail
  } catch {
    /* non-JSON body â€” keep the fallback message */
  }
  const apiError = new ApiError(res.status, error, detail)
  if (res.status === 401 && onUnauthorized) onUnauthorized()
  return apiError
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, form, ...rest } = init
  const headers = new Headers(rest.headers)

  let body: BodyInit | undefined
  if (form) {
    body = form // FormData sets its own multipart content-type
  } else if (json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(json)
  } else {
    body = rest.body ?? undefined
  }

  let res: Response
  try {
    res = await fetch(BASE + path, {
      ...rest,
      headers,
      body,
      credentials: 'include',
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }

  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T

  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** Raw fetch for binary downloads (e.g. markdown export). */
export async function apiBlob(path: string, init: ApiInit = {}): Promise<Blob> {
  const { json, form, ...rest } = init
  const headers = new Headers(rest.headers)
  let body: BodyInit | undefined
  if (form) {
    body = form
  } else if (json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(json)
  } else {
    body = rest.body ?? undefined
  }

  let res: Response
  try {
    res = await fetch(BASE + path, { ...rest, headers, body, credentials: 'include' })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }
  if (!res.ok) throw await toApiError(res)
  return res.blob()
}

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

// ---- auth -----------------------------------------------------------------

export const authApi = {
  signup: (payload: SignupPayload) => api<SessionOut>('/auth/signup', { method: 'POST', json: payload }),
  login: (payload: LoginPayload) => api<SessionOut>('/auth/login', { method: 'POST', json: payload }),
  logout: () => api<OkOut>('/auth/logout', { method: 'POST' }),
  me: () => api<SessionOut>('/auth/me'),
}

// ---- workspaces -----------------------------------------------------------

export const workspacesApi = {
  list: () => api<WorkspaceOut[]>('/workspaces'),
  create: (payload: { name: string; description?: string | null }) =>
    api<WorkspaceOut>('/workspaces', { method: 'POST', json: payload }),
  get: (id: string) => api<WorkspaceOut>(`/workspaces/${id}`),
  members: (id: string) => api<WorkspaceMemberOut[]>(`/workspaces/${id}/members`),
  updateMember: (id: string, userId: string, role: string) =>
    api<WorkspaceMemberOut>(`/workspaces/${id}/members/${userId}`, {
      method: 'PATCH',
      json: { role },
    }),
  createInvitation: (id: string, payload: { email: string; role: string }) =>
    api<InvitationOut>(`/workspaces/${id}/invitations`, { method: 'POST', json: payload }),
  listInvitations: (id: string) => api<InvitationOut[]>(`/workspaces/${id}/invitations`),
  acceptInvitation: (token: string) =>
    api<WorkspaceMemberOut>(`/workspaces/invitations/accept${qs({ token })}`, { method: 'POST' }),
}

// ---- projects -------------------------------------------------------------

export const projectsApi = {
  list: (workspaceId: string) => api<ProjectOut[]>(`/projects${qs({ workspace_id: workspaceId })}`),
  create: (workspaceId: string, payload: ProjectCreatePayload) =>
    api<ProjectOut>(`/projects${qs({ workspace_id: workspaceId })}`, {
      method: 'POST',
      json: payload,
    }),
  get: (id: string) => api<ProjectOut>(`/projects/${id}`),
  update: (id: string, payload: ProjectUpdatePayload) =>
    api<ProjectOut>(`/projects/${id}`, { method: 'PATCH', json: payload }),
  members: (id: string) => api<ProjectMemberOut[]>(`/projects/${id}/members`),
  addMember: (id: string, payload: ProjectMemberAddPayload) =>
    api<ProjectMemberOut>(`/projects/${id}/members`, { method: 'POST', json: payload }),
  updateMember: (id: string, userId: string, payload: ProjectMemberUpdatePayload) =>
    api<ProjectMemberOut>(`/projects/${id}/members/${userId}`, {
      method: 'PATCH',
      json: payload,
    }),
}

// ---- documents ------------------------------------------------------------

export const documentsApi = {
  list: (projectId: string) => api<DocumentOut[]>(`/projects/${projectId}/documents`),
  upload: (projectId: string, file: File, accessScope: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('access_scope', accessScope)
    return api<UploadResult>(`/projects/${projectId}/documents`, { method: 'POST', form })
  },
  get: (projectId: string, docId: string) =>
    api<DocumentOut>(`/projects/${projectId}/documents/${docId}`),
  remove: (projectId: string, docId: string) =>
    api<OkOut>(`/projects/${projectId}/documents/${docId}`, { method: 'DELETE' }),
  updateScope: (projectId: string, docId: string, accessScope: string) =>
    api<DocumentOut>(`/projects/${projectId}/documents/${docId}`, {
      method: 'PATCH',
      json: { access_scope: accessScope },
    }),
  chunks: (projectId: string, docId: string, limit = 50, offset = 0) =>
    api<Page<ChunkOut>>(
      `/projects/${projectId}/documents/${docId}/chunks${qs({ limit, offset })}`,
    ),
  job: (projectId: string, docId: string) =>
    api<JobOut | null>(`/projects/${projectId}/documents/${docId}/job`),
  reprocess: (projectId: string, docId: string) =>
    api<JobOut>(`/projects/${projectId}/documents/${docId}/reprocess`, { method: 'POST' }),
  grants: (projectId: string, docId: string) =>
    api<DocumentGrantOut[]>(`/projects/${projectId}/documents/${docId}/grants`),
  addGrant: (projectId: string, docId: string, userId: string) =>
    api<DocumentGrantOut>(`/projects/${projectId}/documents/${docId}/grants`, {
      method: 'POST',
      json: { user_id: userId },
    }),
  removeGrant: (projectId: string, docId: string, userId: string) =>
    api<OkOut>(`/projects/${projectId}/documents/${docId}/grants/${userId}`, {
      method: 'DELETE',
    }),
}

// ---- code snapshot --------------------------------------------------------

export const codeApi = {
  tree: (projectId: string) => api<CodeTreeOut>(`/projects/${projectId}/code`),
  file: (projectId: string, path: string) =>
    api<CodeFileOut>(`/projects/${projectId}/code/file${qs({ path })}`),
}

// ---- processing -----------------------------------------------------------

export const processingApi = {
  jobs: (projectId: string) => api<JobOut[]>(`/projects/${projectId}/processing/jobs`),
  retry: (projectId: string, jobId: string) =>
    api<JobOut>(`/projects/${projectId}/processing/jobs/${jobId}/retry`, { method: 'POST' }),
}

// ---- knowledge ------------------------------------------------------------

export const knowledgeApi = {
  list: (projectId: string, query: KnowledgeQuery = {}) =>
    api<KnowledgeListOut>(`/projects/${projectId}/knowledge${qs(query as Record<string, string | number | undefined>)}`),
  get: (projectId: string, itemId: string) =>
    api<KnowledgeItemOut>(`/projects/${projectId}/knowledge/${itemId}`),
  review: (projectId: string, itemId: string, payload: KnowledgeReviewPayload) =>
    api<KnowledgeItemOut>(`/projects/${projectId}/knowledge/${itemId}/review`, {
      method: 'POST',
      json: payload,
    }),
  evidence: (projectId: string, itemId: string) =>
    api<EvidenceOut[]>(`/projects/${projectId}/knowledge/${itemId}/evidence`),
  remove: (projectId: string, itemId: string) =>
    api<OkOut>(`/projects/${projectId}/knowledge/${itemId}`, { method: 'DELETE' }),
}

// ---- graph / authority ----------------------------------------------------

export const graphApi = {
  get: (projectId: string) => api<GraphOut>(`/projects/${projectId}/graph`),
}

export const authorityApi = {
  overview: (projectId: string) => api<AuthorityOverview>(`/projects/${projectId}/authority`),
  me: (projectId: string) => api<AuthorityMe>(`/projects/${projectId}/authority/me`),
  access: (projectId: string) => api<AuthorityAccess>(`/projects/${projectId}/authority/access`),
  updateCapability: (projectId: string, payload: { key: string; role: string; enabled: boolean }) =>
    api<{ key: string; role: string; enabled: boolean; effective_roles: string[] }>(
      `/projects/${projectId}/authority/capabilities`,
      { method: 'PATCH', json: payload },
    ),
}

// ---- handovers ------------------------------------------------------------

export const handoverApi = {
  list: (projectId: string) => api<HandoverOut[]>(`/projects/${projectId}/handovers`),
  create: (projectId: string, payload: HandoverCreatePayload) =>
    api<HandoverDetailOut>(`/projects/${projectId}/handovers`, { method: 'POST', json: payload }),
  get: (projectId: string, handoverId: string) =>
    api<HandoverDetailOut>(`/projects/${projectId}/handovers/${handoverId}`),
  update: (projectId: string, handoverId: string, payload: HandoverUpdatePayload) =>
    api<HandoverDetailOut>(`/projects/${projectId}/handovers/${handoverId}`, {
      method: 'PATCH',
      json: payload,
    }),
  generate: (projectId: string, handoverId: string) =>
    api<HandoverDetailOut>(`/projects/${projectId}/handovers/${handoverId}/generate`, {
      method: 'POST',
    }),
  action: (projectId: string, handoverId: string, payload: HandoverActionPayload) =>
    api<HandoverDetailOut>(`/projects/${projectId}/handovers/${handoverId}/actions`, {
      method: 'POST',
      json: payload,
    }),
  reviewFinding: (
    projectId: string,
    handoverId: string,
    findingId: string,
    payload: FindingReviewPayload,
  ) =>
    api<HandoverDetailOut>(
      `/projects/${projectId}/handovers/${handoverId}/findings/${findingId}/review`,
      { method: 'POST', json: payload },
    ),
  impact: (projectId: string, departingUserId: string) =>
    api<ImpactAnalysis>(
      `/projects/${projectId}/handovers/impact${qs({ departing_user_id: departingUserId })}`,
    ),
  markdown: (projectId: string, handoverId: string) =>
    apiBlob(`/projects/${projectId}/handovers/${handoverId}/markdown`),
  delete: (projectId: string, handoverId: string) =>
    api<{ ok: boolean }>(`/projects/${projectId}/handovers/${handoverId}`, {
      method: 'DELETE',
    }),
}

// ---- assistant / search / activity ---------------------------------------

export const assistantApi = {
  conversations: (projectId: string) =>
    api<ConversationOut[]>(`/projects/${projectId}/assistant/conversations`),
  createConversation: (projectId: string, title?: string) =>
    api<ConversationOut>(`/projects/${projectId}/assistant/conversations`, {
      method: 'POST',
      json: title ? { title } : {},
    }),
  messages: (projectId: string, conversationId: string) =>
    api<MessageOut[]>(`/projects/${projectId}/assistant/conversations/${conversationId}/messages`),
  ask: (projectId: string, payload: { conversation_id?: string; message: string }) =>
    api<AskOut>(`/projects/${projectId}/assistant/ask`, { method: 'POST', json: payload }),
  deleteConversation: (projectId: string, conversationId: string) =>
    api<OkOut>(`/projects/${projectId}/assistant/conversations/${conversationId}`, {
      method: 'DELETE',
    }),
}

export const searchApi = {
  query: (projectId: string, q: string, limit = 8) =>
    api<SearchOut>(`/projects/${projectId}/search${qs({ q, limit })}`),
}

export const activityApi = {
  list: (params: { project_id?: string; workspace_id?: string; limit?: number; offset?: number } = {}) =>
    api<ActivityOut[]>(`/activity${qs(params)}`),
}

// ---- demo / meta ----------------------------------------------------------

export const demoApi = {
  status: () => api<DemoStatus>('/demo/status'),
  accounts: () => api<DemoAccounts>('/demo/accounts'),
  quickstart: (email: string) =>
    api<SessionOut & { seeded: boolean }>('/demo/quickstart', { method: 'POST', json: { email } }),
  seed: () => api<Record<string, unknown>>('/demo/seed', { method: 'POST' }),
  reset: (workspaceId?: string) =>
    api<Record<string, unknown>>('/demo/reset', {
      method: 'POST',
      json: workspaceId ? { workspace_id: workspaceId } : {},
    }),
}

export const metaApi = {
  health: () => api<HealthOut>('/health'),
}
