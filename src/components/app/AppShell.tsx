import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRightLeft,
  BookOpen,
  Database,
  FileText,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  RotateCcw,
  Settings,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, demoApi } from '@/lib/api'
import { useCurrentProject, useSession } from '@/providers/AppProviders'
import {
  Avatar,
  Button,
  CenteredSpinner,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Select,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui'

type NavItem = {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/tree', label: 'Project Tree', icon: FolderTree },
  { to: '/app/documents', label: 'Documents', icon: FileText },
  { to: '/app/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/app/graph', label: 'Graph', icon: Share2 },
  { to: '/app/authority', label: 'Authority', icon: ShieldCheck },
  { to: '/app/handover', label: 'Handover', icon: ArrowRightLeft },
  { to: '/app/assistant', label: 'Assistant', icon: MessageSquare },
  { to: '/app/activity', label: 'Activity', icon: Activity },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.detail || err.error
  return 'Something went wrong. Please try again.'
}

export function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const { status, user, logout, enableCheck } = useSession()
  const {
    workspace,
    workspaces,
    projects,
    projectId,
    projectsQuery,
    setWorkspace,
    setProject,
  } = useCurrentProject()

  const [rail, setRail] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    enableCheck()
  }, [enableCheck])

  const demoStatusQuery = useQuery({
    queryKey: ['demoStatus'],
    queryFn: () => demoApi.status(),
    retry: false,
    staleTime: 30_000,
  })
  const demoSeeded = demoStatusQuery.data?.seeded ?? false

  const seedMutation = useMutation({
    mutationFn: () => demoApi.seed(),
    onSuccess: (result) => {
      toast.success('Demo data loaded.')
      const record = (result ?? {}) as Record<string, unknown>
      const wsId = typeof record.workspace_id === 'string' ? record.workspace_id : null
      const pjId = typeof record.project_id === 'string' ? record.project_id : null
      if (wsId) {
        setWorkspace(wsId)
        if (pjId) setProject(pjId)
      }
      void qc.invalidateQueries()
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const resetMutation = useMutation({
    mutationFn: () => demoApi.reset(workspace?.id),
    onSuccess: () => {
      toast.success('Demo data reset.')
      setProject(null)
      void qc.invalidateQueries()
    },
    onError: (err) => toast.error(errMsg(err)),
  })

  const handleLogout = useCallback(async () => {
    await logout()
    navigate('/', { replace: true })
  }, [logout, navigate])

  const handleDemo = useCallback(() => {
    if (demoSeeded) resetMutation.mutate()
    else seedMutation.mutate()
  }, [demoSeeded, resetMutation, seedMutation])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <CenteredSpinner label="Loading ProjectPulse" />
      </div>
    )
  }

  if (status === 'anonymous' || !user) {
    return <Navigate to="/login" replace />
  }

  const isActive = (item: NavItem) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)

  return (
    <div
      className="pp-app"
      data-rail={rail ? 'true' : 'false'}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
    >
      {mobileOpen ? <div className="pp-backdrop" onClick={() => setMobileOpen(false)} /> : null}

      <aside className="pp-sidebar">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <span
            aria-hidden
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] bg-forest font-display text-sm text-paper"
          >
            P
          </span>
          <span className="pp-sidebar-label min-w-0">
            <span className="block truncate font-display text-[17px] leading-none text-ink">
              ProjectPulse
            </span>
            <span className="label-mono mt-1 block text-[9px] text-muted">
              PROJECTPULSE
            </span>
          </span>
          <IconButton
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            size="sm"
            className="ml-auto hidden lg:inline-flex"
            onClick={() => setRail((r) => !r)}
          >
            {rail ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
          </IconButton>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = isActive(item)
            const link = (
              <Link
                to={item.to}
                data-active={active}
                className="pp-nav-link"
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={16} className="shrink-0" aria-hidden />
                <span className="pp-sidebar-label truncate">{item.label}</span>
              </Link>
            )
            if (!rail) return <Fragment key={item.to}>{link}</Fragment>
            return (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent>{item.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </nav>

        <div className="pp-sidebar-footer flex flex-col gap-2 border-t border-line px-3 py-3">
          <div className="pp-sidebar-label flex min-w-0 items-center gap-2.5 px-1">
            <Avatar name={user.name} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{user.name}</p>
              <p className="truncate text-[11px] text-muted">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1"
              loading={seedMutation.isPending || resetMutation.isPending}
              onClick={handleDemo}
            >
              {demoSeeded ? (
                <RotateCcw size={13} aria-hidden />
              ) : (
                <Database size={13} aria-hidden />
              )}
              <span className="pp-sidebar-label truncate">
                {demoSeeded ? 'Reset demo data' : 'Load demo data'}
              </span>
            </Button>
            <IconButton aria-label="Log out" onClick={() => void handleLogout()}>
              <LogOut size={15} />
            </IconButton>
          </div>
        </div>
      </aside>

      <div className="pp-main">
        <header className="pp-topbar">
          <IconButton
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="lg:hidden"
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X size={17} /> : <Menu size={17} />}
          </IconButton>

          <div className="flex min-w-0 items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="label-mono text-muted">Workspace</span>
              <Select
                ariaLabel="Workspace"
                value={workspace?.id ?? null}
                onChange={setWorkspace}
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                placeholder={workspaces.length ? 'Workspace' : 'No workspace'}
                disabled={!workspaces.length}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="label-mono text-muted">Project</span>
              <Select
                ariaLabel="Project"
                value={projectId}
                onChange={setProject}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                placeholder={
                  projectsQuery.isPending
                    ? 'Loading…'
                    : projects.length
                      ? 'Project'
                      : 'No project'
                }
                disabled={!projects.length || projectsQuery.isPending}
              />
            </label>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {demoSeeded ? (
              <Chip className="border-ember/40 bg-ember/8 text-ember">Demo</Chip>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="rounded-full transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-1"
                >
                  <Avatar name={user.name} size={32} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="font-sans">
                  <span className="block text-[13px] font-medium normal-case text-ink">
                    {user.name}
                  </span>
                  <span className="block text-[11px] normal-case text-muted">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/app/settings')}>
                  <Settings size={14} aria-hidden />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-ember focus:text-ember"
                  onSelect={() => void handleLogout()}
                >
                  <LogOut size={14} aria-hidden />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="pp-content">
          <div className="mx-auto w-full max-w-[1400px] px-8 py-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
