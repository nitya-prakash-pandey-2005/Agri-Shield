import Link from "next/link";
import { Github, Linkedin, Mail, Twitter } from "lucide-react";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { LogoMark, Wordmark } from "./Logo";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Platform",
    links: [
      { label: "Farmer portal", href: "/dashboard/farmer" },
      { label: "Government portal", href: "/dashboard/government" },
      { label: "Supply chain portal", href: "/dashboard/supply-chain" },
      { label: "Live risk map", href: "/#demo" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "API reference", href: "/docs/api-reference" },
      { label: "Webhooks", href: "/docs/integration-guide" },
      { label: "Methodology", href: "/docs/methodology-flood" },
      { label: "Data sources", href: "/docs/data-sources" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Pitch", href: "/pitch" },
      { label: "Request a demo", href: "/#request-demo" },
      { label: "Security", href: "/docs/security" },
      { label: "Privacy policy", href: "/docs/privacy" },
      { label: "Terms of service", href: "/docs/terms" },
    ],
  },
];

const BADGES = [
  { label: "ISO 27001-ready controls", detail: "Access control, audit log, encryption in transit" },
  { label: "GDPR · DPDP Act 2023", detail: "Consent, export and deletion on request" },
  { label: "Open data only", detail: "NASA, Copernicus, Open-Meteo, GDACS" },
  { label: "Offline-first", detail: "PWA + SMS fallback for feature phones" },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/[0.06] bg-[#040810]" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_2fr]">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2" aria-label="Agri-SHIELD home">
              <LogoMark size={28} />
              <Wordmark />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              Climate decision intelligence for Asia’s deltas. Flood and saltwater-intrusion warnings that reach farmers, agencies and buyers while there is still time to act.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {[
                { icon: Github, label: "GitHub", href: "https://github.com/" },
                { icon: Linkedin, label: "LinkedIn", href: "https://www.linkedin.com/" },
                { icon: Twitter, label: "X (Twitter)", href: "https://x.com/" },
                { icon: Mail, label: "Email", href: "mailto:partners@agrishield.io" },
              ].map(({ icon: Icon, label, href }) => (
                <a key={label} href={href} aria-label={label} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-emerald-400/40 hover:text-white">
                  <Icon size={16} />
                </a>
              ))}
            </div>
            <div className="mt-5">
              <LanguageSwitcher align="left" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((c) => (
              <nav key={c.title} aria-label={c.title}>
                <h3 className="text-sm font-medium text-white">{c.title}</h3>
                <ul className="mt-3 space-y-1">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="inline-flex min-h-[32px] items-center text-sm text-slate-400 transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Trust and compliance">
          {BADGES.map((b) => (
            <li key={b.label} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="mt-0.5 shrink-0 text-emerald-400">
                <path d="M12 2 20 5v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="1.5" />
                <path d="m8.5 12 2.4 2.4L15.5 9.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div>
                <div className="text-[13px] font-medium text-slate-200">{b.label}</div>
                <div className="text-xs text-slate-500">{b.detail}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/[0.06] pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Agri-SHIELD · Built by <span className="text-slate-300">Nitya Prakash Pandey</span>
          </p>
          <p>
            Weather &amp; river data: Open-Meteo (CC BY 4.0), Copernicus GloFAS · Imagery: NASA GIBS · Hazards: GDACS, NASA EONET.{" "}
            <Link href="/docs/data-sources" className="underline decoration-slate-600 underline-offset-2 hover:text-slate-300">
              Attribution
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
