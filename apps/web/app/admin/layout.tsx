import type { ReactNode } from 'react';

import '../observer-admin-refactor.css';

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
