'use client';

import { createContext, useContext } from 'react';
import type { EvanPlannerCheckIn } from '@/lib/anam/evan-planner-contact';

// Only the visitor's current browser memory. Never persist this in storage,
// forward it to the avatar, or fetch raw contact details back from the server.
export const EvanPlannerContactContext = createContext<EvanPlannerCheckIn | undefined>(undefined);

export function useEvanPlannerCheckIn() {
    return useContext(EvanPlannerContactContext);
}
