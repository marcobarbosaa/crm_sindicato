export type CompanySize = "ME" | "EPP" | "Demais";

export type Workforce = {
  valid: boolean;
  employeeCount: number | null;
  employeeRange: string | null;
  companySize: CompanySize | null;
};

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function comparableText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function parseWorkforce(value: unknown): Workforce {
  const original = normalizedText(value);
  if (!original)
    return {
      valid: true,
      employeeCount: null,
      employeeRange: null,
      companySize: null,
    };

  const comparable = comparableText(original);
  const exact = comparable.match(
    /^(?:DE\s+)?(\d+)\s*(?:COLABORADORES?|FUNCIONARIOS?)?$/,
  );
  if (exact) {
    const employeeCount = Number(exact[1]);
    return {
      valid: true,
      employeeCount,
      employeeRange: null,
      companySize: calculateCompanySize(employeeCount),
    };
  }

  const range = comparable.match(
    /^(?:DE\s+)?(\d+)\s*(?:A|ATE|[-–—])\s*(\d+)\s*(?:COLABORADORES?|FUNCIONARIOS?)?$/,
  );
  if (range) {
    const minimum = Number(range[1]);
    const maximum = Number(range[2]);
    if (minimum > maximum)
      return {
        valid: false,
        employeeCount: null,
        employeeRange: null,
        companySize: null,
      };
    let companySize: CompanySize | null = null;
    if (minimum >= 3 && maximum <= 9) companySize = "ME";
    else if (minimum >= 20 && maximum <= 99) companySize = "EPP";
    else if (minimum >= 100) companySize = "Demais";
    return {
      valid: true,
      employeeCount: null,
      employeeRange: original,
      companySize,
    };
  }

  const above = comparable.match(
    /^(?:(?:MAIS|ACIMA)\s+DE\s+|\+\s*)(\d+)\s*(?:COLABORADORES?|FUNCIONARIOS?)?$/,
  );
  if (above) {
    const threshold = Number(above[1]);
    return {
      valid: true,
      employeeCount: null,
      employeeRange: original,
      companySize: threshold >= 99 ? "Demais" : null,
    };
  }

  return {
    valid: false,
    employeeCount: null,
    employeeRange: null,
    companySize: null,
  };
}

export function isValidEmployeeCount(value: unknown): boolean {
  return parseWorkforce(value).valid;
}

export function parseEmployeeCount(value: unknown): number | null {
  return parseWorkforce(value).employeeCount;
}

export function calculateCompanySize(
  employeeCount: number | null,
): CompanySize | null {
  if (employeeCount === null) return null;
  if (employeeCount >= 3 && employeeCount <= 9) return "ME";
  if (employeeCount >= 20 && employeeCount <= 99) return "EPP";
  if (employeeCount >= 100) return "Demais";
  return null;
}

export function normalizeCnpj(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

export function isValidCnpj(value: unknown): boolean {
  const cnpj = normalizeCnpj(value);
  return cnpj === null || cnpj.length === 14;
}

export function formatCnpj(value: string | null | undefined): string {
  const digits = normalizeCnpj(value);
  if (!digits || digits.length !== 14) return value || "";
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}
