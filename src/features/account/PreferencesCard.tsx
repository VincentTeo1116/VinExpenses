// AC-06: the date format, and renaming, hiding or adding categories and payment methods.
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { SelectField } from '@/components/Field';
import { useI18n } from '@/lib/i18n';
import { DATE_FORMATS, formatDate, type DateFormat } from '@/lib/dates';
import { useMoney } from '@/features/money/MoneyContext';
import { newKey, type TaxonomyItem } from '@/features/money/taxonomy';
import styles from './PreferencesCard.module.css';

type Kind = 'category' | 'payment';

/** `before` goes above the date format (the language), `children` under it (the colour theme). */
export function PreferencesCard({ before, children }: { before?: ReactNode; children?: ReactNode } = {}) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, actions } = useMoney();
  const [open, setOpen] = useState<Kind | null>(null);
  const [problem, setProblem] = useState('');
  const select = useId();

  const changeFormat = async (value: string) => {
    if (!(DATE_FORMATS as readonly string[]).includes(value)) return;
    setProblem('');
    try {
      await actions.saveDateFormat(value as DateFormat);
      toast.show('success', t('acct.saved'));
    } catch {
      setProblem(t('add.failed'));
    }
  };

  return (
    <section className={styles.card} aria-labelledby={`${select}-h`}>
      <div>
        <h2 id={`${select}-h`} className={styles.h2}>
          {t('acct.display')}
        </h2>
        <p className={styles.sub}>{t('acct.displaySub')}</p>
      </div>
      {before}
      <SelectField label={t('acct.dateFormat')} value={data.dateFormat} onChange={(event) => void changeFormat(event.target.value)}>
        {DATE_FORMATS.map((format) => (
          <option key={format} value={format}>
            {formatDate('2026-10-19', format)}
          </option>
        ))}
      </SelectField>
      {problem ? <Notice kind="bad">{problem}</Notice> : null}
      {children}
      <p className={styles.sub}>{t('acct.manage')}</p>
      <div className={styles.buttons}>
        <Button variant="outline" onClick={() => setOpen('category')}>
          {t('acct.categories')}
        </Button>
        <Button variant="outline" onClick={() => setOpen('payment')}>
          {t('acct.payments')}
        </Button>
      </div>
      {open ? <TaxonomySheet kind={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function TaxonomySheet({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { categories, payments, actions } = useMoney();
  const items = kind === 'category' ? categories : payments;
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeCount = items.filter((item) => item.active).length;

  const rowFor = (item: TaxonomyItem, changes: Partial<{ label: string; active: boolean }>) => {
    const index = items.findIndex((entry) => entry.key === item.key);
    const base = { label: changes.label ?? item.label, color: item.color, active: changes.active ?? item.active, is_builtin: item.builtin, sort_order: index, icon: kind === 'category' ? 'fa-tag' : 'fa-wallet' };
    return kind === 'category' ? { category_key: item.key, ...base } : { payment_key: item.key, ...base };
  };

  const run = async (work: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await work();
      toast.show('success', t('acct.saved'));
    } catch (failure) {
      setError(failure instanceof Error && failure.message === 'duplicate' ? t('acct.duplicate') : t('add.failed'));
    } finally {
      setBusy(false);
    }
  };

  const rename = (item: TaxonomyItem, label: string) => {
    const clean = label.trim();
    if (!clean || clean === item.label) return;
    if (clean.length > 32) return setError(t('v.labelLong'));
    void run(() => actions.saveTaxonomy(kind, rowFor(item, { label: clean })));
  };

  const toggle = (item: TaxonomyItem) => {
    if (item.active && activeCount <= 1) return setError(t('acct.onlyOne'));
    void run(() => actions.saveTaxonomy(kind, rowFor(item, { active: !item.active })));
  };

  const add = () => {
    const label = newName.trim();
    if (!label) return setError(t('v.nameRequiredShort'));
    if (label.length > 32) return setError(t('v.labelLong'));
    if (items.some((item) => item.label.toLowerCase() === label.toLowerCase())) return setError(t('acct.duplicate'));
    const key = newKey(label, items.map((item) => item.key));
    const base = { label, color: '#4f46e5', active: true, is_builtin: false, sort_order: items.length, icon: kind === 'category' ? 'fa-tag' : 'fa-wallet' };
    void run(async () => {
      await actions.saveTaxonomy(kind, kind === 'category' ? { category_key: key, ...base } : { payment_key: key, ...base });
      setNewName('');
    });
  };

  return (
    <Sheet open onClose={onClose} title={kind === 'category' ? t('acct.categories') : t('acct.payments')} size="wide">
      <div className={styles.sheet}>
        <p className={styles.muted}>{t('acct.hiddenNote')}</p>
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.key} className={`${styles.item} ${item.active ? '' : styles.off}`} data-key={item.key}>
              <span className={styles.glyph} aria-hidden="true">
                {item.glyph}
              </span>
              <RenameInput item={item} onCommit={(label) => rename(item, label)} disabled={busy} />
              <Button variant="outline" disabled={busy} onClick={() => toggle(item)}>
                {item.active ? t('acct.hide') : t('acct.show')}
                <span className="sr-only"> {item.label}</span>
              </Button>
            </li>
          ))}
        </ul>
        <form
          className={styles.add}
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
          noValidate
        >
          <label className={styles.addLabel}>
            <span>{t('acct.addNew')}</span>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} autoComplete="off" />
          </label>
          <Button type="submit" disabled={busy}>
            {t('acct.addBtn')}
          </Button>
        </form>
        {error ? <Notice kind="bad">{error}</Notice> : null}
        <Button variant="outline" block onClick={onClose}>
          {t('acct.done')}
        </Button>
      </div>
    </Sheet>
  );
}

/** The name is saved when the person leaves the box (or presses Enter), not on every key. */
function RenameInput({ item, onCommit, disabled }: { item: TaxonomyItem; onCommit: (label: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState(item.label);
  const [seen, setSeen] = useState(item.label);
  if (seen !== item.label) {
    setSeen(item.label);
    setText(item.label);
  }
  return (
    <input
      className={styles.name}
      value={text}
      disabled={disabled}
      aria-label={`${t('acct.rename')}: ${item.label}`}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(text);
        }
      }}
    />
  );
}
