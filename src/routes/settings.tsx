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
import { Palette, Car, Plus, Pencil, Trash2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { StandardColor, Model, ModelTrim, ModelWithTrims } from "@/lib/db-types";

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
        </TabsList>
        <TabsContent value="colors" className="mt-4"><ColorsTab /></TabsContent>
        <TabsContent value="models" className="mt-4"><ModelsTab /></TabsContent>
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
    const { data } = await supabase.from("standard_colors").select("*").order("sort_order");
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
      supabase.from("models").select("*").order("name"),
      supabase.from("model_trims").select("*").order("sort_order"),
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
