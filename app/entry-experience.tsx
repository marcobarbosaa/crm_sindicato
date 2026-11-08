import { PublicHeader, PublicFooter } from "./landing/public-navigation";
import { Hero, OrganizationSection, HowItWorksSection, ResourcesSection, AccessSection } from "./landing/sections";
import styles from "./landing/landing.module.css";
import { ProductStory } from "./landing/product-story";

export function EntryExperience({ accessHref }: { accessHref: string }) {
  return (
    <div className={styles.landing}>
      <a className={styles.skip} href="#inicio">Pular para o conteúdo</a>
      <PublicHeader />
      <main>
        <Hero />
        <OrganizationSection />
        <ProductStory />
        <HowItWorksSection />
        <ResourcesSection />
        <AccessSection accessHref={accessHref} />
      </main>
      <PublicFooter />
    </div>
  );
}
