'use client';

import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent, type ReactNode, useState } from 'react';

import { motionTokens } from '@/lib/motion';

import { useUiPreferences } from './app-providers';
import { Icons } from './icons';

export function RouteTransitionLink({
  'aria-label': ariaLabel,
  children,
  className,
  href,
}: {
  'aria-label'?: string;
  children: ReactNode;
  className?: string;
  href: string;
}) {
  const router = useRouter();
  const { tier } = useUiPreferences();
  const [leaving, setLeaving] = useState(false);

  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => router.push(href), tier === 'low' ? 0 : 120);
  };

  return (
    <>
      <Link aria-label={ariaLabel} className={className} href={href} onClick={navigate}>
        {children}
      </Link>
      <AnimatePresence>
        {leaving ? (
          <m.div
            animate={{ opacity: 1 }}
            aria-hidden="true"
            className="route-transition-curtain"
            initial={{ opacity: 0 }}
            transition={motionTokens.standard}
          >
            <m.span
              animate={{ opacity: 1, scale: 1 }}
              initial={{ opacity: 0, scale: 0.94 }}
              transition={motionTokens.spring}
            >
              <Icons.moon size={34} />
            </m.span>
          </m.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
