// A labelled input with its error message tied to it for screen readers. The error shows under the field, never in a pop-up.
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { useI18n } from '@/lib/i18n';
import styles from './Field.module.css';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /** Extra content under the input (for example the password rules). */
  children?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Field({ label, error, hint, children, className, ref, ...input }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`${styles.group} ${className ?? ''}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input {...input} ref={ref} id={id} className={`${styles.input} ${error ? styles.invalid : ''}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <p id={errorId} className={`${styles.error} ${error ? '' : styles.errorEmpty}`} role="alert">
        {error}
      </p>
      {children}
    </div>
  );
}

/** A password field with a show/hide button. `mode` sets what the browser's password manager is told. */
export function PasswordField({ mode = 'current', ...props }: Omit<FieldProps, 'type'> & { mode?: 'current' | 'new' }) {
  const [shown, setShown] = useState(false);
  const { t } = useI18n();
  return (
    <div className={styles.passwordWrap}>
      <Field {...props} type={shown ? 'text' : 'password'} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} autoCapitalize="none" spellCheck={false} />
      <button type="button" className={styles.toggle} onClick={() => setShown((value) => !value)} aria-label={shown ? t('common.hidePassword') : t('common.showPassword')} aria-pressed={shown}>
        <Icon name={shown ? 'eyeOff' : 'eye'} size={20} />
      </button>
    </div>
  );
}

interface BoxProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

/** The same label and error pattern for a drop-down list. */
export function SelectField({ label, error, hint, children, ref, ...select }: BoxProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { ref?: Ref<HTMLSelectElement> }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={styles.group}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select {...select} ref={ref} id={id} className={`${styles.input} ${error ? styles.invalid : ''}`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
        {children}
      </select>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      <p id={errorId} className={`${styles.error} ${error ? '' : styles.errorEmpty}`} role="alert">
        {error}
      </p>
    </div>
  );
}

/** The same label and error pattern for a longer text. */
export function TextAreaField({ label, error, hint, ref, ...area }: BoxProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { ref?: Ref<HTMLTextAreaElement> }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className={styles.group}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <textarea {...area} ref={ref} id={id} className={`${styles.input} ${styles.textarea} ${error ? styles.invalid : ''}`} aria-invalid={error ? true : undefined} aria-describedby={[error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined} />
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <p id={errorId} className={`${styles.error} ${error ? '' : styles.errorEmpty}`} role="alert">
        {error}
      </p>
    </div>
  );
}
