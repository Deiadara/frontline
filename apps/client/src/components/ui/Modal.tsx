import { useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Accessible dialog label. */
  labelledBy?: string;
  className?: string;
}

/** Fixed full-screen backdrop with a centered panel; closes on Escape / backdrop click. */
export function Modal({ onClose, children, labelledBy, className }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          'flex max-h-[calc(100vh-2rem)] w-full max-w-lg min-h-0 flex-col border bg-night-raised',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
