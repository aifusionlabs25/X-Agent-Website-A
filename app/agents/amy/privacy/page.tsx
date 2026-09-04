import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Amy demo · Privacy and data use',
    description: 'How the independently built Amy demonstration handles check-in, conversation processing and follow-up.',
    openGraph: { title: 'Amy demo · Privacy and data use', description: 'Demo privacy and data-use information.' },
};

export default function AmyDemoPrivacyPage() {
    return <main className="mx-auto max-w-3xl px-6 py-24 text-zinc-200">
        <p className="text-sm font-semibold uppercase tracking-widest text-pink-400">AI Fusion Labs · Amy demo</p>
        <h1 className="mt-4 text-4xl font-semibold text-white">Privacy and data use</h1>
        <p className="mt-6 leading-7">Amy is an independently built AI demonstration for exploring an Insight-style sales discovery workflow. It is not an official Insight service or a representation of Insight security approval. Use fictional or non-sensitive information, not confidential business, personal, government-controlled, or regulated data.</p>
        <section className="mt-8 space-y-3" aria-labelledby="amy-data-collected">
            <h2 id="amy-data-collected" className="text-xl font-semibold text-white">What is processed</h2>
            <p className="leading-7">Check-in collects the name and email you enter. Your email supports this session&apos;s follow-up; entering it does not verify ownership. Your audio and conversation are processed through Anam and its supporting services. Conversation transcripts support working visuals, session finalization, and follow-up generation.</p>
        </section>
        <section className="mt-8 space-y-3" aria-labelledby="amy-data-recipients">
            <h2 id="amy-data-recipients" className="text-xl font-semibold text-white">Follow-up and review copies</h2>
            <p className="leading-7">A recap is sent to the address provided at check-in. The demo operator also receives an opportunity intake brief and an operations record containing session details and a sanitized conversation record. These are demo review workflows, not automatic delivery to an assigned Insight account team or CRM.</p>
            <p className="leading-7">The website, session storage, and email providers process data to support these functions. Email delivery uses AgentMail and, where configured for the visitor message, Resend. Sanitization is not a guarantee that sensitive information will be removed.</p>
        </section>
        <section className="mt-8 space-y-3" aria-labelledby="amy-data-memory">
            <h2 id="amy-data-memory" className="text-xl font-semibold text-white">Memory, storage, and requests</h2>
            <p className="leading-7">Returning memory is paused in this demo. Public visitors cannot retrieve or delete prior-session notes through an entered email address. Existing stored notes are not erased by this pause. Starting fresh does not mean no information is stored: transcripts, operational records, and email copies may remain in supporting services.</p>
            <p className="leading-7">This demo does not promise zero retention or automatic deletion across providers and mailboxes. For a data-access or deletion request, contact the AI Fusion Labs organizer who shared the demo with you. Ownership must be established before any account-specific information is disclosed or changed.</p>
        </section>
        <section className="mt-8 space-y-3" aria-labelledby="amy-data-limits">
            <h2 id="amy-data-limits" className="text-xl font-semibold text-white">Important limits</h2>
            <p className="leading-7">Amy can make mistakes. Working briefs and suggestions require human review and are not designs, quotes, bookings, or compliance determinations. This notice covers the website demo; joining a third-party meeting requires the separate meeting consent and provider terms shown in that flow.</p>
        </section>
        <Link href="/agents/amy" className="mt-10 inline-block rounded-xl border border-white/20 px-5 py-3 font-semibold text-white">Back to Amy</Link>
    </main>;
}
