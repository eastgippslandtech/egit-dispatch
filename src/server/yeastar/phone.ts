export function normalizeAustralianPhone(value?: string | null) {
  const input = value?.trim();
  if (!input || /private|anonymous|withheld|unknown/i.test(input)) {
    return undefined;
  }

  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0061")) digits = digits.slice(2);
  if (digits.startsWith("61")) digits = `0${digits.slice(2)}`;

  if (!/^0\d{9}$/.test(digits)) {
    return undefined;
  }

  return `+61${digits.slice(1)}`;
}
