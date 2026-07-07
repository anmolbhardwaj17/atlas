import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy · Atlas" };

/**
 * Privacy Policy (template). Placeholder boilerplate reflecting how Atlas actually works
 * (read-only connectors, org-scoped isolation, sub-processors). NOT legal advice; have counsel
 * review and replace before relying on it.
 */
export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-neutral-500">Last updated: 8 July 2026</p>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This is a template for review. Replace it with a policy approved by your legal counsel
          before launch.
        </p>
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
            repositories, deployments, and dependencies, used to build your graph.
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
        We rely on a small set of vetted providers to run the Service, such as cloud hosting and
        Supabase for managed database, authentication, and storage. Each is bound by data-protection
        obligations consistent with this policy.
      </Section>

      <Section title="6. Retention & deletion">
        We keep your data for as long as your account is active. Disconnecting a source removes the
        data derived from it, and closing your account deletes your organization&rsquo;s data within
        a reasonable period, subject to legal requirements.
      </Section>

      <Section title="7. Your rights">
        You may access, correct, export, or delete your personal data. Contact us and we will
        respond within the timeframes required by applicable law.
      </Section>

      <Section title="8. Contact">
        Privacy questions? Reach our team at{" "}
        <a href="mailto:privacy@atlas.example" className="underline underline-offset-2">
          privacy@atlas.example
        </a>
        .
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="leading-relaxed text-neutral-600">{children}</div>
    </section>
  );
}
