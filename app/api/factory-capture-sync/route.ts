import {createFactorySyncHandlers} from '@/lib/preview/factory-sync.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return createFactorySyncHandlers().GET(request);}
export async function POST(request:Request){return createFactorySyncHandlers().POST(request);}
