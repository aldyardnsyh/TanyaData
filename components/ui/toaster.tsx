'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Toast, type ToastStatus } from '@/components/ui/toast';

let seq = 0;
type Listener = (item: ToastItem) => void;
const listeners = new Set<Listener>();

export type ToastItem = {
  id: number;
  status: ToastStatus;
  message: string;
  action?: string;
  onAction?: () => void;
};

/** Panggil dari mana saja (di luar React tree) untuk menampilkan toast. Maks 3. */
export function toast(item: Omit<ToastItem, 'id'>) {
  const full: ToastItem = { ...item, id: ++seq };
  listeners.forEach((l) => l(full));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const add: Listener = (item) => {
      setItems((prev) => [...prev.slice(-2), item]);
      if (item.status !== 'error') {
        timers.set(
          item.id,
          setTimeout(() => {
            setItems((prev) => prev.filter((i) => i.id !== item.id));
            timers.delete(item.id);
          }, 5000),
        );
      }
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const close = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex flex-col items-end gap-2">
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <Toast
            status={item.status}
            message={item.message}
            action={item.action}
            onAction={item.onAction}
            onClose={() => close(item.id)}
            className="static shadow-lg"
          />
        </div>
      ))}
    </div>
  );
}

export { CheckCircle, AlertTriangle, Info, X };
