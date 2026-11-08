import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ApiError, demoApi } from '@/lib/api'
import { useSession } from '@/providers/AppProviders'
import { Button, Card, Field, Input } from '@/components/app/ui'
import { AuthPanel } from './LoginPage'
import '@/styles/app.css'

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.'),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(10, 'Password must be at least 10 characters.'),
  workspace_name: z.string().trim().optional(),
})

type SignupValues = z.infer<typeof signupSchema>

export function SignupPage() {
  const navigate = useNavigate()
  const { signup, enableCheck, status } = useSession()
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    enableCheck()
  }, [enableCheck])

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '', workspace_name: '' },
  })

  const demoStatusQuery = useQuery({
    queryKey: ['demoStatus'],
    queryFn: () => demoApi.status(),
    retry: false,
    staleTime: 30_000,
  })
  const demoLogins = demoStatusQuery.data?.seeded ? demoStatusQuery.data.logins : []

  const onSubmit = async (values: SignupValues) => {
    setFormError(null)
    try {
      await signup({
        email: values.email,
        name: values.name,
        password: values.password,
        workspace_name: values.workspace_name?.trim() || null,
      })
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
          <p className="label-mono text-forest">Create account</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-ink">
            Start your workspace.
          </h1>
          <p className="mt-2 text-sm text-muted">
            One account, one workspace — invite your team when you&apos;re ready.
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
            <Field label="Your name" htmlFor="signup-name" error={errors.name?.message}>
              <Input
                id="signup-name"
                autoComplete="name"
                placeholder="Ada Lovelace"
                invalid={!!errors.name}
                {...register('name')}
              />
            </Field>
            <Field label="Email" htmlFor="signup-email" error={errors.email?.message}>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                invalid={!!errors.email}
                {...register('email')}
              />
            </Field>
            <Field
              label="Password"
              htmlFor="signup-password"
              error={errors.password?.message}
              hint="At least 10 characters."
            >
              <Input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                placeholder="Choose a password"
                invalid={!!errors.password}
                {...register('password')}
              />
            </Field>
            <Field
              label="Workspace name"
              htmlFor="signup-workspace"
              error={errors.workspace_name?.message}
              hint="Optional — defaults to your first name's workspace."
            >
              <Input
                id="signup-workspace"
                placeholder="Acme Platform"
                invalid={!!errors.workspace_name}
                {...register('workspace_name')}
              />
            </Field>
            <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
              Create account
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
              to="/login"
              className="text-ink underline-offset-4 transition-colors duration-150 hover:text-forest hover:underline"
            >
              I already have an account
            </Link>
          </div>

          {demoLogins.length ? (
            <Card className="mt-6 p-4">
              <p className="label-mono text-muted">Demo accounts (loaded)</p>
              <ul className="mt-3 flex flex-col gap-3">
                {demoLogins.map((demo) => (
                  <li key={demo.email} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{demo.email}</p>
                      <p className="truncate font-mono text-xs text-muted">
                        {demo.password} · {demo.project_role}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setValue('email', demo.email, { shouldValidate: true })
                        setValue('password', demo.password, { shouldValidate: true })
                        toast.success('Demo credentials filled in.')
                      }}
                    >
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
