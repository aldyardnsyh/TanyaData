import type { Metadata } from 'next';
import './globals.css';
import { inter, jakarta } from '@/lib/fonts';
import { MotionVisibility } from '@/lib/ui/motion-visibility';
import { TooltipProvider } from '@/components/ui/icon-tooltip';

export const metadata: Metadata = {
  title: {
    default: 'TanyaData',
    template: '%s · TanyaData',
  },
  description: 'Ask the data. Find the insight.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body>
        <MotionVisibility />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
