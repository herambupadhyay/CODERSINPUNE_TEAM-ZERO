import { useEffect, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import App from './App'
import { AppShell } from './components/app/AppShell'
import { CenteredSpinner } from './components/app/ui'
import { useSession } from './providers/AppProviders'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { ActivityPage } from './pages/app/ActivityPage'
import { AssistantPage } from './pages/app/AssistantPage'
import { AuthorityPage } from './pages/app/AuthorityPage'
import { DocumentsPage } from './pages/app/DocumentsPage'
import { GraphPage } from './pages/app/GraphPage'
import { HandoverPage } from './pages/app/HandoverPage'
import { KnowledgePage } from './pages/app/KnowledgePage'
import { OverviewPage } from './pages/app/OverviewPage'
import { SettingsPage } from './pages/app/SettingsPage'

/** Login / signup are for anonymous visitors only. */
function AnonymousOnly({ children }: { children: ReactNode }) {
  const { status, enableCheck } = useSession()

  useEffect(() => {
    enableCheck()
  }, [enableCheck])

  if (status === 'loading') return <CenteredSpinner label="Checking your session" />
  if (status === 'authenticated') return <Navigate to="/app" replace />
  return <>{children}</>
}

export const router = createBrowserRouter([
  { path: '/', element: <App /> },
  {
    path: '/login',
    element: (
      <AnonymousOnly>
        <LoginPage />
      </AnonymousOnly>
    ),
  },
  {
    path: '/signup',
    element: (
      <AnonymousOnly>
        <SignupPage />
      </AnonymousOnly>
    ),
  },
  {
    path: '/app',
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'knowledge', element: <KnowledgePage /> },
      { path: 'graph', element: <GraphPage /> },
      { path: 'authority', element: <AuthorityPage /> },
      { path: 'handover', element: <HandoverPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
