import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ApiError } from '@/lib/api'
import { useSession } from '@/providers/AppProviders'
import { Button, Field, Input } from '@/components/app/ui'
import { DemoAccess } from '@/components/app/DemoAccess'
import '@/styles/app.css'

const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

type LoginValues = z.infer<typeof loginSchema>

export function AuthPanel() {
  const features: Array<[string, string]> = [
    ['01', 'Upload once — extract everything'],
    ['02', 'Every claim traces to a source'],
    ['03', 'Handover packets, not scribbles'],
  ]
  return (
    <aside className="pp-auth-panel">
      <div>
        <a href="/" className="inline-flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-[4px] bg-paper font-display text-sm text-forest"
          >
            P
          </span>
          <span className="font-display text-lg text-paper">ProjectPulse</span>
        </a>
        <p className="label-mono pp-auth-kicker mt-10">AI Handover Assistant</p>
        <h2 className="mt-3 max-w-md font-display text-[2.4rem] leading-[1.06] tracking-tight text-paper">
          Pick up where the last engineer left off.
        </h2>
      </div>

      <div className="flex flex-col gap-0">
        {features.map(([num, text]) => (
          <p key={num} className="pp-auth-feature label-mono">
            <span className="text-ember-soft">{num}</span>
            <span>{text}</span>
          </p>
        ))}
      </div>

      <a href="/" className="pp-auth-kicker text-sm underline-offset-4 hover:text-paper hover:underline">
        Back to the site
      </a>
    </aside>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const { login, enableCheck, status } = useSession()
  const [formError, setFormError] = useState<string | null>(null)

  // anonymous-only route: probe the session so we can bounce a signed-in user
  useEffect(() => {
    enableCheck()
  }, [enableCheck])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginValues) => {
    setFormError(null)
    try {
      await login(values.email, values.password)
      navigate('/app', { replace: true })
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.detail || err.error : 'Something went wrong. Please try again.',
      )
    }
  }

  if (status === 'authenticated') {
    return <Navigate to="/app" replace />
  }

  return (
    <div className="pp-auth">
      <AuthPanel />
      <div className="pp-auth-form">
        <div className="mx-auto w-full max-w-[420px]">
          <p className="label-mono text-forest">Sign in</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-ink">Welcome back.</h1>
          <p className="mt-2 text-sm text-muted">
            Your workspaces, projects and handovers are waiting.
          </p>

          {formError ? (
            <div
              role="alert"
              className="mt-5 rounded-[3px] border border-ember/40 bg-ember/8 px-3.5 py-3 text-sm text-ember"
            >
              {formError}
            </div>
          ) : null}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 flex flex-col gap-4">
            <Field label="Email" htmlFor="login-email" error={errors.email?.message}>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                invalid={!!errors.email}
                {...register('email')}
              />
            </Field>
            <Field label="Password" htmlFor="login-password" error={errors.password?.message}>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="Your password"
                invalid={!!errors.password}
                {...register('password')}
              />
            </Field>
            <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
              Sign in
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm">
            <a
              href="/"
              className="text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
            >
              Back to the site
            </a>
            <Link
              to="/signup"
              className="text-ink underline-offset-4 transition-colors duration-150 hover:text-forest hover:underline"
            >
              Create an account
            </Link>
          </div>

          <DemoAccess />
        </div>
      </div>
    </div>
  )
}
