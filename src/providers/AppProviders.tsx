import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ApiError, authApi, demoApi, projectsApi, setOnUnauthorized } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import type {
  Counts,
  ProjectOut,
  SessionOut,
  SessionWorkspace,
  SignupPayload,
  UserOut,
} from '@/lib/types'

const SESSION_KEY = ['session'] as const

/* ------------------------------------------------------------------ auth */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export type AuthContextValue = {
  session: SessionOut | null
  user: UserOut | null
  workspaces: SessionWorkspace[]
  status: AuthStatus
  login: (email: string, password: string) => Promise<SessionOut>
  loginDemo: (email: string) => Promise<SessionOut>
  signup: (payload: SignupPayload) => Promise<SessionOut>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  /** Route guards call this so the session is only probed outside the landing page. */
  enableCheck: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useSession(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useSession must be used within AppProviders')
  return ctx
}

function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  // The landing page must never hit the API (console-clean, no auth probe).
  const [checkEnabled, setCheckEnabled] = useState(
    () => typeof window !== 'undefined' && window.location.pathname !== '/',
  )
  const unauthorizedFired = useRef(false)

  const enableCheck = useCallback(() => setCheckEnabled(true), [])

  const sessionQuery = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => authApi.me(),
    enabled: checkEnabled,
    retry: false,
    staleTime: 60_000,
  })

  // Session lives in the query cache: login/signup/logout write it directly.
  const session = sessionQuery.data ?? null
  const status: AuthStatus = session
    ? 'authenticated'
    : sessionQuery.isFetched
      ? 'anonymous'
      : 'loading'

  useEffect(() => {
    setOnUnauthorized(() => {
      if (unauthorizedFired.current) return
      unauthorizedFired.current = true
      qc.setQueryData(SESSION_KEY, null)
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
    })
    return () => setOnUnauthorized(null)
  }, [qc])

  const login = useCallback(
    async (email: string, password: string) => {
      const next = await authApi.login({ email, password })
      unauthorizedFired.current = false
      qc.setQueryData(SESSION_KEY, next)
      void qc.invalidateQueries({ queryKey: SESSION_KEY })
      return next
    },
    [qc],
  )

  const loginDemo = useCallback(
    async (email: string) => {
      const next = await demoApi.quickstart(email)
      unauthorizedFired.current = false
      try {
        if (next.primary_workspace_id) {
          window.localStorage.setItem('pp.workspace', next.primary_workspace_id)
        } else {
          window.localStorage.removeItem('pp.workspace')
        }
        window.localStorage.removeItem('pp.project')
      } catch {
        /* storage unavailable — the session's primary workspace still applies */
      }
      qc.setQueryData(SESSION_KEY, next)
      void qc.invalidateQueries({ queryKey: SESSION_KEY })
      return next
    },
    [qc],
  )

  const signup = useCallback(
    async (payload: SignupPayload) => {
      const next = await authApi.signup(payload)
      unauthorizedFired.current = false
      qc.setQueryData(SESSION_KEY, next)
      void qc.invalidateQueries({ queryKey: SESSION_KEY })
      return next
    },
    [qc],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      /* the session may already be gone — local state still clears */
    }
    unauthorizedFired.current = false
    qc.setQueryData(SESSION_KEY, null)
    qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
  }, [qc])

  const refresh = useCallback(async () => {
    const next = await authApi.me()
    unauthorizedFired.current = false
    qc.setQueryData(SESSION_KEY, next)
  }, [qc])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      workspaces: session?.workspaces ?? [],
      status,
      login,
      loginDemo,
      signup,
      logout,
      refresh,
      enableCheck,
    }),
    [session, status, login, loginDemo, signup, logout, refresh, enableCheck],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/* --------------------------------------------------------------- project */

const LS_WORKSPACE = 'pp.workspace'
const LS_PROJECT = 'pp.project'

function readLs(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLs(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — selection just won't persist */
  }
}

export type ProjectContextValue = {
  workspace: SessionWorkspace | null
  workspaceId: string | null
  project: ProjectOut | null
  projectId: string | null
  counts: Counts | null
  setWorkspace: (id: string) => void
  setProject: (id: string | null) => void
  workspaces: SessionWorkspace[]
  projects: ProjectOut[]
  projectsQuery: UseQueryResult<ProjectOut[], ApiError | Error>
  projectQuery: UseQueryResult<ProjectOut, ApiError | Error>
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useCurrentProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useCurrentProject must be used within AppProviders')
  return ctx
}

function ProjectProvider({ children }: { children: ReactNode }) {
  const { session, status } = useSession()
  const qc = useQueryClient()

  const workspaces = useMemo(() => session?.workspaces ?? [], [session])
  const [storedWorkspaceId, setStoredWorkspaceId] = useState<string | null>(() =>
    readLs(LS_WORKSPACE),
  )
  const [storedProjectId, setStoredProjectId] = useState<string | null>(() => readLs(LS_PROJECT))

  // Resolve the workspace during render: stored choice wins if still valid,
  // otherwise fall back to the session's primary workspace (then the first).
  const workspaceId = useMemo(() => {
    if (status !== 'authenticated') return storedWorkspaceId
    if (storedWorkspaceId && workspaces.some((w) => w.id === storedWorkspaceId)) {
      return storedWorkspaceId
    }
    const primary = session?.primary_workspace_id
    if (primary && workspaces.some((w) => w.id === primary)) return primary
    return workspaces[0]?.id ?? null
  }, [status, session, storedWorkspaceId, workspaces])

  const projectsQuery = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => projectsApi.list(workspaceId as string),
    enabled: status === 'authenticated' && !!workspaceId,
  })

  // Resolve the project during render: stored choice if still in this
  // workspace, otherwise the workspace's first project.
  const projectId = useMemo(() => {
    const list = projectsQuery.data
    if (!list || projectsQuery.status !== 'success') return null
    if (storedProjectId && list.some((p) => p.id === storedProjectId)) return storedProjectId
    return list[0]?.id ?? null
  }, [projectsQuery.data, projectsQuery.status, storedProjectId])

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId as string),
    enabled: status === 'authenticated' && !!projectId,
  })

  const project =
    projectQuery.data ?? projectsQuery.data?.find((p) => p.id === projectId) ?? null

  const setWorkspace = useCallback((id: string) => {
    setStoredWorkspaceId(id)
    writeLs(LS_WORKSPACE, id)
    setStoredProjectId(null)
    writeLs(LS_PROJECT, null)
    qc.removeQueries({ queryKey: ['project'] })
  }, [qc])

  const setProject = useCallback((id: string | null) => {
    setStoredProjectId(id)
    writeLs(LS_PROJECT, id)
  }, [])

  const value = useMemo<ProjectContextValue>(
    () => ({
      workspace: workspaces.find((w) => w.id === workspaceId) ?? null,
      workspaceId,
      project,
      projectId,
      counts: project?.counts ?? null,
      setWorkspace,
      setProject,
      workspaces,
      projects: projectsQuery.data ?? [],
      projectsQuery,
      projectQuery,
    }),
    [
      workspaces,
      workspaceId,
      project,
      projectId,
      setWorkspace,
      setProject,
      projectsQuery,
      projectQuery,
    ],
  )

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

/* ------------------------------------------------------------- providers */

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ProjectProvider>
          {children}
          <Toaster
            theme="light"
            position="top-center"
            toastOptions={{
              style: {
                background: '#faf8f4',
                border: '1px solid #eaeae5',
                borderRadius: '3px',
                color: '#20231f',
                fontFamily: "'Inter', system-ui, sans-serif",
                fontSize: '14px',
              },
            }}
          />
        </ProjectProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
