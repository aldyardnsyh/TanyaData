import { Toaster } from '@/components/ui/toaster';
import { I18nProvider } from '@/lib/ui/i18n-provider';
import { AppShell } from '@/components/shell/app-shell';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLang="en">
      <AppShell>{children}</AppShell>
      <Toaster />
    </I18nProvider>
  );
}
