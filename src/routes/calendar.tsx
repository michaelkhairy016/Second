import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

interface CalendarDay {
  date: string;
  is_working_day: boolean;
  working_hours: number;
  notes: string | null;
}

function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarData, setCalendarData] = useState<Record<string, CalendarDay>>({});
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState("");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const fetchCalendarData = async (start: Date, end: Date) => {
    const { data, error } = await supabase
      .from("factory_calendar")
      .select("id,date,working_hours,is_working_day,notes")
      .gte("date", start.toISOString().split("T")[0])
      .lte("date", end.toISOString().split("T")[0]);

    if (data && !error) {
      const mapped: Record<string, CalendarDay> = {};
      data.forEach((d) => {
        mapped[d.date] = d;
      });
      setCalendarData(mapped);
    }
    setLoading(false);
  };

  useEffect(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    fetchCalendarData(firstDay, lastDay);
  }, [year, month]);

  const getDaysInMonth = () => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = () => new Date(year, month, 1).getDay();

  const toggleDay = async (dateStr: string) => {
    const dayData = calendarData[dateStr];
    const currentHours = dayData?.working_hours ?? 0;
    const isWorking = dayData?.is_working_day ?? false;

    // Cycle: off → 8h → 10h → off
    let newHours: number;
    let newWorking: boolean;
    if (!isWorking || currentHours === 0) {
      newHours = 8; newWorking = true;
    } else if (currentHours <= 8) {
      newHours = 10; newWorking = true;
    } else {
      newHours = 0; newWorking = false;
    }

    const { error } = await supabase
      .from("factory_calendar")
      .update({ is_working_day: newWorking, working_hours: newHours })
      .eq("date", dateStr);

    if (!error) {
      setCalendarData((prev) => ({
        ...prev,
        [dateStr]: { ...prev[dateStr], is_working_day: newWorking, working_hours: newHours },
      }));
    }
  };

  const saveNotes = async (dateStr: string) => {
    const { error } = await supabase
      .from("factory_calendar")
      .update({ notes: noteValue || null })
      .eq("date", dateStr);

    if (!error) {
      setCalendarData((prev) => ({
        ...prev,
        [dateStr]: { ...prev[dateStr], notes: noteValue || null },
      }));
      setEditingNotes(null);
      setNoteValue("");
    }
  };

  const resetMonthToDefault = async () => {
    const daysInMonth = getDaysInMonth();
    const updates = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = date.toISOString().split("T")[0];
      const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
      const isWorking = dayOfWeek >= 0 && dayOfWeek <= 4; // Sun-Thu

      updates.push(
        supabase
          .from("factory_calendar")
          .update({ is_working_day: isWorking, working_hours: isWorking ? 8 : 0 })
          .eq("date", dateStr)
      );
    }

    await Promise.all(updates);
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    fetchCalendarData(firstDay, lastDay);
  };

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const daysInMonth = getDaysInMonth();
  const firstDay = getFirstDayOfMonth();
  const blanks = Array(firstDay).fill(null);

  const renderDay = (day: number) => {
    const date = new Date(year, month, day);
    const dateStr = date.toISOString().split("T")[0];
    const dayData = calendarData[dateStr];
    const isWorking = dayData?.is_working_day ?? true;
    const hours = dayData?.working_hours ?? 8;
    const notes = dayData?.notes;
    const isOvertime = isWorking && hours >= 10;

    return (
      <div
        key={day}
        onClick={() => toggleDay(dateStr)}
        className={`
          aspect-square p-1 rounded cursor-pointer transition-all hover:opacity-80
          ${isOvertime ? "bg-amber-500/20 border border-amber-500/30" : isWorking ? "bg-green-500/20 border border-green-500/30" : "bg-gray-700/40 border border-gray-600/30"}
        `}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{day}</span>
            {isWorking && <span className="text-[9px] font-mono text-muted-foreground">{hours}h</span>}
          </div>
          {editingNotes === dateStr ? (
            <div
              className="mt-1 flex-1"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                autoFocus
                defaultValue={notes || ""}
                onChange={(e) => setNoteValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveNotes(dateStr);
                  if (e.key === "Escape") {
                    setEditingNotes(null);
                    setNoteValue("");
                  }
                }}
                onBlur={() => saveNotes(dateStr)}
                className="w-full text-[10px] bg-black/30 rounded px-1 py-0.5 border border-white/10 focus:outline-none focus:border-white/30"
                placeholder="Add note..."
              />
            </div>
          ) : (
            notes && (
              <p
                className="text-[9px] text-muted-foreground truncate mt-0.5 line-clamp-3"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingNotes(dateStr);
                  setNoteValue(notes);
                }}
              >
                {notes}
              </p>
            )
          )}
          {!notes && !editingNotes && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingNotes(dateStr);
                setNoteValue("");
              }}
              className="mt-auto text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
            >
              +
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-xl">Factory Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={calendarData[new Date().toISOString().split("T")[0]]?.is_working_day ? "default" : "secondary"} className="bg-green-500/20 text-green-400 border-green-500/30">
              Today: {calendarData[new Date().toISOString().split("T")[0]]?.is_working_day ? "Working" : "Off"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date(year, month - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-semibold">
                {monthNames[month]} {year}
              </h2>
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date(year, month + 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={resetMonthToDefault}
              className="w-full"
            >
              <RotateCcw className="h-3 w-3 mr-2" />
              Reset to default (Sun–Thu, 8h)
            </Button>

            <div className="text-center text-xs text-muted-foreground">
              Click a day to cycle: off → 8h → 10h → off • Click + to add notes
            </div>

            {loading ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {dayNames.map((name) => (
                  <div key={name} className="text-center text-xs font-medium text-muted-foreground py-1">
                    {name}
                  </div>
                ))}
                {blanks.map((_, i) => (
                  <div key={`blank-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => renderDay(i + 1))}
              </div>
            )}

            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/30" />
                <span>8h</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-amber-500/20 border border-amber-500/30" />
                <span>10h OT</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-gray-700/40 border border-gray-600/30" />
                <span>Off</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/calendar")({
  head: () => ({ meta: [{ title: "Calendar — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><CalendarPage /></AppShell></RequireAuth>,
});
