import { LogOut } from 'lucide-react';

interface EvanSessionExitProps {
    onExit?: () => void;
    disabled?: boolean;
    placement: 'picture-in-picture' | 'planner';
}

export default function EvanSessionExit({ onExit, disabled = false, placement }: EvanSessionExitProps) {
    if (!onExit) return null;

    return (
        <button
            type="button"
            onClick={onExit}
            disabled={disabled}
            aria-label="Exit session with Evan"
            data-testid={placement === 'picture-in-picture' ? 'evan-pip-exit' : 'evan-planner-mobile-exit'}
            className={`relative z-20 min-h-12 flex-none items-center justify-center gap-2 rounded-xl border border-[#ffc857]/35 bg-[#5d24d6] px-6 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-[0_12px_35px_rgba(0,0,0,.3)] transition-colors hover:bg-[#6f34e8] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffc857] disabled:cursor-wait disabled:opacity-60 ${placement === 'picture-in-picture' ? 'hidden lg:inline-flex' : 'inline-flex w-full lg:hidden'}`}
        >
            <LogOut size={18} aria-hidden="true" />
            {disabled ? 'Ending session…' : 'Exit'}
        </button>
    );
}
