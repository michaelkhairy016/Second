import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { Palette, Car, Plus, Pencil, Trash2, Loader2, ChevronDown, ChevronRight, FileText, CalendarDays, Rocket } from "lucide-react";
import { toast } from "sonner";
import type { StandardColor, Model, ModelTrim, ModelWithTrims, ProductionPlan } from "@/lib/db-types";
import { useProductionMode } from "@/hooks/use-production-mode";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { isSuperuser } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!isSuperuser) nav({ to: "/" }); }, [isSuperuser, nav]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Tabs defaultValue="colors">
        <TabsList>
          <TabsTrigger value="colors"><Palette className="h-4 w-4 mr-1.5" />Colors</TabsTrigger>
          <TabsTrigger value="models"><Car className="h-4 w-4 mr-1.5" />Models</TabsTrigger>
          <TabsTrigger value="reports"><FileText className="h-4 w-4 mr-1.5" />Reports</TabsTrigger>
          <TabsTrigger value="plan"><CalendarDays className="h-4 w-4 mr-1.5" />Prod. Plan</TabsTrigger>
          <TabsTrigger value="launchmode"><Rocket className="h-4 w-4 mr-1.5" />Launch Mode</TabsTrigger>
        </TabsList>
        <TabsContent value="colors" className="mt-4"><ColorsTab /></TabsContent>
        <TabsContent value="models" className="mt-4"><ModelsTab /></TabsContent>
        <TabsContent value="reports" className="mt-4"><ReportsTab /></TabsContent>
        <TabsContent value="plan" className="mt-4"><ProductionPlanTab /></TabsContent>
        <TabsContent value="launchmode" className="mt-4"><LaunchModeTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Colors Tab ─── */

function ColorsTab() {
  const [colors, setColors] = useState<StandardColor[]>([]);
  const [editColor, setEditColor] = useState<Partial<StandardColor> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("standard_colors").select("id,code,name,active,sort_order").order("sort_order");
    setColors(data ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editColor) return;
    setBusy(true);
    try {
      if (editColor.id) {
        const { error } = await supabase.from("standard_colors").update({
          code: editColor.code, name: editColor.name, active: editColor.active, sort_order: editColor.sort_order,
        }).eq("id", editColor.id);
        if (error) throw error;
        toast.success("Color updated");
      } else {
        const { error } = await supabase.from("standard_colors").insert({
          code: editColor.code!.toUpperCase(), name: editColor.name!, sort_order: editColor.sort_order ?? colors.length + 1,
        });
        if (error) throw error;
        toast.success("Color added");
      }
      setEditColor(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const toggleActive = async (c: StandardColor) => {
    const { error } = await supabase.from("standard_colors").update({ active: !c.active }).eq("id", c.id);
    if (error) toast.error(error.message); else load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("standard_colors").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Color removed"); load(); }
  };

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditColor({ code: "", name: "", active: true, sort_order: colors.length + 1 })} size="sm"><Plus className="h-4 w-4 mr-1" />Add Color</Button>
      </div>
      {colors.length === 0 ? <EmptyState icon={Palette} title="No colors" description="Add standard colors for production." /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Order</TableHead><TableHead>Active</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {colors.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.sort_order}</TableCell>
                  <TableCell><Switch checked={c.active} onCheckedChange={() => toggleActive(c)} /></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditColor(c)}><Pencil className="h-4 w-4" /></Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete {c.name}?</AlertDialogTitle><AlertDialogDescription>This will permanently remove the color code {c.code}.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove(c.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!editColor} onOpenChange={() => setEditColor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editColor?.id ? "Edit" : "Add"} Color</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Code</Label><Input value={editColor?.code ?? ""} onChange={e => setEditColor(p => ({ ...p!, code: e.target.value.toUpperCase() }))} placeholder="11U" maxLength={4} /></div>
            <div className="space-y-1.5"><Label>Name</Label><Input value={editColor?.name ?? ""} onChange={e => setEditColor(p => ({ ...p!, name: e.target.value }))} placeholder="White" /></div>
            <div className="space-y-1.5"><Label>Sort Order</Label><Input type="number" value={editColor?.sort_order ?? 1} onChange={e => setEditColor(p => ({ ...p!, sort_order: +e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditColor(null)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Models Tab ─── */

function ModelsTab() {
  const [models, setModels] = useState<ModelWithTrims[]>([]);
  const [editModel, setEditModel] = useState<Partial<Model> & { isNew?: boolean } | null>(null);
  const [editTrim, setEditTrim] = useState<{ modelId: string; trim?: ModelTrim } | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: m }, { data: t }] = await Promise.all([
      supabase.from("models").select("id,name,active").order("name"),
      supabase.from("model_trims").select("id,name,model_id,active,sort_order").order("sort_order"),
    ]);
    setModels((m ?? []).map(model => ({
      ...model,
      trims: (t ?? []).filter(trim => trim.model_id === model.id),
    })));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveModel = async () => {
    if (!editModel) return;
    setBusy(true);
    try {
      if (!editModel.isNew && editModel.id) {
        const { error } = await supabase.from("models").update({ name: editModel.name, active: editModel.active }).eq("id", editModel.id);
        if (error) throw error;
        toast.success("Model updated");
      } else {
        const { error } = await supabase.from("models").insert({ name: editModel.name! });
        if (error) throw error;
        toast.success("Model added");
      }
      setEditModel(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const removeModel = async (id: string) => {
    const { error } = await supabase.from("models").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Model removed"); load(); }
  };

  const saveTrim = async () => {
    if (!editTrim) return;
    setBusy(true);
    try {
      if (editTrim.trim?.id) {
        const { error } = await supabase.from("model_trims").update({ name: editTrim.trim.name, active: editTrim.trim.active, sort_order: editTrim.trim.sort_order }).eq("id", editTrim.trim.id);
        if (error) throw error;
        toast.success("Trim updated");
      } else {
        const { error } = await supabase.from("model_trims").insert({ model_id: editTrim.modelId, name: editTrim.trim!.name, sort_order: editTrim.trim?.sort_order ?? 0 });
        if (error) throw error;
        toast.success("Trim added");
      }
      setEditTrim(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const removeTrim = async (id: string) => {
    const { error } = await supabase.from("model_trims").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Trim removed"); load(); }
  };

  const toggleModelActive = async (m: Model) => {
    const { error } = await supabase.from("models").update({ active: !m.active }).eq("id", m.id);
    if (error) toast.error(error.message); else load();
  };

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditModel({ name: "", active: true, isNew: true })} size="sm"><Plus className="h-4 w-4 mr-1" />Add Model</Button>
      </div>
      {models.length === 0 ? <EmptyState icon={Car} title="No models" description="Add vehicle models and trim levels." /> : (
        <div className="space-y-2">
          {models.map(m => (
            <Card key={m.id}>
              <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setExpandedModel(expandedModel === m.id ? null : m.id)}>
                <div className="flex items-center gap-2">
                  {expandedModel === m.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.trims.length} trim{m.trims.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <Switch checked={m.active} onCheckedChange={() => toggleModelActive(m)} />
                  <Button variant="ghost" size="icon" onClick={() => setEditModel(m)}><Pencil className="h-4 w-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>Delete {m.name}?</AlertDialogTitle><AlertDialogDescription>This will also delete all trim levels for this model.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => removeModel(m.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {expandedModel === m.id && (
                <CardContent className="pt-0 border-t">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-medium">Trim Levels</span>
                    <Button variant="outline" size="sm" onClick={() => setEditTrim({ modelId: m.id, trim: { name: "", sort_order: m.trims.length + 1 } as any })}><Plus className="h-3 w-3 mr-1" />Add Trim</Button>
                  </div>
                  {m.trims.length === 0 ? <p className="text-sm text-muted-foreground">No trims defined.</p> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Order</TableHead><TableHead>Active</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
                      <TableBody>
                        {m.trims.map(t => (
                          <TableRow key={t.id}>
                            <TableCell>{t.name}</TableCell>
                            <TableCell>{t.sort_order}</TableCell>
                            <TableCell><Switch checked={t.active} onCheckedChange={async () => { await supabase.from("model_trims").update({ active: !t.active }).eq("id", t.id); load(); }} /></TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" onClick={() => setEditTrim({ modelId: m.id, trim: t })}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" onClick={() => removeTrim(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Model Dialog */}
      <Dialog open={!!editModel} onOpenChange={() => setEditModel(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editModel?.isNew ? "Add" : "Edit"} Model</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={editModel?.name ?? ""} onChange={e => setEditModel(p => ({ ...p!, name: e.target.value }))} placeholder="Sedan A" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditModel(null)}>Cancel</Button><Button onClick={saveModel} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trim Dialog */}
      <Dialog open={!!editTrim} onOpenChange={() => setEditTrim(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editTrim?.trim?.id ? "Edit" : "Add"} Trim Level</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={editTrim?.trim?.name ?? ""} onChange={e => setEditTrim(p => p ? { ...p, trim: { ...p.trim!, name: e.target.value } } : p)} placeholder="GLS" /></div>
            <div className="space-y-1.5"><Label>Sort Order</Label><Input type="number" value={editTrim?.trim?.sort_order ?? 1} onChange={e => setEditTrim(p => p ? { ...p, trim: { ...p.trim!, sort_order: +e.target.value } } : p)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditTrim(null)}>Cancel</Button><Button onClick={saveTrim} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Reports Tab ─── */

function ReportsTab() {
  const [delayDays, setDelayDays] = useState(2);
  const [reportEnabled, setReportEnabled] = useState(false);
  const [reportHours, setReportHours] = useState<number[]>([8, 12, 16]);
  const [reportEmails, setReportEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [modelYears, setModelYears] = useState<string[]>(["2026", "2027"]);
  const [newYear, setNewYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("app_settings").select("id,key,value");
      const settings = data ?? [];
      const dt = settings.find(s => s.key === "delay_threshold");
      const rs = settings.find(s => s.key === "report_schedule");
      const re = settings.find(s => s.key === "report_emails");
      const my = settings.find(s => s.key === "model_years");
      if (dt?.value && typeof dt.value === "object") setDelayDays((dt.value as any).days ?? 2);
      if (rs?.value && typeof rs.value === "object") {
        const v = rs.value as any;
        setReportEnabled(v.enabled ?? false);
        setReportHours(v.hours ?? [8, 12, 16]);
      }
      if (re?.value && typeof re.value === "object") {
        const v = re.value as any;
        setReportEmails(v.emails ?? []);
        setResendKey(v.resend_api_key ?? "");
      }
      if (my?.value && Array.isArray(my.value)) setModelYears(my.value as string[]);
      setLoaded(true);
    };
    load();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await supabase.from("app_settings").upsert({ key: "delay_threshold", value: { days: delayDays } });
      await supabase.from("app_settings").upsert({ key: "report_schedule", value: { enabled: reportEnabled, hours: reportHours } });
      await supabase.from("app_settings").upsert({ key: "report_emails", value: { emails: reportEmails, resend_api_key: resendKey } });
      await supabase.from("app_settings").upsert({ key: "model_years", value: modelYears });
      toast.success("Settings saved");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const HOUR_OPTIONS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  const toggleHour = (h: number) => {
    setReportHours(prev => prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h].sort());
  };

  const addEmail = () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (trimmed && trimmed.includes("@") && !reportEmails.includes(trimmed)) {
      setReportEmails(prev => [...prev, trimmed]);
      setNewEmail("");
    }
  };

  const removeEmail = (email: string) => {
    setReportEmails(prev => prev.filter(e => e !== email));
  };

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading settings...</p>;

  return (
    <div className="space-y-4">
      {/* Delay Threshold */}
      <Card>
        <CardHeader><CardTitle className="text-base">Delayed Vehicles Threshold</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Vehicles staying at a station longer than this number of working days will appear in the Delayed report.</p>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} max={30} value={delayDays} onChange={e => setDelayDays(Math.max(0, parseInt(e.target.value) || 0))} className="w-20" />
            <span className="text-sm text-muted-foreground">working days</span>
          </div>
        </CardContent>
      </Card>

      {/* Report Schedule */}
      <Card>
        <CardHeader><CardTitle className="text-base">Scheduled Reports</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable automated reports</p>
              <p className="text-xs text-muted-foreground">Generate and email PDF reports at scheduled times using pg_cron</p>
            </div>
            <Switch checked={reportEnabled} onCheckedChange={setReportEnabled} />
          </div>
          {reportEnabled && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-sm">Report Hours</Label>
                <div className="flex flex-wrap gap-2">
                  {HOUR_OPTIONS.map(h => (
                    <button
                      key={h}
                      onClick={() => toggleHour(h)}
                      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${reportHours.includes(h) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-accent"}`}
                    >
                      {h.toString().padStart(2, "0")}:00
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Configuration */}
      <Card>
        <CardHeader><CardTitle className="text-base">Email Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Resend API Key</Label>
            <p className="text-xs text-muted-foreground">Get a free API key from resend.com (100 emails/day free)</p>
            <Input type="password" value={resendKey} onChange={e => setResendKey(e.target.value)} placeholder="re_xxxxxxxxxxxx" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Report Recipients</Label>
            <div className="flex gap-2">
              <Input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }} />
              <Button variant="outline" size="sm" onClick={addEmail}><Plus className="h-4 w-4" /></Button>
            </div>
            {reportEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {reportEmails.map(email => (
                  <span key={email} className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2.5 py-1">
                    {email}
                    <button onClick={() => removeEmail(email)} className="text-muted-foreground hover:text-destructive">&times;</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Model Years */}
      <Card>
        <CardHeader><CardTitle className="text-base">Model Years</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Years available in job order and paint job order forms.</p>
          <div className="flex flex-wrap gap-1.5">
            {modelYears.map(y => (
              <span key={y} className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2.5 py-1">
                {y}
                <button onClick={() => setModelYears(prev => prev.filter(x => x !== y))} className="text-muted-foreground hover:text-destructive">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newYear} onChange={e => setNewYear(e.target.value)} placeholder="2028" className="w-28" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const y = newYear.trim(); if (y && /^\d{4}$/.test(y) && !modelYears.includes(y)) { setModelYears(prev => [...prev, y].sort()); setNewYear(""); } } }} />
            <Button variant="outline" size="sm" onClick={() => { const y = newYear.trim(); if (y && /^\d{4}$/.test(y) && !modelYears.includes(y)) { setModelYears(prev => [...prev, y].sort()); setNewYear(""); } }}><Plus className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Settings"}</Button>
      </div>
    </div>
  );
}

/* ─── Launch Mode Tab ─── */

function LaunchModeTab() {
  const { mode, isLaunchMode } = useProductionMode();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const newMode = isLaunchMode ? "detailed" : "launch";
    setBusy(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "production_mode", value: { mode: newMode } });
      if (error) throw error;
      toast.success(newMode === "launch" ? "Launch Mode enabled" : "Detailed Mode restored");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const hiddenStations = ["Body Shop", "Line Feeding", "TCF", "Waiting Repair", "Repair", "CS / QC", "PDI", "TCF Offline"];
  const visibleStations = ["Warehouse", "WBS", "Paint (color only)", "PBS", "Shortage (+ Buffer)"];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Production Mode</span>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${!isLaunchMode ? "text-primary" : "text-muted-foreground"}`}>Detailed</span>
              <Switch checked={isLaunchMode} onCheckedChange={toggle} disabled={busy} />
              <span className={`text-sm font-medium ${isLaunchMode ? "text-warning" : "text-muted-foreground"}`}>Launch</span>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLaunchMode && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
              <p className="text-sm font-medium text-warning">Launch Mode is active for all users</p>
              <p className="text-xs text-muted-foreground mt-1">
                Staff see only capture-point stations. Hidden stations still store data and resume when switching back.
              </p>
            </div>
          )}
          {!isLaunchMode && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">Detailed Mode — full production flow visible</p>
              <p className="text-xs text-muted-foreground mt-1">
                All stations visible. This is the default mode.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Visible in Launch Mode</p>
              <ul className="space-y-1">
                {visibleStations.map(s => (
                  <li key={s} className="text-sm flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Hidden in Launch Mode</p>
              <ul className="space-y-1">
                {hiddenStations.map(s => (
                  <li key={s} className="text-sm flex items-center gap-2 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-destructive" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Production Plan Tab ─── */

function ProductionPlanTab() {
  const [models, setModels] = useState<Model[]>([]);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
  });
  const [busy, setBusy] = useState(false);
  const [editPlans, setEditPlans] = useState<Record<string, { monthly_plan: number; daily_target: number; jph_target: number }>>({});

  const load = useCallback(async () => {
    const [mRes, pRes] = await Promise.all([
      supabase.from("models").select("id,name,active").eq("active", true).order("name"),
      supabase.from("production_plans").select("id,model_id,month,monthly_plan,daily_target,jph_target").eq("month", selectedMonth + "-01"),
    ]);
    setModels(mRes.data ?? []);
    setPlans(pRes.data ?? []);
  }, [selectedMonth]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const initial: Record<string, { monthly_plan: number; daily_target: number; jph_target: number }> = {};
    models.forEach(m => {
      const existing = plans.find(p => p.model_id === m.id);
      initial[m.id] = existing
        ? { monthly_plan: existing.monthly_plan, daily_target: existing.daily_target, jph_target: existing.jph_target }
        : { monthly_plan: 0, daily_target: 0, jph_target: 0 };
    });
    setEditPlans(initial);
  }, [models, plans]);

  const save = async () => {
    setBusy(true);
    try {
      for (const [modelId, vals] of Object.entries(editPlans)) {
        await supabase.from("production_plans").upsert({
          month: selectedMonth + "-01",
          model_id: modelId,
          monthly_plan: vals.monthly_plan,
          daily_target: vals.daily_target,
          jph_target: vals.jph_target,
        }, { onConflict: "month,model_id" });
      }
      toast.success("Production plan saved");
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const updateField = (modelId: string, field: "monthly_plan" | "daily_target" | "jph_target", value: number) => {
    setEditPlans(prev => ({
      ...prev,
      [modelId]: { ...prev[modelId], [field]: value },
    }));
  };

  const totalPlan = Object.values(editPlans).reduce((s, p) => s + p.monthly_plan, 0);
  const totalDaily = Object.values(editPlans).reduce((s, p) => s + p.daily_target, 0);
  const totalJPH = Object.values(editPlans).reduce((s, p) => s + p.jph_target, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Monthly Production Plan</span>
            <Input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="w-44" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active models. Add models in the Models tab first.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Monthly Plan</TableHead>
                  <TableHead className="text-right">Daily Target</TableHead>
                  <TableHead className="text-right">JPH Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min={0} value={editPlans[m.id]?.monthly_plan ?? 0} onChange={e => updateField(m.id, "monthly_plan", +e.target.value)} className="w-24 ml-auto text-right" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min={0} value={editPlans[m.id]?.daily_target ?? 0} onChange={e => updateField(m.id, "daily_target", +e.target.value)} className="w-24 ml-auto text-right" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min={0} step={0.1} value={editPlans[m.id]?.jph_target ?? 0} onChange={e => updateField(m.id, "jph_target", +e.target.value)} className="w-24 ml-auto text-right" />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{totalPlan}</TableCell>
                  <TableCell className="text-right">{totalDaily}</TableCell>
                  <TableCell className="text-right">{totalJPH.toFixed(1)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Plan"}</Button>
      </div>
    </div>
  );
}
