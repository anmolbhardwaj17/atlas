import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy · Atlas" };

/**
 * Privacy Policy.
 *
 * ⚠️ STILL AWAITING COUNSEL REVIEW — tracked on the project board. What was removed from this page
 * was the visitor-facing "DRAFT" marker and a review banner addressed to the operator ("your counsel
 * must confirm…"), which was internal process leaking onto a public page linked from the login
 * screen. Removing it changes nothing legally; it stops us publishing a note-to-self. Do not treat
 * this comment's absence as sign-off.
 *
 * The content below is written to reflect how Atlas ACTUALLY handles data
 * (read-only connectors, org-scoped isolation, the real sub-processor set, retention windows, and the
 * access/erasure paths that exist in code) so counsel reviews accurate facts — NOT a generic template.
 * It is still NOT legal advice: a lawyer must confirm the legal framing (lawful basis, transfer
 * mechanism/SCCs, DSAR turnaround commitments, controller/processor roles) and finalize before launch.
 */
export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: 15 July 2026</p>
      </header>

      <Section title="1. Overview">
        This policy explains what Atlas collects, why, and the choices you have. We collect the
        minimum needed to run the Service and never sell your data.
      </Section>

      <Section title="2. What we collect">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Account data</strong>: your name, email, and profile photo from Google sign-in.
          </li>
          <li>
            <strong>Connected-system data</strong>: read-only metadata about your cloud resources,
            repositories, deployments, and dependencies, used to build your graph. This can include
            personal data such as commit and pull-request author names, and ticket assignees.
          </li>
          <li>
            <strong>Usage data</strong>: logs and events needed to operate, secure, and improve the
            Service.
          </li>
        </ul>
      </Section>

      <Section title="3. How we use it">
        We use your data to provide the Service: to build and keep your knowledge graph current, to
        answer your questions with citations, to send the alerts you configure, and to keep the
        platform secure. We do not use your connected-system data to train shared models.
      </Section>

      <Section title="4. Read-only by design">
        Atlas requests read-only access to your systems and never writes to your cloud or code. Your
        data is isolated per organization at every layer, so one customer can never see another
        customer&rsquo;s data.
      </Section>

      <Section title="5. Sub-processors">
        <p>We rely on a small set of vetted providers to run the Service:</p>
        <ul className="ml-5 mt-2 list-disc space-y-1">
          <li>
            <strong>Supabase</strong> - managed Postgres database, authentication, and file storage.
          </li>
          <li>
            <strong>Amazon Web Services</strong> - cloud hosting and infrastructure.
          </li>
          <li>
            <strong>Anthropic</strong> - the AI model that powers cited answers and diagnosis.
            Relevant graph context (which can include the personal data in section 2) is sent to
            answer your questions.
          </li>
          <li>
            <strong>Resend</strong> - transactional and notification email delivery.
          </li>
        </ul>
        <p className="mt-2">
          If your organization configures its own AI provider (bring-your-own key), the relevant
          context is sent to that provider instead, under your agreement with them. Each
          sub-processor is bound by data-protection obligations consistent with this policy.
        </p>
      </Section>

      <Section title="6. Where your data is processed">
        The Service is hosted in Australia (Sydney). AI processing may occur in the United States
        via our model provider. Where personal data is transferred across borders, we rely on
        appropriate safeguards as required by applicable law.{" "}
        <em className="text-warning">
          [Legal to confirm the transfer mechanism - e.g. Standard Contractual Clauses - and data-
          residency commitments.]
        </em>
      </Section>

      <Section title="7. Retention & deletion">
        We keep your data for as long as your account is active. Raw source snapshots are kept on a
        rolling window (typically 30 days) and activity history for a limited period; older records
        are automatically purged. <strong>Disconnecting a source</strong> removes the data derived
        from it - including the stored credential and the raw snapshots - and{" "}
        <strong>closing your account</strong> deletes your organization&rsquo;s data, including
        files in storage, subject to legal requirements.
      </Section>

      <Section title="8. Your rights">
        You may access, correct, export, or delete your personal data. Organization admins can
        export the personal data we hold for the organization from the app; deletion requests are
        honored by disconnecting a source or deleting the organization, and we can assist with
        individual requests. We respond within the timeframes required by applicable law.{" "}
        <em className="text-warning">[Legal to set the committed response window.]</em>
      </Section>

      <Section title="9. Contact">
        Privacy questions? Reach our team at{" "}
        <a href="mailto:privacy@atlas.example" className="underline underline-offset-2">
          privacy@atlas.example
        </a>
        . <em className="text-warning">[Replace with your monitored privacy contact address.]</em>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}
