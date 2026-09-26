import type { Metadata } from 'next';
import LegalPage, { LegalList, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
    title: 'Privacy Policy | AI Fusion Labs',
    description: 'Privacy Policy for the AI Fusion Labs X Agents services.',
};

export default function PrivacyPage() {
    return (
        <LegalPage
            eyebrow="AI Fusion Labs"
            title="Privacy Policy"
            description="How the X Agents website and related services handle information for current adult users."
        >
            <LegalSection title="1. About this Policy">
                <p>
                    AI Fusion Labs is the public-facing trade name used by Rob Vicks, doing business as AI Fusion Labs
                    (&quot;AI Fusion Labs,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). This Privacy Policy applies to the X Agents website and
                    related services (the &quot;Services&quot;) at <span className="text-white">xagent.aifusionlabs.app</span>.
                </p>
                <p>The Services are intended for people age 18 and older. Do not use the Services if you are under 18.</p>
            </LegalSection>

            <LegalSection title="2. Information you may provide">
                <p>Depending on the feature you use, you may provide:</p>
                <LegalList>
                    <li>your name, email address, company or role, and selected business use case through the beta signup form;</li>
                    <li>your name, verified email address, email-recap choice, reviewed-memory choice, and an email verification code through an agent access flow;</li>
                    <li>spoken conversation content and related conversation turns during an AI avatar or voice session;</li>
                    <li>a meeting platform, meeting link, scheduling date and time, group or one-to-one preference, duration, and optional meeting purpose; and</li>
                    <li>street addresses or stops for available Evan route-planning features.</li>
                </LegalList>
                <p>
                    The current public path does not provide a general file-upload capability. Do not submit secrets,
                    credentials, regulated records, or other sensitive material through an experimental session.
                </p>
            </LegalSection>

            <LegalSection title="3. Information collected or created automatically">
                <p>
                    The Services may create or process operational information such as session IDs, launch and completion
                    timestamps, consent and verification state, provider message IDs, error and transition information,
                    cookies, and browser meeting-invite metadata.
                </p>
                <p>
                    The application reads forwarded IP headers and derives a truncated hash for rate limiting. The
                    application does not use raw IP addresses in its session records. Hosting and infrastructure providers
                    may process additional request metadata.
                </p>
                <p>
                    No analytics SDK, advertising pixel, or marketing tracker was observed in the inspected public path.
                    This statement is limited to the public path and does not describe uninspected infrastructure or
                    third-party provider logs.
                </p>
                <p>
                    The application does not use the browser geolocation API. Available Evan route-planning features may
                    process a street address supplied by you and send it for geocoding into route-pin coordinates.
                </p>
            </LegalSection>

            <LegalSection title="4. How we use information">
                <p>Subject to the feature and choices you make, information may be used to:</p>
                <LegalList>
                    <li>provide, operate, secure, and troubleshoot the Services;</li>
                    <li>process beta requests and respond to submitted business inquiries;</li>
                    <li>authenticate an optional verified-email flow and apply requested recap or reviewed-memory choices;</li>
                    <li>operate an AI avatar, voice, or video session and complete session administration;</li>
                    <li>schedule or coordinate a meeting request;</li>
                    <li>geocode user-provided route addresses for available Evan route-planning features;</li>
                    <li>send a requested verification email, recap, or operational follow-up; and</li>
                    <li>maintain limited operational records, rate limits, fraud-prevention controls, and error records.</li>
                </LegalList>
                <p>
                    The primary session-spine design records transcript status, source, turn count, and a content hash
                    rather than the raw transcript. A legacy fallback route exists that can persist transcript files when
                    that session path is inactive. We do not promise that raw transcripts are never stored.
                </p>
            </LegalSection>

            <LegalSection title="5. Service providers and disclosures">
                <p>
                    We may disclose information to service providers needed to operate the Services, including AI,
                    avatar, voice, and video services; email and communications services; geocoding and location services;
                    meeting and scheduling services; and hosting, storage, security, and operational services.
                </p>
                <p>
                    The current Services directly use Anam for avatar, voice, video, session, and meeting-invite functions;
                    AgentMail and Resend for email workflows; and Geoapify and the U.S. Census Geocoder for available Evan
                    address geocoding. Provider-side retention, training, and independent logging practices may differ.
                </p>
                <p>
                    We do not promise that providers never retain data, never log request metadata, or never use data for
                    training. Those matters depend on applicable provider terms and configuration.
                </p>
            </LegalSection>

            <LegalSection title="6. Cookies, local storage, and retention">
                <p>
                    The application uses signed browser, session, guest, contact, and verification cookies. A successful
                    meeting invitation can be stored in browser local storage as meeting-invite metadata.
                </p>
                <p>
                    Current application settings provide a seven-day expiry for session-spine records and an eight-day
                    cleanup threshold for browser meeting-invite metadata. These are application settings, not universal
                    provider or infrastructure retention promises. Provider and infrastructure retention may differ.
                </p>
                <p>
                    We retain information for as long as reasonably necessary for the purposes described in this Policy,
                    subject to operational, security, dispute-resolution, and legal requirements.
                </p>
            </LegalSection>

            <LegalSection title="7. Email and privacy requests">
                <p>
                    For privacy questions or requests about information associated with your interaction, contact
                    <a className="ml-1 text-teal-300 underline decoration-teal-700 underline-offset-4" href="mailto:XAgents@aifusionlabs.app">
                        XAgents@aifusionlabs.app
                    </a>.
                </p>
                <p>
                    If you request a recap or related follow-up, the applicable email service may receive your email
                    address and the message content needed to deliver that request. The Dani flow separately presents
                    recap and reviewed-memory choices.
                </p>
                <p>
                    We may need to verify a request and may retain a limited record of the request and response. Any
                    rights or limitations that apply by law depend on the circumstances and jurisdiction.
                </p>
            </LegalSection>

            <LegalSection title="8. Security and changes">
                <p>
                    We use measures appropriate to the current experimental Services, including signed cookies, email
                    verification for selected flows, bounded records, rate limiting, and operational access controls where
                    configured. No method of transmission or storage is guaranteed to be completely secure.
                </p>
                <p>
                    We may update this Policy as the Services, configuration, or legal requirements change. The version
                    and effective date will be updated when a revised Policy is published.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
