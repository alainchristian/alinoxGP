import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { VehicleCategoryDto, VehicleDto } from '@gps/shared';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { emptyVehicleForm, fuelTypeOptions, vehicleFormToPayload, vehicleToForm, vehicleTypeOptions, type VehicleFormValues } from './fleet-model';

/** Create (no `vehicle`) or edit a vehicle. Every field except the registration number may stay empty — empty means unknown. */
export function VehicleFormDialog({
  open,
  onOpenChange,
  vehicle,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle?: VehicleDto;
  categories: VehicleCategoryDto[];
  onSaved: (v: VehicleDto) => void | Promise<unknown>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VehicleFormValues>({ defaultValues: emptyVehicleForm });

  useEffect(() => {
    if (open) {
      reset(vehicle ? vehicleToForm(vehicle) : emptyVehicleForm);
      setFormError(null);
    }
  }, [open, vehicle, reset]);

  async function onSubmit(values: VehicleFormValues) {
    setFormError(null);
    if (!values.registrationNumber.trim()) {
      setError('registrationNumber', { message: 'Enter the registration number' });
      return;
    }
    try {
      const saved = await api<VehicleDto>(vehicle ? `/vehicles/${vehicle.id}` : '/vehicles', { method: vehicle ? 'PATCH' : 'POST', body: vehicleFormToPayload(values) });
      await onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      // The two uniqueness rules belong next to the field that caused them.
      if (err instanceof ApiError && err.code === 'VEHICLE_REGISTRATION_TAKEN') setError('registrationNumber', { message: 'Already used by another vehicle' });
      else if (err instanceof ApiError && err.code === 'VEHICLE_VIN_TAKEN') setError('vin', { message: 'Already used by another vehicle' });
      else setFormError(applyApiError(err, setError));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={vehicle ? 'Edit vehicle' : 'Add vehicle'}
      description="Only the registration number is required. Leave anything you do not know empty — it will show as unknown."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registration number" htmlFor="v-reg" error={errors.registrationNumber?.message}>
            <Input id="v-reg" autoFocus invalid={!!errors.registrationNumber} {...register('registrationNumber')} />
          </Field>
          <Field label="Category" htmlFor="v-cat" error={errors.categoryId?.message}>
            <Select id="v-cat" {...register('categoryId')}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Make" htmlFor="v-make" error={errors.make?.message}>
            <Input id="v-make" {...register('make')} />
          </Field>
          <Field label="Model" htmlFor="v-model" error={errors.model?.message}>
            <Input id="v-model" {...register('model')} />
          </Field>
          <Field label="Year" htmlFor="v-year" error={errors.year?.message}>
            <Input id="v-year" inputMode="numeric" invalid={!!errors.year} {...register('year')} />
          </Field>
          <Field label="Colour" htmlFor="v-color" error={errors.color?.message}>
            <Input id="v-color" {...register('color')} />
          </Field>
          <Field label="Type" htmlFor="v-type" error={errors.vehicleType?.message}>
            <Select id="v-type" {...register('vehicleType')}>
              <option value="">Unknown</option>
              {vehicleTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fuel" htmlFor="v-fuel" error={errors.fuelType?.message}>
            <Select id="v-fuel" {...register('fuelType')}>
              <option value="">Unknown</option>
              {fuelTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="VIN / chassis number" htmlFor="v-vin" error={errors.vin?.message} hint="5–30 letters or digits">
            <Input id="v-vin" autoCapitalize="characters" invalid={!!errors.vin} {...register('vin')} />
          </Field>
          <span className="hidden sm:block" />
          <Field label="Insurance valid through" htmlFor="v-ins" error={errors.insuranceExpiry?.message}>
            <Input id="v-ins" type="date" invalid={!!errors.insuranceExpiry} {...register('insuranceExpiry')} />
          </Field>
          <Field label="Inspection valid through" htmlFor="v-insp" error={errors.inspectionExpiry?.message}>
            <Input id="v-insp" type="date" invalid={!!errors.inspectionExpiry} {...register('inspectionExpiry')} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="v-notes" error={errors.notes?.message}>
          <textarea
            id="v-notes"
            rows={3}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint"
            {...register('notes')}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {vehicle ? 'Save changes' : 'Add vehicle'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
