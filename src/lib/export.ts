export function exportToCSV(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = "﻿" + [
    headers.join(","),
    ...rows.map(row =>
      headers.map(h => {
        let val = row[h];
        if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
          // Prefer the Postgres-produced *_cairo text sibling (server-formatted, PC-independent);
          // fall back to browser Cairo formatting only if no sibling is present.
          const cairo = row[`${h}_cairo`];
          val = typeof cairo === "string" && cairo
            ? cairo
            : new Date(val).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" });
        }
        const str = typeof val === "string" ? val : JSON.stringify(val ?? "");
        return `"${str.replace(/"/g, '""')}"`;
      }).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
