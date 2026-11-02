import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { VehicleCategoryDto } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Button, EmptyState, Input, Select } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';

/** Accent colours for categories. Deliberately none of the status colours (green/amber/blue/grey/red are reserved for vehicle status). */
export const CATEGORY_COLORS = [
  { value: '', label: 'No colour' },
  { value: '#7c3aed', label: 'Purple' },
  { value: '#db2777', label: 'Pink' },
  { value: '#0d9488', label: 'Teal' },
  { value: '#92400e', label: 'Brown' },
  { value: '#475569', label: 'Slate' },
];

export const categoriesKey = (orgId: string) => ['org', orgId, 'vehicle-categories'];

export function CategoriesDialog({
  open,
  onOpenChange,
  orgId,
  categories,
  canManage,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
  categories: VehicleCategoryDto[];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: categoriesKey(orgId) }), queryClient.invalidateQueries({ queryKey: ['org', orgId, 'vehicles'] })]);
  const fail = (e: unknown) => setError(e instanceof ApiError ? errorMessage(e.code) : errorMessage(undefined));

  const create = useMutation({
    mutationFn: () => api('/vehicle-categories', { method: 'POST', body: { name: name.trim(), color: color || null } }),
    onSuccess: async () => { setError(null); setName(''); setColor(''); await refresh(); },
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => api(`/vehicle-categories/${v.id}`, { method: 'PATCH', body: { name: v.name.trim() } }),
    onSuccess: async () => { setError(null); setEditing(null); await refresh(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/vehicle-categories/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: fail,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Vehicle categories" description="Group your vehicles your own way, for example by use or by branch.">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {categories.length === 0 ? (
          <EmptyState title="No categories yet" description={canManage ? 'Create one below, then choose it when you add or edit a vehicle.' : 'An administrator can create categories.'} />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <span aria-hidden className="size-3 shrink-0 rounded-sm border border-border-strong" style={{ background: c.color ?? 'transparent' }} />
                {editing === c.id ? (
                  <>
                    <Input aria-label={`New name for ${c.name}`} className="h-8" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    <Button size="sm" loading={rename.isPending} onClick={() => rename.mutate({ id: c.id, name: editName })}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="tabular text-xs text-text-muted">{c.vehicleCount === 1 ? '1 vehicle' : `${c.vehicleCount} vehicles`}</span>
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" aria-label={`Rename ${c.name}`} onClick={() => { setEditing(c.id); setEditName(c.name); }}>Rename</Button>
                        <Button size="sm" variant="ghost" className="text-danger" aria-label={`Delete ${c.name}`} loading={remove.isPending && remove.variables === c.id} onClick={() => remove.mutate(c.id)}>Delete</Button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <div className="min-w-40 flex-1">
              <label htmlFor="cat-name" className="mb-1.5 block text-[13px] font-medium">New category</label>
              <Input id="cat-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="cat-color" className="mb-1.5 block text-[13px] font-medium">Colour</label>
              <Select id="cat-color" className="w-32" value={color} onChange={(e) => setColor(e.target.value)}>
                {CATEGORY_COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </div>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>Add</Button>
          </form>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
