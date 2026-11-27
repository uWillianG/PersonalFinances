/** BRL form input: Brazilian grouping is accepted without turning 1.000 into
 * one real; dot decimals remain accepted for existing edit-field values. */
export function moneyInputCents(value: string): number {
  let raw = value.trim().replace(/^([+-]?)\s*R\$\s*/i, "$1");
  const sign = raw.startsWith("-") ? -1 : 1;
  raw = raw.replace(/^[+-]/, "");
  let integer: string;
  let fraction = "";
  if (raw.includes(",")) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(raw))
      throw new Error(
        "Informe um valor em reais, com até duas casas decimais.",
      );
    [integer, fraction] = raw.split(",");
    integer = integer.replace(/\./g, "");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
    integer = raw.replace(/\./g, "");
  } else if (/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    [integer, fraction = ""] = raw.split(".");
  } else {
    throw new Error("Informe um valor em reais, com até duas casas decimais.");
  }
  const cents =
    sign * (Number(integer) * 100 + Number(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 1_000_000_000_000)
    throw new Error("O valor excede o limite permitido.");
  return cents;
}
