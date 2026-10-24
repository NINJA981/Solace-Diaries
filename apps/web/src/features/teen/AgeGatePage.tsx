import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { RequireAuth } from '@/app/guards';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/fields';
import { AuthLayout, FormError } from '@/features/auth/AuthLayout';
import { api } from '@/lib/api';
import { errorMessage, isApiError } from '@/lib/errors';
import { ME_QUERY_KEY, useProfile, useSession } from '@/lib/session';
import { MONTHS, birthYearOptions, gateTarget, parseBirth } from './age';

const MONTH_OPTIONS = [
  { value: '', label: 'Choose a month' },
  ...MONTHS.map((label, i) => ({ value: String(i + 1), label })),
];

function AgeGate() {
  const { profile } = useProfile();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);

  if (profile?.ageConfirmed) return <Navigate to={gateTarget(profile) ?? '/app/today'} replace />;

  const birth = parseBirth(year, month);
  const yearOptions = [
    { value: '', label: 'Choose a year' },
    ...birthYearOptions().map((y) => ({ value: String(y), label: String(y) })),
  ];

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!birth) {
      setError('Choose both a month and a year.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await api.confirmAge({ body: birth });
      queryClient.setQueryData(ME_QUERY_KEY, next);
      navigate(gateTarget(next) ?? '/app/today', { replace: true });
    } catch (err) {
      if (isApiError(err, 'age_restricted')) {
        // The server has already deleted the account. The public page explains and then clears
        // this browser (signing out here would bounce through /login first).
        navigate('/age-restricted', { replace: true, state: { clearSession: true } });
        return;
      }
      if (isApiError(err, 'teen_signup_unavailable')) setUnavailable(true);
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <AuthLayout
      title="Before you start"
      intro="Solace has a few extra protections for people under 18, so we need to know roughly how old you are. We only ask for the month and year you were born."
    >
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5" noValidate>
        <FormError>{error}</FormError>
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-medium text-fg">When were you born?</legend>
          <Select label="Month" options={MONTH_OPTIONS} value={month} onChange={(e) => setMonth(e.target.value)} autoComplete="bday-month" />
          <Select label="Year" options={yearOptions} value={year} onChange={(e) => setYear(e.target.value)} autoComplete="bday-year" />
        </fieldset>
        <p className="text-sm leading-relaxed text-fg-muted">
          We use this once to work out an age range, then forget it. We never keep your birth date, and you can’t
          change the range later.
        </p>
        <div>
          <Button type="submit" className="h-11 px-6 text-base" loading={saving}>
            Continue
          </Button>
        </div>
        {unavailable && (
          <div>
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}

export default function AgeGatePage() {
  return (
    <RequireAuth requireOnboarded={false} enforceGates={false}>
      <AgeGate />
    </RequireAuth>
  );
}
