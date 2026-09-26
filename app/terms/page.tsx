import type { Metadata } from 'next';
import LegalPage, { LegalList, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
    title: 'Terms of Service | AI Fusion Labs',
    description: 'Terms of Service for the AI Fusion Labs X Agents services.',
};

export default function TermsPage() {
    return (
        <LegalPage
            eyebrow="AI Fusion Labs"
            title="Terms of Service"
            description="Terms for using the current X Agents website and related adult-only experimental services."
        >
            <LegalSection title="1. Acceptance and eligibility">
                <p>
                    These Terms are between you and Rob Vicks, doing business as AI Fusion Labs (&quot;AI Fusion Labs,&quot; &quot;we,&quot;
                    &quot;us,&quot; or &quot;our&quot;). They govern your access to the X Agents website and related services (the
                    &quot;Services&quot;).
                </p>
                <p>
                    By accessing or using the Services, you agree to these Terms and the AI Fusion Labs Privacy Policy. If
                    you do not agree, do not use the Services.
                </p>
                <p>
                    The Services are intended only for users age 18 or older. By using them, you represent that you are at
                    least 18 and can enter a binding agreement. The Services are not intended for children.
                </p>
            </LegalSection>

            <LegalSection title="2. Current Services">
                <p>The current public Services may include:</p>
                <LegalList>
                    <li>beta signup and demo-request workflows;</li>
                    <li>experimental AI avatar, voice, and video sessions;</li>
                    <li>Dani access, verification, recap, and reviewed-memory flows;</li>
                    <li>a meeting and scheduling concierge; and</li>
                    <li>depending on availability, Evan access and route-planning features that process user-provided street addresses for geocoding.</li>
                </LegalList>
                <p>
                    Features may be limited, changed, suspended, or removed. These Terms do not make future products,
                    youth or tutoring concepts, Meta connectors, or other roadmap concepts part of the current Services.
                </p>
            </LegalSection>

            <LegalSection title="3. Experimental and demo use; metering is not charging">
                <p>
                    The current Services are experimental and/or demonstration experiences. Availability, performance,
                    outputs, and integrations may change without notice.
                </p>
                <p>
                    Current experimental or demo usage may be measured for operational, reliability, capacity, or pilot
                    management purposes. Measurement or metering does not itself mean that a payment was charged or that a
                    paid subscription exists. Any future paid service will be governed by the applicable commercial terms
                    and pricing presented at the time of purchase or enrollment.
                </p>
            </LegalSection>

            <LegalSection title="4. Responsible use">
                <p>You must not:</p>
                <LegalList>
                    <li>use the Services unlawfully, fraudulently, or to violate another person&apos;s rights;</li>
                    <li>submit credentials, secrets, payment-card data, regulated records, or other sensitive information to an experimental session;</li>
                    <li>interfere with, probe, reverse engineer, overload, or attempt unauthorized access to the Services or connected systems;</li>
                    <li>use an AI output as a substitute for professional legal, medical, financial, safety, employment, housing, education, or other high-impact advice;</li>
                    <li>impersonate another person or misrepresent your authority to submit information, meeting links, addresses, or business data; or</li>
                    <li>use the Services to create or distribute harmful, abusive, deceptive, or unlawful content.</li>
                </LegalList>
                <p>
                    You are responsible for the accuracy and legality of information you submit and for obtaining any
                    permission needed to provide another person&apos;s information, meeting link, or address.
                </p>
            </LegalSection>

            <LegalSection title="5. AI outputs and human review">
                <p>
                    AI-generated responses, summaries, recommendations, route information, and other outputs may be
                    incomplete, incorrect, stale, or unsuitable for your situation. Review important outputs independently
                    before relying on them or taking action. The Services do not guarantee a particular business result,
                    lead, appointment, route, answer, or outcome.
                </p>
            </LegalSection>

            <LegalSection title="6. Conversations, records, and privacy">
                <p>
                    The Services may process voice input, conversation turns, email verification information, optional
                    recap or memory choices, meeting details, and user-provided route addresses. The Privacy Policy
                    describes current data-handling practices.
                </p>
                <p>
                    The primary session-spine design records transcript status, turn count, and a content hash rather than
                    the raw transcript. A legacy fallback transcript-persistence route exists, and whether it is active in
                    the deployed public environment is unknown. The Services do not promise that raw transcripts are never
                    stored, that providers never retain data, or that infrastructure never logs request metadata.
                </p>
                <p>
                    Do not use the Services for secrets or information that requires a retention, confidentiality, or
                    security guarantee that the current experimental Services do not provide.
                </p>
            </LegalSection>

            <LegalSection title="7. Third-party services">
                <p>
                    The Services may rely on third-party categories including AI, avatar, voice, and video; email and
                    communications; geocoding and location; meeting and scheduling; hosting and storage; security; and
                    operational services. Current Services directly use Anam for avatar, voice, video, session, and
                    meeting-invite functions; AgentMail and Resend for email workflows; and Geoapify and the U.S. Census
                    Geocoder for available Evan address geocoding.
                </p>
                <p>
                    Third-party services are subject to their own terms and policies. We do not control and do not make
                    unsupported promises about their availability, retention, security, logging, or use of information.
                </p>
            </LegalSection>

            <LegalSection title="8. User submissions and feedback">
                <p>
                    You retain rights you may have in information you submit. You grant Rob Vicks, doing business as AI
                    Fusion Labs, a limited, non-exclusive license to host, process, transmit, display, and otherwise use
                    those submissions as reasonably necessary to provide, secure, troubleshoot, administer, and complete the
                    feature you requested, subject to the Privacy Policy and any additional consent presented in the
                    applicable flow.
                </p>
                <p>
                    Do not submit information you lack the right to use or disclose. Feedback may be used without
                    compensation unless the parties separately agree otherwise.
                </p>
            </LegalSection>

            <LegalSection title="9. Ownership">
                <p>
                    The Services, site design, software, branding, documentation, and related materials are owned by or
                    licensed to Rob Vicks, doing business as AI Fusion Labs, or its licensors. These Terms grant you a
                    limited right to access and use the current Services for their intended purpose. No ownership interest
                    is transferred to you.
                </p>
            </LegalSection>

            <LegalSection title="10. Privacy, security, and communications">
                <p>
                    The Privacy Policy is incorporated into these Terms by reference. You consent to service-related
                    communications necessary to provide the Services. Optional recap, memory, and follow-up emails are
                    handled through the choices presented in the applicable flow.
                </p>
                <p>
                    Questions about these Terms should be directed to
                    <a className="ml-1 text-teal-300 underline decoration-teal-700 underline-offset-4" href="mailto:XAgents@aifusionlabs.app">
                        XAgents@aifusionlabs.app
                    </a>.
                </p>
            </LegalSection>

            <LegalSection title="11. Suspension and termination">
                <p>
                    Rob Vicks, doing business as AI Fusion Labs, may suspend or terminate access to protect the Services,
                    users, third parties, or connected systems, or to address misuse, security risk, legal requirements, or
                    operational constraints. You may stop using the Services at any time. Provisions that by their nature
                    should survive termination will survive, including provisions concerning ownership, submissions,
                    disclaimers, limitations, indemnity, and dispute handling.
                </p>
            </LegalSection>

            <LegalSection title="12. Disclaimers, limitation of liability, and indemnity">
                <p>
                    The Services are experimental and are provided on an availability basis. To the maximum extent
                    permitted by applicable law, Rob Vicks, doing business as AI Fusion Labs, disclaims implied warranties
                    and does not warrant uninterrupted, error-free, secure, accurate, or continuously available operation.
                    The Services and outputs are provided without a guarantee of fitness for a particular purpose or
                    business result.
                </p>
                <p>
                    To the maximum extent permitted by applicable law, Rob Vicks, doing business as AI Fusion Labs, will
                    not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for
                    lost profits, revenue, data, goodwill, or business opportunities arising from or related to the
                    Services.
                </p>
                <p>
                    You agree to defend, indemnify, and hold harmless Rob Vicks, doing business as AI Fusion Labs, and its
                    personnel, licensors, and service providers from claims, losses, liabilities, costs, and expenses
                    arising from your unlawful use of the Services, your submissions, your violation of these Terms, or your
                    violation of another person&apos;s rights, subject to any limitations and procedures required by applicable
                    law.
                </p>
            </LegalSection>

            <LegalSection title="13. Changes">
                <p>
                    Rob Vicks, doing business as AI Fusion Labs, may update these Terms as the Services change. The version
                    and effective date will be updated when revised Terms are published. Continued use after publication of
                    an updated version means you accept the updated Terms to the extent permitted by law.
                </p>
            </LegalSection>
        </LegalPage>
    );
}
