/**
 * A product can belong to several models; `Product.model` stores them as a
 * comma-separated list ("X20, X21") so old single-model rows keep working.
 */
export function productModelsOf(model: string | null | undefined): string[] {
  return String(model ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);
}

export function hasProductModel(model: string | null | undefined, name: string | null | undefined): boolean {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return false;
  return productModelsOf(model).some(item => item.toLowerCase() === wanted);
}

export function toggleProductModel(model: string | null | undefined, name: string): string {
  const key = name.trim();
  const list = productModelsOf(model);
  const index = list.findIndex(item => item.toLowerCase() === key.toLowerCase());
  if (index >= 0) list.splice(index, 1);
  else if (key) list.push(key);
  return list.join(', ');
}

export function replaceProductModel(model: string | null | undefined, from: string, to: string): string {
  const key = from.trim().toLowerCase();
  return productModelsOf(model)
    .map(item => (item.toLowerCase() === key ? to : item))
    .join(', ');
}

export function joinProductModels(models: string[]): string {
  return models.map(name => name.trim()).filter(Boolean).join(', ');
}
