import { LoginRequestSchema, RegisterRequestSchema, type AuthResponse } from '@frontline/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, login, register } from '../lib/api';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { useSession } from '../store/session';

type Mode = 'login' | 'register';

interface FieldErrors {
  username?: string | undefined;
  password?: string | undefined;
}

export function AuthScreen() {
  const setSession = useSession((s) => s.login);
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation<AuthResponse, Error, void>({
    mutationFn: () =>
      mode === 'login' ? login({ username, password }) : register({ username, password }),
    onSuccess: (data) => setSession(data.token, data.user),
  });

  const switchMode = (next: Mode) => {
    setMode(next);
    setFieldErrors({});
    mutation.reset();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const schema = mode === 'register' ? RegisterRequestSchema : LoginRequestSchema;
    const parsed = schema.safeParse({ username, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ username: flat.username?.[0], password: flat.password?.[0] });
      return;
    }
    setFieldErrors({});
    mutation.mutate();
  };

  const serverError = mutation.error instanceof ApiRequestError ? mutation.error.message : null;

  return (
    <main className="scanlines relative flex h-screen flex-col items-center justify-center overflow-hidden bg-night px-4">
      <div className="grain pointer-events-none absolute inset-0" />
      <div className="relative flex w-full max-w-sm flex-col">
        <div className="mb-6 text-center">
          <p className="font-display text-[10px] tracking-[0.5em] text-neon-cyan/70">
            // ACCESS TERMINAL //
          </p>
          <h1 className="text-glow-cyan mt-2 font-display text-4xl font-black tracking-[0.2em] text-steel-100">
            FRONTLINE
          </h1>
        </div>

        <div className="border border-neon-cyan/25 bg-night-raised shadow-neon-cyan">
          <div className="grid grid-cols-2">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  'border-b py-3 font-display text-xs font-semibold uppercase tracking-[0.25em] transition-colors',
                  mode === m
                    ? 'border-neon-cyan text-neon-cyan'
                    : 'border-steel-800 text-steel-500 hover:text-steel-300',
                )}
              >
                {m}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6" noValidate>
            <Field
              label="Operator ID"
              value={username}
              onChange={setUsername}
              autoComplete="username"
              error={fieldErrors.username}
            />
            <Field
              label="Passphrase"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              error={fieldErrors.password}
            />

            {serverError && (
              <p
                role="alert"
                className="border border-neon-magenta/40 bg-neon-magenta/10 px-3 py-2 font-body text-xs text-neon-magenta"
              >
                {serverError}
              </p>
            )}

            <Button type="submit" disabled={mutation.isPending} className="w-full justify-center">
              {mutation.isPending ? 'Linking…' : mode === 'login' ? 'Jack In' : 'Enlist'}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  error?: string | undefined;
}

function Field({ label, value, onChange, type = 'text', autoComplete, error }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-[10px] uppercase tracking-[0.25em] text-steel-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'border bg-night px-3 py-2 font-body text-sm text-steel-100 outline-none transition-colors',
          'placeholder:text-steel-600 focus:border-neon-cyan',
          error ? 'border-neon-magenta/60' : 'border-steel-700',
        )}
      />
      {error && <span className="font-body text-[11px] text-neon-magenta">{error}</span>}
    </label>
  );
}
