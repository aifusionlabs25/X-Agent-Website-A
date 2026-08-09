import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ALL_AGENTS } from '@/lib/agents';
import InsightMotionMark from './InsightMotionMark';
import styles from './AmyInsightLanding.module.css';

const conversationOutcomes = [
  {
    number: '01',
    kicker: 'Make the case',
    title: 'A sharper business story',
    copy: 'Turn the initiative, business impact, and urgency into a case that people can act on.',
  },
  {
    number: '02',
    kicker: 'Map the room',
    title: 'A clearer buying conversation',
    copy: 'Surface the stakeholders, constraints, decision path, and questions that could slow momentum.',
  },
  {
    number: '03',
    kicker: 'Move it forward',
    title: 'An Insight-ready next step',
    copy: 'Prepare a focused handoff when the opportunity is ready for the right Insight specialist.',
  },
];

const technologyTopics = [
  'Cloud and infrastructure',
  'Cybersecurity',
  'Data and AI',
  'Modern workplace',
  'Applications',
];

const amyDemoHref = ALL_AGENTS.find((agent) => agent.slug === 'amy')?.liveUrl ?? '/demo/amy';

export default function AmyInsightLanding() {
  return (
    <main id="amy-insight-landing" className={styles.page}>
      <section className={styles.hero} aria-labelledby="amy-insight-heading">
        <div className={styles.brandBar}>
          <Image
            src="/agents/insight-logo.png"
            alt="Insight"
            width={190}
            height={78}
            className={styles.logo}
            priority
          />
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.copy}>
            <div className={styles.copyMotion}>
              <InsightMotionMark className={styles.motionMark} />
            </div>
            <p className={styles.eyebrow}>Amy · Senior SDR for Insight</p>
            <h1 id="amy-insight-heading">Bring your most important technology question into the room.</h1>
            <p className={styles.lede}>
              Amy leads a focused executive conversation that gets beyond the surface. Clarify
              the priority, pressure-test the business case, and prepare the right next meeting
              with Insight.
            </p>

            <div className={styles.actions}>
              <Link href={amyDemoHref} className={styles.primaryAction}>
                Meet with Amy <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>

            <p className={styles.conversationNote}>
              Private conversation · Senior-level discovery · Specialist handoff when it makes sense
            </p>
          </div>

          <div className={styles.visual} aria-label="Amy, senior SDR for Insight">
            <div className={styles.portraitFrame}>
              <Image
                src="/agents/amy-insight-sdr-hero-polished.webp"
                alt="Amy, senior SDR for Insight"
                fill
                priority
                sizes="(max-width: 900px) 88vw, 44vw"
                className={styles.portrait}
              />
            </div>
          </div>
        </div>

        <p className={styles.prototypeNote}>
          Independent AI Fusion Labs concept · Not produced or approved by Insight
        </p>
      </section>

      <section className={styles.process} aria-labelledby="process-heading">
        <div className={styles.processGlow} aria-hidden="true" />
        <div className={styles.processIntro}>
          <p className={styles.eyebrow}>What the conversation is designed to unlock</p>
          <h2 id="process-heading">Bring the initiative. Leave with a clearer path forward.</h2>
          <p>
            Amy helps turn a broad technology discussion into something your team can move:
            a stronger case, a clearer buying path, and a useful next conversation.
          </p>
        </div>

        <div className={styles.stageGrid}>
          {conversationOutcomes.map((outcome, index) => (
            <article
              key={outcome.number}
              className={`${styles.stageCard} ${index === 0 ? styles.featuredCard : ''}`}
            >
              <div className={styles.cardTopline}>
                <span>{outcome.number}</span>
                <span>{outcome.kicker}</span>
              </div>
              <h3>{outcome.title}</h3>
              <p>{outcome.copy}</p>
            </article>
          ))}
        </div>

        <div className={styles.topicRail} aria-label="Technology conversation areas">
          <span className={styles.topicLabel}>Start where the pressure is</span>
          <div className={styles.topics}>
            {technologyTopics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
        </div>

        <div className={styles.boundary}>
          <div>
            <strong>Amy shapes the opportunity.</strong>
            <span>
              Insight specialists own recommendations, architecture, scope, pricing,
              commitments, and delivery.
            </span>
          </div>
          <Link href={amyDemoHref} className={styles.boundaryAction}>
            Put your question on the table <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
