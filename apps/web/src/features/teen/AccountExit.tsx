import { Download } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/fields';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/** Export and delete, for screens where the rest of the app is locked. */
export function AccountExit() {
  const { email, signOut } = useSession();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();

  const download = async () => {
    setPending(true);
    try {
      await api.exportMe({ query: { format: 'markdown' } });
    } catch (err) {
      toast(errorMessage(err), { tone: 'danger' });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon={<Download aria-hidden="true" className="size-4" />} loading={pending} onClick={() => void download()}>
          Download my journal
        </Button>
        <Button
          variant="ghost"
          className="text-danger"
          onClick={() => {
            setTyped('');
            setOpen(true);
          }}
        >
          Delete my account
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Delete your account and journal?"
        description="This erases everything you wrote, right away. It can’t be undone."
        confirmLabel="Delete everything"
        cancelLabel="Keep my account"
        confirmDisabled={!matches}
        onConfirm={async () => {
          if (!email) return;
          await api.deleteMe({ body: { confirmEmail: email } });
          navigate('/', { replace: true });
          await signOut({ scope: 'local', reason: 'deleted' }).catch(() => {});
        }}
      >
        <Input
          label={`Type ${email ?? 'your email'} to confirm`}
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
}
