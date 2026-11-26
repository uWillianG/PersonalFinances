export function categoryRuleKey(description: string): string {
  return description
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:parcela|parc\.?)\s*\d{1,3}\s*(?:\/|de)\s*\d{1,3}\b/g, " ")
    .replace(/\s+\d{1,3}\s*\/\s*\d{1,3}\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
}
