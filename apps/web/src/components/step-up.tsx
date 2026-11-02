import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { Alert, Button, Field, Input } from './ui/primitives';
import { Dialog } from './ui/dialog';

type Runner = <T>(action: () => Promise<T>) => Promise<T>;
const StepUpContext = createContext<Runner | null>(null);

/**
 * Sensitive actions (role changes, member removal, ...) need a recent password confirmation.
 * `useStepUp()(action)` runs the action; if the API answers STEP_UP_REQUIRED it asks for the password
 * once and retries. The API enforces the rule — this only provides the interaction.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const waiter = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiter.current = { resolve, reject };
        setPassword('');
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const run: Runner = useCallback(
    async (action) => {
      try {
        return await action();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
          await ask();
          return action();
        }
        throw err;
      }
    },
    [ask],
  );

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/step-up', { method: 'POST', body: { password }, noOrg: true });
      setOpen(false);
      waiter.current?.resolve();
    } catch (err) {
      setError(errorMessage(err instanceof ApiError ? err.code : undefined));
    } finally {
      setPending(false);
    }
  }

  function close(next: boolean) {
    if (!next) {
      setOpen(false);
      waiter.current?.reject(new Error('Confirmation cancelled'));
    }
  }

  const value = useMemo(() => run, [run]);
  return (
    <StepUpContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={close} title="Confirm your password" description="This action is sensitive. Confirm it is you to continue.">
        <form onSubmit={confirm} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Password" htmlFor="stepup-password">
            <Input id="stepup-password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!password}>
              Confirm
            </Button>
          </div>
        </form>
      </Dialog>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): Runner {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp must be used inside StepUpProvider');
  return ctx;
}
