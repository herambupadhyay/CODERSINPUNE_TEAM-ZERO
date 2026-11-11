// ProjectPulse API types — mirrors backend/app/schemas (frozen contract).

export type WorkspaceRole = 'owner' | 'lead' | 'member' | 'successor'
export type ProjectRole = 'head' | 'lead' | 'member' | 'successor'
export type MemberStatus = 'active' | 'invited' | 'deactivated'
export type DocumentStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'needs_review'
export type DocumentKind = 'pdf' | 'docx' | 'txt' | 'markdown' | 'csv'
export type AccessScope = 'project' | 'restricted'
export type KnowledgeType =
  | 'decision'
  | 'task'
  | 'risk'
  | 'dependency'
  | 'person'
  | 'gap'
  | 'question'
  | 'contact'
export type EvidenceStatus = 'supported' | 'inferred' | 'conflicting' | 'missing'
export type ReviewState = 'pending' | 'verified' | 'rejected' | 'corrected'
export type RelationshipType =
  | 'owns'
  | 'assigned_to'
  | 'depends_on'
  | 'blocks'
  | 'decided_by'
  | 'supports'
  | 'supersedes'
  | 'mentioned_in'
  | 'resolved_by'
  | 'related_to'
export type HandoverStatus =
  | 'draft'
  | 'processing'
  | 'needs_review'
  | 'changes_requested'
  | 'approved'
  | 'shared'
  | 'archived'
export type FindingReviewState = 'pending' | 'accepted' | 'rejected' | 'edited'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

// ---- error envelope -------------------------------------------------------

export interface ApiErrorBody {
  error: string
  detail?: string | null
}

// ---- auth -----------------------------------------------------------------

export interface UserOut {
  id: string
  email: string
  name: string
  title: string | null
}

export interface SessionWorkspace {
  id: string
  name: string
  slug: string
  role: WorkspaceRole
}

export interface SessionOut {
  user: UserOut
  primary_workspace_id: string | null
  workspaces: SessionWorkspace[]
}

export interface SignupPayload {
  email: string
  name: string
  password: string
  title?: string | null
  workspace_name?: string | null
}

export interface LoginPayload {
  email: string
  password: string
}

export interface OkOut {
  ok: boolean
}

// ---- workspaces -----------------------------------------------------------

export interface WorkspaceOut {
  id: string
  name: string
  description?: string | null
  slug: string
  owner_id: string
  member_count: number
  project_count: number
  created_at?: string | null
}

export interface WorkspaceMemberOut {
  id: string
  user_id: string
  workspace_id: string
  role: WorkspaceRole
  status: MemberStatus
  name: string
  email: string
  title?: string | null
}

export interface InvitationOut {
  id: string
  email: string
  role: WorkspaceRole
  token: string
  expires_at: string
  accepted_at?: string | null
}

// ---- projects -------------------------------------------------------------

export interface Counts {
  documents: number
  chunks: number
  knowledge: number
  pending_review: number
  handovers: number
  open_tasks: number
  gaps: number
  members: number
}

export interface ProjectOut {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  tags: string[]
  archived: boolean
  created_at?: string | null
  counts: Counts
  my_role: ProjectRole | null
}

export interface ProjectCreatePayload {
  name: string
  description?: string | null
  tags: string[]
}

export interface ProjectUpdatePayload {
  name?: string
  description?: string | null
  tags?: string[]
  archived?: boolean
}

export interface ProjectMemberOut {
  id: string
  project_id: string
  user_id: string
  role: ProjectRole
  status: MemberStatus
  responsibility?: string | null
  name: string
  email: string
  title?: string | null
}

export interface ProjectMemberAddPayload {
  email: string
  role: ProjectRole
  responsibility?: string | null
}

export interface ProjectMemberUpdatePayload {
  role?: ProjectRole
  responsibility?: string | null
  status?: MemberStatus
}

// ---- documents ------------------------------------------------------------

export interface DocumentOut {
  id: string
  project_id: string
  original_name: string
  kind: DocumentKind
  size_bytes: number
  status: DocumentStatus
  access_scope: AccessScope
  mime_type?: string | null
  page_count?: number | null
  char_count?: number | null
  chunk_count: number
  extracted_count: number
  error_message?: string | null
  uploaded_by?: string | null
  uploaded_by_name?: string | null
  created_at?: string | null
  processed_at?: string | null
}

export interface DocumentGrantOut {
  document_id: string
  user_id: string
  name: string
  email: string
  granted_by?: string | null
}

export interface JobOut {
  id: string
  document_id: string
  status: JobStatus
  stage: string
  attempts: number
  error_message?: string | null
  stats: Record<string, unknown>
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export interface ChunkOut {
  id: string
  document_id: string
  seq: number
  text: string
  page_number?: number | null
  section?: string | null
  source_type: string
  access_scope: AccessScope
  score?: number | null
  document_name?: string | null
}

export interface UploadResult {
  document: DocumentOut
  job?: JobOut | null
  duplicate: boolean
  warnings: string[]
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

// ---- knowledge ------------------------------------------------------------

export interface EvidenceRef {
  document_id?: string | null
  document_name?: string | null
  chunk_id?: string | null
  quote?: string
  page_number?: number | null
  section?: string | null
  label?: string | null
  position?: number
}

export interface KnowledgeItemOut {
  id: string
  project_id: string
  type: KnowledgeType
  title: string
  description: string
  reasoning?: string | null
  attributes: Record<string, unknown>
  evidence_status: EvidenceStatus
  review_state: ReviewState
  access_scope: AccessScope
  subject_user_id?: string | null
  source_document_id?: string | null
  source_document_name?: string | null
  is_sample: boolean
  reviewed_by?: string | null
  reviewed_at?: string | null
  corrected_text?: string | null
  created_at?: string | null
  evidence: EvidenceRef[]
}

export interface KnowledgeListOut {
  items: KnowledgeItemOut[]
  total: number
  counts_by_type: Record<string, number>
  counts_by_evidence: Record<string, number>
  pending_review: number
}

export interface KnowledgeQuery {
  type?: KnowledgeType
  review_state?: ReviewState
  evidence_status?: EvidenceStatus
  access_scope?: AccessScope
  q?: string
  limit?: number
  offset?: number
}

export interface KnowledgeReviewPayload {
  action: 'verify' | 'reject' | 'correct' | 'comment' | 'restore'
  note?: string | null
  corrected_text?: string | null
}

export interface KnowledgeItemCreate {
  type: KnowledgeType
  title: string
  description?: string
  reasoning?: string | null
  attributes?: Record<string, unknown>
  evidence_status?: EvidenceStatus
  access_scope?: AccessScope
  subject_user_id?: string | null
}

export interface EvidenceOut {
  id: string
  item_id: string
  document_id: string
  document_name?: string | null
  quote: string
  page_number?: number | null
  section?: string | null
  confidence?: string | null
}

// ---- graph ----------------------------------------------------------------

export interface GraphNode {
  id: string
  type: KnowledgeType
  title: string
  evidence_status: EvidenceStatus
  review_state: ReviewState
  access_scope: AccessScope
  is_sample: boolean
  subject_user_id?: string | null
  group: number
}

export interface GraphEdge {
  id: string
  src_item_id: string
  dst_item_id: string
  rel_type: RelationshipType
  label?: string | null
  evidence_status: EvidenceStatus
  is_sample: boolean
}

export interface GraphOut {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  node_count: number
  edge_count: number
}

// ---- authority ------------------------------------------------------------

export interface AuthorityMemberOut {
  user_id: string
  name: string
  email: string
  ws_role?: WorkspaceRole | null
  project_role?: ProjectRole | null
  responsibility?: string | null
  is_workspace_owner: boolean
  document_grants: number
}

export interface CapabilityRow {
  key: string
  label: string
  description: string
  roles: string[]
  workspace_owner_allowed: boolean
}

export interface RoleCard {
  role: ProjectRole
  label: string
  summary: string
  capabilities: string[]
  limitations: string[]
}

export interface ScopeCard {
  scope: AccessScope
  label: string
  description: string
  visible_to: string[]
}

export interface AuthorityOverview {
  members: AuthorityMemberOut[]
  capabilities: CapabilityRow[]
  roles: RoleCard[]
  scopes: ScopeCard[]
  audit_enabled: boolean
}

export interface AuthorityGrant {
  user_id: string
  name: string
  email: string
  granted_by?: string | null
}

export interface AuthorityDocumentAccess {
  document_id: string
  name: string
  kind: string
  status: string
  grants: AuthorityGrant[]
}

export interface AuthorityAccess {
  documents: AuthorityDocumentAccess[]
}

export interface AuthorityMe {
  project_role?: ProjectRole | null
  workspace_role?: WorkspaceRole | null
  is_workspace_owner: boolean
  can: Record<string, boolean>
  limitations: string[]
}

// ---- handovers ------------------------------------------------------------

export interface SectionOut {
  id: string
  key: string
  title: string
  body: string
  position: number
  meta: Record<string, unknown>
}

export interface FindingOut {
  id: string
  handover_id: string
  section_key: string
  item_id?: string | null
  label: string
  content: string
  evidence_status: EvidenceStatus
  review_state: FindingReviewState
  evidence: EvidenceRef[]
  reviewer_note?: string | null
  position: number
}

export interface ApprovalOut {
  id: string
  actor_id?: string | null
  actor_name?: string | null
  action: string
  note?: string | null
  created_at?: string | null
}

export interface HandoverOut {
  id: string
  project_id: string
  created_by: string
  departing_user_id: string
  departing_name?: string | null
  successor_user_id?: string | null
  successor_name?: string | null
  role_transferred: string
  title: string
  status: HandoverStatus
  version: number
  scope: Record<string, unknown>
  impact: Record<string, unknown>
  summary?: string | null
  approved_by?: string | null
  approved_at?: string | null
  shared_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  section_count: number
  finding_count: number
}

export interface HandoverDetailOut extends HandoverOut {
  sections: SectionOut[]
  findings: FindingOut[]
  approvals: ApprovalOut[]
  can: Record<string, boolean>
}

export interface HandoverCreatePayload {
  departing_user_id: string
  successor_user_id?: string | null
  role_transferred: string
  title: string
  categories: string[]
}

export interface HandoverUpdatePayload {
  title?: string
  successor_user_id?: string | null
  role_transferred?: string
  scope?: Record<string, unknown>
}

export interface HandoverActionPayload {
  action: 'submit' | 'approve' | 'request_changes' | 'share' | 'archive' | 'delete'
  note?: string | null
  recipient_user_id?: string | null
}

export interface FindingReviewPayload {
  action: 'accept' | 'reject' | 'edit'
  content?: string | null
  note?: string | null
}

export interface ImpactItem {
  label: string
  type: string
  status?: string
}

export interface ImpactAnalysis {
  departing_user_id: string
  open_tasks: number
  decisions: number
  owned_systems: number
  documents_uploaded: number
  unresolved_items: number
  gaps: number
  items: ImpactItem[]
}

// ---- assistant / search / activity ---------------------------------------

export interface ConversationOut {
  id: string
  project_id: string
  title: string
  created_at?: string | null
  updated_at?: string | null
  message_count: number
}

export interface MessageOut {
  id: string
  conversation_id: string
  role: string
  content: string
  meta: Record<string, unknown>
  error?: string | null
  created_at?: string | null
  citations: EvidenceRef[]
}

export interface AskOut {
  conversation_id: string
  message: MessageOut
  retrieved_count: number
  model?: string | null
  demo_mode: boolean
  uncertainty?: string | null
}

export interface SearchHit {
  chunk_id: string
  document_id: string
  document_name: string
  text: string
  page_number?: number | null
  section?: string | null
  score: number
  access_scope: string
}

export interface SearchOut {
  query: string
  hits: SearchHit[]
  total: number
  demo_mode: boolean
}

export interface ActivityOut {
  id: string
  action: string
  actor_id?: string | null
  actor_name?: string | null
  actor_type: string
  target_type?: string | null
  target_id?: string | null
  summary?: string | null
  meta: Record<string, unknown>
  created_at?: string | null
}

// ---- demo / meta ----------------------------------------------------------

export interface DemoLogin {
  email: string
  name: string
  project_role: string
  password: string
}

export interface DemoStatus {
  seeded: boolean
  workspace_id?: string | null
  project_id?: string | null
  logins: DemoLogin[]
  counts: Record<string, number>
}

export interface DemoAccounts {
  seeded: boolean
  workspace_id?: string | null
  project_id?: string | null
  logins: DemoLogin[]
}

export interface HealthOut {
  status: string
  database: string
  pgvector: boolean
  ai_configured: boolean
  demo_mode: boolean
  embed_dim: number
  version: string
}

// ---- code snapshot --------------------------------------------------------

export interface CodeTreeFile {
  path: string
  size: number
}

export interface CodeTreeOut {
  root: string
  files: CodeTreeFile[]
  truncated: boolean
}

export interface CodeFileOut {
  path: string
  name: string
  language: string
  size: number
  content: string
  truncated: boolean
}
