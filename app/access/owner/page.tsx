import type { Metadata } from 'next';
import OwnerSignIn from '@/components/access/OwnerSignIn';
import { safeAccessReturnTo } from '@/components/access/navigation';

export const metadata: Metadata = { title: 'Owner sign-in · X Agents', robots: { index: false, follow: false } };
export default async function OwnerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const query = await searchParams;
    return <OwnerSignIn returnTo={safeAccessReturnTo(query.returnTo, '/access/admin')} />;
}
