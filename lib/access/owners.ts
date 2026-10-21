export function accessOwnerEmails(): string[] {
    return [...new Set((process.env.XAGENT_ACCESS_OWNER_EMAILS ?? 'aifusionlabs@gmail.com')
        .split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
}

export function isAccessOwner(email: string): boolean {
    return accessOwnerEmails().includes(email.trim().toLowerCase());
}
