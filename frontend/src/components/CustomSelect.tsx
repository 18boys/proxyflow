import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string | number;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: string;
}

interface CustomSelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
  mono?: boolean;
  ariaLabel?: string;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  size = 'sm',
  mono = false,
  ariaLabel,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; openUp: boolean }>({
    top: 0,
    left: 0,
    width: 0,
    openUp: false,
  });

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = Math.min(options.length * 36 + 12, 260);
    const openUp = spaceBelow < estimatedHeight && rect.top > estimatedHeight;
    setCoords({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 140),
      openUp,
    });
  };

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    const handleScrollOrResize = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      updatePosition();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  const sizeClasses = {
    xs: 'px-2.5 py-1.5 text-xs rounded-lg',
    sm: 'px-3 py-2 text-sm rounded-lg',
    md: 'px-3.5 py-2.5 text-sm rounded-xl',
  }[size];

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 bg-slate-800 border border-slate-700 text-slate-100 text-left transition-all select-none focus:outline-none ${sizeClasses} ${
          open ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'hover:border-slate-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${mono ? 'font-mono' : ''}`}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1 truncate">
          {selectedOption ? (
            <>
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.badge && (
                <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded shrink-0 ${selectedOption.badgeColor || 'bg-slate-700 text-slate-300'}`}>
                  {selectedOption.badge}
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-500 truncate">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          size={size === 'xs' ? 13 : 15}
          className={`text-slate-400 shrink-0 transition-transform duration-150 ${open ? 'rotate-180 text-cyan-400' : ''}`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: coords.openUp ? undefined : coords.top,
              bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              width: coords.width,
              zIndex: 9999,
            }}
            className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 max-h-64 overflow-y-auto divide-y divide-slate-800/40"
          >
            {options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500 italic">No options</div>
            ) : (
              options.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(String(opt.value));
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                      size === 'xs' ? 'text-xs' : 'text-sm'
                    } ${mono ? 'font-mono' : ''} ${
                      isSelected
                        ? 'bg-cyan-500/15 text-cyan-400 font-medium'
                        : 'text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="truncate">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="text-[11px] text-slate-500 font-mono shrink-0">{opt.sublabel}</span>
                      )}
                      {opt.badge && (
                        <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded shrink-0 ${opt.badgeColor || 'bg-slate-800 text-slate-400'}`}>
                          {opt.badge}
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={13} className="text-cyan-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

