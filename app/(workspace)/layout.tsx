import { Toaster } from '@/components/ui/toaster';
import { I18nProvider } from '@/lib/ui/i18n-provider';
import { Shell } from '@/components/ui/shell';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLang="id">
      <Shell engineOnline>{children}</Shell>
      <Toaster />
    </I18nProvider>
  );
}
