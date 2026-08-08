export const BETA_SIGNUP_USE_CASES = [
    'Lead Nurturing',
    'CRM Automation',
    'Customer Intake',
    'Sales SDR',
    'Support Triage',
    'Other',
] as const;

export interface BetaSignupData {
    name: string;
    email: string;
    company: string;
    useCase: (typeof BETA_SIGNUP_USE_CASES)[number];
}

const ALLOWED_USE_CASES = new Set<string>(BETA_SIGNUP_USE_CASES);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(
    payload: Record<string, unknown>,
    key: string,
    maximumLength: number,
): string | null {
    const value = payload[key];
    if (typeof value !== 'string') return null;

    const normalized = value.trim();
    if (!normalized || normalized.length > maximumLength || CONTROL_CHARACTERS.test(normalized)) {
        return null;
    }

    return normalized;
}

export function parseBetaSignup(value: unknown): BetaSignupData | null {
    if (!isRecord(value)) return null;

    const name = readText(value, 'name', 120);
    const email = readText(value, 'email', 254);
    const company = readText(value, 'company', 160);
    const useCase = readText(value, 'useCase', 80);

    if (
        !name
        || !email
        || !company
        || !useCase
        || !EMAIL_PATTERN.test(email)
        || !ALLOWED_USE_CASES.has(useCase)
    ) {
        return null;
    }

    return {
        name,
        email,
        company,
        useCase: useCase as BetaSignupData['useCase'],
    };
}
