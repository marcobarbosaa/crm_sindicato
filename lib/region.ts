export function parseRegion(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const region = Number(
    String(value)
      .trim()
      .replace(/^regi[aã]o\s*/i, ""),
  );
  return Number.isInteger(region) && region >= 1 && region <= 17
    ? region
    : null;
}

export function isValidRegion(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    String(value).trim() === "" ||
    parseRegion(value) !== null
  );
}
