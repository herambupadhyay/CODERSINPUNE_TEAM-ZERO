import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { ApiError, demoApi } from '@/lib/api'
import { useSession } from '@/providers/AppProviders'
import type { DemoLogin } from '@/lib/types'

type RoleMeta = { label: string; blurb: string; icon: LucideIcon }

const ROLE_META: Record<string, RoleMeta> = {
  head: {
    label: 'Project head',
    blurb: 'Approves handovers, shares them, edits authority.',
    icon: ShieldCheck,
  },
  lead: {
    label: 'Lead',
    blurb: 'Reviews findings and prepares handovers.',
    icon: Users,
  },
  member: {
    label: 'Member',
    blurb: 'Uploads documents, asks the assistant, no reviews.',
    icon: UserRound,
  },
  successor: {
    label: 'Successor',
    blurb: 'Reads the approved handover once it is shared.',
    icon: ArrowRight,
  },
}

const ROLE_ORDER: Record<string, number> = { head: 0, lead: 1, member: 2, successor: 3 }

export function DemoAccess({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate()
  const { loginDemo } = useSession()
  const [busy, setBusy] = useState<string | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['demoAccounts'],
    queryFn: () => demoApi.accounts(),
    retry: false,
    staleTime: 30_000,
  })

  const logins = [...(accountsQuery.data?.logins ?? [])].sort(
    (a, b) => (ROLE_ORDER[a.project_role] ?? 9) - (ROLE_ORDER[b.project_role] ?? 9),
  )

  if (accountsQuery.isPending || !logins.length) return null

  const handleLogin = async (demo: DemoLogin) => {
    setBusy(demo.email)
    try {
      await loginDemo(demo.email)
      const meta = ROLE_META[demo.project_role]
      toast.success(`Signed in as ${demo.name}${meta ? ` — ${meta.label}` : ''}.`)
      navigate('/app', { replace: true })
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.detail || err.error
          : 'Demo sign-in failed. Please try again.',
      )
      setBusy(null)
    }
  }

  return (
    <section
      aria-label="Demo access"
      className="mt-7 rounded-[4px] border border-line bg-cream/70 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-mono flex items-center gap-1.5 text-forest">
          <KeyRound size={12} aria-hidden />
          Demo access — one click
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          no password needed
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Jump straight into the Northwind demo as any role. Each role sees a
        different slice of the project — exactly as authority allows.
      </p>

      <ul className={compact ? 'mt-3 flex flex-col gap-1.5' : 'mt-3 grid gap-1.5 sm:grid-cols-2'}>
        {logins.map((demo) => {
          const meta = ROLE_META[demo.project_role]
          const Icon = meta?.icon ?? UserRound
          const loading = busy === demo.email
          return (
            <li key={demo.email}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void handleLogin(demo)}
                className="group flex w-full items-center gap-3 rounded-[3px] border border-line bg-paper px-3 py-2.5 text-left transition-colors duration-150 hover:border-forest/40 hover:bg-cream disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-1"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-line bg-cream text-forest">
                  {loading ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Icon size={14} aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">
                      {demo.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-forest">
                      {meta?.label ?? demo.project_role}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">
                    {meta?.blurb ?? demo.email}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted">
        First click on a fresh database loads the demo dataset (can take a
        minute). Password for manual sign-in:{' '}
        <span className="text-ink">Handover!2026</span>
      </p>
    </section>
  )
}
