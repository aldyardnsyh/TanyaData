'use client';

import { ShareOutputView } from './adaptive-output';
import { MonoMeta } from '@/components/ui/mono-meta';
import type { ShareCitation, ShareMessage } from '@/lib/ui/share-contract';

/**
 * Section 4 hasil visual. Sembilan tipe dirender komponen yang sama dengan
 * workspace, tanpa aksi mutasi. Satu tipe utama + maksimal satu pendamping
 * sudah dijamin upstream (P-4). Tanpa kartu kosong bila tidak ada output.
 */
export function ShareResults({
  messages,
  citations,
  includeCitations,
}: {
  messages: ShareMessage[];
  citations: ShareCitation[];
  includeCitations: boolean;
}) {
  const blocks = messages
    .map((message, index) => ({
      message,
      question: messages.slice(0, index).reverse().find((item) => item.role === 'user')?.question ?? null,
    }))
    .filter((block) => block.message.role === 'assistant' && block.message.outputs.length > 0);

  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {blocks.map(({ message, question }) => (
        <div key={message.id} className="flex min-w-0 flex-col gap-3">
          {question && <MonoMeta className="block">HASIL · {question}</MonoMeta>}
          {message.outputs.map((output, index) => (
            <div key={`${message.id}-result-${index}`} className="animate-share-stagger" style={{ animationDelay: `${Math.min(index, 7) * 30}ms` }}>
              <ShareOutputView output={output} citations={citations} includeCitations={includeCitations} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
