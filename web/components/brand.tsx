export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#123C32" />
      <path d="M8.5 12.2h15v9.2a1.2 1.2 0 0 1-1.2 1.2H9.7a1.2 1.2 0 0 1-1.2-1.2v-9.2Z" fill="none" stroke="#F7FAF8" strokeWidth="1.6" />
      <path d="M8.8 12.6 16 17.6l7.2-5" fill="none" stroke="#F7FAF8" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
