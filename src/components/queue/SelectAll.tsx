"use client";

/** Header checkbox that toggles every row checkbox in the same table. */
export function SelectAll({ label }: { label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 accent-kc-primary"
      onChange={(e) => {
        const table = e.currentTarget.closest("table");
        table?.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]').forEach((cb) => {
          cb.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
