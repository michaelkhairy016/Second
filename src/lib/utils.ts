import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { serverNowMs } from "@/lib/time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(enteredAt: string): string {
  const entered = new Date(enteredAt);
  const diffMs = serverNowMs() - entered.getTime();
  if (diffMs < 0) return "0m";

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMinutes = totalMinutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  return `${totalMinutes}m`;
}
