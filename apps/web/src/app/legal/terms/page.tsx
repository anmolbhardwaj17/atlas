import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service · Atlas" };

/**
 * Terms of Service (template). This is placeholder boilerplate written to be reasonable for a
 * B2B read-only intelligence product; it is NOT legal advice. Have counsel review and replace
 * before relying on it.
 */
export default function TermsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-neutral-500">Last updated: 8 July 2026</p>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This is a template for review. Replace it with terms approved by your legal counsel before
          launch.
        </p>
      </header>

      <Section title="1. Agreement">
        These Terms of Service (the &ldquo;Terms&rdquo;) govern your access to and use of Atlas (the
        &ldquo;Service&rdquo;). By creating an account or using the Service, you agree to these
        Terms on behalf of yourself and the organization you represent.
      </Section>

      <Section title="2. The Service">
        Atlas connects to systems you authorize (such as your cloud accounts and code repositories)
        using read-only access, and builds a knowledge graph that helps your team understand and
        operate its infrastructure and code. Atlas does not modify your connected systems.
      </Section>

      <Section title="3. Your account">
        You are responsible for the activity under your account and for keeping your credentials
        secure. You must have authority to connect any system you add, and you must comply with the
        terms of those third-party providers.
      </Section>

      <Section title="4. Acceptable use">
        You agree not to misuse the Service: no attempting to breach security or tenancy boundaries,
        no reverse engineering, no using the Service to build a competing product, and no uploading
        unlawful content. We may suspend access that puts the Service or other customers at risk.
      </Section>

      <Section title="5. Your data">
        You retain all rights to the data you connect. You grant Atlas the limited rights needed to
        operate the Service for you, as described in our{" "}
        <a href="/legal/privacy" className="underline underline-offset-2">
          Privacy Policy
        </a>
        . We process your data only to provide and improve the Service.
      </Section>

      <Section title="6. Availability & changes">
        We work to keep the Service available and accurate, but it is provided on an &ldquo;as
        is&rdquo; basis without warranties. We may update the Service and these Terms; material
        changes will be communicated in advance where practical.
      </Section>

      <Section title="7. Liability">
        To the maximum extent permitted by law, Atlas is not liable for indirect or consequential
        damages, and our total liability is limited to the amounts you paid for the Service in the
        preceding twelve months.
      </Section>

      <Section title="8. Contact">
        Questions about these Terms? Reach us at{" "}
        <a href="mailto:legal@atlas.example" className="underline underline-offset-2">
          legal@atlas.example
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
      <p className="leading-relaxed text-neutral-600">{children}</p>
    </section>
  );
}
