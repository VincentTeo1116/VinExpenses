// AU-11: turn the authenticator on. Scan the QR code (or type the key), confirm with a 6-digit code, then save 8 one-time recovery codes.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/app/AuthProvider';
import { gate } from '@/features/auth/gate';
import { digitsOnly } from '@/features/auth/rules';
import { mfaCodeSchema } from '@/features/auth/schemas';
import styles from './MfaSetupSheet.module.css';

interface Props {
  open: boolean;
  /** `setup` turns the authenticator on; `codes` only makes new recovery codes for someone who already has it on. */
  mode?: 'setup' | 'codes';
  /** `enabled` is true when the authenticator was really turned on (or the codes were made). */
  onClose: (enabled: boolean) => void;
}

type Stage = 'preparing' | 'scan' | 'codes';

/** Only an SVG picture is shown: an image cannot run anything. Anything else is dropped. */
const safeQr = (value: unknown): string => (typeof value === 'string' && /^data:image\/svg\+xml/i.test(value) ? value : '');

/** The body is only mounted while the sheet is open, so every opening starts from a clean state. */
export function MfaSetupSheet(props: Props) {
  return props.open ? <MfaSetupBody {...props} /> : null;
}

function MfaSetupBody({ open, mode = 'setup', onClose }: Props) {
  const { t } = useI18n();
  const { client, refresh, session } = useAuth();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>('preparing');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [codesProblem, setCodesProblem] = useState(false);
  const [saved, setSaved] = useState(false);
  const factorId = useRef('');
  const enabled = useRef(false);
  type Values = z.infer<ReturnType<typeof mfaCodeSchema>>;
  const { control, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(mfaCodeSchema(t)), mode: 'onTouched', defaultValues: { code: '' } });

  const prepare = useCallback(async () => {
    if (!client) return;
    try {
      // An unfinished setup from an earlier try is cleared first, so half-made factors never pile up
      const listed = await client.auth.mfa.listFactors();
      for (const factor of listed.data?.all ?? []) if (factor.status === 'unverified') await client.auth.mfa.unenroll({ factorId: factor.id });
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'VinExpenses', issuer: 'VinExpenses' });
      if (error || !data) throw error ?? new Error('enroll failed');
      factorId.current = data.id;
      setQr(safeQr(data.totp.qr_code));
      setSecret(String(data.totp.secret ?? '').replace(/(.{4})/g, '$1 ').trim());
      setStage('scan');
    } catch (error) {
      const text = String((error as { message?: string } | null)?.message ?? '');
      setProblem(/enroll|disabled|not enabled/i.test(text) ? t('mfaSetup.notEnabled') : t('mfaSetup.startFailed'));
      setStage('scan');
    }
  }, [client, t]);

  const makeCodes = useCallback(async () => {
    const current = await client?.auth.getSession();
    const reply = await gate('recovery_codes', {}, current?.data.session?.access_token ?? session?.access_token);
    if (reply.ok && reply.codes?.length) setCodes(reply.codes);
    else setCodesProblem(true);
    setStage('codes');
  }, [client, session]);

  useEffect(() => {
    enabled.current = mode === 'codes';
    // Loading from the server once, when the sheet opens (the answer arrives after an await, never during the render)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode === 'codes') void makeCodes();
    else void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(async ({ code }) => {
      if (!client || !factorId.current) return;
      setProblem('');
      setBusy(true);
      try {
        const challenge = await client.auth.mfa.challenge({ factorId: factorId.current });
        if (challenge.error || !challenge.data) return setProblem(t('mfaSetup.challengeFailed'));
        const verified = await client.auth.mfa.verify({ factorId: factorId.current, challengeId: challenge.data.id, code });
        if (verified.error) return setError('code', { message: t('mfa.wrongCode') });
        enabled.current = true;
        await refresh();
        await makeCodes();
      } catch {
        setProblem(t('mfaSetup.startFailed'));
      } finally {
        setBusy(false);
      }
    })(event);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.show('success', t('mfaSetup.copied'));
    } catch {
      toast.show('info', t('mfaSetup.copyFailed'));
    }
  };

  const close = () => {
    // Leaving before the code is confirmed drops the half-made factor
    if (!enabled.current && client && factorId.current) void client.auth.mfa.unenroll({ factorId: factorId.current }).catch(() => undefined);
    onClose(enabled.current);
  };

  const mustSave = stage === 'codes' && !codesProblem && codes.length > 0 && !saved;
  return (
    <Sheet open={open} onClose={close} title={stage === 'codes' ? t('mfaSetup.codesTitle') : t('mfaSetup.title')} dismissible={!mustSave}>
      {stage === 'codes' ? (
        <div className={styles.stack}>
          <Notice kind="good">{t('mfaSetup.on')}</Notice>
          {codesProblem ? (
            <Notice kind="warn">{t('mfaSetup.codesFailed')}</Notice>
          ) : (
            <>
              <p className={styles.lead}>{t('mfaSetup.codesBody')}</p>
              <ul className={styles.codes} aria-label={t('mfaSetup.codesTitle')}>
                {codes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <Button variant="outline" block onClick={() => void copy()}>
                {t('mfaSetup.copy')}
              </Button>
              <label className={styles.check}>
                <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
                <span>{t('mfaSetup.saved')}</span>
              </label>
            </>
          )}
          <Button block disabled={mustSave} onClick={close}>
            {t('mfaSetup.done')}
          </Button>
        </div>
      ) : (
        <form onSubmit={confirm} noValidate className={styles.stack}>
          <p className={styles.lead}>{t('mfaSetup.scan')}</p>
          <div className={styles.qr} aria-live="polite">
            {stage === 'preparing' ? <span>{t('mfaSetup.preparing')}</span> : qr ? <img src={qr} alt={t('mfaSetup.qrAlt')} width={196} height={196} /> : problem ? null : <span>{t('mfaSetup.qrFailed')}</span>}
          </div>
          {secret ? (
            <p className={styles.key}>
              {t('mfaSetup.orType')} <code>{secret}</code>
            </p>
          ) : null}
          <Controller
            name="code"
            control={control}
            render={({ field }) => (
              <Field
                label={t('mfaSetup.enter')}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                data-autofocus
                error={formState.errors.code?.message}
                value={field.value}
                onChange={(event) => field.onChange(digitsOnly(event.target.value))}
                onBlur={field.onBlur}
                ref={field.ref}
              />
            )}
          />
          {problem ? <Notice kind="bad">{problem}</Notice> : null}
          <Button type="submit" block loading={busy} disabled={stage === 'preparing' || !secret}>
            {busy ? t('mfaSetup.checking') : t('mfaSetup.confirm')}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
