import {createPreviewHandlers} from '@/lib/preview/application.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return createPreviewHandlers().CAPTURE(request);}
