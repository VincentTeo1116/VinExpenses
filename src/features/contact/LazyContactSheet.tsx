// The contact form pulls in the form library, so its code is only downloaded the first time someone opens it.
import { lazy, Suspense, useState, type ComponentProps } from 'react';
import type { ContactSheet as Real } from './ContactSheet';

const Loaded = lazy(() => import('./ContactSheet').then((module) => ({ default: module.ContactSheet })));

export function ContactSheet(props: ComponentProps<typeof Real>) {
  const [seen, setSeen] = useState(false);
  if (props.open && !seen) setSeen(true); // once opened it stays mounted, so closing still returns focus properly
  if (!seen) return null;
  return (
    <Suspense fallback={null}>
      <Loaded {...props} />
    </Suspense>
  );
}
