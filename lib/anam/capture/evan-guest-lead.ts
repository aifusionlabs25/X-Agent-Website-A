// Exact type-only dependency from current source; no guest/email action code.
export type EvanGuestLead = {
    displayName: string | null;
    /** Visitor-supplied name not fully repeated by Evan; human review only. */
    nameForReview: string | null;
    phone: string | null;
    email: string | null;
    /** Visitor-supplied email not read back by Evan; internal review only, never a delivery address. */
    emailForReview?: string;
    requestedFollowUp: true;
    callbackWindow: string | null;
};
