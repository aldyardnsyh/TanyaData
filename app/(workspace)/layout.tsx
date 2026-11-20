import { Toaster } from '@/components/ui/toaster';
import { I18nProvider } from '@/lib/ui/i18n-provider';
import { WorkspaceShell } from '@/components/layout/workspace-shell';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLang="en">
      <WorkspaceShell>{children}</WorkspaceShell>
      <Toaster />
    </I18nProvider>
  );
}
