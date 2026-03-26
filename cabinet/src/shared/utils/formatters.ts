type FormatNumberOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

export function formatNumber(
  value: number | null | undefined,
  options?: FormatNumberOptions,
) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0';
  }

  const maximumFractionDigits =
    options?.maximumFractionDigits ?? (Number.isInteger(value) ? 0 : 2);

  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits,
  }).format(value);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return 'Нет данных';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Нет данных';
  }

  return date.toLocaleString('ru-RU');
}

export function formatDay(value: string | null | undefined) {
  if (!value) {
    return 'Нет данных';
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('ru-RU');
}
