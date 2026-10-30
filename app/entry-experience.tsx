import { PublicHeader, PublicFooter } from "./landing/public-navigation";
import { Hero, OrganizationSection, OverviewSection, FeatureSections, ResourcesSection, AccessSection } from "./landing/sections";
import styles from "./landing/landing.module.css";

export function EntryExperience({ accessHref }: { accessHref: string }) {
  return (
    <div className={styles.landing}>
      <a className={styles.skip} href="#inicio">Pular para o conteúdo</a>
      <PublicHeader />
      <main>
        <Hero />
        <OrganizationSection />
        <OverviewSection />
        <FeatureSections />
        <ResourcesSection />
        <AccessSection accessHref={accessHref} />
      </main>
      <PublicFooter />
    </div>
  );
}
